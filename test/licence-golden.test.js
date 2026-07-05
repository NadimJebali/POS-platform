// Byte-identical lock for the licence-protocol module (POS-platform#13). The existing
// license-format tests use random keys, so they prove behaviour but can't pin the wire
// bytes. This pins them: signing the fixed golden payload must produce the exact golden
// string, and verifying that string must recover the payload. Any change to the format
// (key type, the sign-the-base64 detail, field order) breaks this against the shared
// fixture that POS-software also carries.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { signLicense, verifyLicense } from '../src/license-format.js'
import { GOLDEN_PRIVATE_KEY_PEM, GOLDEN_PUBLIC_KEY_PEM, GOLDEN_PAYLOAD, GOLDEN_LICENCE } from './golden-licence.js'

test('signing the golden payload produces the exact golden licence string', () => {
  const priv = crypto.createPrivateKey(GOLDEN_PRIVATE_KEY_PEM)
  assert.equal(signLicense(GOLDEN_PAYLOAD, priv), GOLDEN_LICENCE)
})

test('verifying the golden licence recovers the golden payload', () => {
  const pub = crypto.createPublicKey(GOLDEN_PUBLIC_KEY_PEM)
  assert.deepEqual(verifyLicense(GOLDEN_LICENCE, pub), GOLDEN_PAYLOAD)
})
