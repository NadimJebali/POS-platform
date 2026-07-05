// Deleting a published version from the download feed: unlink the installer + blockmap,
// drop the releases.json entry, and never delete the live (latest.yml) version.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readReleases, currentLatestVersion, deleteRelease, ReleaseError } from '../src/releases.js'

// Builds a throwaway updates dir with two published versions and latest.yml -> 0.2.2.
function seedUpdates() {
  const dir = mkdtempSync(join(tmpdir(), 'pos-updates-'))
  const releases = [
    { version: '0.2.2', date: '2026-07-04T00:00:00Z', file: 'POS-Software-0.2.2-setup.exe', size: 87665202, notes: 'latest' },
    { version: '0.2.1', date: '2026-07-01T00:00:00Z', file: 'POS-Software-0.2.1-setup.exe', size: 87665167, notes: 'older' }
  ]
  writeFileSync(join(dir, 'releases.json'), JSON.stringify(releases, null, 2))
  writeFileSync(join(dir, 'latest.yml'), 'version: 0.2.2\npath: POS-Software-0.2.2-setup.exe\n')
  for (const v of ['0.2.1', '0.2.2']) {
    writeFileSync(join(dir, `POS-Software-${v}-setup.exe`), 'fake-installer')
    writeFileSync(join(dir, `POS-Software-${v}-setup.exe.blockmap`), 'fake-blockmap')
  }
  return dir
}

test('currentLatestVersion reads the version from latest.yml', () => {
  const dir = seedUpdates()
  assert.equal(currentLatestVersion(dir), '0.2.2')
  rmSync(dir, { recursive: true, force: true })
})

test('deleting an older version unlinks its files and drops its manifest entry', () => {
  const dir = seedUpdates()
  const removed = deleteRelease(dir, '0.2.1')

  assert.equal(removed.version, '0.2.1')
  assert.equal(existsSync(join(dir, 'POS-Software-0.2.1-setup.exe')), false)
  assert.equal(existsSync(join(dir, 'POS-Software-0.2.1-setup.exe.blockmap')), false)
  // The live version's files are untouched.
  assert.equal(existsSync(join(dir, 'POS-Software-0.2.2-setup.exe')), true)
  const left = readReleases(dir)
  assert.deepEqual(left.map((r) => r.version), ['0.2.2'])
  rmSync(dir, { recursive: true, force: true })
})

test('refuses to delete the current published (latest.yml) version', () => {
  const dir = seedUpdates()
  assert.throws(() => deleteRelease(dir, '0.2.2'), (e) => e instanceof ReleaseError && e.code === 'is_latest')
  // Nothing was removed.
  assert.equal(existsSync(join(dir, 'POS-Software-0.2.2-setup.exe')), true)
  assert.equal(readReleases(dir).length, 2)
  rmSync(dir, { recursive: true, force: true })
})

test('unknown version is a not_found error', () => {
  const dir = seedUpdates()
  assert.throws(() => deleteRelease(dir, '9.9.9'), (e) => e instanceof ReleaseError && e.code === 'not_found')
  rmSync(dir, { recursive: true, force: true })
})

test('tolerates an already-missing installer file (still drops the entry)', () => {
  const dir = seedUpdates()
  rmSync(join(dir, 'POS-Software-0.2.1-setup.exe')) // file gone, entry remains

  const removed = deleteRelease(dir, '0.2.1')
  assert.equal(removed.version, '0.2.1')
  assert.deepEqual(readReleases(dir).map((r) => r.version), ['0.2.2'])
  rmSync(dir, { recursive: true, force: true })
})

test('a manifest filename cannot escape the updates dir (basename guard)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pos-updates-'))
  const outside = join(tmpdir(), 'pos-should-survive.txt')
  writeFileSync(outside, 'do not delete me')
  writeFileSync(
    join(dir, 'releases.json'),
    JSON.stringify([{ version: '1.0.0', date: '2026-01-01', file: '../pos-should-survive.txt', size: 1 }])
  )
  // no latest.yml -> currentLatestVersion null -> not the latest, so it proceeds
  deleteRelease(dir, '1.0.0')
  assert.equal(existsSync(outside), true) // the traversal target survived
  rmSync(outside, { force: true })
  rmSync(dir, { recursive: true, force: true })
})
