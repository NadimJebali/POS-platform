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
  warn_days: '7'
}

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
  seedSettings(db)
  return db
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

export function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
