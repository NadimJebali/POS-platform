// Branding asset storage: BLOBs in SQLite, magic-byte format detection, size caps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seedDb } from './helpers.js'
import { putAsset, getAsset, getAssetMeta, deleteAsset, detectImageType, isAssetKey, MAX_BYTES } from '../src/assets.js'

// Minimal valid magic-byte headers padded out to a few bytes.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from([0, 0])])

test('detectImageType recognises PNG, JPEG, and WebP by their magic bytes', () => {
  assert.equal(detectImageType(PNG), 'image/png')
  assert.equal(detectImageType(JPEG), 'image/jpeg')
  assert.equal(detectImageType(WEBP), 'image/webp')
})

test('detectImageType rejects non-images and SVG (no magic match)', () => {
  assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
  assert.equal(detectImageType(Buffer.from('GIF89a')), null)
  assert.equal(detectImageType(Buffer.from('not an image at all')), null)
})

test('putAsset stores a BLOB and getAsset returns the exact bytes + type', () => {
  const db = seedDb()
  putAsset(db, 'logo', 'image/png', PNG)
  const a = getAsset(db, 'logo')
  assert.equal(a.contentType, 'image/png')
  assert.ok(Buffer.isBuffer(a.bytes))
  assert.deepEqual(a.bytes, PNG)
  assert.equal(typeof a.updatedAt, 'number')
})

test('getAsset / getAssetMeta return null when the asset is absent', () => {
  const db = seedDb()
  assert.equal(getAsset(db, 'og_image'), null)
  assert.equal(getAssetMeta(db, 'og_image'), null)
})

test('putAsset replaces an existing asset and advances updated_at', () => {
  const db = seedDb()
  putAsset(db, 'logo', 'image/png', PNG, 1000)
  assert.equal(getAssetMeta(db, 'logo').updatedAt, 1000)
  putAsset(db, 'logo', 'image/jpeg', JPEG, 2000)
  const a = getAsset(db, 'logo')
  assert.equal(a.contentType, 'image/jpeg')
  assert.deepEqual(a.bytes, JPEG)
  assert.equal(a.updatedAt, 2000)
})

test('deleteAsset removes it (reverting to the default)', () => {
  const db = seedDb()
  putAsset(db, 'logo', 'image/png', PNG)
  deleteAsset(db, 'logo')
  assert.equal(getAsset(db, 'logo'), null)
})

test('putAsset refuses an unknown key', () => {
  const db = seedDb()
  assert.throws(() => putAsset(db, 'banner', 'image/png', PNG), /Unknown asset key/)
})

test('isAssetKey / MAX_BYTES expose the known keys and their caps', () => {
  assert.equal(isAssetKey('logo'), true)
  assert.equal(isAssetKey('og_image'), true)
  assert.equal(isAssetKey('nope'), false)
  assert.equal(MAX_BYTES.logo, 512 * 1024)
  assert.equal(MAX_BYTES.og_image, 2 * 1024 * 1024)
})
