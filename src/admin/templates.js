// Server-rendered HTML for the admin panel. Plain strings, no framework — it's a
// single-operator internal tool. All dynamic values go through esc() to prevent XSS.
import { formatActivationCode } from '../activation-code.js'

export function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function fmtDate(ms) {
  if (ms == null) return '—'
  return new Date(ms).toISOString().slice(0, 10)
}

function statusBadge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`
}

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 1.5rem; line-height: 1.5; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #8884; padding-bottom: .75rem; margin-bottom: 1.25rem; }
  h1 { font-size: 1.3rem; margin: 0; } h2 { font-size: 1.05rem; margin: 1.5rem 0 .5rem; }
  a { color: #2563eb; } nav a { margin-right: 1rem; }
  table { width: 100%; border-collapse: collapse; margin: .5rem 0; }
  th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid #8883; font-size: .93rem; }
  form.inline { display: flex; gap: .5rem; flex-wrap: wrap; align-items: end; }
  label { display: block; font-size: .8rem; color: #8a8a8a; }
  input, button { font: inherit; padding: .5rem .6rem; border-radius: 6px; border: 1px solid #8886; background: transparent; color: inherit; }
  button { cursor: pointer; background: #2563eb; color: #fff; border-color: #2563eb; }
  button.secondary { background: transparent; color: inherit; }
  .badge { font-size: .72rem; padding: .1rem .45rem; border-radius: 999px; border: 1px solid currentColor; text-transform: uppercase; }
  .badge.active { color: #16a34a; } .badge.suspended { color: #d97706; } .badge.revoked { color: #dc2626; }
  .code { font-family: ui-monospace, monospace; font-size: 1.1rem; letter-spacing: .04em; background: #8882; padding: .5rem .7rem; border-radius: 6px; display: inline-block; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 1rem; margin: 1rem 0; }
  .err { color: #dc2626; } .muted { color: #8a8a8a; font-size: .85rem; }
`

function layout(title, body, { authed = true } = {}) {
  const nav = authed
    ? `<nav><a href="/admin">Customers</a><form class="inline" method="post" action="/admin/logout" style="display:inline"><button class="secondary">Log out</button></form></nav>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · POS admin</title><style>${STYLE}</style></head><body><header><h1>POS admin</h1>${nav}</header>${body}</body></html>`
}

export function loginPage({ error } = {}) {
  const body = `
    <h2>Sign in</h2>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <form method="post" action="/admin/login" class="inline">
      <div><label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus required></div>
      <button>Sign in</button>
    </form>`
  return layout('Sign in', body, { authed: false })
}

export function customersPage({ customers, search, error }) {
  const rows = customers
    .map(
      (c) => `<tr>
        <td><a href="/admin/customers/${c.id}">${esc(c.name)}</a></td>
        <td>${esc(c.phone) || '—'}</td><td>${esc(c.city) || '—'}</td>
        <td class="muted">${fmtDate(c.created_at)}</td></tr>`
    )
    .join('')
  const body = `
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <form class="inline" method="get" action="/admin">
      <div><label for="q">Search</label><input id="q" name="q" value="${esc(search)}" placeholder="name, phone, city"></div>
      <button class="secondary">Search</button>
    </form>
    <h2>Customers (${customers.length})</h2>
    <table><thead><tr><th>Name</th><th>Phone</th><th>City</th><th>Added</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="muted">No customers yet.</td></tr>'}</tbody></table>
    <div class="card"><h2>New customer</h2>
      <form class="inline" method="post" action="/admin/customers">
        <div><label for="name">Name / café *</label><input id="name" name="name" required></div>
        <div><label for="phone">Phone</label><input id="phone" name="phone"></div>
        <div><label for="city">City</label><input id="city" name="city"></div>
        <button>Add customer</button>
      </form>
    </div>`
  return layout('Customers', body)
}

export function customerPage({ customer, licenses, newCode }) {
  const licRows = licenses
    .map(
      (l) => `<tr>
        <td><a href="/admin/licenses/${l.id}">#${l.id}</a></td>
        <td>${statusBadge(l.status)}</td>
        <td>${l.activeMachines}/${l.max_machines}</td>
        <td>${fmtDate(l.paidUntil)}</td>
        <td class="muted">${esc(formatActivationCode(l.activation_code))}</td></tr>`
    )
    .join('')
  const banner = newCode
    ? `<div class="card"><h2>License issued — hand this code to the customer</h2>
       <p class="code">${esc(formatActivationCode(newCode))}</p>
       <p class="muted">They type it into the app's Activate screen. It won't be shown this prominently again.</p></div>`
    : ''
  const body = `
    <p><a href="/admin">← Customers</a></p>
    <h2>${esc(customer.name)}</h2>
    <p class="muted">${esc(customer.phone) || 'no phone'} · ${esc(customer.city) || 'no city'} · added ${fmtDate(customer.created_at)}</p>
    ${banner}
    <h2>Licenses (${licenses.length})</h2>
    <table><thead><tr><th>ID</th><th>Status</th><th>Machines</th><th>Paid until</th><th>Code</th></tr></thead>
    <tbody>${licRows || '<tr><td colspan="5" class="muted">No licenses yet.</td></tr>'}</tbody></table>
    <div class="card"><h2>Issue a license</h2>
      <form class="inline" method="post" action="/admin/customers/${customer.id}/licenses">
        <div><label for="max">Machines (seats)</label><input id="max" name="max_machines" type="number" min="1" value="1"></div>
        <button>Issue license</button>
      </form>
    </div>`
  return layout(customer.name, body)
}

export function licenseDetailPage({ license, customer, machines, paidUntil }) {
  const mRows = machines
    .map(
      (m) => `<tr>
        <td class="muted">${esc(m.machine_id)}</td>
        <td>${m.unbound_at ? '<span class="muted">unbound</span>' : '<span class="badge active">bound</span>'}</td>
        <td>${esc(m.app_version) || '—'}</td>
        <td class="muted">${m.last_seen_at ? new Date(m.last_seen_at).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td></tr>`
    )
    .join('')
  const body = `
    <p><a href="/admin/customers/${customer.id}">← ${esc(customer.name)}</a></p>
    <h2>License #${license.id} ${statusBadge(license.status)}</h2>
    <p class="code">${esc(formatActivationCode(license.activation_code))}</p>
    <p class="muted">Seats: ${license.max_machines} · Paid until: ${fmtDate(paidUntil)} · Issued: ${fmtDate(license.created_at)}</p>
    <h2>Machines</h2>
    <table><thead><tr><th>Machine ID</th><th>State</th><th>App version</th><th>Last seen (UTC)</th></tr></thead>
    <tbody>${mRows || '<tr><td colspan="4" class="muted">Never activated.</td></tr>'}</tbody></table>
    <p class="muted">Payments, suspend/revoke, and settings arrive with issue #9.</p>`
  return layout(`License #${license.id}`, body)
}
