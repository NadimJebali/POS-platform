// License domain logic. Kept free of HTTP concerns so it's unit-testable and reused
// by the admin (issue #8/#9) and renew/rebind endpoints (issue #7/#10) later.
import { getIntSetting } from './db.js'
import { normalizeActivationCode } from './activation-code.js'
import { signLicense, verifyLicense, buildPayload } from './license-format.js'
import { derivePaidUntil } from './payments.js'

// A domain error carrying a stable machine-readable `code` so the HTTP layer can map
// each failure to a distinct response and the app can branch on it (e.g. bound
// elsewhere -> offer rebind). `status` is the HTTP status to use.
export class LicenseError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function countActiveMachines(db, licenseId) {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM machines WHERE license_id = ? AND unbound_at IS NULL')
    .get(licenseId)
  return row.n
}

// Activates a license onto a machine and returns a freshly signed license string.
//
//  - unknown code            -> LicenseError('invalid_code', 404)
//  - suspended / revoked      -> LicenseError('suspended' | 'revoked', 403)
//  - all machine slots in use -> LicenseError('machine_limit', 409)  (rebind comes in #10)
//  - already bound here        -> idempotent success (re-issues a key)
//
// `deps` = { privateKey, now } lets tests inject a throwaway keypair and clock.
export function activate(db, { code, machineId, appVersion }, deps) {
  const now = deps.now ?? Date.now()
  if (!machineId || typeof machineId !== 'string') {
    throw new LicenseError('bad_request', 'A machine id is required', 400)
  }

  const canonical = normalizeActivationCode(code)
  if (!canonical) throw new LicenseError('invalid_code', 'That activation code is not valid', 404)

  const license = db.prepare('SELECT * FROM licenses WHERE activation_code = ?').get(canonical)
  if (!license) throw new LicenseError('invalid_code', 'That activation code is not valid', 404)

  if (license.status === 'suspended') {
    throw new LicenseError('suspended', 'This license is suspended — please contact the vendor', 403)
  }
  if (license.status === 'revoked') {
    throw new LicenseError('revoked', 'This license has been revoked', 403)
  }

  const existing = db
    .prepare('SELECT * FROM machines WHERE license_id = ? AND machine_id = ?')
    .get(license.id, machineId)

  if (existing && existing.unbound_at == null) {
    // Idempotent re-activation from the same machine: refresh telemetry, re-issue.
    db.prepare('UPDATE machines SET last_seen_at = ?, app_version = ? WHERE id = ?').run(
      now,
      appVersion ?? existing.app_version,
      existing.id
    )
  } else {
    // A new machine (or a previously-unbound one coming back) needs a free slot.
    if (countActiveMachines(db, license.id) >= license.max_machines) {
      throw new LicenseError(
        'machine_limit',
        'This license is already active on another machine',
        409
      )
    }
    if (existing) {
      db.prepare(
        'UPDATE machines SET unbound_at = NULL, bound_at = ?, last_seen_at = ?, app_version = ? WHERE id = ?'
      ).run(now, now, appVersion ?? null, existing.id)
    } else {
      db.prepare(
        'INSERT INTO machines (license_id, machine_id, app_version, bound_at, last_seen_at) VALUES (?, ?, ?, ?, ?)'
      ).run(license.id, machineId, appVersion ?? null, now, now)
    }
  }

  const payload = buildPayload({
    lid: license.id,
    machineId,
    name: license.name,
    now,
    renewalWindowDays: getIntSetting(db, 'renewal_window_days'),
    warnDays: getIntSetting(db, 'warn_days')
  })
  const license_key = signLicense(payload, deps.privateKey)
  return { license_key, exp: payload.exp }
}

// Renews a license from the client's CURRENT signed key and returns a fresh one.
// Self-authenticating: the key is verified against the server's own public key, so
// no client secret exists. The presented key's expiry is intentionally NOT checked —
// a long-offline machine with an expired-but-genuine key must still renew if its
// license is in good standing (offline gap recovery).
//
//  - bad/forged signature      -> LicenseError('invalid_key', 401)
//  - key not for this machine   -> LicenseError('machine_mismatch', 403)
//  - license gone / not bound    -> LicenseError('invalid_key' | 'unbound', 403)
//  - suspended / revoked         -> LicenseError('suspended' | 'revoked', 403)
//  - lapsed past the grace window -> LicenseError('lapsed', 403)
//
// `deps` = { privateKey, publicKey, now }.
export function renew(db, { license_key, machineId, appVersion }, deps) {
  const now = deps.now ?? Date.now()

  let payload
  try {
    payload = verifyLicense(license_key, deps.publicKey)
  } catch {
    throw new LicenseError('invalid_key', 'The license could not be verified', 401)
  }

  // The caller's real machine must be the one the key was issued to. The key is
  // signed, so payload.machineId is trustworthy; a machine presenting someone
  // else's key is rejected.
  if (machineId && machineId !== payload.machineId) {
    throw new LicenseError('machine_mismatch', 'This license belongs to a different machine', 403)
  }
  const boundMachineId = payload.machineId

  const license = db.prepare('SELECT * FROM licenses WHERE id = ?').get(payload.lid)
  if (!license) throw new LicenseError('invalid_key', 'The license could not be verified', 403)

  if (license.status === 'suspended') {
    throw new LicenseError('suspended', 'This license is suspended — please contact the vendor', 403)
  }
  if (license.status === 'revoked') {
    throw new LicenseError('revoked', 'This license has been revoked', 403)
  }

  const binding = db
    .prepare('SELECT * FROM machines WHERE license_id = ? AND machine_id = ? AND unbound_at IS NULL')
    .get(license.id, boundMachineId)
  if (!binding) {
    throw new LicenseError('unbound', 'This machine is no longer bound to the license', 403)
  }

  // Payment standing. paid_until is derived from the ledger; grace extends renewals
  // (with a flag) a little past it so a late transfer never kills a register.
  const graceDays = getIntSetting(db, 'grace_days')
  const paidUntil = derivePaidUntil(db, license.id)
  const graceDeadline = (paidUntil ?? 0) + graceDays * 86400000
  let graceUntil
  if (paidUntil != null && now <= paidUntil) {
    // Fully paid up — no flag.
  } else if (now <= graceDeadline) {
    graceUntil = graceDeadline
  } else {
    throw new LicenseError('lapsed', 'This subscription has lapsed — please renew', 403)
  }

  db.prepare('UPDATE machines SET last_seen_at = ?, app_version = ? WHERE id = ?').run(
    now,
    appVersion ?? binding.app_version,
    binding.id
  )

  const newPayload = buildPayload({
    lid: license.id,
    machineId: boundMachineId,
    name: license.name,
    now,
    renewalWindowDays: getIntSetting(db, 'renewal_window_days'),
    warnDays: getIntSetting(db, 'warn_days'),
    graceUntil
  })
  const renewed = signLicense(newPayload, deps.privateKey)
  return { license_key: renewed, exp: newPayload.exp, graceUntil: graceUntil ?? null }
}
