// The admin can delete an older published version from the download feed. The live
// (latest.yml) version is protected. Files live in a throwaway updates dir per test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildApp } from '../src/app.js'
import { hashPassword, SESSION_COOKIE } from '../src/auth.js'
import { testKeys, seedDb } from './helpers.js'

const PASSWORD = 'admin-pass'

function form(fields) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString()
  }
}

function seedUpdates() {
  const dir = mkdtempSync(join(tmpdir(), 'pos-upd-'))
  writeFileSync(
    join(dir, 'releases.json'),
    JSON.stringify([
      { version: '0.2.2', date: '2026-07-04T00:00:00Z', file: 'POS-Software-0.2.2-setup.exe', size: 87665202, notes: 'latest' },
      { version: '0.2.1', date: '2026-07-01T00:00:00Z', file: 'POS-Software-0.2.1-setup.exe', size: 87665167, notes: 'older' }
    ])
  )
  writeFileSync(join(dir, 'latest.yml'), 'version: 0.2.2\npath: POS-Software-0.2.2-setup.exe\n')
  for (const v of ['0.2.1', '0.2.2']) {
    writeFileSync(join(dir, `POS-Software-${v}-setup.exe`), 'x')
    writeFileSync(join(dir, `POS-Software-${v}-setup.exe.blockmap`), 'x')
  }
  return dir
}

async function loggedIn(updatesDir) {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({ db, privateKey, adminPasswordHash: hashPassword(PASSWORD), cookieSecure: false, updatesDir })
  const login = await app.inject({ method: 'POST', url: '/admin/login', ...form({ password: PASSWORD }) })
  const cookie = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE).value }
  return { app, cookie }
}

test('settings lists published versions: delete for older, "current" for the live one', async () => {
  const dir = seedUpdates()
  const { app, cookie } = await loggedIn(dir)

  const page = await app.inject({ method: 'GET', url: '/admin/settings', cookies: cookie })
  assert.match(page.body, /Published versions/)
  assert.match(page.body, /v0\.2\.1/)
  assert.match(page.body, /v0\.2\.2/)
  assert.match(page.body, /current/) // the live version shows a badge, not a delete button
  assert.match(page.body, /name="version" value="0.2.1"/) // older is deletable
  rmSync(dir, { recursive: true, force: true })
})

test('deleting an older version removes its files + manifest entry', async () => {
  const dir = seedUpdates()
  const { app, cookie } = await loggedIn(dir)

  const res = await app.inject({ method: 'POST', url: '/admin/releases/delete', cookies: cookie, ...form({ version: '0.2.1' }) })
  assert.equal(res.statusCode, 302)
  assert.equal(existsSync(join(dir, 'POS-Software-0.2.1-setup.exe')), false)
  assert.equal(existsSync(join(dir, 'POS-Software-0.2.1-setup.exe.blockmap')), false)
  assert.equal(existsSync(join(dir, 'POS-Software-0.2.2-setup.exe')), true)
  rmSync(dir, { recursive: true, force: true })
})

test('deleting the live (latest.yml) version is refused', async () => {
  const dir = seedUpdates()
  const { app, cookie } = await loggedIn(dir)

  const res = await app.inject({ method: 'POST', url: '/admin/releases/delete', cookies: cookie, ...form({ version: '0.2.2' }) })
  assert.equal(res.statusCode, 400)
  assert.match(res.body, /current published version/)
  assert.equal(existsSync(join(dir, 'POS-Software-0.2.2-setup.exe')), true) // untouched
  rmSync(dir, { recursive: true, force: true })
})

test('the delete route requires being signed in', async () => {
  const dir = seedUpdates()
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({ db, privateKey, adminPasswordHash: hashPassword(PASSWORD), cookieSecure: false, updatesDir: dir })

  const res = await app.inject({ method: 'POST', url: '/admin/releases/delete', ...form({ version: '0.2.1' }) })
  assert.equal(res.statusCode, 302)
  assert.match(res.headers.location, /\/admin\/login/)
  assert.equal(existsSync(join(dir, 'POS-Software-0.2.1-setup.exe')), true) // nothing deleted
  rmSync(dir, { recursive: true, force: true })
})
