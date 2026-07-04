// License domain logic. Kept free of HTTP concerns so it's unit-testable and reused
// by the admin (issue #8/#9) and renew/rebind endpoints (issue #7/#10) later.
import { getIntSetting } from './db.js'
import { normalizeActivationCode } from './activation-code.js'
import { signLicense, buildPayload } from './license-format.js'

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
    machineId,
    name: license.name,
    now,
    renewalWindowDays: getIntSetting(db, 'renewal_window_days'),
    warnDays: getIntSetting(db, 'warn_days')
  })
  const license_key = signLicense(payload, deps.privateKey)
  return { license_key, exp: payload.exp }
}
