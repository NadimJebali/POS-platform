// Public branding surfaces: the /branding/* + /favicon serving routes (fallback ladder,
// ETag/304, nosniff) and the OG/Twitter/favicon tags the download page emits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app.js'
import { putAsset } from '../src/assets.js'
import { testKeys, seedDb } from './helpers.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function makeApp() {
  const db = seedDb()
  const { privateKey } = testKeys()
  const dir = mkdtempSync(join(tmpdir(), 'pos-brand-'))
  writeFileSync(join(dir, 'releases.json'), '[]')
  const app = buildApp({ db, privateKey, adminPasswordHash: 'x', cookieSecure: false, updatesDir: dir })
  return { db, app }
}

test('GET /branding/logo serves the uploaded logo with nosniff + ETag', async () => {
  const { db, app } = makeApp()
  putAsset(db, 'logo', 'image/png', PNG, 1717)
  const res = await app.inject({ method: 'GET', url: '/branding/logo' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'image/png')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.ok(res.headers['etag'])
  assert.deepEqual(res.rawPayload, PNG)
})

test('GET /branding/logo falls back to a generated SVG monogram when no logo is set', async () => {
  const { app } = makeApp()
  const res = await app.inject({ method: 'GET', url: '/branding/logo' })
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /image\/svg\+xml/)
  assert.match(res.body, /<svg/)
})

test('a matching If-None-Match yields 304 (no body)', async () => {
  const { db, app } = makeApp()
  putAsset(db, 'logo', 'image/png', PNG, 42)
  const first = await app.inject({ method: 'GET', url: '/branding/logo' })
  const etag = first.headers['etag']
  const res = await app.inject({ method: 'GET', url: '/branding/logo', headers: { 'if-none-match': etag } })
  assert.equal(res.statusCode, 304)
  assert.equal(res.body, '')
})

test('the OG fallback ladder: uploaded OG → logo → generic banner', async () => {
  // 1) neither uploaded → the committed default PNG banner
  const a = makeApp()
  const def = await a.app.inject({ method: 'GET', url: '/branding/og-image' })
  assert.equal(def.statusCode, 200)
  assert.equal(def.headers['content-type'], 'image/png')
  assert.ok(def.rawPayload.length > 1000) // the real banner, not an empty stub

  // 2) only a logo uploaded → the logo stands in for the share image
  const b = makeApp()
  putAsset(b.db, 'logo', 'image/png', PNG, 7)
  const viaLogo = await b.app.inject({ method: 'GET', url: '/branding/og-image' })
  assert.deepEqual(viaLogo.rawPayload, PNG)

  // 3) a dedicated OG image wins over the logo
  const c = makeApp()
  putAsset(c.db, 'logo', 'image/png', PNG, 7)
  const OG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9])
  putAsset(c.db, 'og_image', 'image/jpeg', OG, 8)
  const viaOg = await c.app.inject({ method: 'GET', url: '/branding/og-image' })
  assert.deepEqual(viaOg.rawPayload, OG)
})

test('GET /favicon.ico serves the logo, else a monogram (never 404)', async () => {
  const { db, app } = makeApp()
  const none = await app.inject({ method: 'GET', url: '/favicon.ico' })
  assert.equal(none.statusCode, 200)
  assert.match(none.headers['content-type'], /image\/svg\+xml/)

  putAsset(db, 'logo', 'image/png', PNG, 5)
  const withLogo = await app.inject({ method: 'GET', url: '/favicon.ico' })
  assert.equal(withLogo.headers['content-type'], 'image/png')
})

test('the download page emits absolute OG/Twitter tags, a favicon link, and the right card type', async () => {
  const { db, app } = makeApp()
  db.prepare("UPDATE settings SET value = '1' WHERE key = 'download_page_enabled'").run()

  // No uploads → generic landscape banner → large card, with declared dimensions.
  const res = await app.inject({ method: 'GET', url: '/', headers: { host: 'pos.example.com', 'x-forwarded-proto': 'https' } })
  assert.match(res.body, /<meta property="og:image" content="https:\/\/pos\.example\.com\/branding\/og-image">/)
  assert.match(res.body, /<meta property="og:url" content="https:\/\/pos\.example\.com\/">/)
  assert.match(res.body, /<meta name="twitter:card" content="summary_large_image">/)
  assert.match(res.body, /og:image:width" content="1200"/)
  assert.match(res.body, /<link rel="icon" href="\/branding\/logo">/)

  // A square logo (no OG) → summary card + a versioned image URL.
  putAsset(db, 'logo', 'image/png', PNG, 999)
  const res2 = await app.inject({ method: 'GET', url: '/', headers: { host: 'pos.example.com', 'x-forwarded-proto': 'https' } })
  assert.match(res2.body, /<meta name="twitter:card" content="summary">/)
  assert.match(res2.body, /og:image" content="https:\/\/pos\.example\.com\/branding\/og-image\?v=999"/)
  assert.match(res2.body, /<link rel="icon" href="\/branding\/logo\?v=999">/)
  assert.match(res2.body, /<img class="mark mark-img" src="\/branding\/logo\?v=999"/)
})
