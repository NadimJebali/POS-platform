// Admin authentication: password hashing (scrypt) and session tokens.
//
// The admin panel can mint and revoke licenses, so it's the most attack-worthy
// surface here. Defenses: a single account whose password is stored only as a heavy
// scrypt hash, random session tokens in httpOnly cookies, and login rate limiting
// (see admin/login-limit.js). Same self-describing hash format as the POS app's
// PIN hashing, so the work factor can be raised later without locking anyone out.
import crypto from 'node:crypto'

const SCRYPT_N = 1 << 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 64
const MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2

const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours
const SESSION_COOKIE = 'pos_admin'

function derive(password, salt, n, r, p) {
  return crypto.scryptSync(String(password), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }).toString('hex')
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)}`
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false
  const [, n, r, p, salt, hash] = stored.split('$')
  if (!salt || !hash) return false
  const test = derive(password, salt, Number(n), Number(r), Number(p))
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(test, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export { SESSION_COOKIE }

// Creates a session row and returns its token (to be set as a cookie).
export function createSession(db, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').run(
    token,
    now,
    now + SESSION_TTL_MS
  )
  return token
}

// Returns true if the token maps to a live session. Sweeps expired rows lazily.
export function isSessionValid(db, token, now = Date.now()) {
  if (!token) return false
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  const row = db.prepare('SELECT token FROM sessions WHERE token = ? AND expires_at > ?').get(token, now)
  return !!row
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}
