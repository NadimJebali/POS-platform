// CONTRACT TEST. Proves a license signed by this server verifies under the EXACT
// logic the POS app uses offline. The `appSideVerify` function below is copied
// verbatim from the app's src/main/license.js verify() — if this test ever fails,
// the two repos have drifted and licenses issued here will be rejected in the field.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { signLicense, verifyLicense, buildPayload } from '../src/license-format.js'
import { testKeys } from './helpers.js'

// --- verbatim from POS app src/main/license.js (verify), trimmed to the crypto ---
function appSideVerify(licenseString, publicKeyPem, machineId, nowMs) {
  const [pB64, sB64] = String(licenseString).trim().split('.')
  if (!pB64 || !sB64) return { valid: false, reason: 'License is malformed' }
  if (!crypto.verify(null, Buffer.from(pB64), publicKeyPem, Buffer.from(sB64, 'base64'))) {
    return { valid: false, reason: 'License signature is invalid' }
  }
  const payload = JSON.parse(Buffer.from(pB64, 'base64').toString('utf8'))
  if (payload.machineId !== machineId) return { valid: false, reason: 'wrong machine' }
  if (payload.exp && nowMs > payload.exp) return { valid: false, reason: 'expired' }
  return { valid: true, payload }
}

test('a server-signed license verifies under the app-side verifier', () => {
  const { publicKey, privateKey } = testKeys()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const now = Date.now()
  const payload = buildPayload({
    machineId: 'ABCD-1234-EF56',
    name: 'Café Test',
    now,
    renewalWindowDays: 30,
    warnDays: 7
  })
  const licenseString = signLicense(payload, privateKey)

  const res = appSideVerify(licenseString, publicKeyPem, 'ABCD-1234-EF56', now)
  assert.equal(res.valid, true)
  assert.equal(res.payload.name, 'Café Test')
  assert.equal(res.payload.exp, now + 30 * 86400000)
})

test('app-side verifier rejects a license for a different machine', () => {
  const { publicKey, privateKey } = testKeys()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const now = Date.now()
  const licenseString = signLicense(
    buildPayload({ machineId: 'MINE', name: 'x', now, renewalWindowDays: 30, warnDays: 7 }),
    privateKey
  )
  assert.equal(appSideVerify(licenseString, publicKeyPem, 'THEIRS', now).valid, false)
})

test('app-side verifier rejects a tampered payload', () => {
  const { publicKey, privateKey } = testKeys()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const now = Date.now()
  const good = signLicense(
    buildPayload({ machineId: 'M', name: 'x', now, renewalWindowDays: 30, warnDays: 7 }),
    privateKey
  )
  // Swap the payload for a longer-expiry one but keep the original signature.
  const forgedPayload = Buffer.from(JSON.stringify({ machineId: 'M', exp: now + 999 * 86400000 })).toString('base64')
  const tampered = forgedPayload + '.' + good.split('.')[1]
  assert.equal(appSideVerify(tampered, publicKeyPem, 'M', now).valid, false)
})

test('verifyLicense round-trips its own signature and rejects a wrong key', () => {
  const a = testKeys()
  const b = testKeys()
  const now = Date.now()
  const lic = signLicense(
    buildPayload({ machineId: 'M', name: 'x', now, renewalWindowDays: 30, warnDays: 7 }),
    a.privateKey
  )
  assert.equal(verifyLicense(lic, a.publicKey).machineId, 'M')
  assert.throws(() => verifyLicense(lic, b.publicKey), /signature is invalid/)
})
