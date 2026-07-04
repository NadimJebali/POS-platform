// Issuing a license can start the subscription in the same step (record the first
// payment), so a new license doesn't have to sit at "Never paid".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { hashPassword, SESSION_COOKIE } from '../src/auth.js'
import { testKeys, seedDb, insertCustomer } from './helpers.js'

const PASSWORD = 'admin-pass'

function form(fields) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString()
  }
}

async function loggedIn() {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({ db, privateKey, adminPasswordHash: hashPassword(PASSWORD), cookieSecure: false })
  const login = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password: PASSWORD }) })
  const cookie = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE).value }
  return { db, app, cookie }
}

const issue = (app, cookie, customerId, fields) =>
  app.inject({ method: 'POST', url: `/admin/customers/${customerId}/licenses`, cookies: cookie, ...form(fields) })
const getPage = (app, cookie, url) => app.inject({ method: 'GET', url, cookies: cookie })

test('issuing a license with a 1-month period starts the subscription (Active, not Never paid)', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Start')

  const res = await issue(app, cookie, cid, { max_machines: '1', months: '1' })
  assert.equal(res.statusCode, 302)

  const page = await getPage(app, cookie, `/admin/customers/${cid}`)
  assert.match(page.body, /Active/)
  assert.doesNotMatch(page.body, /Never paid/)
})

test('issuing with no period leaves the license "Never paid" (unchanged behavior)', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café None')

  await issue(app, cookie, cid, { max_machines: '1', months: '0' })

  const page = await getPage(app, cookie, `/admin/customers/${cid}`)
  assert.match(page.body, /Never paid/)
})

test('issuing with a 1-year period records a year of coverage', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Year')

  await issue(app, cookie, cid, { max_machines: '1', months: '12' })

  const licenseId = db.prepare('SELECT id FROM licenses WHERE customer_id = ?').get(cid).id
  const page = await getPage(app, cookie, `/admin/licenses/${licenseId}`)
  assert.match(page.body, /Active/)
  assert.match(page.body, /1 year/) // the payment ledger shows a yearly entry
})

test('the issue-license form offers a start-subscription period selector', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Form')
  const page = await getPage(app, cookie, `/admin/customers/${cid}`)
  assert.match(page.body, /name="months"/)
  assert.match(page.body, /1 year/)
})
