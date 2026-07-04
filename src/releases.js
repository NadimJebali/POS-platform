// Reads the release manifest (releases.json) the app's publish script maintains in
// the updates directory. The manifest is the single source of truth for the public
// download page: whatever it lists is downloadable, newest first. Tolerant by design —
// a missing or corrupt manifest yields an empty list, never an error page.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readReleases(updatesDir) {
  let raw
  try {
    raw = JSON.parse(readFileSync(join(updatesDir, 'releases.json'), 'utf8'))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r) => r && typeof r.version === 'string' && typeof r.file === 'string')
    .sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0))
}
