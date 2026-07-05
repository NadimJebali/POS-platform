// Default branding art, used when the admin hasn't uploaded a logo / share image.
// Dependency-free: the favicon default is a generated SVG monogram (safe — we author
// it, and browsers render SVG favicons), and the share-image default is a static PNG
// committed under src/assets (rasterised once at authoring time), so nothing rasterises
// at runtime.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const escapeXml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// A square monogram tile (first letter of the site name) in the app's ember gradient —
// the same mark the download-page header falls back to, as an SVG for the browser tab.
export function monogramSvg(name) {
  const letter = escapeXml((String(name ?? '').trim()[0] || 'P').toUpperCase())
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs><linearGradient id="e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7b96b"/><stop offset="1" stop-color="#ec9a45"/></linearGradient></defs>
  <rect width="64" height="64" rx="16" fill="url(#e)"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700" fill="#2a1c0c">${letter}</text>
</svg>`
}

let cachedOg = null
// The committed generic share banner (1200×630 PNG). Read once, then cached in memory.
export function defaultOgPng() {
  if (!cachedOg) cachedOg = readFileSync(join(here, 'assets', 'default-og.png'))
  return cachedOg
}

// The default banner's intrinsic dimensions, emitted as og:image:width/height so
// scrapers reserve the right aspect box before the image loads.
export const DEFAULT_OG_SIZE = { width: 1200, height: 630 }
