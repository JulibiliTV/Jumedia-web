import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { envelope, resetSigning } from '../api/client'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'

export interface Me {
  mid: number; uname: string; face: string; level_info?: { current_level: number; current_exp: number; next_exp: number | string }
  money: number; vipStatus: number; role?: 'admin' | 'user'; sign?: string
}
export interface Site { siteName: string; allowRegister: boolean; announcement: string; version?: string; banners: { id: number; title: string; img: string; url: string }[] }

interface Session { me: Me | null; ready: boolean; site: Site | null; refresh: () => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<Session>({ me: null, ready: false, site: null, refresh: async () => {}, logout: async () => {} })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [site, setSite] = useState<Site | null>(null)

  const refresh = useCallback(async () => {
    try {
      // -101 is the anonymous answer (and still carries `wbi_img`), not a failure.
      const root = await envelope<Me & { isLogin: boolean }>('api', '/x/web-interface/nav', {}, { validates: false })
      setMe(root.code === 0 && root.data?.isLogin ? root.data : null)
    } catch {
      setMe(null)
    } finally {
      setReady(true)
    }
  }, [])

  const logout = useCallback(async () => {
    try { await juli.signOut() } finally {
      try { localStorage.removeItem('jumedia.access_key') } catch { /* ignore */ }
      resetSigning()
      setMe(null)
    }
  }, [])

  useEffect(() => {
    refresh()
    jm.site().then(setSite).catch(() => setSite(null))
  }, [refresh])

  return <Ctx.Provider value={{ me, ready, site, refresh, logout }}>{children}</Ctx.Provider>
}

export const useSession = () => useContext(Ctx)
