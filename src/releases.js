// Reads the release manifest (releases.json) the app's publish script maintains in
// the updates directory. The manifest is the single source of truth for the public
// download page: whatever it lists is downloadable, newest first. Tolerant by design —
// a missing or corrupt manifest yields an empty list, never an error page.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'

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

// The version latest.yml currently advertises to auto-updaters — the "live" build.
// It must never be deleted, or installed apps would try to fetch an installer that's
// gone. Returns null if there's no (readable) latest.yml.
export function currentLatestVersion(updatesDir) {
  try {
    const yml = readFileSync(join(updatesDir, 'latest.yml'), 'utf8')
    return yml.match(/^version:\s*(.+?)\s*$/m)?.[1] ?? null
  } catch {
    return null
  }
}

// A delete failure carrying a machine-readable code for the admin layer.
export class ReleaseError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// Removes a published version from the download feed: unlinks its installer and blockmap
// and drops its entry from releases.json. Refuses to delete the version latest.yml points
// at (the live auto-update target — retire it by publishing a newer build first).
// Tolerant if the files are already gone. Returns the removed entry.
export function deleteRelease(updatesDir, version) {
  const list = readReleases(updatesDir)
  const entry = list.find((r) => r.version === version)
  if (!entry) throw new ReleaseError('not_found', 'No such published version')
  if (version === currentLatestVersion(updatesDir)) {
    throw new ReleaseError('is_latest', 'That is the current published version — publish a newer build before deleting it')
  }
  // entry.file comes from our own publish script; basename() is defence-in-depth so a
  // tampered manifest can't unlink outside the updates directory.
  for (const name of [entry.file, `${entry.file}.blockmap`]) {
    const p = join(updatesDir, basename(name))
    if (existsSync(p)) unlinkSync(p)
  }
  writeFileSync(join(updatesDir, 'releases.json'), JSON.stringify(list.filter((r) => r.version !== version), null, 2))
  return entry
}
