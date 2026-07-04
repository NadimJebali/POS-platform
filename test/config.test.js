import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAdminHash } from '../src/config.js'
import { hashPassword, verifyPassword } from '../src/auth.js'

test('ADMIN_PASSWORD is hashed into a hash that verifies the password', () => {
  const h = resolveAdminHash({ ADMIN_PASSWORD: 'hunter2' })
  assert.ok(verifyPassword('hunter2', h))
  assert.equal(verifyPassword('wrong', h), false)
})

test('ADMIN_PASSWORD takes precedence over ADMIN_PASSWORD_HASH', () => {
  const h = resolveAdminHash({ ADMIN_PASSWORD: 'plain', ADMIN_PASSWORD_HASH: 'scrypt$32768$8$1$aa$bb' })
  assert.ok(verifyPassword('plain', h))
})

test('falls back to ADMIN_PASSWORD_HASH when no plaintext is set', () => {
  const pre = hashPassword('viahash')
  assert.equal(resolveAdminHash({ ADMIN_PASSWORD_HASH: pre }), pre)
})

test('neither set disables login (empty hash)', () => {
  assert.equal(resolveAdminHash({}), '')
})
