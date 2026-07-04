// HTTP-inject tests for customer archive / unarchive / permanent delete.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { hashPassword, SESSION_COOKIE } from '../src/auth.js'
import { testKeys, seedDb, insertCustomer, insertLicense, insertPayment } from './helpers.js'

const PASSWORD = 'admin-pass'

function form(fields) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString()
  }
}

async function setup() {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({ db, privateKey, adminPasswordHash: hashPassword(PASSWORD), cookieSecure: false })
  const login = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password: PASSWORD }) })
  const cookie = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE).value }
  return { db, app, cookie }
}

const post = (app, url, cookie, fields = {}) => app.inject({ method: 'POST', url, cookies: cookie, ...form(fields) })
const get = (app, url, cookie) => app.inject({ method: 'GET', url, cookies: cookie })

test('archiving hides a customer from the active list but shows in archived', async () => {
  const { db, app, cookie } = await setup()
  const id = insertCustomer(db, 'Café Churn')

  await post(app, `/admin/customers/${id}/archive`, cookie)

  const active = await get(app, '/admin', cookie)
  assert.doesNotMatch(active.body, /Café Churn/)

  const archived = await get(app, '/admin?archived=1', cookie)
  assert.match(archived.body, /Café Churn/)
})

test('unarchiving brings a customer back to the active list', async () => {
  const { db, app, cookie } = await setup()
  const id = insertCustomer(db, 'Café Return')
  await post(app, `/admin/customers/${id}/archive`, cookie)
  await post(app, `/admin/customers/${id}/unarchive`, cookie)
  const active = await get(app, '/admin', cookie)
  assert.match(active.body, /Café Return/)
})

test('permanent delete is refused unless the customer is archived first', async () => {
  const { db, app, cookie } = await setup()
  const id = insertCustomer(db, 'Café Active')
  const res = await post(app, `/admin/customers/${id}/delete`, cookie, { confirm: 'yes' })
  assert.equal(res.statusCode, 409)
  assert.ok(db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) // still there
})

test('permanent delete requires the confirm field', async () => {
  const { db, app, cookie } = await setup()
  const id = insertCustomer(db, 'Café NoConfirm')
  await post(app, `/admin/customers/${id}/archive`, cookie)
  const res = await post(app, `/admin/customers/${id}/delete`, cookie) // no confirm
  assert.equal(res.statusCode, 400)
  assert.ok(db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id))
})

test('permanent delete of an archived customer cascades through all their records', async () => {
  const { db, app, cookie } = await setup()
  const id = insertCustomer(db, 'Café Gone')
  const { id: licenseId, code } = insertLicense(db, { customerId: id })
  insertPayment(db, { licenseId, months: 12 })
  // give it a bound machine + a transfer via real endpoints
  await app.inject({ method: 'POST', url: '/activate', payload: { code, machineId: 'M1' } })
  db.prepare('INSERT INTO transfers (license_id, from_machine_id, to_machine_id, created_at) VALUES (?,?,?,?)').run(licenseId, 'M0', 'M1', Date.now())

  await post(app, `/admin/customers/${id}/archive`, cookie)
  const res = await post(app, `/admin/customers/${id}/delete`, cookie, { confirm: 'yes' })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, '/admin')

  // Customer and every dependent row are gone.
  assert.equal(db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id), undefined)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE customer_id = ?').get(id).n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments WHERE license_id = ?').get(licenseId).n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM machines WHERE license_id = ?').get(licenseId).n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE license_id = ?').get(licenseId).n, 0)
})

test('archived customers are hidden but their records still exist (soft delete)', async () => {
  const { db, app, cookie } = await setup()
  const id = insertCustomer(db, 'Café Soft')
  const { id: licenseId } = insertLicense(db, { customerId: id })
  insertPayment(db, { licenseId, months: 1 })
  await post(app, `/admin/customers/${id}/archive`, cookie)
  // Payment ledger survives archiving.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments WHERE license_id = ?').get(licenseId).n, 1)
})

test('customer lifecycle routes require authentication', async () => {
  const { db, app } = await setup()
  const id = insertCustomer(db, 'Café Auth')
  const res = await app.inject({ method: 'POST', url: `/admin/customers/${id}/archive`, ...form({}) })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, '/admin/login')
})
