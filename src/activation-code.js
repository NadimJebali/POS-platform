// Activation codes: short, human-typeable, hard to guess.
//
// 20 data characters of Crockford base32 = 100 bits of entropy, printed in five
// dash-separated groups behind a POSK prefix, e.g.  POSK-7F3K-92QM-X1DZ-4R5T-8VWY.
// Brute force is hopeless (rate limiting on top comes in issue #11), and Crockford's
// alphabet (no I, L, O, U) survives being read aloud or hand-copied.
import crypto from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32
const DATA_LEN = 20
const GROUP = 4
const PREFIX = 'POSK'

// The canonical form stored in the DB and compared against: prefix + 20 data chars,
// uppercase, no separators.
export function generateActivationCode() {
  let data = ''
  const bytes = crypto.randomBytes(DATA_LEN)
  for (let i = 0; i < DATA_LEN; i++) {
    data += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return PREFIX + data
}

// The pretty form handed to a customer: dash-separated groups.
export function formatActivationCode(canonical) {
  const groups = [PREFIX]
  const data = canonical.slice(PREFIX.length)
  for (let i = 0; i < data.length; i += GROUP) {
    groups.push(data.slice(i, i + GROUP))
  }
  return groups.join('-')
}

// Normalizes whatever the customer typed back to canonical form for lookup:
// strip separators/whitespace, uppercase, and apply Crockford's read-alike mapping
// (O->0, I/L->1) so a mis-keyed letter still resolves. Returns '' if it can't be a
// valid code, so lookups miss cleanly instead of throwing.
export function normalizeActivationCode(input) {
  if (typeof input !== 'string') return ''
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '')
  if (!cleaned.startsWith(PREFIX)) return ''
  // Apply Crockford's read-alike mapping to the DATA only — the PREFIX itself
  // contains an 'O', which we must not rewrite to '0'.
  const data = cleaned.slice(PREFIX.length).replace(/O/g, '0').replace(/[IL]/g, '1')
  if (data.length !== DATA_LEN) return ''
  for (const ch of data) {
    if (!ALPHABET.includes(ch)) return ''
  }
  return PREFIX + data
}
