import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = resolve(root, process.argv.find((arg) => arg.startsWith('--dir='))?.slice(6) ?? 'dist')
const manifest = JSON.parse(await readFile(resolve(dist, '.vite/manifest.json'), 'utf8'))
const initial = new Set()
function visit(key) {
  if (initial.has(key)) return
  assert.ok(manifest[key], `Missing manifest entry: ${key}`)
  initial.add(key)
  for (const dependency of manifest[key].imports ?? []) visit(dependency)
}
visit('index.html')

const deferred = ['src/pages/admin/Admin.tsx', 'src/pages/creator/Creator.tsx', 'src/pages/account/Account.tsx', 'src/pages/Video.tsx', 'src/pages/Search.tsx', 'src/components/PlayerCore.tsx']
for (const key of deferred) {
  assert.ok(manifest[key]?.isDynamicEntry, `Expected an async entry: ${key}`)
  assert.ok(!initial.has(key), `Unexpected eager dependency: ${key}`)
}
const sizes = await Promise.all([...initial].map(async (key) => (await stat(resolve(dist, manifest[key].file))).size))
const initialBytes = sizes.reduce((sum, size) => sum + size, 0)
assert.ok(initialBytes < 300_000, `Initial JavaScript exceeds 300 kB: ${initialBytes}`)

for (const [key, entry] of Object.entries(manifest)) {
  if (!entry.file.endsWith('.js') || entry.file.includes('/libmedia-')) continue
  const { size } = await stat(resolve(dist, entry.file))
  assert.ok(size < 500_000, `Generated chunk exceeds 500 kB: ${entry.file} (${size})`)
  if (initial.has(key)) {
    assert.ok(!/\/hls[.-]/.test(entry.file), 'HLS must not load on the home page')
  }
}

if (process.argv.includes('--production')) {
  assert.ok(!Object.keys(manifest).some((key) => key.startsWith('src/mock/')), 'Production build includes Mock code')
}

const require = createRequire(import.meta.url)
const upstream = resolve(dirname(require.resolve('@libmedia/avplayer')), '../esm')
const runtimeEntries = Object.values(manifest).filter((entry) => /\/libmedia-[^/]+\/avplayer\.js$/.test(entry.file))
assert.equal(runtimeEntries.length, 1, 'Expected exactly one libmedia runtime')
const runtimeDir = dirname(resolve(dist, runtimeEntries[0].file))
for (const name of (await readdir(upstream)).filter((file) => file.endsWith('.js'))) {
  assert.deepEqual(await readFile(resolve(runtimeDir, name)), await readFile(resolve(upstream, name)), `Missing or modified libmedia resource: ${name}`)
}
console.log(`Bundle checks passed: initial JavaScript ${(initialBytes / 1000).toFixed(2)} kB; pages and player deferred; libmedia runtime complete.`)
console.log('The prebuilt libmedia entry remains about 585 kB and is fetched only for formats that need it.')
