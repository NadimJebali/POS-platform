// Generates a fresh Ed25519 keypair for signing licenses.
//
//   npm run keygen
//
// Prints both keys to stdout. The PRIVATE key goes into the server's .env as
// LICENSE_PRIVATE_KEY (single line, \n-escaped) and NOWHERE else. The PUBLIC key
// gets embedded in the POS app so it can verify licenses offline. This script
// never writes to disk, so it can't accidentally leave key material lying around
// in the repo — copy what you need from the terminal.
import crypto from 'node:crypto'

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

// Single-line, \n-escaped form for pasting into a .env value.
const privEnv = privPem.replace(/\n/g, '\\n')

console.log('=== PUBLIC KEY (embed in the POS app) ===')
console.log(pubPem)
console.log('=== PRIVATE KEY (paste into server .env as LICENSE_PRIVATE_KEY) ===')
console.log(`LICENSE_PRIVATE_KEY="${privEnv}"`)
console.log()
console.log('Keep the private key secret. Do not commit it. Do not ship it in the app.')
