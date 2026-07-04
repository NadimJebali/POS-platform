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
    ? `<nav><a href="/admin">Customers</a><a href="/admin/settings">Settings</a><form class="inline" method="post" action="/admin/logout" style="display:inline"><button class="secondary">Log out</button></form></nav>`
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

function fmtMoney(millimes) {
  return (Number(millimes || 0) / 1000).toFixed(3) + ' TND'
}

export function licenseDetailPage({ license, customer, machines, paidUntil, payments, error }) {
  const revoked = license.status === 'revoked'
  const mRows = machines
    .map((m) => {
      const bound = !m.unbound_at
      const seen = m.last_seen_at ? new Date(m.last_seen_at).toISOString().slice(0, 16).replace('T', ' ') : '—'
      const unbindBtn = bound
        ? `<form method="post" action="/admin/licenses/${license.id}/machines/${encodeURIComponent(m.machine_id)}/unbind" style="display:inline" onsubmit="return confirm('Unbind this machine and free its seat?')"><button class="secondary">Unbind</button></form>`
        : ''
      return `<tr>
        <td class="muted">${esc(m.machine_id)}</td>
        <td>${bound ? '<span class="badge active">bound</span>' : '<span class="muted">unbound</span>'}</td>
        <td>${esc(m.app_version) || '—'}</td>
        <td class="muted">${seen}</td><td>${unbindBtn}</td></tr>`
    })
    .join('')
  const pRows = payments
    .map(
      (p) => `<tr><td class="muted">${fmtDate(p.created_at)}</td>
        <td>${p.months === 12 ? '1 year' : p.months + ' mo'}</td>
        <td>${esc(p.method)}</td><td>${fmtMoney(p.amount_millimes)}</td>
        <td class="muted">${esc(p.note) || ''}</td></tr>`
    )
    .join('')

  // suspend/revoke controls depend on current status; revoked is terminal.
  let statusControls = ''
  if (license.status === 'active') {
    statusControls = `
      <form method="post" action="/admin/licenses/${license.id}/status" style="display:inline"><input type="hidden" name="status" value="suspended"><button class="secondary">Suspend</button></form>
      <form method="post" action="/admin/licenses/${license.id}/status" style="display:inline" onsubmit="return confirm('Revoke this license permanently? This cannot be undone.')"><input type="hidden" name="status" value="revoked"><input type="hidden" name="confirm" value="yes"><button class="secondary">Revoke</button></form>`
  } else if (license.status === 'suspended') {
    statusControls = `
      <form method="post" action="/admin/licenses/${license.id}/status" style="display:inline"><input type="hidden" name="status" value="active"><button class="secondary">Unsuspend</button></form>
      <form method="post" action="/admin/licenses/${license.id}/status" style="display:inline" onsubmit="return confirm('Revoke this license permanently? This cannot be undone.')"><input type="hidden" name="status" value="revoked"><input type="hidden" name="confirm" value="yes"><button class="secondary">Revoke</button></form>`
  } else {
    statusControls = `<span class="muted">Revoked — terminal.</span>`
  }

  const body = `
    <p><a href="/admin/customers/${customer.id}">← ${esc(customer.name)}</a></p>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <h2>License #${license.id} ${statusBadge(license.status)}</h2>
    <p class="code">${esc(formatActivationCode(license.activation_code))}</p>
    <p class="muted">Seats: ${license.max_machines} · Paid until: ${fmtDate(paidUntil)} · Issued: ${fmtDate(license.created_at)}</p>
    <div class="card"><h2>Status</h2>${statusControls}</div>
    ${
      revoked
        ? ''
        : `<div class="card"><h2>Record a payment</h2>
      <form class="inline" method="post" action="/admin/licenses/${license.id}/payments">
        <div><label for="months">Period</label><select id="months" name="months"><option value="1">1 month</option><option value="12">1 year</option></select></div>
        <div><label for="amount">Amount (TND)</label><input id="amount" name="amount" type="number" step="0.001" min="0" value="0"></div>
        <div><label for="method">Method</label><select id="method" name="method"><option>cash</option><option>transfer</option><option>card</option></select></div>
        <button>Record payment</button>
      </form></div>`
    }
    <h2>Payments (${payments.length})</h2>
    <table><thead><tr><th>Date</th><th>Period</th><th>Method</th><th>Amount</th><th>Note</th></tr></thead>
    <tbody>${pRows || '<tr><td colspan="5" class="muted">No payments recorded.</td></tr>'}</tbody></table>
    <h2>Machines</h2>
    <table><thead><tr><th>Machine ID</th><th>State</th><th>App version</th><th>Last seen (UTC)</th><th></th></tr></thead>
    <tbody>${mRows || '<tr><td colspan="5" class="muted">Never activated.</td></tr>'}</tbody></table>`
  return layout(`License #${license.id}`, body)
}

export function settingsPage({ settings, saved, error }) {
  const field = (key, label, hint) =>
    `<div><label for="${key}">${esc(label)}</label><input id="${key}" name="${key}" type="number" min="0" value="${esc(settings[key])}"><span class="muted">${esc(hint)}</span></div>`
  const body = `
    <p><a href="/admin">← Customers</a></p>
    <h2>Global settings</h2>
    ${saved ? '<p style="color:#16a34a">Saved.</p>' : ''}
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <p class="muted">These take effect on each client's next renewal — no app update needed.</p>
    <form method="post" action="/admin/settings" style="display:grid; gap:.75rem; max-width:32rem">
      ${field('renewal_window_days', 'Renewal window (days)', 'how long a signed key lasts before it must renew')}
      ${field('grace_days', 'Paid-grace (days)', 'renewals still succeed this long past paid-until, with a banner')}
      ${field('transfers_per_year', 'Machine transfers per year', 'self-service rebind limit')}
      ${field('warn_days', 'Warn (days before expiry)', 'when the app shows the connectivity warning')}
      <div><button>Save settings</button></div>
    </form>`
  return layout('Settings', body)
}
