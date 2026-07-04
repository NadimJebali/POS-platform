// Shared test scaffolding: a throwaway keypair, an in-memory DB, and seed helpers.
import crypto from 'node:crypto'
import { openDb } from '../src/db.js'
import { generateActivationCode } from '../src/activation-code.js'

export function testKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  return { publicKey, privateKey }
}

export function seedDb() {
  return openDb(':memory:')
}

export function insertCustomer(db, name = 'Café Test') {
  const info = db
    .prepare('INSERT INTO customers (name, phone, city, created_at) VALUES (?, ?, ?, ?)')
    .run(name, '20000000', 'Tunis', Date.now())
  return Number(info.lastInsertRowid)
}

// Inserts a license and returns { id, code } where `code` is the canonical code to
// feed into /activate. Override status/maxMachines to exercise the error paths.
export function insertLicense(db, { customerId, status = 'active', maxMachines = 1, name = 'Café Test' } = {}) {
  const code = generateActivationCode()
  const info = db
    .prepare(
      'INSERT INTO licenses (customer_id, activation_code, status, max_machines, name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(customerId, code, status, maxMachines, name, Date.now())
  return { id: Number(info.lastInsertRowid), code }
}
