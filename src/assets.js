// Branding assets (logo, Open Graph share image) stored as SQLite BLOBs. Kept free of
// HTTP concerns so it's unit-testable and reused by the public serving routes and the
// admin upload handler. See schema.sql for why BLOBs (backup + no extra mount).

// The only asset keys the rest of the system will store/serve. Anything else is a bug.
export const ASSET_KEYS = ['logo', 'og_image']

// Per-asset upload size caps (bytes). A square logo is small; a share banner larger.
export const MAX_BYTES = { logo: 512 * 1024, og_image: 2 * 1024 * 1024 }

// Accepted upload formats, identified by magic bytes (never the client-declared type).
// Raster only — SVG is excluded on purpose: an uploaded SVG can carry <script> and would
// run same-origin. Our own default favicon SVG is safe because we author it, never a
// client upload.
const SNIFFERS = [
  { type: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/webp',
    test: (b) =>
      b.length > 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  }
]

// Sniffs the real image type from the leading bytes. Returns the MIME string, or null
// if the bytes aren't one of the accepted raster formats.
export function detectImageType(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  return SNIFFERS.find((s) => s.test(b))?.type ?? null
}

export function isAssetKey(key) {
  return ASSET_KEYS.includes(key)
}

// Stores (or replaces) an asset, bumping updated_at so ETags + ?v= cache-busters change.
export function putAsset(db, key, contentType, bytes, now = Date.now()) {
  if (!isAssetKey(key)) throw new Error(`Unknown asset key: ${key}`)
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  db.prepare(
    `INSERT INTO assets (key, content_type, bytes, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes, updated_at = excluded.updated_at`
  ).run(key, contentType, buf, now)
}

// Full asset (bytes included) or null. node:sqlite returns a BLOB as a Uint8Array;
// wrap it in a Buffer so callers get a consistent type.
export function getAsset(db, key) {
  const row = db.prepare('SELECT content_type, bytes, updated_at FROM assets WHERE key = ?').get(key)
  if (!row) return null
  return { contentType: row.content_type, bytes: Buffer.from(row.bytes), updatedAt: Number(row.updated_at) }
}

// Lightweight existence/version check — no BLOB read. Used to build cache-busters and
// resolve the OG fallback ladder on every page render without loading image bytes.
export function getAssetMeta(db, key) {
  const row = db.prepare('SELECT updated_at FROM assets WHERE key = ?').get(key)
  return row ? { updatedAt: Number(row.updated_at) } : null
}

export function deleteAsset(db, key) {
  db.prepare('DELETE FROM assets WHERE key = ?').run(key)
}
