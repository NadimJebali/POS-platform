// Admin panel routes (server-rendered HTML) under /admin. Registered by buildApp.
import {
  SESSION_COOKIE,
  verifyPassword,
  createSession,
  isSessionValid,
  destroySession
} from '../auth.js'
import { createLoginLimiter } from './login-limit.js'
import {
  createCustomer,
  getCustomer,
  listCustomers,
  archiveCustomer,
  unarchiveCustomer,
  deleteCustomer
} from '../customers.js'
import {
  issueLicense,
  listLicensesForCustomer,
  getLicenseDetail,
  setLicenseStatus,
  unbindMachine,
  LicenseError
} from '../licenses.js'
import multipart from '@fastify/multipart'
import { recordPayment } from '../payments.js'
import { readReleases, currentLatestVersion, deleteRelease, ReleaseError } from '../releases.js'
import { getAllSettings, setIntSetting, setTextSetting } from '../db.js'
import { putAsset, deleteAsset, getAssetMeta, detectImageType, MAX_BYTES } from '../assets.js'
import {
  loginPage,
  customersPage,
  customerPage,
  licenseDetailPage,
  settingsPage
} from './templates.js'

export function registerAdmin(app, { db, adminPasswordHash, cookieSecure, updatesDir = './updates' }) {
  const limiter = createLoginLimiter()

  // Settings page data, including the published versions (from the updates feed) and
  // which one is live (latest.yml) so the admin can't delete the current build.
  const settingsView = (extra = {}) =>
    settingsPage({
      settings: getAllSettings(db),
      releases: readReleases(updatesDir),
      latestVersion: currentLatestVersion(updatesDir),
      // Meta drives the live previews + their ?v= cache-busters on the settings page.
      branding: { logo: getAssetMeta(db, 'logo'), og: getAssetMeta(db, 'og_image') },
      ...extra
    })

  const sendHtml = (reply, body, status = 200) =>
    reply.status(status).type('text/html; charset=utf-8').send(body)

  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/admin' }

  app.register(async (admin) => {
    // Branding uploads are multipart/form-data. Registered INSIDE this plugin so only
    // the admin accepts file uploads (the public API keeps its JSON/urlencoded parsers).
    // fileSize caps at the larger asset's limit; per-asset caps are enforced below.
    await admin.register(multipart, {
      limits: { fileSize: MAX_BYTES.og_image, files: 2, fields: 6, fieldSize: 100 }
    })

    // Gate everything under /admin behind a valid session, except the login page.
    admin.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0]
      if (path === '/admin/login') return
      if (!isSessionValid(db, request.cookies?.[SESSION_COOKIE])) {
        return reply.redirect('/admin/login')
      }
    })

    admin.get('/admin/login', async (request, reply) => sendHtml(reply, loginPage()))

    admin.post('/admin/login', async (request, reply) => {
      const ip = request.ip
      if (limiter.isBlocked(ip)) {
        return sendHtml(reply, loginPage({ error: 'Too many attempts. Try again later.' }), 429)
      }
      const password = request.body?.password ?? ''
      if (!verifyPassword(password, adminPasswordHash)) {
        limiter.recordFailure(ip)
        return sendHtml(reply, loginPage({ error: 'Incorrect password.' }), 401)
      }
      limiter.reset(ip)
      const token = createSession(db)
      reply.setCookie(SESSION_COOKIE, token, cookieOpts)
      return reply.redirect('/admin')
    })

    admin.post('/admin/logout', async (request, reply) => {
      destroySession(db, request.cookies?.[SESSION_COOKIE])
      reply.clearCookie(SESSION_COOKIE, { path: '/admin' })
      return reply.redirect('/admin/login')
    })

    admin.get('/admin', async (request, reply) => {
      const search = request.query?.q ?? ''
      const archived = request.query?.archived === '1'
      return sendHtml(
        reply,
        customersPage({ customers: listCustomers(db, { search, archived }), search, archived })
      )
    })

    admin.post('/admin/customers', async (request, reply) => {
      try {
        const c = createCustomer(db, request.body ?? {})
        return reply.redirect(`/admin/customers/${c.id}`)
      } catch (err) {
        if (err instanceof LicenseError) {
          return sendHtml(
            reply,
            customersPage({ customers: listCustomers(db, {}), search: '', error: err.message }),
            err.status
          )
        }
        throw err
      }
    })

    admin.get('/admin/customers/:id', async (request, reply) => {
      const customer = getCustomer(db, Number(request.params.id))
      if (!customer) return sendHtml(reply, loginPage({ error: 'No such customer' }), 404)
      const licenses = listLicensesForCustomer(db, customer.id)
      const newCode = request.query?.code || null
      const newLicenseId = Number(request.query?.lid) || null
      return sendHtml(reply, customerPage({ customer, licenses, newCode, newLicenseId }))
    })

    // Show a customer detail page, optionally with an error.
    const showCustomer = (reply, id, { error, status = 200 } = {}) => {
      const customer = getCustomer(db, id)
      if (!customer) return sendHtml(reply, loginPage({ error: 'No such customer' }), 404)
      return sendHtml(
        reply,
        customerPage({ customer, licenses: listLicensesForCustomer(db, id), error }),
        error ? status : 200
      )
    }

    admin.post('/admin/customers/:id/archive', async (request, reply) => {
      const id = Number(request.params.id)
      try {
        archiveCustomer(db, id)
        return reply.redirect(`/admin/customers/${id}`)
      } catch (err) {
        if (err instanceof LicenseError) return showCustomer(reply, id, { error: err.message, status: err.status })
        throw err
      }
    })

    admin.post('/admin/customers/:id/unarchive', async (request, reply) => {
      const id = Number(request.params.id)
      try {
        unarchiveCustomer(db, id)
        return reply.redirect(`/admin/customers/${id}`)
      } catch (err) {
        if (err instanceof LicenseError) return showCustomer(reply, id, { error: err.message, status: err.status })
        throw err
      }
    })

    admin.post('/admin/customers/:id/delete', async (request, reply) => {
      const id = Number(request.params.id)
      if (request.body?.confirm !== 'yes') {
        return showCustomer(reply, id, { error: 'Deletion must be confirmed', status: 400 })
      }
      try {
        deleteCustomer(db, id)
        return reply.redirect('/admin')
      } catch (err) {
        if (err instanceof LicenseError) return showCustomer(reply, id, { error: err.message, status: err.status })
        throw err
      }
    })

    admin.post('/admin/customers/:id/licenses', async (request, reply) => {
      const customerId = Number(request.params.id)
      try {
        const { id, code } = issueLicense(db, {
          customerId,
          maxMachines: Number(request.body?.max_machines) || 1
        })
        // Redirect with the fresh code (shown once, prominently) and the license id so
        // the banner can ask "has the customer paid?" and record against the ledger.
        return reply.redirect(`/admin/customers/${customerId}?code=${encodeURIComponent(code)}&lid=${id}`)
      } catch (err) {
        if (err instanceof LicenseError) {
          const customer = getCustomer(db, customerId)
          if (!customer) return sendHtml(reply, loginPage({ error: err.message }), err.status)
          return sendHtml(
            reply,
            customerPage({ customer, licenses: listLicensesForCustomer(db, customerId) }),
            err.status
          )
        }
        throw err
      }
    })

    admin.get('/admin/licenses/:id', async (request, reply) => {
      const detail = getLicenseDetail(db, Number(request.params.id))
      if (!detail) return sendHtml(reply, loginPage({ error: 'No such license' }), 404)
      return sendHtml(reply, licenseDetailPage(detail))
    })

    // Re-render a license detail page, optionally with an error, at a given status.
    const showLicense = (reply, id, { error, status = 200 } = {}) => {
      const detail = getLicenseDetail(db, id)
      if (!detail) return sendHtml(reply, loginPage({ error: 'No such license' }), 404)
      return sendHtml(reply, licenseDetailPage({ ...detail, error }), error ? status : 200)
    }

    admin.post('/admin/licenses/:id/payments', async (request, reply) => {
      const id = Number(request.params.id)
      try {
        const months = Number(request.body?.months) === 12 ? 12 : 1
        // The form takes TND; store millimes (integers) to match the app's money model.
        const amountMillimes = Math.round((Number(request.body?.amount) || 0) * 1000)
        recordPayment(db, { licenseId: id, months, amountMillimes, method: request.body?.method })
        // The post-issue banner sends `back` to return to the customer page. Only
        // in-admin paths are honored (open-redirect guard).
        const back = String(request.body?.back || '')
        return reply.redirect(back.startsWith('/admin/') ? back : `/admin/licenses/${id}`)
      } catch (err) {
        return showLicense(reply, id, { error: err.message, status: 400 })
      }
    })

    admin.post('/admin/licenses/:id/status', async (request, reply) => {
      const id = Number(request.params.id)
      const status = request.body?.status
      // Revocation is irreversible, so it requires the explicit confirm field the
      // revoke form sends (the button also asks in the browser).
      if (status === 'revoked' && request.body?.confirm !== 'yes') {
        return showLicense(reply, id, { error: 'Revocation must be confirmed', status: 400 })
      }
      try {
        setLicenseStatus(db, id, status)
        return reply.redirect(`/admin/licenses/${id}`)
      } catch (err) {
        if (err instanceof LicenseError) return showLicense(reply, id, { error: err.message, status: err.status })
        throw err
      }
    })

    admin.post('/admin/licenses/:id/machines/:machineId/unbind', async (request, reply) => {
      const id = Number(request.params.id)
      try {
        unbindMachine(db, id, request.params.machineId)
        return reply.redirect(`/admin/licenses/${id}`)
      } catch (err) {
        if (err instanceof LicenseError) return showLicense(reply, id, { error: err.message, status: err.status })
        throw err
      }
    })

    admin.get('/admin/settings', async (request, reply) => {
      return sendHtml(reply, settingsView({ saved: request.query?.saved === '1' }))
    })

    admin.post('/admin/settings', async (request, reply) => {
      try {
        for (const key of ['renewal_window_days', 'grace_days', 'transfers_per_year', 'warn_days']) {
          if (request.body?.[key] != null) setIntSetting(db, key, request.body[key])
        }
        // Download-page content. The enabled flag is a checkbox: absent when
        // unchecked, so it's normalized rather than skipped like the fields above.
        setTextSetting(db, 'download_page_enabled', request.body?.download_page_enabled === '1' ? '1' : '0')
        for (const key of ['product_name', 'product_tagline', 'product_description', 'contact_phone', 'contact_email']) {
          if (request.body?.[key] != null) setTextSetting(db, key, request.body[key])
        }
        return reply.redirect('/admin/settings?saved=1')
      } catch (err) {
        return sendHtml(reply, settingsView({ error: err.message }), 400)
      }
    })

    // Delete a published app version from the download feed (installer + blockmap +
    // its releases.json entry). The live (latest.yml) version is protected server-side.
    admin.post('/admin/releases/delete', async (request, reply) => {
      const version = String(request.body?.version || '')
      try {
        deleteRelease(updatesDir, version)
        return reply.redirect('/admin/settings?saved=1')
      } catch (err) {
        if (err instanceof ReleaseError) return sendHtml(reply, settingsView({ error: err.message }), 400)
        throw err
      }
    })

    // Branding: upload/replace/remove the logo and share image in one multipart form.
    // Per asset: a ticked "remove" reverts to the default; otherwise a chosen file is
    // validated (magic-byte type + per-asset size cap) and stored; an empty field is a
    // no-op so untouched assets are left alone.
    admin.post('/admin/branding', async (request, reply) => {
      const removals = new Set()
      const uploads = {}
      try {
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            if ((part.fieldname === 'remove_logo' || part.fieldname === 'remove_og_image') && part.value) {
              removals.add(part.fieldname === 'remove_logo' ? 'logo' : 'og_image')
            }
            continue
          }
          const key = part.fieldname === 'logo' || part.fieldname === 'og_image' ? part.fieldname : null
          const buf = await part.toBuffer() // draining the stream is required even when ignored
          if (!key || buf.length === 0) continue // unknown field or "no file chosen"
          if (part.file.truncated || buf.length > MAX_BYTES[key]) {
            throw new BrandingError(`${label(key)} is too large (max ${MAX_BYTES[key] / 1024} KB).`)
          }
          const type = detectImageType(buf)
          if (!type) throw new BrandingError(`${label(key)} must be a PNG, JPEG, or WebP image.`)
          uploads[key] = { type, buf }
        }
      } catch (err) {
        if (err instanceof BrandingError) return sendHtml(reply, settingsView({ error: err.message }), 400)
        throw err
      }
      // Apply removals first, then uploads (an upload wins if a file was also chosen).
      for (const key of removals) deleteAsset(db, key)
      for (const [key, { type, buf }] of Object.entries(uploads)) putAsset(db, key, type, buf)
      return reply.redirect('/admin/settings?saved=1')
    })
  })
}

// A validation failure in the branding upload — re-rendered on the settings page.
class BrandingError extends Error {}
const label = (key) => (key === 'logo' ? 'Logo' : 'Share image')
