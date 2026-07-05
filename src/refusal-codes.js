// SHARED refusal vocabulary for the licence boundary (#15). Every reason the server can
// refuse an activate/renew/rebind with — plus the client-only transport failures the app
// raises — in one enumerated table, so the two repos can't drift on the codes they branch
// on. Vendored into POS-software (see scripts/vendor-protocol.mjs); the app derives its
// user-facing handling from the same table.
export const REFUSAL = {
  // Server-thrown. `status` is the HTTP status the API returns for this refusal.
  invalid_code: { status: 404, meaning: 'The activation code is not valid' },
  bad_request: { status: 400, meaning: 'The request was malformed' },
  suspended: { status: 403, meaning: 'The licence is suspended' },
  revoked: { status: 403, meaning: 'The licence has been revoked' },
  machine_limit: { status: 409, meaning: 'The licence is already active on another machine' },
  transfer_limit: { status: 429, meaning: 'The yearly machine-transfer limit is spent' },
  invalid_key: { status: 401, meaning: 'The presented licence key could not be verified' },
  machine_mismatch: { status: 403, meaning: 'The key belongs to a different machine' },
  unbound: { status: 403, meaning: 'This machine is no longer bound to the licence' },
  lapsed: { status: 403, meaning: 'The subscription has lapsed past its grace window' },
  internal: { status: 500, meaning: 'An unexpected server error' },

  // Client-only transport failures — the app raises these; the server never sends them.
  network: { clientOnly: true, meaning: 'The licensing server was unreachable' },
  server_error: { clientOnly: true, meaning: 'The server returned an unexpected response' },
  rate_limited: { clientOnly: true, meaning: 'Too many attempts — wait and retry' }
}

// The codes the SERVER can return (statused, not client-only).
export const SERVER_REFUSALS = Object.keys(REFUSAL).filter((c) => !REFUSAL[c].clientOnly)

export function isRefusalCode(code) {
  return Object.prototype.hasOwnProperty.call(REFUSAL, code)
}
