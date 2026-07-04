// Admin panel routes (server-rendered HTML) under /admin. Registered by buildApp.
import {
  SESSION_COOKIE,
  verifyPassword,
  createSession,
  isSessionValid,
  destroySession
} from '../auth.js'
import { createLoginLimiter } from './login-limit.js'
import { createCustomer, getCustomer, listCustomers } from '../customers.js'
import {
  issueLicense,
  listLicensesForCustomer,
  getLicenseDetail,
  LicenseError
} from '../licenses.js'
import {
  loginPage,
  customersPage,
  customerPage,
  licenseDetailPage
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
      return sendHtml(reply, customersPage({ customers: listCustomers(db, { search }), search }))
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
      return sendHtml(reply, customerPage({ customer, licenses, newCode }))
    })

    admin.post('/admin/customers/:id/licenses', async (request, reply) => {
      const customerId = Number(request.params.id)
      try {
        const { code } = issueLicense(db, {
          customerId,
          maxMachines: Number(request.body?.max_machines) || 1
        })
        // Redirect with the fresh code so the page can show it once, prominently.
        return reply.redirect(`/admin/customers/${customerId}?code=${encodeURIComponent(code)}`)
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
  })
}
