// Loads runtime configuration from the environment. Kept tiny and dependency-free;
// `.env` is loaded by `node --env-file` (see server.js) rather than a library.
import crypto from 'node:crypto'
import { hashPassword } from './auth.js'

// Parses the Ed25519 private key from LICENSE_PRIVATE_KEY. Accepts either a real
// multi-line PEM or the single-line \n-escaped form that lives in a .env value.
// Throws loudly at startup if it's missing or malformed — the server is useless
// without it, so failing fast beats issuing unsigned garbage.
export function loadPrivateKey(env = process.env) {
  const raw = env.LICENSE_PRIVATE_KEY
  if (!raw) throw new Error('LICENSE_PRIVATE_KEY is not set')
  const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
  try {
    return crypto.createPrivateKey(pem)
  } catch (err) {
    throw new Error(`LICENSE_PRIVATE_KEY is not a valid private key: ${err.message}`)
  }
}

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    dbPath: env.DB_PATH || './data/pos-platform.db',
    privateKey: loadPrivateKey(env),
    adminPasswordHash: resolveAdminHash(env),
    // Marks the session cookie Secure so it's only sent over HTTPS. Defaults on;
    // set COOKIE_INSECURE=1 for local plain-HTTP testing.
    cookieSecure: env.COOKIE_INSECURE !== '1'
  }
}

// Resolves the effective admin login hash. Two ways to configure it:
//  - ADMIN_PASSWORD: a plaintext password, hashed here at startup (simplest).
//  - ADMIN_PASSWORD_HASH: a pre-computed scrypt hash (avoids plaintext at rest).
// ADMIN_PASSWORD wins when both are set. If neither is set, login is disabled.
export function resolveAdminHash(env = process.env) {
  if (env.ADMIN_PASSWORD) return hashPassword(env.ADMIN_PASSWORD)
  return env.ADMIN_PASSWORD_HASH || ''
}
