// HTTP-inject tests for POST /rebind (self-service machine transfer).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { verifyLicense } from '../src/license-format.js'
import { testKeys, seedDb, insertCustomer, insertLicense } from './helpers.js'

async function setup({ maxMachines = 1, status = 'active' } = {}) {
  const db = seedDb()
  const { privateKey, publicKey } = testKeys()
  const app = buildApp({ db, privateKey })
  const customerId = insertCustomer(db)
  const { id: licenseId, code } = insertLicense(db, { customerId, maxMachines })
  return { db, app, publicKey, privateKey, licenseId, code }
}

const activate = (app, machineId, code) => app.inject({ method: 'POST', url: '/activate', payload: { code, machineId } })
const rebind = (app, body) => app.inject({ method: 'POST', url: '/rebind', payload: body })
const renew = (app, key, machineId) => app.inject({ method: 'POST', url: '/renew', payload: { license_key: key, machineId } })

test('a full 1-seat license moves to a new machine and issues a fresh key', async () => {
  const { app, publicKey, code } = await setup({ maxMachines: 1 })
  await activate(app, 'OLD-PC', code)
  const res = await rebind(app, { code, machineId: 'NEW-PC', appVersion: '0.2.0' })
  assert.equal(res.statusCode, 200)
  assert.equal(verifyLicense(res.json().license_key, publicKey).machineId, 'NEW-PC')
})

test('after a rebind the old machine can no longer renew', async () => {
  const { app, code } = await setup({ maxMachines: 1 })
  const oldKey = (await activate(app, 'OLD-PC', code)).json().license_key
  await rebind(app, { code, machineId: 'NEW-PC' })
  const res = await renew(app, oldKey, 'OLD-PC')
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'unbound')
})

test('the transfer counts against the rolling-year limit and is recorded', async () => {
  const { app, db, code, licenseId } = await setup({ maxMachines: 1 })
  await activate(app, 'PC-1', code)
  // transfers_per_year defaults to 2: two rebinds succeed, the third is refused.
  assert.equal((await rebind(app, { code, machineId: 'PC-2' })).statusCode, 200)
  assert.equal((await rebind(app, { code, machineId: 'PC-3' })).statusCode, 200)
  const third = await rebind(app, { code, machineId: 'PC-4' })
  assert.equal(third.statusCode, 429)
  assert.equal(third.json().error, 'transfer_limit')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE license_id = ?').get(licenseId).n, 2)
})

test('raising transfers_per_year lets another transfer through', async () => {
  const { app, db, code } = await setup({ maxMachines: 1 })
  await activate(app, 'PC-1', code)
  await rebind(app, { code, machineId: 'PC-2' })
  await rebind(app, { code, machineId: 'PC-3' })
  assert.equal((await rebind(app, { code, machineId: 'PC-4' })).statusCode, 429)
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('3', 'transfers_per_year')
  assert.equal((await rebind(app, { code, machineId: 'PC-4' })).statusCode, 200)
})

test('rebind onto a machine while a seat is free does not consume a transfer', async () => {
  const { app, db, code, licenseId } = await setup({ maxMachines: 2 })
  await activate(app, 'PC-1', code) // one of two seats used
  const res = await rebind(app, { code, machineId: 'PC-2' }) // free seat -> acts like activation
  assert.equal(res.statusCode, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE license_id = ?').get(licenseId).n, 0)
})

test('rebind onto the already-bound machine is idempotent, no transfer', async () => {
  const { app, db, code, licenseId } = await setup({ maxMachines: 1 })
  await activate(app, 'PC-1', code)
  const res = await rebind(app, { code, machineId: 'PC-1' })
  assert.equal(res.statusCode, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE license_id = ?').get(licenseId).n, 0)
})

test('the moved-to machine can then renew, proving the new binding is live', async () => {
  const { app, db, code, licenseId } = await setup({ maxMachines: 1 })
  await activate(app, 'OLD-PC', code)
  const newKey = (await rebind(app, { code, machineId: 'NEW-PC' })).json().license_key
  // pay so renewal passes the standing check
  db.prepare('INSERT INTO payments (license_id, amount_millimes, method, months, created_at) VALUES (?,?,?,?,?)').run(licenseId, 0, 'cash', 12, Date.now())
  assert.equal((await renew(app, newKey, 'NEW-PC')).statusCode, 200)
})

test('suspended and revoked licenses cannot be rebound', async () => {
  const { app, db, code, licenseId } = await setup({ maxMachines: 1 })
  await activate(app, 'PC-1', code)
  db.prepare('UPDATE licenses SET status = ? WHERE id = ?').run('suspended', licenseId)
  assert.equal((await rebind(app, { code, machineId: 'PC-2' })).json().error, 'suspended')
  db.prepare('UPDATE licenses SET status = ? WHERE id = ?').run('revoked', licenseId)
  assert.equal((await rebind(app, { code, machineId: 'PC-2' })).json().error, 'revoked')
})

test('unknown code and missing machineId are rejected', async () => {
  const { app, code } = await setup()
  assert.equal((await rebind(app, { code: 'POSK-0000-0000-0000-0000-0000', machineId: 'X' })).statusCode, 404)
  assert.equal((await rebind(app, { code })).statusCode, 400)
})
