// SHARED wire contract for the licence endpoints — the request-body shapes for
// /activate, /rebind, and /renew, defined once so the server validates inbound requests
// at the route seam and both repos read the same definitions. Vendored into POS-software
// (see scripts/vendor-protocol.mjs). JSON Schema (the form Fastify validates with).
export const ACTIVATE_BODY = {
  type: 'object',
  required: ['code', 'machineId'],
  properties: {
    code: { type: 'string', minLength: 1 },
    machineId: { type: 'string', minLength: 1 },
    appVersion: { type: 'string' }
  }
}

// Rebind takes the same shape as activate (a code + the target machine).
export const REBIND_BODY = ACTIVATE_BODY

export const RENEW_BODY = {
  type: 'object',
  required: ['license_key'],
  properties: {
    license_key: { type: 'string', minLength: 1 },
    machineId: { type: 'string' },
    appVersion: { type: 'string' }
  }
}
