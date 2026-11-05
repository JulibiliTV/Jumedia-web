import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function frontendVersion() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const version = process.env.BUILD_VERSION || JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  let revision = process.env.BUILD_REVISION || ''
  let modified = false
  if (!revision) {
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      revision = git('rev-parse', 'HEAD')
      modified = !!git('status', '--porcelain')
    } catch { /* Source archives supply BUILD_REVISION or display dev. */ }
  }
  return `${version.replace(/^v/, '')}+${revision.slice(0, 7) || 'dev'}${modified ? '.dirty' : ''}`
}
