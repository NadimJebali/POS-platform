# Product

## Register

product

> The repo's dominant surface is the internal admin panel (deliberately plain, utility-first).
> The one public surface — the download/landing page at `/` — is a **brand** surface; treat
> tasks that touch it under the brand register.

## Users

- **Vendor (admin panel):** the software's owner managing customers, licenses, and payments
  from a desktop browser. Wants speed and zero ceremony.
- **Café/restaurant owners in Tunisia (download page):** small-business buyers evaluating or
  installing POS Software on a Windows machine at their venue. Not technical; French/Arabic
  speakers comfortable with English UI chrome. They arrive with one job: download the
  installer (14-day free trial, no signup), or grab an older version if told to.

## Product Purpose

POS-platform is the cloud side of POS Software (an Electron touchscreen point-of-sale for
cafés/restaurants): license activation/renewal/rebind APIs, a payments ledger, an admin
panel, the auto-update feed, and the public download page. Success = a café owner can get
the software, activate it with a short code, and stay licensed/updated with zero manual
support from the vendor.

## Brand Personality

Solid & trustworthy. Calm, confident, utilitarian-premium — like good point-of-sale
hardware. The download page should say "this is reliable business equipment", not "this is
a startup". The visual identity should echo the POS app itself: dark, focused surfaces with
a single warm ember/amber accent (the app's signature gradient #f7b96b→#ec9a45).

## Anti-references

- Generic SaaS landing pages: gradient heroes, testimonial carousels, pricing-tier cards,
  stock screenshots, "Trusted by 10,000+ teams".
- Corporate/enterprise software sites: navy-suit palettes, dense feature matrices, jargon.
- Anything that reads as a template. One page, one job, done with conviction.

## Design Principles

1. **One job per surface.** The download page exists to hand over an installer; everything
   else supports that single action.
2. **Look like the product.** The page should feel like the POS app the customer is about
   to run — same darkness, same ember accent — so the install feels continuous.
3. **Honest, not promotional.** Version history with real dates and notes builds more trust
   with a café owner than marketing claims. It's also the rollback story.
4. **Utility speed.** Server-rendered, self-contained, no build step, no external
   dependencies; fast on the cheap phones and old laptops café owners actually use.

## Accessibility & Inclusion

WCAG AA contrast (≥4.5:1 body text). Works without JavaScript. Respects
`prefers-reduced-motion`. Touch-friendly targets (many visitors are on phones).
