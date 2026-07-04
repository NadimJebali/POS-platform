import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, derivePaidUntil } from '../src/payments.js'
import { seedDb, insertCustomer, insertLicense, insertPayment } from './helpers.js'

function licenseWithPayments(payments) {
  const db = seedDb()
  const cid = insertCustomer(db)
  const { id } = insertLicense(db, { customerId: cid })
  for (const p of payments) insertPayment(db, { licenseId: id, ...p })
  return { db, id }
}

test('no payments -> paid_until is null', () => {
  const { db, id } = licenseWithPayments([])
  assert.equal(derivePaidUntil(db, id), null)
})

test('a single month payment covers ~one month from the payment date', () => {
  const at = Date.UTC(2026, 0, 15) // 15 Jan 2026
  const { db, id } = licenseWithPayments([{ months: 1, createdAt: at }])
  assert.equal(derivePaidUntil(db, id), addMonths(at, 1)) // 15 Feb 2026
})

test('back-to-back payments stack coverage', () => {
  const at = Date.UTC(2026, 0, 1)
  // Two payments made the same day: 1 month + 12 months = 13 months of coverage.
  const { db, id } = licenseWithPayments([
    { months: 1, createdAt: at },
    { months: 12, createdAt: at }
  ])
  assert.equal(derivePaidUntil(db, id), addMonths(at, 13))
})

test('a lapse forfeits the gap — coverage restarts from the later payment date', () => {
  const first = Date.UTC(2026, 0, 1) // covers to 1 Feb
  const late = Date.UTC(2026, 5, 1) // paid again 1 Jun, long after coverage lapsed
  const { db, id } = licenseWithPayments([
    { months: 1, createdAt: first },
    { months: 1, createdAt: late }
  ])
  // Not first + 2 months; the second payment anchors at its own date.
  assert.equal(derivePaidUntil(db, id), addMonths(late, 1)) // 1 Jul, not 1 Mar
})
