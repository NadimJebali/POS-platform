// Admin branding uploads: multipart logo/share-image upload, per-asset removal, format
// + size validation, and auth-gating. Uses a hand-built multipart body (no browser).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app.js'
import { getAsset } from '../src/assets.js'
import { hashPassword, SESSION_COOKIE } from '../src/auth.js'
import { testKeys, seedDb } from './helpers.js'

const PASSWORD = 'admin-pass'
const BOUNDARY = '----posbrandtest'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

// Builds a multipart/form-data body from a list of parts. Each part is either
// { name, value } (a field) or { name, filename, contentType, data } (a file).
function multipart(parts) {
  const chunks = []
  for (const p of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`))
    if (p.filename != null) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.contentType}\r\n\r\n`
        )
      )
      chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data))
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`))
      chunks.push(Buffer.from(String(p.value)))
    }
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`))
  return Buffer.concat(chunks)
}

function makeApp() {
  const db = seedDb()
  const { privateKey } = testKeys()
  const dir = mkdtempSync(join(tmpdir(), 'pos-brand-'))
  writeFileSync(join(dir, 'releases.json'), '[]')
  const app = buildApp({ db, privateKey, adminPasswordHash: hashPassword(PASSWORD), cookieSecure: false, updatesDir: dir })
  return { db, app }
}

async function login(app) {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ password: PASSWORD }).toString()
  })
  return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE).value }
}

function post(app, cookie, parts) {
  return app.inject({
    method: 'POST',
    url: '/admin/branding',
    cookies: cookie,
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipart(parts)
  })
}

test('uploading a PNG logo stores it and redirects', async () => {
  const { db, app } = makeApp()
  const cookie = await login(app)
  const res = await post(app, cookie, [{ name: 'logo', filename: 'logo.png', contentType: 'image/png', data: PNG }])
  assert.equal(res.statusCode, 302)
  const a = getAsset(db, 'logo')
  assert.equal(a.contentType, 'image/png')
  assert.deepEqual(a.bytes, PNG)
})

test('the content-type is sniffed, not trusted — a mislabelled text file is rejected', async () => {
  const { db, app } = makeApp()
  const cookie = await login(app)
  const res = await post(app, cookie, [
    { name: 'logo', filename: 'evil.png', contentType: 'image/png', data: Buffer.from('<svg onload=alert(1)>') }
  ])
  assert.equal(res.statusCode, 400)
  assert.match(res.body, /PNG, JPEG, or WebP/)
  assert.equal(getAsset(db, 'logo'), null) // nothing stored
})

test('a logo over the 512 KB cap is rejected', async () => {
  const { db, app } = makeApp()
  const cookie = await login(app)
  const big = Buffer.concat([PNG, Buffer.alloc(520 * 1024, 7)]) // valid header, too big
  const res = await post(app, cookie, [{ name: 'logo', filename: 'big.png', contentType: 'image/png', data: big }])
  assert.equal(res.statusCode, 400)
  assert.match(res.body, /too large/)
  assert.equal(getAsset(db, 'logo'), null)
})

test('ticking "remove" deletes the asset, reverting to the default', async () => {
  const { db, app } = makeApp()
  const cookie = await login(app)
  await post(app, cookie, [{ name: 'logo', filename: 'logo.png', contentType: 'image/png', data: PNG }])
  assert.ok(getAsset(db, 'logo'))

  const res = await post(app, cookie, [
    { name: 'remove_logo', value: '1' },
    { name: 'logo', filename: '', contentType: 'application/octet-stream', data: Buffer.alloc(0) }
  ])
  assert.equal(res.statusCode, 302)
  assert.equal(getAsset(db, 'logo'), null)
})

test('an empty file field leaves an existing asset untouched', async () => {
  const { db, app } = makeApp()
  const cookie = await login(app)
  await post(app, cookie, [{ name: 'logo', filename: 'logo.png', contentType: 'image/png', data: PNG }])

  const res = await post(app, cookie, [
    { name: 'logo', filename: '', contentType: 'application/octet-stream', data: Buffer.alloc(0) }
  ])
  assert.equal(res.statusCode, 302)
  assert.ok(getAsset(db, 'logo')) // still there
})

test('the branding route requires being signed in', async () => {
  const { db, app } = makeApp()
  const res = await post(app, {}, [{ name: 'logo', filename: 'logo.png', contentType: 'image/png', data: PNG }])
  assert.equal(res.statusCode, 302)
  assert.match(res.headers.location, /\/admin\/login/)
  assert.equal(getAsset(db, 'logo'), null)
})

test('the settings page shows the branding uploader with both previews', async () => {
  const { app } = makeApp()
  const cookie = await login(app)
  const res = await app.inject({ method: 'GET', url: '/admin/settings', cookies: cookie })
  assert.match(res.body, /Branding/)
  assert.match(res.body, /action="\/admin\/branding"/)
  assert.match(res.body, /enctype="multipart\/form-data"/)
  assert.match(res.body, /src="\/branding\/logo"/)
  assert.match(res.body, /src="\/branding\/og-image"/)
  assert.match(res.body, /name="remove_og_image"/)
})
