import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

const publicId = 'virtual:libmedia-entry'
const resolvedId = '\0' + publicId

/** Preserve the upstream runtime's relative chunk URLs instead of rebundling it. */
export function libmediaAssets(): Plugin {
  let config: ResolvedConfig
  const require = createRequire(import.meta.url)
  const directory = resolve(dirname(require.resolve('@libmedia/avplayer')), '../esm')

  return {
    name: 'libmedia-assets',
    configResolved(value) { config = value },
    resolveId(id) { if (id === publicId) return resolvedId },
    async load(id) {
      if (id !== resolvedId) return
      if (config.command === 'serve') {
        return `export default ${JSON.stringify(config.base + 'node_modules/@libmedia/avplayer/dist/esm/avplayer.js')}`
      }

      const names = (await readdir(directory)).filter((name) => name.endsWith('.js')).sort()
      const files = await Promise.all(names.map(async (name) => ({ name, source: await readFile(resolve(directory, name)) })))
      const hash = createHash('sha256')
      for (const file of files) hash.update(file.name).update(file.source)
      const prefix = `${config.build.assetsDir}/libmedia-${hash.digest('hex').slice(0, 12)}`
      let entry: string | undefined
      for (const file of files) {
        const reference = this.emitFile({ type: 'asset', name: file.name, fileName: `${prefix}/${file.name}`, source: file.source })
        if (file.name === 'avplayer.js') entry = reference
      }
      if (!entry) this.error('Missing libmedia ESM entry')
      // Vite resolves the emitted URL for root, nested and relative base paths.
      return `export default import.meta.ROLLUP_FILE_URL_${entry}`
    },
  }
}
