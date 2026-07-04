// SHARED CONTRACT with the POS app's offline verifier (src/main/license.js).
//
// A license string is:   <base64(payloadJson)>.<base64(signature)>
// where the signature is Ed25519 over the ASCII BYTES of the base64 payload string
// (not over the decoded JSON). The app splits on '.', verifies `Buffer.from(pB64)`
// against its embedded public key, then JSON-parses `Buffer.from(pB64,'base64')`.
//
// If you change anything here — key type, the sign-the-base64-string detail, the
// payload field names — you MUST change the app's verifier in lockstep, and the
// cross-repo contract test (test/license-format.test.js) is what guards that.
import crypto from 'node:crypto'

// Signs a payload object into a license string using the given Ed25519 private key
// (a KeyObject or PEM string). `payload` should contain at least { machineId, exp };
// the app also reads `name` and (new in the cloud era) `graceUntil` / `warnDays`.
export function signLicense(payload, privateKey) {
  const pB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  const sig = crypto.sign(null, Buffer.from(pB64), privateKey).toString('base64')
  return `${pB64}.${sig}`
}

// Verifies a license string against the given Ed25519 public key and returns the
// decoded payload, or throws. This is the same check the app performs offline; the
// renew endpoint (issue #7) uses it to self-authenticate a client's current key.
export function verifyLicense(licenseString, publicKey) {
  const [pB64, sB64] = String(licenseString).trim().split('.')
  if (!pB64 || !sB64) throw new Error('License is malformed')
  if (!crypto.verify(null, Buffer.from(pB64), publicKey, Buffer.from(sB64, 'base64'))) {
    throw new Error('License signature is invalid')
  }
  return JSON.parse(Buffer.from(pB64, 'base64').toString('utf8'))
}

// Builds the payload for a freshly issued/renewed license. `now` and the windows
// are passed in so callers stay testable and all policy comes from the DB settings.
// exp/graceUntil are epoch ms, matching the app's Date.now() comparison.
//
// `lid` (license id) is embedded so the renew endpoint can identify which license a
// presented key belongs to. It's an internal integer, not the activation code, so
// exposing it in the (readable) payload is harmless. The app's verifier ignores it.
export function buildPayload({ lid, machineId, name, now, renewalWindowDays, warnDays, graceUntil }) {
  const payload = {
    lid,
    machineId,
    name: name || null,
    exp: now + renewalWindowDays * 86400000,
    warnDays
  }
  // Only present when the subscription has lapsed into its paid-grace window, so the
  // app shows the "please renew" banner. Absent = fully paid up.
  if (graceUntil != null) payload.graceUntil = graceUntil
  return payload
}
