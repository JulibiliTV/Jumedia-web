import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const folder = await mkdtemp(join(tmpdir(), 'jumedia-admin-'))
try {
  const file = join(folder, 'checks.mjs')
  await build({ entryPoints: [join(root, 'tests/admin-management.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm' })
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally { await rm(folder, { recursive: true, force: true }) }
