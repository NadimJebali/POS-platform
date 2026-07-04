// Database layer built on Node's built-in `node:sqlite` (Node >= 22.5) — no native
// compilation, so it installs on a machine with no C++ toolchain. Synchronous API.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA = readFileSync(join(here, 'schema.sql'), 'utf8')

// Global policy defaults. These are SEED values only — once written to the settings
// table they are edited from the admin, and all runtime code reads them from the DB.
export const DEFAULT_SETTINGS = {
  renewal_window_days: '30',
  grace_days: '7',
  transfers_per_year: '2',
  warn_days: '7',
  // Public download page (rendered at /). Off until the admin flips it on.
  download_page_enabled: '0',
  product_name: 'POS Software',
  product_tagline: '',
  product_description: '',
  contact_phone: '',
  contact_email: ''
}

// The settings above that hold free text (edited via setTextSetting; everything the
// admin can break is length-capped there). The rest are non-negative integers.
export const TEXT_SETTINGS = [
  'download_page_enabled',
  'product_name',
  'product_tagline',
  'product_description',
  'contact_phone',
  'contact_email'
]

// Opens (or creates) the database, applies the schema, and seeds any missing
// settings. `:memory:` gives a throwaway DB for tests.
export function openDb(path = ':memory:') {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  migrate(db)
  seedSettings(db)
  return db
}

// Additive migrations for databases created before a column existed (CREATE TABLE
// IF NOT EXISTS won't add columns to an existing table). Each step is idempotent.
function migrate(db) {
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  if (!columns('customers').includes('archived_at')) {
    db.exec('ALTER TABLE customers ADD COLUMN archived_at INTEGER')
  }
}

function seedSettings(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insert.run(key, value)
  }
}

// Reads a numeric setting from the DB. Throws if absent so a typo fails loudly
// rather than silently defaulting.
export function getIntSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) throw new Error(`Missing setting: ${key}`)
  return Number(row.value)
}

// Writes a non-negative integer setting. Only known keys are writable so the admin
// form can't inject arbitrary settings rows.
export function setIntSetting(db, key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${key}`)
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a non-negative integer`)
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(n), key)
}

// Writes a free-text setting. Only known text keys are writable, and values are
// length-capped so a paste accident can't balloon the page.
export function setTextSetting(db, key, value) {
  if (!TEXT_SETTINGS.includes(key)) throw new Error(`Unknown setting: ${key}`)
  const s = String(value ?? '').slice(0, 2000)
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(s, key)
}

export function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
