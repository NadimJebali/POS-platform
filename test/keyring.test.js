// Key-rotation support in the shared verifier (#17). verifyLicense accepts a keyring
// (kid -> public key, with a designated legacy key for pre-kid licences) and selects the
// verifying key by the payload's kid. A legacy no-kid licence verifies against the legacy
// key; an unknown kid fails closed. This is what lets a new signing key ship in an app
// update before the server cuts over — no flag day (see PRD #12, candidate C).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { signLicense, verifyLicense, buildPayload } from '../src/license-format.js'

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: privateKey }
}

const base = { machineId: 'M', now: 1000, renewalWindowDays: 30, warnDays: 7 }

test('a kid-tagged licence verifies against the matching key in a keyring', () => {
  const k1 = keypair()
  const k2 = keypair()
  const keyring = { keys: { k1: k1.pub, k2: k2.pub }, legacyKid: 'k1' }
  const lic = signLicense(buildPayload({ ...base, kid: 'k2' }), k2.priv)
  const payload = verifyLicense(lic, keyring)
  assert.equal(payload.machineId, 'M')
  assert.equal(payload.kid, 'k2')
})

test('a legacy (no-kid) licence verifies against the keyring legacy key', () => {
  const k1 = keypair()
  const k2 = keypair()
  const keyring = { keys: { k1: k1.pub, k2: k2.pub }, legacyKid: 'k1' }
  const lic = signLicense(buildPayload({ ...base }), k1.priv) // no kid
  assert.equal(verifyLicense(lic, keyring).machineId, 'M')
})

test('an unknown kid fails closed', () => {
  const k1 = keypair()
  const rogue = keypair()
  const keyring = { keys: { k1: k1.pub }, legacyKid: 'k1' }
  const lic = signLicense(buildPayload({ ...base, kid: 'k9' }), rogue.priv)
  assert.throws(() => verifyLicense(lic, keyring), /signature is invalid/)
})

test('a kid-tagged licence signed by the wrong key still fails', () => {
  const k1 = keypair()
  const k2 = keypair()
  const rogue = keypair()
  const keyring = { keys: { k1: k1.pub, k2: k2.pub }, legacyKid: 'k1' }
  const lic = signLicense(buildPayload({ ...base, kid: 'k2' }), rogue.priv) // claims k2, signed by rogue
  assert.throws(() => verifyLicense(lic, keyring), /signature is invalid/)
})

test('buildPayload omits kid when not given and includes it when given', () => {
  assert.equal('kid' in buildPayload({ ...base }), false)
  assert.equal(buildPayload({ ...base, kid: 'k2' }).kid, 'k2')
})
