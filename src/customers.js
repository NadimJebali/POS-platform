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

// Lists customers, optionally filtered by a case-insensitive substring over name,
// phone, or city. Most recent first.
export function listCustomers(db, { search = '' } = {}) {
  const q = String(search ?? '').trim()
  if (!q) {
    return db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all()
  }
  const like = `%${q}%`
  return db
    .prepare(
      `SELECT * FROM customers
       WHERE name LIKE ? COLLATE NOCASE OR phone LIKE ? COLLATE NOCASE OR city LIKE ? COLLATE NOCASE
       ORDER BY created_at DESC`
    )
    .all(like, like, like)
}
