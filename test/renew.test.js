// HTTP-inject tests for POST /renew.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { verifyLicense, signLicense, buildPayload } from '../src/license-format.js'
import { addMonths } from '../src/payments.js'
import { getIntSetting } from '../src/db.js'
import { testKeys, seedDb, insertCustomer, insertLicense, insertPayment } from './helpers.js'

const DAY = 86400000

// Builds a licensed machine: active license, MACHINE-A bound via a real activation,
// and (by default) a payment that leaves it fully paid up. Returns the current key.
async function setup({ status = 'active', maxMachines = 1, paidMonths = 12, paidAt = Date.now() } = {}) {
  const db = seedDb()
  const { publicKey, privateKey } = testKeys()
  const app = buildApp({ db, privateKey })
  const customerId = insertCustomer(db)
  const { id: licenseId, code } = insertLicense(db, { customerId, maxMachines })
  const act = await app.inject({
    method: 'POST',
    url: '/activate',
    payload: { code, machineId: 'MACHINE-A', appVersion: '0.2.0' }
  })
  const key = act.json().license_key
  if (paidMonths) insertPayment(db, { licenseId, months: paidMonths, createdAt: paidAt })
  if (status !== 'active') db.prepare('UPDATE licenses SET status = ? WHERE id = ?').run(status, licenseId)
  return { db, app, publicKey, privateKey, licenseId, code, key }
}

function renew(app, body) {
  return app.inject({ method: 'POST', url: '/renew', payload: body })
}

test('paid license renews with a fresh, later exp and no grace flag', async () => {
  const { app, publicKey, key } = await setup({ paidMonths: 12 })
  const old = verifyLicense(key, publicKey)
  const res = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.graceUntil, null)
  const fresh = verifyLicense(body.license_key, publicKey)
  assert.ok(fresh.exp >= old.exp)
  assert.ok(Math.abs(fresh.exp - (Date.now() + 30 * DAY)) < 2000)
})

test('within the grace window it still renews and carries graceUntil', async () => {
  // paid_until sits ~2 days in the past (inside the 7-day grace window).
  const paidAt = addMonths(Date.now() - 2 * DAY, -1)
  const { app, publicKey, key } = await setup({ paidMonths: 1, paidAt })
  const res = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.ok(body.graceUntil != null)
  assert.ok(body.graceUntil > Date.now()) // grace deadline is still ahead
  const fresh = verifyLicense(body.license_key, publicKey)
  assert.equal(fresh.graceUntil, body.graceUntil)
})

test('lapsed past the grace window is refused', async () => {
  const paidAt = addMonths(Date.now() - 10 * DAY, -1) // paid_until ~10 days ago, grace is 7
  const { app, key } = await setup({ paidMonths: 1, paidAt })
  const res = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'lapsed')
})

test('a never-paid license is refused (dies after the activation window)', async () => {
  const { app, key } = await setup({ paidMonths: 0 })
  const res = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'lapsed')
})

test('suspended license is refused', async () => {
  const { app, key } = await setup({ status: 'suspended' })
  const res = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'suspended')
})

test('revoked license is refused', async () => {
  const { app, key } = await setup({ status: 'revoked' })
  const res = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'revoked')
})

test('a key presented by the wrong machine is refused', async () => {
  const { app, key } = await setup()
  const res = await renew(app, { license_key: key, machineId: 'SOME-OTHER-MACHINE' })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'machine_mismatch')
})

test('a forged signature is refused', async () => {
  const { app, licenseId } = await setup()
  const other = testKeys() // different keypair than the server's
  const forged = signLicense(
    buildPayload({ lid: licenseId, machineId: 'MACHINE-A', name: 'x', now: Date.now(), renewalWindowDays: 30, warnDays: 7 }),
    other.privateKey
  )
  const res = await renew(app, { license_key: forged, machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 401)
  assert.equal(res.json().error, 'invalid_key')
})

test('an expired but genuine key still renews when the license is in good standing', async () => {
  const { app, publicKey, privateKey, licenseId } = await setup({ paidMonths: 12 })
  // A key issued 60 days ago with a 30-day window: long expired, but validly signed.
  const expiredKey = signLicense(
    buildPayload({
      lid: licenseId,
      machineId: 'MACHINE-A',
      name: 'Café Test',
      now: Date.now() - 60 * DAY,
      renewalWindowDays: 30,
      warnDays: 7
    }),
    privateKey
  )
  assert.ok(verifyLicense(expiredKey, publicKey).exp < Date.now()) // confirm it's expired
  const res = await renew(app, { license_key: expiredKey, machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 200)
  assert.ok(verifyLicense(res.json().license_key, publicKey).exp > Date.now())
})

test('a machine unbound after rebind can no longer renew', async () => {
  const { app, db, licenseId, key } = await setup()
  db.prepare('UPDATE machines SET unbound_at = ? WHERE license_id = ? AND machine_id = ?').run(
    Date.now(),
    licenseId,
    'MACHINE-A'
  )
  const res = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'unbound')
})

test('changing renewal_window_days takes effect on the next renewal', async () => {
  const { app, db, publicKey, key } = await setup()
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('45', 'renewal_window_days')
  const res = await renew(app, { license_key: key, machineId: 'MACHINE-A' })
  assert.equal(getIntSetting(db, 'renewal_window_days'), 45)
  const fresh = verifyLicense(res.json().license_key, publicKey)
  assert.ok(Math.abs(fresh.exp - (Date.now() + 45 * DAY)) < 2000)
})

test('renewal records last_seen_at and app_version', async () => {
  const { app, db, licenseId, key } = await setup()
  await renew(app, { license_key: key, machineId: 'MACHINE-A', appVersion: '0.3.0' })
  const m = db.prepare('SELECT app_version, last_seen_at FROM machines WHERE license_id = ?').get(licenseId)
  assert.equal(m.app_version, '0.3.0')
  assert.ok(Date.now() - m.last_seen_at < 2000)
})
