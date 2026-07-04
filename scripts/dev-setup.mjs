// Creates a local-dev .env if one doesn't exist: a throwaway signing keypair, a dev
// admin password, and plain-HTTP cookies. Runs automatically before `npm run dev`.
// NEVER overwrites an existing .env, so it can't clobber real secrets.
import { existsSync, writeFileSync } from 'node:fs'
import crypto from 'node:crypto'

const envPath = new URL('../.env', import.meta.url)
if (existsSync(envPath)) {
  console.log('.env already exists — leaving it untouched.')
  process.exit(0)
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const privLine = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n')
const DEV_PASSWORD = 'dev'

writeFileSync(
  envPath,
  `# Auto-generated for LOCAL DEV (scripts/dev-setup.mjs). Gitignored. Throwaway keys.
PORT=3000
DB_PATH=./data/dev.db
COOKIE_INSECURE=1
LICENSE_PRIVATE_KEY="${privLine}"
ADMIN_PASSWORD=${DEV_PASSWORD}
`
)

console.log('Wrote .env for local dev.')
console.log(`Admin login password: ${DEV_PASSWORD}  (http://localhost:3000/admin/login)`)
console.log('Public key (dev only):\n' + publicKey.export({ type: 'spki', format: 'pem' }).toString())
