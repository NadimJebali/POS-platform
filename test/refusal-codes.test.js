// Server-side refusal-code parity (#15). Every code the server refuses a request with
// must be a member of the shared REFUSAL table, and LicenseError enforces that at the
// throw site — a typo'd or renamed code fails loudly (dev error) instead of leaking an
// unknown code across the boundary. The route-test suite exercises the real throw sites,
// so a green suite is the "throwable ⊆ table" proof; this file guards the mechanism.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LicenseError } from '../src/licenses.js'
import { REFUSAL, SERVER_REFUSALS } from '../src/refusal-codes.js'

test('LicenseError rejects an unknown refusal code', () => {
  assert.throws(() => new LicenseError('not_a_real_code', 'x'), /Unknown refusal code/)
})

test('LicenseError accepts every server refusal code in the shared table', () => {
  for (const code of SERVER_REFUSALS) {
    assert.doesNotThrow(() => new LicenseError(code, 'x'))
  }
})

test('every server refusal in the table carries an HTTP status; transport codes are client-only', () => {
  for (const code of SERVER_REFUSALS) {
    assert.equal(typeof REFUSAL[code].status, 'number', `${code} needs a status`)
    assert.notEqual(REFUSAL[code].clientOnly, true)
  }
  // The transport codes the app raises but the server never sends.
  for (const code of ['network', 'server_error', 'rate_limited']) {
    assert.equal(REFUSAL[code].clientOnly, true)
  }
})
