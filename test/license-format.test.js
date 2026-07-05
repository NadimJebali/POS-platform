// CONTRACT TEST. Proves a licence signed by this server verifies under the REAL shared
// verifier — `verifyLicense` from license-format.js, which POS-software vendors verbatim
// (guarded by the golden-vector + checksum tests, see #13). Previously this file tested a
// hand-copied `appSideVerify`, which could silently drift from the shipping app; it now
// tests the actual shared code, so a green run genuinely means field activations succeed.
//
// Scope: this is the crypto/format contract (signature, encoding, malformed handling).
// The machine-binding and expiry checks are APP POLICY (POS-software src/main/license.js
// wraps verifyLicense with them and the monotonic clock) and are covered by that repo's
// tests — not duplicated here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signLicense, verifyLicense, buildPayload } from '../src/license-format.js'
import { testKeys } from './helpers.js'

test('a server-signed licence verifies under the shared verifier and recovers its payload', () => {
  const { publicKey, privateKey } = testKeys()
  const now = Date.now()
  const licence = signLicense(
    buildPayload({ lid: 7, machineId: 'ABCD-1234-EF56', name: 'Café Test', now, renewalWindowDays: 30, warnDays: 7 }),
    privateKey
  )
  const payload = verifyLicense(licence, publicKey)
  assert.equal(payload.name, 'Café Test')
  assert.equal(payload.machineId, 'ABCD-1234-EF56')
  assert.equal(payload.exp, now + 30 * 86400000)
})

test('the shared verifier rejects a tampered payload', () => {
  const { publicKey, privateKey } = testKeys()
  const now = Date.now()
  const good = signLicense(buildPayload({ machineId: 'M', name: 'x', now, renewalWindowDays: 30, warnDays: 7 }), privateKey)
  // Swap the payload for a longer-expiry one but keep the original signature.
  const forgedPayload = Buffer.from(JSON.stringify({ machineId: 'M', exp: now + 999 * 86400000 })).toString('base64')
  const tampered = forgedPayload + '.' + good.split('.')[1]
  assert.throws(() => verifyLicense(tampered, publicKey), /signature is invalid/)
})

test('the shared verifier rejects a malformed string (no dot)', () => {
  const { publicKey } = testKeys()
  assert.throws(() => verifyLicense('not-a-licence', publicKey), /malformed/)
})

test('the shared verifier round-trips its own signature and rejects a wrong key', () => {
  const a = testKeys()
  const b = testKeys()
  const now = Date.now()
  const lic = signLicense(buildPayload({ machineId: 'M', name: 'x', now, renewalWindowDays: 30, warnDays: 7 }), a.privateKey)
  assert.equal(verifyLicense(lic, a.publicKey).machineId, 'M')
  assert.throws(() => verifyLicense(lic, b.publicKey), /signature is invalid/)
})
