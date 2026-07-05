// After issuing a license the admin is asked whether the customer paid — the payment
// question moved from an upfront form selector to a post-issue prompt on the new-code
// banner, matching how the sale actually happens (generate code → hand over → get paid).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { hashPassword, SESSION_COOKIE } from '../src/auth.js'
import { testKeys, seedDb, insertCustomer } from './helpers.js'

const PASSWORD = 'admin-pass'

function form(fields) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString()
  }
}

async function loggedIn() {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({ db, privateKey, adminPasswordHash: hashPassword(PASSWORD), cookieSecure: false })
  const login = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password: PASSWORD }) })
  const cookie = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE).value }
  return { db, app, cookie }
}

const issue = (app, cookie, customerId, fields = { max_machines: '1' }) =>
  app.inject({ method: 'POST', url: `/admin/customers/${customerId}/licenses`, cookies: cookie, ...form(fields) })
const getPage = (app, cookie, url) => app.inject({ method: 'GET', url, cookies: cookie })
const post = (app, cookie, url, fields) => app.inject({ method: 'POST', url, cookies: cookie, ...form(fields) })

test('issuing redirects to a banner that asks whether the customer paid', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Prompt')

  const res = await issue(app, cookie, cid)
  assert.equal(res.statusCode, 302)
  assert.match(res.headers.location, /code=/)
  assert.match(res.headers.location, /lid=\d+/)

  const page = await getPage(app, cookie, res.headers.location)
  assert.match(page.body, /Has the customer paid\?/)
  const lid = db.prepare('SELECT id FROM licenses WHERE customer_id = ?').get(cid).id
  assert.match(page.body, new RegExp(`/admin/licenses/${lid}/payments`)) // pay buttons post to the ledger
  assert.match(page.body, /Not yet/)
})

test('answering "1 month" records the payment and returns to the customer page (Active)', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Paid')
  await issue(app, cookie, cid)
  const lid = db.prepare('SELECT id FROM licenses WHERE customer_id = ?').get(cid).id

  const res = await post(app, cookie, `/admin/licenses/${lid}/payments`, {
    months: '1',
    method: 'initial',
    back: `/admin/customers/${cid}`
  })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, `/admin/customers/${cid}`)

  const page = await getPage(app, cookie, `/admin/customers/${cid}`)
  assert.match(page.body, /Active/)
  assert.doesNotMatch(page.body, /Never paid/)
})

test('answering "1 year" records a year of coverage', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Year')
  await issue(app, cookie, cid)
  const lid = db.prepare('SELECT id FROM licenses WHERE customer_id = ?').get(cid).id

  await post(app, cookie, `/admin/licenses/${lid}/payments`, { months: '12', method: 'initial' })

  const page = await getPage(app, cookie, `/admin/licenses/${lid}`)
  assert.match(page.body, /Active/)
  assert.match(page.body, /1 year/) // the payment ledger shows a yearly entry
})

test('walking away without answering leaves the license "Never paid"', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café NotYet')

  await issue(app, cookie, cid)

  const page = await getPage(app, cookie, `/admin/customers/${cid}`)
  assert.match(page.body, /Never paid/)
})

test('the issue form no longer asks about payment upfront (no period selector)', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Form')
  const page = await getPage(app, cookie, `/admin/customers/${cid}`)
  assert.doesNotMatch(page.body, /name="months"/)
  assert.doesNotMatch(page.body, /Start subscription/)
})

test('the paid prompt offers an amount (TND) field', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Amount UI')
  const res = await issue(app, cookie, cid)
  const page = await getPage(app, cookie, res.headers.location)
  assert.match(page.body, /name="amount"/)
})

test('recording the paid prompt with an amount stores it in millimes', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Amount')
  await issue(app, cookie, cid)
  const lid = db.prepare('SELECT id FROM licenses WHERE customer_id = ?').get(cid).id

  await post(app, cookie, `/admin/licenses/${lid}/payments`, { months: '1', method: 'initial', amount: '30.000' })

  const pay = db.prepare('SELECT amount_millimes, months FROM payments WHERE license_id = ?').get(lid)
  assert.equal(pay.amount_millimes, 30000) // 30.000 TND stored as integer millimes
  assert.equal(pay.months, 1)
})

test('the back param cannot redirect outside the admin (open-redirect guard)', async () => {
  const { db, app, cookie } = await loggedIn()
  const cid = insertCustomer(db, 'Café Redirect')
  await issue(app, cookie, cid)
  const lid = db.prepare('SELECT id FROM licenses WHERE customer_id = ?').get(cid).id

  const res = await post(app, cookie, `/admin/licenses/${lid}/payments`, {
    months: '1',
    back: 'https://evil.example/phish'
  })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, `/admin/licenses/${lid}`) // falls back to the license page
})
