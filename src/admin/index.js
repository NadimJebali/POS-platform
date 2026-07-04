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
import { recordPayment } from '../payments.js'
import { getAllSettings, setIntSetting } from '../db.js'
import {
  loginPage,
  customersPage,
  customerPage,
  licenseDetailPage,
  settingsPage
} from './templates.js'

export function registerAdmin(app, { db, adminPasswordHash, cookieSecure }) {
  const limiter = createLoginLimiter()

  const sendHtml = (reply, body, status = 200) =>
    reply.status(status).type('text/html; charset=utf-8').send(body)

  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/admin' }

  app.register(async (admin) => {
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
      const saved = request.query?.saved === '1'
      return sendHtml(reply, settingsPage({ settings: getAllSettings(db), saved }))
    })

    admin.post('/admin/settings', async (request, reply) => {
      try {
        for (const key of ['renewal_window_days', 'grace_days', 'transfers_per_year', 'warn_days']) {
          if (request.body?.[key] != null) setIntSetting(db, key, request.body[key])
        }
        return reply.redirect('/admin/settings?saved=1')
      } catch (err) {
        return sendHtml(reply, settingsPage({ settings: getAllSettings(db), error: err.message }), 400)
      }
    })
  })
}
