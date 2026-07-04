// Verifies the admin surfaces subscription standing (needs-renewal) in the UI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { hashPassword, SESSION_COOKIE } from '../src/auth.js'
import { addMonths } from '../src/payments.js'
import { testKeys, seedDb, insertCustomer, insertLicense, insertPayment } from './helpers.js'

const PASSWORD = 'admin-pass'
const DAY = 86400000

async function loggedIn() {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({ db, privateKey, adminPasswordHash: hashPassword(PASSWORD), cookieSecure: false })
  const login = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ password: PASSWORD }).toString()
  })
  const cookie = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE).value }
  return { db, app, cookie }
}

test('an expired subscription shows "needs renewal" on the license page', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Expired')
  const { id: licenseId } = insertLicense(db, { customerId: cid })
  // paid_until ~10 days ago (past the 7-day grace) -> lapsed
  insertPayment(db, { licenseId, months: 1, createdAt: addMonths(Date.now() - 10 * DAY, -1) })

  const res = await app.inject({ method: 'GET', url: `/admin/licenses/${licenseId}`, cookies: cookie })
  assert.match(res.body, /needs renewal|expired/i)
})

test('a paid-up subscription shows Active, no renewal warning', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Current')
  const { id: licenseId } = insertLicense(db, { customerId: cid })
  insertPayment(db, { licenseId, months: 12 }) // a year, dated now

  const res = await app.inject({ method: 'GET', url: `/admin/licenses/${licenseId}`, cookies: cookie })
  assert.match(res.body, /Active/)
  assert.doesNotMatch(res.body, /needs renewal/i)
})

test('the customer page flags licenses that need renewal', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Flag')
  const { id: licenseId } = insertLicense(db, { customerId: cid })
  insertPayment(db, { licenseId, months: 1, createdAt: addMonths(Date.now() - 10 * DAY, -1) })

  const res = await app.inject({ method: 'GET', url: `/admin/customers/${cid}`, cookies: cookie })
  assert.match(res.body, /need.* renewal/i)
})
