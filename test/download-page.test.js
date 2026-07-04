// The public download page at / : off by default, switched on from admin settings,
// rendered from admin-set text + the releases.json manifest the publish script
// maintains in the updates directory. No auth — it's the customer-facing page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app.js'
import { readReleases } from '../src/releases.js'
import { hashPassword, SESSION_COOKIE } from '../src/auth.js'
import { testKeys, seedDb } from './helpers.js'

const PASSWORD = 'admin-pass'

function form(fields) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString()
  }
}

function tempUpdatesDir(releases) {
  const dir = mkdtempSync(join(tmpdir(), 'pos-updates-'))
  if (releases) writeFileSync(join(dir, 'releases.json'), JSON.stringify(releases))
  return dir
}

function makeApp({ releases, updatesDir } = {}) {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({
    db,
    privateKey,
    adminPasswordHash: hashPassword(PASSWORD),
    cookieSecure: false,
    updatesDir: updatesDir ?? tempUpdatesDir(releases)
  })
  return { db, app }
}

async function adminCookie(app) {
  const login = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password: PASSWORD }) })
  return { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE).value }
}

const RELEASES = [
  { version: '0.2.0', date: '2026-06-01T10:00:00.000Z', file: 'POS-Software-0.2.0-setup.exe', size: 80000000, notes: 'First cloud build' },
  { version: '0.3.0', date: '2026-07-04T10:00:00.000Z', file: 'POS-Software-0.3.0-setup.exe', size: 84000000, notes: 'Split bills' }
]

test('the download page is off by default (404 until enabled)', async () => {
  const { app } = makeApp({ releases: RELEASES })
  const res = await app.inject({ method: 'GET', url: '/' })
  assert.equal(res.statusCode, 404)
})

test('enabling from admin settings turns the page on with content + latest download', async () => {
  const { app } = makeApp({ releases: RELEASES })
  const cookie = await adminCookie(app)

  const save = await app.inject({
    method: 'POST',
    url: '/admin/settings',
    cookies: cookie,
    ...form({
      download_page_enabled: '1',
      product_name: 'POS Software',
      product_tagline: 'The register that just works',
      product_description: 'Touchscreen point of sale for cafés and restaurants.',
      contact_phone: '+216 12 345 678',
      contact_email: 'sales@example.com'
    })
  })
  assert.equal(save.statusCode, 302)

  const res = await app.inject({ method: 'GET', url: '/' })
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /text\/html/)
  assert.match(res.body, /The register that just works/)
  assert.match(res.body, /POS Software/)
  // The big button points at the NEWEST installer in the manifest (0.3.0, not 0.2.0).
  assert.match(res.body, /href="\/updates\/POS-Software-0\.3\.0-setup\.exe"/)
  assert.match(res.body, /14[- ]days?/i)
  assert.match(res.body, /\+216 12 345 678/)
})

test('version history lists all releases newest-first with notes and download links', async () => {
  const { app, db } = makeApp({ releases: RELEASES })
  db.prepare("UPDATE settings SET value = '1' WHERE key = 'download_page_enabled'").run()

  const res = await app.inject({ method: 'GET', url: '/' })
  const body = res.body
  assert.match(body, /Split bills/)
  assert.match(body, /First cloud build/)
  assert.match(body, /href="\/updates\/POS-Software-0\.2\.0-setup\.exe"/)
  assert.ok(body.indexOf('0.3.0') < body.indexOf('0.2.0'), 'newest release renders first')
})

test('an empty or missing manifest renders a "no builds yet" page, not an error', async () => {
  const { app, db } = makeApp({ updatesDir: tempUpdatesDir(null) }) // no releases.json at all
  db.prepare("UPDATE settings SET value = '1' WHERE key = 'download_page_enabled'").run()

  const res = await app.inject({ method: 'GET', url: '/' })
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /no builds|coming soon/i)
})

test('readReleases tolerates a malformed manifest and sorts newest-first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pos-updates-'))
  writeFileSync(join(dir, 'releases.json'), 'not json {')
  assert.deepEqual(readReleases(dir), [])

  const dir2 = tempUpdatesDir([
    { version: '0.1.0', date: '2026-01-01T00:00:00.000Z', file: 'a.exe' },
    { garbage: true },
    { version: '0.2.0', date: '2026-02-01T00:00:00.000Z', file: 'b.exe' }
  ])
  const list = readReleases(dir2)
  assert.equal(list.length, 2) // the shapeless entry is dropped
  assert.equal(list[0].version, '0.2.0')
})

test('the admin settings page includes the download-page section', async () => {
  const { app } = makeApp({ releases: RELEASES })
  const cookie = await adminCookie(app)
  const res = await app.inject({ method: 'GET', url: '/admin/settings', cookies: cookie })
  assert.match(res.body, /download_page_enabled/)
  assert.match(res.body, /product_tagline/)
  assert.match(res.body, /contact_email/)
})
