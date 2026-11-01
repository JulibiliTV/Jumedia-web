/**
 * Demo media from an Emby server (see `scripts/import-emby.mjs`). The catalog
 * lists direct-play items; images are Emby's public https URLs, and videos are
 * stored as `emby:{itemId}:{mediaSourceId}`.
 *
 * Canonical media paths, shared with Jumedia-server (which proxies them and
 * keeps the Emby token server-side):
 *   /media/emby/{itemId}.mp4?source={id}            progressive MP4
 *   /media/emby/{itemId}/hls/index.m3u8?source={id}  HLS master → main.m3u8 → segments
 * In the browser mock, `<video>` and hls.js segment requests bypass `fetch`, so
 * progressive URLs and segment URIs point at Emby directly with the token.
 */

export interface CatalogEpisode { id: string; sourceId: string; container: string; width: number; height: number; name: string; season: number; index: number; overview: string; runtime: number; premiere: number; image: string | null }
export interface CatalogImages { primary: string | null; backdrop: string | null; thumb: string | null }
export interface CatalogSeries { id: string; library: string; name: string; overview: string; year: number; genres: string[]; countries: string[]; studios: string[]; rating: number; ended: boolean; airDays: string[]; airTime: string; premiere: number; images: CatalogImages; episodes: CatalogEpisode[] }
export interface CatalogMovie { id: string; sourceId: string; container: string; width: number; height: number; library: string; name: string; overview: string; year: number; genres: string[]; countries: string[]; rating: number; runtime: number; premiere: number; images: CatalogImages }
export interface Catalog { server: string; username: string; generatedAt: number; series: CatalogSeries[]; movies: CatalogMovie[] }

let catalog: Catalog = { server: '', username: '', generatedAt: 0, series: [], movies: [] }
let token = ''
const DEVICE = 'jumedia-web-mock'

export const getCatalog = () => catalog
export const embyRef = (itemId: string, sourceId: string) => `emby:${itemId}:${sourceId}`
export const embyHlsPath = (itemId: string, sourceId: string) => `/media/emby/${itemId}/hls/index.m3u8?source=${encodeURIComponent(sourceId)}`

/** Loads the catalog and signs in to Emby with the account it was built from. */
export async function loadEmby(fetcher: typeof fetch) {
  try {
    const res = await fetcher('/mock/emby/catalog.json')
    if (res.ok) catalog = await res.json()
  } catch { /* no catalog: the mock still runs, without demo media */ }
  if (!catalog.server) return
  try {
    const auth = await fetcher(`${catalog.server}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Emby-Authorization': `MediaBrowser Client="Jumedia", Device="Jumedia Web", DeviceId="${DEVICE}", Version="0.1.0"` },
      body: JSON.stringify({ Username: catalog.username, Pw: (import.meta.env.VITE_EMBY_PASSWORD as string | undefined) ?? '' }),
    }).then((r) => r.json())
    token = auth.AccessToken ?? ''
  } catch (e) {
    console.warn('[mock] Emby 登录失败，视频将无法播放', e)
  }
}

/** Progressive MP4 for `emby:{item}:{source}`. */
export function embyStreamURL(ref: string): string {
  const [, item, source] = ref.split(':')
  return `${catalog.server}/Videos/${item}/stream.mp4?Static=true&MediaSourceId=${encodeURIComponent(source)}&DeviceId=${DEVICE}&api_key=${token}`
}

const sessions = new Map<string, Promise<string>>()
function playSession(fetcher: typeof fetch, item: string, source: string) {
  const key = item + ':' + source
  if (!sessions.has(key)) {
    sessions.set(key, fetcher(`${catalog.server}/Items/${item}/PlaybackInfo?MediaSourceId=${encodeURIComponent(source)}&api_key=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).then((d) => d.PlaySessionId as string)
      .catch((e) => { sessions.delete(key); throw e }))
  }
  return sessions.get(key)!
}

/**
 * Playlists behind `/media/emby/{item}/hls/{index|main}.m3u8`. Emby needs the
 * play session, device and token on every segment, but its playlists carry only
 * the session, so segment URIs are rewritten to complete absolute Emby URLs.
 */
export async function embyPlaylist(fetcher: typeof fetch, path: string, source: string): Promise<string | null> {
  const m = /^\/media\/emby\/([^/]+)\/hls\/(index|main)\.m3u8$/.exec(path)
  if (!m || !catalog.server || !token) return null
  const [, item, kind] = m
  if (kind === 'index') {
    return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2"\nmain.m3u8?source=${encodeURIComponent(source)}\n`
  }
  const session = await playSession(fetcher, item, source)
  const query = `MediaSourceId=${encodeURIComponent(source)}&VideoCodec=h264&AudioCodec=aac&DeviceId=${DEVICE}&PlaySessionId=${session}&api_key=${token}`
  const text = await fetcher(`${catalog.server}/Videos/${item}/main.m3u8?${query}`).then((r) => r.text())
  return text.split('\n').map((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return line
    const base = t.split('?')[0]
    return `${catalog.server}/Videos/${item}/${base}?${query}`
  }).join('\n')
}
