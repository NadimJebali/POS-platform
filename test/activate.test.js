// HTTP-inject tests for POST /activate — real Fastify app over an in-memory DB and a
// throwaway keypair, driven with app.inject(). No network, no files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { verifyLicense } from '../src/license-format.js'
import { formatActivationCode } from '../src/activation-code.js'
import { getIntSetting } from '../src/db.js'
import { testKeys, seedDb, insertCustomer, insertLicense } from './helpers.js'

function ctx({ status = 'active', maxMachines = 1 } = {}) {
  const db = seedDb()
  const { publicKey, privateKey } = testKeys()
  const app = buildApp({ db, privateKey })
  const customerId = insertCustomer(db)
  const { id, code } = insertLicense(db, { customerId, status, maxMachines })
  return { db, app, publicKey, licenseId: id, code }
}

async function activate(app, body) {
  return app.inject({ method: 'POST', url: '/activate', payload: body })
}

test('happy path: returns a license key that verifies and is machine-bound', async () => {
  const { app, publicKey, code } = ctx()
  const res = await activate(app, { code, machineId: 'MACHINE-A', appVersion: '0.2.0' })
  assert.equal(res.statusCode, 200)
  const { license_key, exp } = res.json()
  const payload = verifyLicense(license_key, publicKey)
  assert.equal(payload.machineId, 'MACHINE-A')
  assert.equal(payload.exp, exp)
  assert.ok(exp > Date.now())
})

test('exp reflects the renewal_window_days setting from the DB', async () => {
  const { app, db, publicKey, code } = ctx()
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('45', 'renewal_window_days')
  const res = await activate(app, { code, machineId: 'MACHINE-A' })
  const payload = verifyLicense(res.json().license_key, publicKey)
  const window = getIntSetting(db, 'renewal_window_days')
  assert.equal(window, 45)
  // exp is ~45 days out (allow a second of slack for clock movement in the test).
  assert.ok(Math.abs(payload.exp - (Date.now() + 45 * 86400000)) < 1000)
})

test('accepts the pretty dash-grouped form of the code', async () => {
  const { app, code } = ctx()
  const res = await activate(app, { code: formatActivationCode(code), machineId: 'MACHINE-A' })
  assert.equal(res.statusCode, 200)
})

test('unknown code -> 404 invalid_code', async () => {
  const { app } = ctx()
  const res = await activate(app, { code: 'POSK-0000-0000-0000-0000-0000', machineId: 'M' })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error, 'invalid_code')
})

test('suspended license -> 403 suspended', async () => {
  const { app, code } = ctx({ status: 'suspended' })
  const res = await activate(app, { code, machineId: 'M' })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'suspended')
})

test('revoked license -> 403 revoked', async () => {
  const { app, code } = ctx({ status: 'revoked' })
  const res = await activate(app, { code, machineId: 'M' })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'revoked')
})

test('second machine on a 1-seat license -> 409 machine_limit', async () => {
  const { app, code } = ctx({ maxMachines: 1 })
  await activate(app, { code, machineId: 'MACHINE-A' })
  const res = await activate(app, { code, machineId: 'MACHINE-B' })
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().error, 'machine_limit')
})

test('two seats allow two machines', async () => {
  const { app, code } = ctx({ maxMachines: 2 })
  assert.equal((await activate(app, { code, machineId: 'MACHINE-A' })).statusCode, 200)
  assert.equal((await activate(app, { code, machineId: 'MACHINE-B' })).statusCode, 200)
  assert.equal((await activate(app, { code, machineId: 'MACHINE-C' })).statusCode, 409)
})

test('re-activating from the same machine is idempotent and updates telemetry', async () => {
  const { app, db, code, licenseId } = ctx()
  await activate(app, { code, machineId: 'MACHINE-A', appVersion: '0.2.0' })
  const res = await activate(app, { code, machineId: 'MACHINE-A', appVersion: '0.3.0' })
  assert.equal(res.statusCode, 200)
  const machines = db
    .prepare('SELECT COUNT(*) AS n FROM machines WHERE license_id = ? AND unbound_at IS NULL')
    .get(licenseId)
  assert.equal(machines.n, 1) // still one binding, not two
  const m = db.prepare('SELECT app_version FROM machines WHERE license_id = ?').get(licenseId)
  assert.equal(m.app_version, '0.3.0') // telemetry advanced
})

test('missing machineId -> 400 bad_request', async () => {
  const { app, code } = ctx()
  const res = await activate(app, { code })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'bad_request')
})
