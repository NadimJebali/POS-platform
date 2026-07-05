// The public download page served at / — the only customer-facing surface.
// Design: it looks like the product. Same dark, focused surfaces and ember accent as
// the POS app itself, so the install feels continuous. The version history is set as
// a printed till receipt — the product's own output artifact — which doubles as the
// page's one bright visual object. Server-rendered, self-contained, no JS.
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const fmtSize = (bytes) => (bytes > 0 ? `${Math.round(bytes / 1e6)} MB` : '')
const fmtDate = (iso) => {
  const d = new Date(iso ?? 0)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// One receipt line per release: version + date, its notes as the "item", a download
// link as the "price column". Newest first (the manifest is already sorted).
function receiptRows(releases) {
  return releases
    .map(
      (r) => `
      <div class="r-row">
        <div class="r-line"><span class="r-ver">v${escapeHtml(r.version)}</span><span class="r-dots"></span><span class="r-date">${escapeHtml(fmtDate(r.date))}</span></div>
        ${r.notes ? `<div class="r-notes">${escapeHtml(r.notes)}</div>` : ''}
        <div class="r-get"><a href="/updates/${encodeURIComponent(r.file)}">download${r.size ? ` · ${fmtSize(r.size)}` : ''}</a></div>
      </div>`
    )
    .join('')
}

export function downloadPage({ settings, releases, baseUrl = '', branding = {} }) {
  const name = settings.product_name || 'POS Software'
  const tagline = settings.product_tagline || 'The register that just works.'
  const description = settings.product_description || ''
  const phone = settings.contact_phone || ''
  const email = settings.contact_email || ''
  const latest = releases[0] ?? null
  const monogram = escapeHtml(name.trim().charAt(0).toUpperCase() || 'P')

  // Branding: a logo (header + favicon) and a share image, each with a ?v= cache-buster
  // keyed on when it was uploaded so a replacement busts browser + scraper caches.
  const hasLogo = !!branding.logo
  const hasOg = !!branding.og
  const logoSrc = `/branding/logo${hasLogo ? `?v=${branding.logo.updatedAt}` : ''}`
  // The share image resolves through the same ladder the /branding route uses: OG →
  // logo → generic banner. The card type must match the shape we actually serve: a
  // landscape banner is a large card; a square logo is a summary thumbnail.
  const ogVer = hasOg ? branding.og.updatedAt : hasLogo ? branding.logo.updatedAt : null
  const ogImageUrl = `${baseUrl}/branding/og-image${ogVer != null ? `?v=${ogVer}` : ''}`
  const twitterCard = hasOg ? 'summary_large_image' : hasLogo ? 'summary' : 'summary_large_image'
  const shareDesc = description || `${tagline} Point of sale for cafés & restaurants — 14-day free trial.`
  // og:image:width/height are only known for our generic banner (1200×630); omit them
  // for an uploaded image of unknown dimensions.
  const ogDims = !hasOg && !hasLogo ? '\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">' : ''

  const social = `<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(name)}">
<meta property="og:title" content="${escapeHtml(tagline)}">
<meta property="og:description" content="${escapeHtml(shareDesc)}">
<meta property="og:url" content="${escapeHtml(baseUrl)}/">
<meta property="og:image" content="${escapeHtml(ogImageUrl)}">${ogDims}
<meta name="twitter:card" content="${twitterCard}">
<meta name="twitter:title" content="${escapeHtml(tagline)}">
<meta name="twitter:description" content="${escapeHtml(shareDesc)}">
<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">
<link rel="icon" href="${escapeHtml(logoSrc)}">`

  // Header mark: the uploaded logo when present (object-fit cover in the tile), else the
  // CSS monogram — so the default needs no image request at all.
  const headerMark = hasLogo
    ? `<img class="mark mark-img" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(name)} logo" width="46" height="46">`
    : `<div class="mark">${monogram}</div>`

  const cta = latest
    ? `<a class="cta" href="/updates/${encodeURIComponent(latest.file)}">
         <svg class="cta-ic" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 3v10.6l3.8-3.8 1.4 1.4-6.2 6.2-6.2-6.2 1.4-1.4L11 13.6V3h1zM5 19h14v2H5z"/></svg>
         <span>Download for Windows</span>
       </a>
       <p class="cta-meta">v${escapeHtml(latest.version)}${latest.size ? ` · ${fmtSize(latest.size)}` : ''}${latest.date ? ` · ${escapeHtml(fmtDate(latest.date))}` : ''} · Windows 10/11 (64-bit)</p>`
    : `<div class="cta-empty">
         <p><strong>No builds yet — coming soon.</strong></p>
         <p>Get in touch and we'll tell you the moment the first build is up.</p>
       </div>`

  const trial = `<p class="trial">Free for <strong>14 days</strong> — no signup, no card. Keep using it with an activation code from your vendor.</p>`

  const receipt = `
    <aside class="receipt" aria-label="Version history">
      <div class="r-head">
        <div class="r-shop">${escapeHtml(name).toUpperCase()}</div>
        <div class="r-sub">VERSION HISTORY</div>
        <div class="r-rule"></div>
      </div>
      ${releases.length ? receiptRows(releases) : '<div class="r-row"><div class="r-notes">No public builds yet.</div></div>'}
      <div class="r-rule"></div>
      <div class="r-foot">*** THANK YOU ***<br>${escapeHtml(new URL('https://pos.nadimjebali.engineer').host)}</div>
    </aside>`

  const contactBits = [
    phone ? `<a href="tel:${escapeHtml(phone.replace(/\s+/g, ''))}">${escapeHtml(phone)}</a>` : '',
    email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : ''
  ].filter(Boolean)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — point of sale for cafés &amp; restaurants</title>
<meta name="description" content="${escapeHtml(tagline)}">
${social}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: oklch(0.17 0.008 70);          /* warm near-black, the app's darkness */
    --bg-raise: oklch(0.21 0.01 70);
    --line: oklch(0.32 0.012 70 / .55);
    --ink: oklch(0.93 0.015 85);         /* cream */
    --ink-soft: oklch(0.72 0.02 80);
    --ember: #ec9a45;                    /* the app's signature accent, verbatim */
    --ember-hi: #f7b96b;
    --ink-on-ember: #2a1c0c;
    --paper: oklch(0.96 0.012 90);       /* receipt paper */
    --paper-ink: oklch(0.25 0.01 70);
    --paper-soft: oklch(0.45 0.012 70);
  }
  * { box-sizing: border-box; }
  html { color-scheme: dark; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.6 system-ui, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--ember); text-underline-offset: 3px; }
  .wrap { max-width: 68rem; margin: 0 auto; padding: clamp(1.25rem, 4vw, 3rem); }

  header { display: flex; align-items: center; gap: .9rem; padding-block: .5rem; }
  .mark {
    width: 46px; height: 46px; border-radius: 13px; flex: none;
    display: grid; place-items: center;
    font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 800; font-size: 1.5rem;
    color: var(--ink-on-ember);
    background: linear-gradient(135deg, var(--ember-hi), var(--ember));
    box-shadow: 0 8px 22px -8px oklch(0.72 0.14 65 / .7);
  }
  /* Uploaded logo drops into the same 46px tile — cover-fit, no gradient/monogram. */
  .mark-img { object-fit: cover; background: none; box-shadow: 0 8px 22px -8px oklch(0 0 0 / .55); }
  .brand { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 600; font-size: 1.15rem; }
  header .spacer { flex: 1; }
  header .h-contact { font-size: .95rem; }

  .hero {
    display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 4fr);
    gap: clamp(2rem, 6vw, 5rem); align-items: start;
    padding-block: clamp(2.5rem, 7vw, 5.5rem) clamp(2rem, 5vw, 4rem);
  }
  .hero > * { min-width: 0; } /* wide children (the CTA) must shrink, not blow out the track */
  h1 {
    font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 800;
    font-size: clamp(2.3rem, 5.5vw, 4rem); line-height: 1.04; letter-spacing: -0.02em;
    margin: 0 0 1.1rem; text-wrap: balance; overflow-wrap: break-word;
  }
  .desc { max-width: 60ch; color: var(--ink-soft); font-size: 1.06rem; margin: 0 0 2.2rem; text-wrap: pretty; }

  .cta {
    display: inline-flex; align-items: center; gap: .8rem;
    font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 800; font-size: 1.35rem;
    color: var(--ink-on-ember); text-decoration: none;
    background: linear-gradient(135deg, var(--ember-hi), var(--ember));
    padding: 1.05rem 1.7rem; border-radius: 1.1rem;
    box-shadow: 0 0 0 1px oklch(0.72 0.14 65 / .35), 0 14px 44px -12px oklch(0.72 0.14 65 / .5);
    transition: transform .18s cubic-bezier(.22,.61,.36,1), box-shadow .18s cubic-bezier(.22,.61,.36,1);
  }
  .cta:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px oklch(0.72 0.14 65 / .5), 0 20px 54px -12px oklch(0.72 0.14 65 / .65); }
  .cta:active { transform: translateY(0); }
  .cta-ic { flex: none; }
  .cta-meta { color: var(--ink-soft); font-size: .95rem; margin: .9rem 0 0; font-variant-numeric: tabular-nums; }
  .cta-empty { border: 1px dashed var(--line); border-radius: 1.1rem; padding: 1.2rem 1.4rem; max-width: 34rem; }
  .cta-empty p { margin: .2rem 0; color: var(--ink-soft); }
  .cta-empty strong { color: var(--ink); }
  .trial { margin: 1.6rem 0 0; color: var(--ink-soft); max-width: 46ch; }
  .trial strong { color: var(--ink); }

  /* The version history, printed. Monospace is literal here — receipt printers print
     monospace — and the one bright paper object gives the dark page its focal pair
     (ember button, cream receipt). */
  .receipt {
    background: var(--paper); color: var(--paper-ink);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: .85rem; line-height: 1.55;
    padding: 1.4rem 1.25rem 1.6rem; rotate: 1.4deg;
    --notch: 9px;
    clip-path: polygon(0 6px, 4% 0, 8% 6px, 12% 0, 16% 6px, 20% 0, 24% 6px, 28% 0, 32% 6px, 36% 0, 40% 6px, 44% 0, 48% 6px, 52% 0, 56% 6px, 60% 0, 64% 6px, 68% 0, 72% 6px, 76% 0, 80% 6px, 84% 0, 88% 6px, 92% 0, 96% 6px, 100% 0,
      100% calc(100% - 6px), 96% 100%, 92% calc(100% - 6px), 88% 100%, 84% calc(100% - 6px), 80% 100%, 76% calc(100% - 6px), 72% 100%, 68% calc(100% - 6px), 64% 100%, 60% calc(100% - 6px), 56% 100%, 52% calc(100% - 6px), 48% 100%, 44% calc(100% - 6px), 40% 100%, 36% calc(100% - 6px), 32% 100%, 28% calc(100% - 6px), 24% 100%, 20% calc(100% - 6px), 16% 100%, 12% calc(100% - 6px), 8% 100%, 4% calc(100% - 6px), 0 100%);
    box-shadow: 0 24px 60px -24px rgb(0 0 0 / .8);
  }
  .r-head { text-align: center; margin-bottom: .9rem; }
  .r-shop { font-weight: 700; letter-spacing: .08em; }
  .r-sub { color: var(--paper-soft); letter-spacing: .18em; font-size: .72rem; margin-top: .15rem; }
  .r-rule { border-top: 1.5px dashed oklch(0.6 0.01 70 / .6); margin: .8rem 0; }
  .r-row { padding-block: .45rem; }
  .r-line { display: flex; align-items: baseline; gap: .5ch; font-variant-numeric: tabular-nums; }
  .r-ver { font-weight: 700; }
  .r-dots { flex: 1; border-bottom: 2px dotted oklch(0.6 0.01 70 / .55); translate: 0 -4px; }
  .r-date { color: var(--paper-soft); }
  .r-notes { color: var(--paper-soft); padding-inline: 1ch 0; }
  .r-get a { color: var(--paper-ink); font-weight: 700; }
  .r-foot { text-align: center; color: var(--paper-soft); font-size: .75rem; margin-top: .9rem; letter-spacing: .06em; }

  footer {
    border-top: 1px solid var(--line);
    display: flex; flex-wrap: wrap; gap: .4rem 1.6rem; align-items: baseline;
    padding-block: 1.6rem 2.4rem; color: var(--ink-soft); font-size: .95rem;
  }
  footer .note { flex: 1 1 100%; font-size: .85rem; color: var(--ink-soft); }

  /* Entrance: transform-only rises (no opacity), so the page is fully readable even
     where animations never run — frozen tabs, headless renderers, reader modes. */
  @media (prefers-reduced-motion: no-preference) {
    .rise { animation: rise .5s cubic-bezier(.16,1,.3,1) backwards; }
    .rise-2 { animation-delay: .07s; } .rise-3 { animation-delay: .14s; }
    .receipt { animation: settle .6s cubic-bezier(.16,1,.3,1) backwards .1s; }
    @keyframes rise { from { transform: translateY(14px); } }
    @keyframes settle { from { transform: translateY(18px) rotate(1.4deg); } }
  }

  @media (max-width: 880px) {
    .hero { grid-template-columns: 1fr; }
    .receipt { max-width: min(26rem, 100%); rotate: .8deg; }
    .cta { width: 100%; justify-content: center; font-size: clamp(1.05rem, 5.2vw, 1.35rem); padding-inline: 1rem; }
    header .h-contact { display: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    ${headerMark}
    <div class="brand">${escapeHtml(name)}</div>
    <div class="spacer"></div>
    ${email ? `<div class="h-contact"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></div>` : ''}
  </header>

  <main class="hero">
    <section>
      <h1 class="rise">${escapeHtml(tagline)}</h1>
      ${description ? `<p class="desc rise rise-2">${escapeHtml(description)}</p>` : ''}
      <div class="rise rise-3">
        ${cta}
        ${trial}
      </div>
    </section>
    ${receipt}
  </main>

  <footer>
    ${contactBits.join('\n    ')}
    <span class="note">Licensed software — after the trial, activation takes a short code from your vendor. Updates install themselves in the background.</span>
  </footer>
</div>
</body>
</html>`
}
