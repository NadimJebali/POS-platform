// Billing derivation. paid_until is NEVER stored as a scalar — it's computed by
// replaying the append-only payments ledger, so history is always reconstructible
// and a webhook (future) can append rows exactly the way the admin does by hand.

// Adds n calendar months to an epoch-ms timestamp (UTC). JS normalizes overflow
// (e.g. Jan 31 + 1mo -> early Mar), which is fine for subscription coverage.
export function addMonths(ms, n) {
  const d = new Date(ms)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.getTime()
}

// Appends a payment to the ledger. `months` is the coverage bought (1 or 12);
// paid_until is never written here — it's always re-derived from these rows.
export function recordPayment(db, { licenseId, months, amountMillimes = 0, method = 'cash', note }, now = Date.now()) {
  const m = Number(months)
  if (!Number.isInteger(m) || m < 1) throw new Error('months must be a positive integer')
  db.prepare(
    'INSERT INTO payments (license_id, amount_millimes, method, months, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(licenseId, Number(amountMillimes) || 0, String(method || 'cash'), m, note ?? null, now)
}

// Payment history for a license, newest first (for the admin ledger view).
export function listPayments(db, licenseId) {
  return db
    .prepare('SELECT * FROM payments WHERE license_id = ? ORDER BY created_at DESC, id DESC')
    .all(licenseId)
}

// Derives the moment coverage runs out for a license, or null if it has never been
// paid. Each payment extends coverage from the later of (current coverage end,
// the payment's own date): stacking prepayments extends cleanly, and a lapse
// forfeits the unpaid gap rather than being back-credited.
export function derivePaidUntil(db, licenseId) {
  const rows = db
    .prepare('SELECT months, created_at FROM payments WHERE license_id = ? ORDER BY created_at ASC, id ASC')
    .all(licenseId)
  if (rows.length === 0) return null
  let paidUntil = null
  for (const p of rows) {
    const base = paidUntil != null && paidUntil > p.created_at ? paidUntil : p.created_at
    paidUntil = addMonths(base, p.months)
  }
  return paidUntil
}
