import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/base.css'
import './styles/site.css'
import './styles/admin.css'
import './styles/shell.css'
import './styles/b.css'

try {
  const theme = localStorage.getItem('jumedia.theme')
  if (theme) document.documentElement.dataset.theme = theme
} catch { /* storage unavailable */ }

async function start() {
  // Until Jumedia-server is deployed the API is served in the browser. Set VITE_MOCK=0 to use the real server.
  if (import.meta.env.VITE_MOCK !== '0') await (await import('./mock/server')).installMockServer()
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
}
start()
