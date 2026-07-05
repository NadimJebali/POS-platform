// Fastify app factory. Everything the app needs is injected (`db`, `privateKey`),
// so tests build an app over a throwaway in-memory DB and test keypair and drive it
// with `app.inject()` — no network, no real files. server.js wires the real ones.
import Fastify from 'fastify'
import crypto from 'node:crypto'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import rateLimit from '@fastify/rate-limit'
import { activate, renew, rebind, LicenseError } from './licenses.js'
import { registerAdmin } from './admin/index.js'
import { readReleases } from './releases.js'
import { downloadPage } from './download-page.js'
import { getAllSettings } from './db.js'
import { getAsset, getAssetMeta } from './assets.js'
import { monogramSvg, defaultOgPng } from './branding.js'
import { ACTIVATE_BODY, REBIND_BODY, RENEW_BODY } from './wire-schemas.js'

// Per-IP limits on the public write endpoints. activate/rebind are the guessable
// ones (someone probing activation codes), so they're tighter; renew is called
// routinely by every client so it's looser. Overridable for tests.
const DEFAULT_RATE_LIMITS = {
  activate: { max: 20, timeWindow: '1 minute' },
  rebind: { max: 20, timeWindow: '1 minute' },
  renew: { max: 60, timeWindow: '1 minute' }
}

export function buildApp({
  db,
  privateKey,
  adminPasswordHash = '',
  cookieSecure = true,
  rateLimits = DEFAULT_RATE_LIMITS,
  updatesDir = process.env.UPDATES_DIR || './updates',
  logger = false
}) {
  // trustProxy so request.ip reflects Caddy's X-Forwarded-For (per-IP rate limiting).
  const app = Fastify({ logger, trustProxy: true })

  app.register(cookie)
  app.register(formbody) // parse HTML form posts (application/x-www-form-urlencoded)

  // The server verifies clients' current keys against its OWN public key, derived
  // once from the signing key — this is what makes /renew self-authenticating.
  const publicKey = crypto.createPublicKey(privateKey)

  // A schema violation on a public endpoint (attachValidation surfaces it as
  // request.validationError) becomes a clean bad_request the app can branch on, instead
  // of Fastify's default {error:'Bad Request'} shape or a failure deep in domain code.
  const badRequest = (reply) => reply.status(400).send({ error: 'bad_request', message: 'The request was malformed' })

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

  // Public download page. Off (404) until the admin enables it in settings; content
  // comes from the settings table + the releases.json manifest in the updates dir
  // (the app's publish script maintains both the installers and the manifest there).
  app.get('/', async (request, reply) => {
    const settings = getAllSettings(db)
    if (settings.download_page_enabled !== '1') {
      return reply.status(404).type('text/html').send('<!doctype html><title>Not found</title><p>Nothing here yet.</p>')
    }
    return reply.type('text/html').send(
      downloadPage({
        settings,
        releases: readReleases(updatesDir),
        // Absolute origin for the OG/Twitter tags (scrapers reject relative URLs). With
        // trustProxy on, Caddy's forwarded proto/host are authoritative.
        baseUrl: `${request.headers['x-forwarded-proto'] || request.protocol}://${request.headers.host}`,
        // Meta only (no BLOB read) — presence drives the OG fallback ladder + ?v= busters.
        branding: { logo: getAssetMeta(db, 'logo'), og: getAssetMeta(db, 'og_image') }
      })
    )
  })

  // Branding assets for the public page + the browser tab. Served by Node (Caddy only
  // serves /updates). ETag + short cache trims repeat bandwidth; the real cache-busting
  // is the ?v=<updated_at> the HTML appends, which changes the URL when an image is
  // replaced so browsers AND social scrapers refetch.
  const sendAsset = (reply, request, { contentType, bytes, updatedAt }) => {
    const etag = `"${updatedAt.toString(36)}"`
    reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=3600').header('ETag', etag)
    if (request.headers['if-none-match'] === etag) return reply.status(304).send()
    return reply.type(contentType).send(bytes)
  }
  const sendDefault = (reply, contentType, body, maxAge = 3600) =>
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', `public, max-age=${maxAge}`)
      .type(contentType)
      .send(body)

  app.get('/branding/:key', async (request, reply) => {
    const key = request.params.key === 'og-image' ? 'og_image' : request.params.key
    if (key === 'logo') {
      const logo = getAsset(db, 'logo')
      return logo
        ? sendAsset(reply, request, logo)
        : sendDefault(reply, 'image/svg+xml', monogramSvg(getAllSettings(db).product_name))
    }
    if (key === 'og_image') {
      // Fallback ladder: uploaded OG image → the logo (square) → the generic banner.
      const og = getAsset(db, 'og_image') || getAsset(db, 'logo')
      return og ? sendAsset(reply, request, og) : sendDefault(reply, 'image/png', defaultOgPng(), 86400)
    }
    return reply.status(404).send()
  })

  // The bare /favicon.ico browsers request unprompted (e.g. on admin pages, which carry
  // no <link rel=icon>): the uploaded logo, else the generated monogram.
  app.get('/favicon.ico', async (request, reply) => {
    const logo = getAsset(db, 'logo')
    return logo
      ? sendAsset(reply, request, logo)
      : sendDefault(reply, 'image/svg+xml', monogramSvg(getAllSettings(db).product_name))
  })

  // The public write endpoints live in a child plugin that registers rate limiting
  // (per-IP, opt-in) BEFORE defining its routes, so the plugin's onRoute hook sees
  // them. /health and the admin pages sit outside it and aren't throttled (admin has
  // its own login limiter).
  app.register(async (pub) => {
    await pub.register(rateLimit, { global: false })

    // POST /activate — bind a machine to a license and return a signed license key.
    // Body: { code, machineId, appVersion? }
    pub.post(
      '/activate',
      { config: { rateLimit: rateLimits.activate }, schema: { body: ACTIVATE_BODY }, attachValidation: true },
      async (request, reply) => {
        if (request.validationError) return badRequest(reply)
        const { code, machineId, appVersion } = request.body ?? {}
        return handle(request, reply, () => activate(db, { code, machineId, appVersion }, { privateKey }))
      }
    )

    // POST /renew — exchange the client's current signed key for a fresh one,
    // enforcing status and payment standing. Body: { license_key, machineId?, appVersion? }
    pub.post(
      '/renew',
      { config: { rateLimit: rateLimits.renew }, schema: { body: RENEW_BODY }, attachValidation: true },
      async (request, reply) => {
        if (request.validationError) return badRequest(reply)
        const { license_key, machineId, appVersion } = request.body ?? {}
        return handle(request, reply, () => renew(db, { license_key, machineId, appVersion }, { privateKey, publicKey }))
      }
    )

    // POST /rebind — self-service machine transfer: move a license onto a new machine.
    // Body: { code, machineId, appVersion? }
    pub.post(
      '/rebind',
      { config: { rateLimit: rateLimits.rebind }, schema: { body: REBIND_BODY }, attachValidation: true },
      async (request, reply) => {
        if (request.validationError) return badRequest(reply)
        const { code, machineId, appVersion } = request.body ?? {}
        return handle(request, reply, () => rebind(db, { code, machineId, appVersion }, { privateKey }))
      }
    )
  })

  // Admin panel (server-rendered HTML) under /admin.
  registerAdmin(app, { db, adminPasswordHash, cookieSecure, updatesDir })

  return app
}
