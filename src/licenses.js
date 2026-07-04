// License domain logic. Kept free of HTTP concerns so it's unit-testable and reused
// by the admin (issue #8/#9) and renew/rebind endpoints (issue #7/#10) later.
import { getIntSetting } from './db.js'
import { generateActivationCode, normalizeActivationCode } from './activation-code.js'
import { signLicense, verifyLicense, buildPayload } from './license-format.js'
import { derivePaidUntil, listPayments, billingState, recordPayment } from './payments.js'

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

// Issues a new license for a customer with a fresh unique activation code. Retries
// on the astronomically unlikely code collision rather than trusting first draw.
// `months` (optional, 1 or 12) records a first payment so the subscription starts
// Active instead of "Never paid".
export function issueLicense(db, { customerId, maxMachines = 1, name, months }, now = Date.now()) {
  if (!getCustomerExists(db, customerId)) {
    throw new LicenseError('bad_request', 'Unknown customer', 400)
  }
  const seats = Number(maxMachines)
  if (!Number.isInteger(seats) || seats < 1) {
    throw new LicenseError('bad_request', 'Machine count must be a whole number ≥ 1', 400)
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateActivationCode()
    try {
      const info = db
        .prepare(
          'INSERT INTO licenses (customer_id, activation_code, status, max_machines, name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(customerId, code, 'active', seats, name ?? null, now)
      const id = Number(info.lastInsertRowid)
      if (months === 1 || months === 12) {
        recordPayment(db, { licenseId: id, months, method: 'initial' }, now)
      }
      return { id, code }
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err
    }
  }
  throw new LicenseError('internal', 'Could not allocate an activation code', 500)
}

function getCustomerExists(db, id) {
  return !!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)
}

export function getLicense(db, id) {
  return db.prepare('SELECT * FROM licenses WHERE id = ?').get(id) ?? null
}

const LICENSE_STATUSES = ['active', 'suspended', 'revoked']

// Sets a license's status. suspend (reversible) / revoke (permanent) / active
// (unsuspend). Revocation is one-way: a revoked license can't be reactivated here.
export function setLicenseStatus(db, id, status) {
  if (!LICENSE_STATUSES.includes(status)) {
    throw new LicenseError('bad_request', 'Unknown status', 400)
  }
  const license = getLicense(db, id)
  if (!license) throw new LicenseError('bad_request', 'Unknown license', 404)
  if (license.status === 'revoked') {
    throw new LicenseError('bad_request', 'A revoked license cannot be changed', 409)
  }
  db.prepare('UPDATE licenses SET status = ? WHERE id = ?').run(status, id)
}

// Manually unbinds a machine (frees a seat) — the vendor helping a customer whose
// self-service transfer limit is spent. Marks the row unbound rather than deleting,
// preserving history; the machine can re-activate into the freed slot afterwards.
export function unbindMachine(db, licenseId, machineId, now = Date.now()) {
  const info = db
    .prepare('UPDATE machines SET unbound_at = ? WHERE license_id = ? AND machine_id = ? AND unbound_at IS NULL')
    .run(now, licenseId, machineId)
  if (info.changes === 0) throw new LicenseError('bad_request', 'No such active binding', 404)
}

const YEAR_MS = 365 * 86400000

export function countTransfersSince(db, licenseId, sinceMs) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM transfers WHERE license_id = ? AND created_at >= ?')
    .get(licenseId, sinceMs).n
}

export function listTransfers(db, licenseId) {
  return db
    .prepare('SELECT * FROM transfers WHERE license_id = ? ORDER BY created_at DESC, id DESC')
    .all(licenseId)
}

// Self-service rebind: move the license onto `machineId`. Called by the app when a
// plain activation reported machine_limit and the user chose "move it here".
//
//  - unknown code               -> LicenseError('invalid_code', 404)
//  - suspended / revoked         -> LicenseError('suspended' | 'revoked', 403)
//  - over the yearly limit        -> LicenseError('transfer_limit', 429)  (app: contact vendor)
//
// If the machine is already bound, or a seat is free, this behaves like activation
// (no transfer recorded). Only when all seats are full does it unbind the oldest and
// record a transfer against the rolling-year limit. Returns a fresh signed key.
export function rebind(db, { code, machineId, appVersion }, deps) {
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
  if (license.status === 'revoked') throw new LicenseError('revoked', 'This license has been revoked', 403)

  const existing = db
    .prepare('SELECT * FROM machines WHERE license_id = ? AND machine_id = ?')
    .get(license.id, machineId)

  if (existing && existing.unbound_at == null) {
    // Already here — idempotent, just refresh telemetry and re-issue.
    db.prepare('UPDATE machines SET last_seen_at = ?, app_version = ? WHERE id = ?').run(now, appVersion ?? existing.app_version, existing.id)
  } else if (countActiveMachines(db, license.id) < license.max_machines) {
    // A seat is free — this is really an activation, no transfer needed.
    bindMachine(db, license, existing, machineId, appVersion, now)
  } else {
    // All seats full: this is a genuine transfer, subject to the yearly limit.
    const limit = getIntSetting(db, 'transfers_per_year')
    if (countTransfersSince(db, license.id, now - YEAR_MS) >= limit) {
      throw new LicenseError('transfer_limit', 'This license has reached its transfer limit for the year — please contact the vendor', 429)
    }
    const oldest = db
      .prepare('SELECT * FROM machines WHERE license_id = ? AND unbound_at IS NULL ORDER BY bound_at ASC, id ASC LIMIT 1')
      .get(license.id)
    db.prepare('UPDATE machines SET unbound_at = ? WHERE id = ?').run(now, oldest.id)
    bindMachine(db, license, existing, machineId, appVersion, now)
    db.prepare('INSERT INTO transfers (license_id, from_machine_id, to_machine_id, created_at) VALUES (?, ?, ?, ?)').run(
      license.id,
      oldest.machine_id,
      machineId,
      now
    )
  }

  const payload = buildPayload({
    lid: license.id,
    machineId,
    name: license.name,
    now,
    renewalWindowDays: getIntSetting(db, 'renewal_window_days'),
    warnDays: getIntSetting(db, 'warn_days')
  })
  return { license_key: signLicense(payload, deps.privateKey), exp: payload.exp }
}

// Binds `machineId` to a license, reusing a prior unbound row if one exists.
function bindMachine(db, license, existingRow, machineId, appVersion, now) {
  if (existingRow) {
    db.prepare('UPDATE machines SET unbound_at = NULL, bound_at = ?, last_seen_at = ?, app_version = ? WHERE id = ?').run(now, now, appVersion ?? null, existingRow.id)
  } else {
    db.prepare('INSERT INTO machines (license_id, machine_id, app_version, bound_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(license.id, machineId, appVersion ?? null, now, now)
  }
}

// Resolves the billing-window thresholds (in ms) from the settings table.
function billingThresholds(db, now = Date.now()) {
  return {
    now,
    graceMs: getIntSetting(db, 'grace_days') * 86400000,
    warnMs: getIntSetting(db, 'warn_days') * 86400000
  }
}

// Licenses for a customer, each annotated with derived paid_until, its billing state
// (active / expiring / grace / lapsed / unpaid), and current bound-machine count.
export function listLicensesForCustomer(db, customerId) {
  const rows = db
    .prepare('SELECT * FROM licenses WHERE customer_id = ? ORDER BY created_at DESC')
    .all(customerId)
  const t = billingThresholds(db)
  return rows.map((lic) => {
    const paidUntil = derivePaidUntil(db, lic.id)
    return {
      ...lic,
      paidUntil,
      billing: billingState(paidUntil, t),
      activeMachines: countActiveMachines(db, lic.id)
    }
  })
}

// Full detail for one license: the license, its customer, derived paid_until, its
// billing state, and its machines (active bindings first, then unbound history).
export function getLicenseDetail(db, id) {
  const license = getLicense(db, id)
  if (!license) return null
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(license.customer_id)
  const machines = db
    .prepare(
      'SELECT * FROM machines WHERE license_id = ? ORDER BY (unbound_at IS NOT NULL), last_seen_at DESC'
    )
    .all(id)
  const paidUntil = derivePaidUntil(db, id)
  return {
    license,
    customer,
    machines,
    paidUntil,
    billing: billingState(paidUntil, billingThresholds(db)),
    payments: listPayments(db, id),
    transfers: listTransfers(db, id)
  }
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
