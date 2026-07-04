// Fastify app factory. Everything the app needs is injected (`db`, `privateKey`),
// so tests build an app over a throwaway in-memory DB and test keypair and drive it
// with `app.inject()` — no network, no real files. server.js wires the real ones.
import Fastify from 'fastify'
import crypto from 'node:crypto'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import { activate, renew, rebind, LicenseError } from './licenses.js'
import { registerAdmin } from './admin/index.js'

export function buildApp({ db, privateKey, adminPasswordHash = '', cookieSecure = true, logger = false }) {
  // trustProxy so request.ip reflects Caddy's X-Forwarded-For (per-IP rate limiting).
  const app = Fastify({ logger, trustProxy: true })

  app.register(cookie)
  app.register(formbody) // parse HTML form posts (application/x-www-form-urlencoded)

  // The server verifies clients' current keys against its OWN public key, derived
  // once from the signing key — this is what makes /renew self-authenticating.
  const publicKey = crypto.createPublicKey(privateKey)

  // Turns a domain call into an HTTP response, mapping LicenseError -> its status.
  const handle = (request, reply, fn) => {
    try {
      return fn()
    } catch (err) {
      if (err instanceof LicenseError) {
        return reply.status(err.status).send({ error: err.code, message: err.message })
      }
      request.log.error(err)
      return reply.status(500).send({ error: 'internal', message: 'Something went wrong' })
    }
  }

  // Liveness probe (used by Docker/Caddy health checks and uptime pings).
  app.get('/health', async () => ({ ok: true }))

  // POST /activate — bind a machine to a license and return a signed license key.
  // Body: { code, machineId, appVersion? }
  app.post('/activate', async (request, reply) => {
    const { code, machineId, appVersion } = request.body ?? {}
    return handle(request, reply, () =>
      activate(db, { code, machineId, appVersion }, { privateKey })
    )
  })

  // POST /renew — exchange the client's current signed key for a fresh one, enforcing
  // status and payment standing. Body: { license_key, machineId?, appVersion? }
  app.post('/renew', async (request, reply) => {
    const { license_key, machineId, appVersion } = request.body ?? {}
    return handle(request, reply, () =>
      renew(db, { license_key, machineId, appVersion }, { privateKey, publicKey })
    )
  })

  // POST /rebind — self-service machine transfer: move a license onto a new machine.
  // Body: { code, machineId, appVersion? }
  app.post('/rebind', async (request, reply) => {
    const { code, machineId, appVersion } = request.body ?? {}
    return handle(request, reply, () => rebind(db, { code, machineId, appVersion }, { privateKey }))
  })

  // Admin panel (server-rendered HTML) under /admin.
  registerAdmin(app, { db, adminPasswordHash, cookieSecure })

  return app
}
