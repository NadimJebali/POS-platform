// Fastify app factory. Everything the app needs is injected (`db`, `privateKey`),
// so tests build an app over a throwaway in-memory DB and test keypair and drive it
// with `app.inject()` — no network, no real files. server.js wires the real ones.
import Fastify from 'fastify'
import { activate, LicenseError } from './licenses.js'

export function buildApp({ db, privateKey, logger = false }) {
  const app = Fastify({ logger })

  // Liveness probe (used by Docker/Caddy health checks and uptime pings).
  app.get('/health', async () => ({ ok: true }))

  // POST /activate — bind a machine to a license and return a signed license key.
  // Body: { code, machineId, appVersion? }
  app.post('/activate', async (request, reply) => {
    const { code, machineId, appVersion } = request.body ?? {}
    try {
      const result = activate(db, { code, machineId, appVersion }, { privateKey })
      return result
    } catch (err) {
      if (err instanceof LicenseError) {
        return reply.status(err.status).send({ error: err.code, message: err.message })
      }
      request.log.error(err)
      return reply.status(500).send({ error: 'internal', message: 'Something went wrong' })
    }
  })

  return app
}
