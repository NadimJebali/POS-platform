// HTTP-inject tests for the admin panel: auth, rate limiting, and the create-customer
// → issue-license → activate path end-to-end.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { hashPassword, SESSION_COOKIE } from '../src/auth.js'
import { testKeys, seedDb } from './helpers.js'

const PASSWORD = 'correct horse battery staple'

function makeApp() {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({
    db,
    privateKey,
    adminPasswordHash: hashPassword(PASSWORD),
    cookieSecure: false
  })
  return { app, db }
}

function form(fields) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString()
  }
}

async function login(app, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password }) })
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)
  return { res, cookie: cookie ? { [SESSION_COOKIE]: cookie.value } : null }
}

test('login page renders', async () => {
  const { app } = makeApp()
  const res = await app.inject({ method: 'GET', url: '/admin/login' })
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /Sign in/)
})

test('unauthenticated admin access redirects to login', async () => {
  const { app } = makeApp()
  const res = await app.inject({ method: 'GET', url: '/admin' })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, '/admin/login')
})

test('wrong password is rejected and sets no session', async () => {
  const { app } = makeApp()
  const { res, cookie } = await login(app, 'nope')
  assert.equal(res.statusCode, 401)
  assert.equal(cookie, null)
})

test('correct password logs in and grants access', async () => {
  const { app } = makeApp()
  const { res, cookie } = await login(app)
  assert.equal(res.statusCode, 302)
  assert.ok(cookie)
  const home = await app.inject({ method: 'GET', url: '/admin', cookies: cookie })
  assert.equal(home.statusCode, 200)
  assert.match(home.body, /Customers/)
})

test('login is rate limited after repeated failures', async () => {
  const { app } = makeApp()
  for (let i = 0; i < 5; i++) await login(app, 'wrong')
  const res = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password: 'wrong' }) })
  assert.equal(res.statusCode, 429)
  // Even the correct password is blocked while the window is open.
  const good = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password: PASSWORD }) })
  assert.equal(good.statusCode, 429)
})

test('empty admin hash disables login entirely', async () => {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({ db, privateKey, adminPasswordHash: '', cookieSecure: false })
  const res = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password: '' }) })
  assert.equal(res.statusCode, 401)
})

test('create customer then see it listed and on its page', async () => {
  const { app } = makeApp()
  const { cookie } = await login(app)
  const created = await app.inject({
    method: 'POST',
    url: '/admin/customers',
    cookies: cookie,
    ...form({ name: 'Café Central', phone: '20123456', city: 'Sfax' })
  })
  assert.equal(created.statusCode, 302)
  assert.match(created.headers.location, /^\/admin\/customers\/\d+$/)
  const page = await app.inject({ method: 'GET', url: created.headers.location, cookies: cookie })
  assert.match(page.body, /Café Central/)
  assert.match(page.body, /Sfax/)
})

test('issuing a license shows its code, and that code activates', async () => {
  const { app, db } = makeApp()
  const { cookie } = await login(app)
  const created = await app.inject({
    method: 'POST',
    url: '/admin/customers',
    cookies: cookie,
    ...form({ name: 'Café Issue' })
  })
  const customerUrl = created.headers.location
  const issued = await app.inject({
    method: 'POST',
    url: `${customerUrl}/licenses`,
    cookies: cookie,
    ...form({ max_machines: '2' })
  })
  assert.equal(issued.statusCode, 302)
  assert.match(issued.headers.location, /\?code=POSK/)

  // The customer page shows the fresh code prominently.
  const page = await app.inject({ method: 'GET', url: issued.headers.location, cookies: cookie })
  assert.match(page.body, /hand this code to the customer/)

  // And that same code actually activates a machine (end-to-end through /activate).
  const code = decodeURIComponent(issued.headers.location.split('code=')[1])
  const act = await app.inject({
    method: 'POST',
    url: '/activate',
    payload: { code, machineId: 'ADMIN-E2E-MACHINE', appVersion: '0.2.0' }
  })
  assert.equal(act.statusCode, 200)
  assert.ok(act.json().license_key)

  // The license detail page now shows the bound machine + its reported version.
  const lic = db.prepare('SELECT id FROM licenses WHERE customer_id IN (SELECT id FROM customers WHERE name = ?)').get('Café Issue')
  const detail = await app.inject({ method: 'GET', url: `/admin/licenses/${lic.id}`, cookies: cookie })
  assert.match(detail.body, /ADMIN-E2E-MACHINE/)
  assert.match(detail.body, /0\.2\.0/)
})

test('search filters the customer list', async () => {
  const { app } = makeApp()
  const { cookie } = await login(app)
  for (const name of ['Alpha Bar', 'Beta Grill']) {
    await app.inject({ method: 'POST', url: '/admin/customers', cookies: cookie, ...form({ name }) })
  }
  const res = await app.inject({ method: 'GET', url: '/admin?q=beta', cookies: cookie })
  assert.match(res.body, /Beta Grill/)
  assert.doesNotMatch(res.body, /Alpha Bar/)
})

test('logout ends the session', async () => {
  const { app } = makeApp()
  const { cookie } = await login(app)
  await app.inject({ method: 'POST', url: '/admin/logout', cookies: cookie })
  const res = await app.inject({ method: 'GET', url: '/admin', cookies: cookie })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, '/admin/login')
})
