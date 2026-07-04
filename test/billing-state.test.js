import { test } from 'node:test'
import assert from 'node:assert/strict'
import { billingState, addMonths } from '../src/payments.js'

const DAY = 86400000
const now = Date.now()
const thresholds = { now, graceMs: 7 * DAY, warnMs: 7 * DAY }

test('never paid -> unpaid', () => {
  assert.equal(billingState(null, thresholds).state, 'unpaid')
})

test('comfortably ahead -> active', () => {
  assert.equal(billingState(now + 60 * DAY, thresholds).state, 'active')
})

test('within warn window -> expiring', () => {
  const s = billingState(now + 3 * DAY, thresholds)
  assert.equal(s.state, 'expiring')
  assert.match(s.label, /Expiring in 3d/)
})

test('past paid_until but within grace -> grace', () => {
  assert.equal(billingState(now - 2 * DAY, thresholds).state, 'grace')
})

test('past the grace window -> lapsed', () => {
  const s = billingState(now - 10 * DAY, thresholds)
  assert.equal(s.state, 'lapsed')
  assert.match(s.label, /needs renewal/i)
})

test('addMonths sanity for a yearly payment lands ~active', () => {
  assert.equal(billingState(addMonths(now, 12), thresholds).state, 'active')
})
