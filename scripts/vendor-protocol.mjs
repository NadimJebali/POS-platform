// Vendors the licence-protocol module + its shared golden fixture from this repo (the
// SOURCE OF TRUTH) into the sibling POS-software checkout, and writes a checksum
// manifest so POS-software's CI can detect a hand-edited copy (POS-platform#13, the
// vendored-mirror mechanism).
//
//   node scripts/vendor-protocol.mjs           # copy + refresh the manifest
//   node scripts/vendor-protocol.mjs --check    # fail (exit 1) if a copy would change
//
// --check is the drift guard for when both repos are checked out together (a dev
// machine or a combined job): it re-derives what the copies SHOULD be and exits non-zero
// if any vendored file differs, without writing anything.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
// The sibling POS-software checkout; overridable so this isn't wired to one machine.
const softwareRoot = process.env.POS_SOFTWARE_DIR || join(repoRoot, '..', 'POS-software')

// source (in this repo) → destination (in POS-software). Add a row to vendor more.
const FILES = [
  { src: 'src/license-format.js', dest: 'src/shared/license-format.js' },
  { src: 'test/golden-licence.js', dest: 'tests/golden-licence.js' }
]
const MANIFEST = 'tests/protocol-manifest.json' // in POS-software, keyed by dest path

// Normalise line endings to LF before writing AND hashing, so git's autocrlf (which can
// re-materialise a file with different EOLs than were copied) never shows as false drift.
const normalise = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n')
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const check = process.argv.includes('--check')

const manifest = {}
let drift = false

for (const { src, dest } of FILES) {
  const content = normalise(readFileSync(join(repoRoot, src)))
  manifest[dest] = sha256(content)
  const destPath = join(softwareRoot, dest)
  let current = null
  try {
    current = normalise(readFileSync(destPath))
  } catch {
    /* missing counts as drift */
  }
  const same = current != null && sha256(current) === manifest[dest]
  if (check) {
    if (!same) {
      console.error(`drift: ${dest} ${current ? 'differs from' : 'missing vs'} source ${src}`)
      drift = true
    }
  } else if (!same) {
    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, content)
    console.log(`vendored ${src} -> ${dest}`)
  }
}

const manifestPath = join(softwareRoot, MANIFEST)
const manifestJson = JSON.stringify(manifest, null, 2) + '\n'
if (check) {
  let currentManifest = null
  try {
    currentManifest = readFileSync(manifestPath, 'utf8')
  } catch {
    /* missing counts as drift */
  }
  if (currentManifest !== manifestJson) {
    console.error(`drift: ${MANIFEST} is stale — re-run scripts/vendor-protocol.mjs`)
    drift = true
  }
  if (drift) process.exit(1)
  console.log('protocol vendor is in sync ✓')
} else {
  writeFileSync(manifestPath, manifestJson)
  console.log(`wrote ${MANIFEST}`)
}
