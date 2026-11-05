import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { libmediaAssets } from './build/libmediaAssets'
import { frontendVersion } from './build/version'

// API_PROXY 指向 Jumedia-server 时，前端以同源方式访问与 Juli 数据源一致的接口路径。
const target = process.env.API_PROXY
// Whole path segments only, so web pages such as /login and /live are not forwarded.
const apiPaths = '^/(x|pgc|xlive|room|live_user|av|login|api|msg|live-relay|live-cache|bfs|upload|media|main|rankdb)/'
// Match the hosted app so libmedia can use shared-memory worker pipelines.
const playerHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  define: { __FRONTEND_VERSION__: JSON.stringify(frontendVersion()) },
  plugins: [react(), libmediaAssets()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) return 'react-vendor'
        },
      },
    },
  },
  // libmedia loads its own webpack chunks relative to the module URL; pre-bundling would move it away from them.
  optimizeDeps: { exclude: ['@libmedia/avplayer'] },
  preview: { headers: playerHeaders },
  server: {
    port: 8790,
    headers: playerHeaders,
    proxy: target ? {
      [apiPaths]: { target, changeOrigin: true, xfwd: true },
      // Live chat WebSocket (`getDanmuInfo` → /sub).
      '^/sub(\\?|$)': { target, ws: true, changeOrigin: true, xfwd: true },
    } : undefined,
  },
})
