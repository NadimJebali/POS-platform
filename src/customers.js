// Customer registry domain logic. Deliberately holds the minimum PII: name/café,
// phone, city (easier to respect Tunisia's data-protection law the less we keep).
import { LicenseError } from './licenses.js'

export function createCustomer(db, { name, phone, city }, now = Date.now()) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) throw new LicenseError('bad_request', 'A customer name is required', 400)
  const info = db
    .prepare('INSERT INTO customers (name, phone, city, created_at) VALUES (?, ?, ?, ?)')
    .run(trimmed, String(phone ?? '').trim() || null, String(city ?? '').trim() || null, now)
  return getCustomer(db, Number(info.lastInsertRowid))
}

export function getCustomer(db, id) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id) ?? null
}

// Lists customers, most recent first. By default only non-archived ("active")
// customers; pass archived: true for the archived view. Optional substring search
// over name/phone/city.
export function listCustomers(db, { search = '', archived = false } = {}) {
  const q = String(search ?? '').trim()
  const archiveClause = archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'
  if (!q) {
    return db.prepare(`SELECT * FROM customers WHERE ${archiveClause} ORDER BY created_at DESC`).all()
  }
  const like = `%${q}%`
  return db
    .prepare(
      `SELECT * FROM customers
       WHERE ${archiveClause}
         AND (name LIKE ? COLLATE NOCASE OR phone LIKE ? COLLATE NOCASE OR city LIKE ? COLLATE NOCASE)
       ORDER BY created_at DESC`
    )
    .all(like, like, like)
}

// Soft-delete: hide a churned customer from the default list without losing any
// records (their payment history stays intact). Reversible via unarchiveCustomer.
export function archiveCustomer(db, id, now = Date.now()) {
  const c = getCustomer(db, id)
  if (!c) throw new LicenseError('bad_request', 'Unknown customer', 404)
  db.prepare('UPDATE customers SET archived_at = ? WHERE id = ?').run(now, id)
}

export function unarchiveCustomer(db, id) {
  const c = getCustomer(db, id)
  if (!c) throw new LicenseError('bad_request', 'Unknown customer', 404)
  db.prepare('UPDATE customers SET archived_at = NULL WHERE id = ?').run(id)
}

// Permanent, irreversible erasure (for a data-removal request). Only allowed on an
// already-archived customer, so it can't be a one-click accident. Cascades through
// every dependent row — this DESTROYS the payment ledger for that customer.
export function deleteCustomer(db, id) {
  const c = getCustomer(db, id)
  if (!c) throw new LicenseError('bad_request', 'Unknown customer', 404)
  if (!c.archived_at) {
    throw new LicenseError('bad_request', 'Archive the customer before deleting permanently', 409)
  }
  db.exec('BEGIN')
  try {
    const licenseIds = db.prepare('SELECT id FROM licenses WHERE customer_id = ?').all(id).map((r) => r.id)
    for (const lid of licenseIds) {
      db.prepare('DELETE FROM transfers WHERE license_id = ?').run(lid)
      db.prepare('DELETE FROM payments WHERE license_id = ?').run(lid)
      db.prepare('DELETE FROM machines WHERE license_id = ?').run(lid)
    }
    db.prepare('DELETE FROM licenses WHERE customer_id = ?').run(id)
    db.prepare('DELETE FROM customers WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
