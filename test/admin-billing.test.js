// HTTP-inject tests for the admin billing/control actions (#9): payments, suspend/
// revoke, manual unbind, and global settings — verified through their effect on
// derived paid_until and on /renew and /activate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { hashPassword, SESSION_COOKIE } from '../src/auth.js'
import { derivePaidUntil, addMonths } from '../src/payments.js'
import { getAllSettings } from '../src/db.js'
import { verifyLicense } from '../src/license-format.js'
import { testKeys, seedDb, insertCustomer, insertLicense } from './helpers.js'

const PASSWORD = 'admin-pass'
const DAY = 86400000

function form(fields) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString()
  }
}

// A logged-in app with an active license and MACHINE-A activated (seat used).
async function setup({ maxMachines = 1 } = {}) {
  const db = seedDb()
  const { privateKey, publicKey } = testKeys()
  const app = buildApp({ db, privateKey, adminPasswordHash: hashPassword(PASSWORD), cookieSecure: false })
  const login = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password: PASSWORD }) })
  const c = login.cookies.find((x) => x.name === SESSION_COOKIE)
  const cookie = { [SESSION_COOKIE]: c.value }

  const customerId = insertCustomer(db)
  const { id: licenseId, code } = insertLicense(db, { customerId, maxMachines })
  const act = await app.inject({ method: 'POST', url: '/activate', payload: { code, machineId: 'MACHINE-A', appVersion: '0.2.0' } })
  const key = act.json().license_key
  return { db, app, publicKey, cookie, licenseId, code, key }
}

const renew = (app, body) => app.inject({ method: 'POST', url: '/renew', payload: body })
const post = (app, url, cookie, fields) => app.inject({ method: 'POST', url, cookies: cookie, ...form(fields) })

test('recording a month payment sets paid_until ~1 month out and lets renewal succeed', async () => {
  const { db, app, cookie, licenseId, key } = await setup()
  assert.equal(derivePaidUntil(db, licenseId), null)
  // Before payment, renewal is refused (unpaid).
  assert.equal((await renew(app, { license_key: key, machineId: 'MACHINE-A' })).statusCode, 403)

  const res = await post(app, `/admin/licenses/${licenseId}/payments`, cookie, { months: '1', amount: '30', method: 'cash' })
  assert.equal(res.statusCode, 302)
  const paid = derivePaidUntil(db, licenseId)
  assert.ok(Math.abs(paid - addMonths(Date.now(), 1)) < 2000)

  const r = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().graceUntil, null)
})

test('a year payment and stacked payments extend coverage cumulatively', async () => {
  const { db, app, cookie, licenseId } = await setup()
  await post(app, `/admin/licenses/${licenseId}/payments`, cookie, { months: '12', amount: '300' })
  assert.ok(Math.abs(derivePaidUntil(db, licenseId) - addMonths(Date.now(), 12)) < 2000)
  await post(app, `/admin/licenses/${licenseId}/payments`, cookie, { months: '1' })
  assert.ok(Math.abs(derivePaidUntil(db, licenseId) - addMonths(Date.now(), 13)) < 2000)
  // Both payments are retained in the append-only ledger.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments WHERE license_id = ?').get(licenseId).n, 2)
})

test('amount is stored in millimes', async () => {
  const { db, app, cookie, licenseId } = await setup()
  await post(app, `/admin/licenses/${licenseId}/payments`, cookie, { months: '1', amount: '30.5' })
  const row = db.prepare('SELECT amount_millimes FROM payments WHERE license_id = ?').get(licenseId)
  assert.equal(row.amount_millimes, 30500)
})

test('suspend blocks renewal; unsuspend restores it', async () => {
  const { app, cookie, licenseId, key } = await setup()
  await post(app, `/admin/licenses/${licenseId}/payments`, cookie, { months: '1' }) // paid up
  await post(app, `/admin/licenses/${licenseId}/status`, cookie, { status: 'suspended' })
  assert.equal((await renew(app, { license_key: key, machineId: 'MACHINE-A' })).json().error, 'suspended')
  await post(app, `/admin/licenses/${licenseId}/status`, cookie, { status: 'active' })
  assert.equal((await renew(app, { license_key: key, machineId: 'MACHINE-A' })).statusCode, 200)
})

test('revoke requires confirmation and is permanent', async () => {
  const { db, app, cookie, licenseId, key } = await setup()
  await post(app, `/admin/licenses/${licenseId}/payments`, cookie, { months: '1' })

  // Without the confirm field, revocation is refused and status stays active.
  const noConfirm = await post(app, `/admin/licenses/${licenseId}/status`, cookie, { status: 'revoked' })
  assert.equal(noConfirm.statusCode, 400)
  assert.equal(db.prepare('SELECT status FROM licenses WHERE id = ?').get(licenseId).status, 'active')

  // With confirm, it revokes and renewal is refused permanently.
  const ok = await post(app, `/admin/licenses/${licenseId}/status`, cookie, { status: 'revoked', confirm: 'yes' })
  assert.equal(ok.statusCode, 302)
  assert.equal((await renew(app, { license_key: key, machineId: 'MACHINE-A' })).json().error, 'revoked')

  // A revoked license is terminal — it cannot be reactivated.
  const reactivate = await post(app, `/admin/licenses/${licenseId}/status`, cookie, { status: 'active' })
  assert.equal(reactivate.statusCode, 409)
  assert.equal(db.prepare('SELECT status FROM licenses WHERE id = ?').get(licenseId).status, 'revoked')
})

test('manual unbind frees a seat so another machine can activate', async () => {
  const { app, cookie, licenseId, code } = await setup({ maxMachines: 1 })
  // Seat is full: a second machine is refused.
  assert.equal((await app.inject({ method: 'POST', url: '/activate', payload: { code, machineId: 'MACHINE-B' } })).statusCode, 409)
  // Unbind MACHINE-A, then MACHINE-B activates into the freed seat.
  const unbind = await post(app, `/admin/licenses/${licenseId}/machines/${encodeURIComponent('MACHINE-A')}/unbind`, cookie, {})
  assert.equal(unbind.statusCode, 302)
  assert.equal((await app.inject({ method: 'POST', url: '/activate', payload: { code, machineId: 'MACHINE-B' } })).statusCode, 200)
})

test('editing settings persists and takes effect on the next renewal', async () => {
  const { db, app, publicKey, cookie, licenseId, key } = await setup()
  await post(app, `/admin/licenses/${licenseId}/payments`, cookie, { months: '12' })
  const res = await post(app, '/admin/settings', cookie, {
    renewal_window_days: '45',
    grace_days: '7',
    transfers_per_year: '2',
    warn_days: '10'
  })
  assert.equal(res.statusCode, 302)
  assert.equal(getAllSettings(db).renewal_window_days, '45')
  assert.equal(getAllSettings(db).warn_days, '10')

  const r = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  const payload = verifyLicense(r.json().license_key, publicKey)
  assert.ok(Math.abs(payload.exp - (Date.now() + 45 * DAY)) < 2000)
  assert.equal(payload.warnDays, 10)
})

test('settings validation rejects non-numeric input', async () => {
  const { app, cookie } = await setup()
  const res = await post(app, '/admin/settings', cookie, { renewal_window_days: 'abc' })
  assert.equal(res.statusCode, 400)
})

test('billing routes require authentication', async () => {
  const { app, licenseId } = await setup()
  const res = await app.inject({ method: 'POST', url: `/admin/licenses/${licenseId}/status`, ...form({ status: 'suspended' }) })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, '/admin/login')
})
