import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateActivationCode,
  formatActivationCode,
  normalizeActivationCode
} from '../src/activation-code.js'

test('generated codes round-trip through normalize (incl. the O in the POSK prefix)', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateActivationCode()
    assert.equal(normalizeActivationCode(code), code, `failed for ${code}`)
  }
})

test('the pretty dash-grouped form normalizes back to canonical', () => {
  const code = generateActivationCode()
  assert.equal(normalizeActivationCode(formatActivationCode(code)), code)
})

test('lowercase and spaced input still normalizes', () => {
  const code = generateActivationCode()
  const messy = formatActivationCode(code).toLowerCase().replace(/-/g, ' ')
  assert.equal(normalizeActivationCode(messy), code)
})

test('read-alike substitutions in the data are accepted (I/L->1, O->0)', () => {
  // Build a code whose data has a 0 and a 1, then feed the look-alikes O and I.
  const base = 'POSK' + '01234567890123456789'
  const typed = 'POSK' + 'O1234567890123456789'.replace('O', 'O') // leading O -> 0
  assert.equal(normalizeActivationCode(typed), base)
  assert.equal(normalizeActivationCode('POSK' + 'I1234567890123456789'), 'POSK' + '11234567890123456789')
})

test('rejects garbage, wrong length, and wrong prefix', () => {
  assert.equal(normalizeActivationCode(''), '')
  assert.equal(normalizeActivationCode('nope'), '')
  assert.equal(normalizeActivationCode('POSK-1234'), '') // too short
  assert.equal(normalizeActivationCode('XXXX' + '01234567890123456789'), '') // wrong prefix
  assert.equal(normalizeActivationCode(null), '')
})
