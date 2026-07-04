# POS-platform

License server, customer registry, and update feed for [POS Software](https://github.com/NadimJebali/POS-software).

Node.js + SQLite (`node:sqlite`, no native build) behind Caddy, deployed with Docker
Compose on a single droplet. The POS app runs fully offline day-to-day; it only talks
to this server to **activate** and to **renew** its short-lived, machine-bound license.

## Status

Tracer bullet (issue #6): schema, keypair, and `POST /activate`. Renewal, admin,
rebind, and the update feed follow in later slices.

## Requirements

- Node.js >= 22.5 (uses the built-in `node:sqlite`; developed on Node 24)

## Getting started

```bash
npm install
npm run keygen          # generate an Ed25519 keypair
cp .env.example .env    # paste the printed LICENSE_PRIVATE_KEY into it
node --env-file=.env src/server.js
```

Run the tests (no network, in-memory DB, throwaway keypair):

```bash
npm test
```

## API

### `POST /activate`

Bind a machine to a license and receive a signed license key.

Request:

```json
{ "code": "POSK-XXXX-XXXX-XXXX-XXXX-XXXX", "machineId": "ABCD-1234-EF56", "appVersion": "0.2.0" }
```

Success `200`: `{ "license_key": "<base64payload>.<base64sig>", "exp": 1750000000000 }`

Errors (each has a stable `error` code): `invalid_code` (404), `suspended` /
`revoked` (403), `machine_limit` (409, license already on another machine — the app
offers rebind), `bad_request` (400).

## License format

`<base64(payloadJson)>.<base64(ed25519 signature over the base64 string)>`. This is
the exact format the POS app verifies offline; `test/license-format.test.js` is a
contract test that guards it against drift. **Never** change the signing details
without updating the app's verifier in lockstep.

## Deployment

`docker compose up -d` on the droplet after populating `.env` (`LICENSE_PRIVATE_KEY`,
`DOMAIN`). Caddy handles TLS for `$DOMAIN`. SQLite persists on a named volume.

## Security

- The private signing key lives only in the server's environment — never in git,
  never in the shipped app. `.gitignore` blocks `.env` and `*.pem`.
- All policy (renewal window, grace days, transfer limit) lives in the `settings`
  table and is read at runtime — changing it never requires an app release.
