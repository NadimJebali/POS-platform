// Wire-contract validation at the route seam (#16). A malformed activate/renew/rebind
// body should be refused with a clean `bad_request` at the boundary, not fail deep in
// domain logic (e.g. a missing license_key reaching the verifier and surfacing as
// invalid_key). The valid shapes are defined once in the shared wire-schemas module.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { testKeys, seedDb } from './helpers.js'

function makeApp() {
  const { privateKey } = testKeys()
  return buildApp({ db: seedDb(), privateKey, adminPasswordHash: 'x', cookieSecure: false })
}

test('POST /renew with no license_key is a bad_request at the seam', async () => {
  const res = await makeApp().inject({ method: 'POST', url: '/renew', payload: { machineId: 'M' } })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'bad_request')
})

test('POST /activate with no code is a bad_request at the seam', async () => {
  const res = await makeApp().inject({ method: 'POST', url: '/activate', payload: { machineId: 'M' } })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'bad_request')
})

test('POST /rebind with no machineId is a bad_request', async () => {
  const res = await makeApp().inject({ method: 'POST', url: '/rebind', payload: { code: 'POSK-AAAA-BBBB-CCCC-DDDD-EEEE' } })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'bad_request')
})
