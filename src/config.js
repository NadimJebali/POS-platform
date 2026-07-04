// Loads runtime configuration from the environment. Kept tiny and dependency-free;
// `.env` is loaded by `node --env-file` (see server.js) rather than a library.
import crypto from 'node:crypto'

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
    privateKey: loadPrivateKey(env)
  }
}
