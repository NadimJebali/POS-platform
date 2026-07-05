// SHARED GOLDEN VECTOR for the licence-protocol module. This is the drift tripwire of
// the vendored-mirror contract (see POS-platform#13): a fixed keypair + payload with a
// known-good licence string. Both repos carry an identical copy of this fixture. If the
// signing/verifying bytes ever change on either side, the golden test in that repo fails
// against this constant — so a divergent copy can't ship silently.
//
// The Ed25519 keypair is a throwaway used ONLY by tests; it is not a production key.
// The signature is deterministic (Ed25519), so GOLDEN_LICENCE is stable for these inputs.

export const GOLDEN_PRIVATE_KEY_PEM = `***REMOVED***`

export const GOLDEN_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAJP4CcP0lDJQuqu/rAf08FAj8eJg5EFL9OsAzm9txQo=
-----END PUBLIC KEY-----`

// A fully-fixed payload (key order matches buildPayload's output).
export const GOLDEN_PAYLOAD = { lid: 42, machineId: 'ABCD-1234-EF56', name: 'Café Golden', exp: 1800000000000, warnDays: 7 }

// The exact licence string signing GOLDEN_PAYLOAD with the fixed private key must produce.
export const GOLDEN_LICENCE =
  'eyJsaWQiOjQyLCJtYWNoaW5lSWQiOiJBQkNELTEyMzQtRUY1NiIsIm5hbWUiOiJDYWbDqSBHb2xkZW4iLCJleHAiOjE4MDAwMDAwMDAwMDAsIndhcm5EYXlzIjo3fQ==.Caz6G82DAKX/bZVNSW5Js79y8SCBgamcI+bXnbdAw6JZ1ZbtBMZjPZAvW0/uatwuuJqkX5ylpeyFGGSbThlIAw=='
