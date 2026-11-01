import { type Archive, type ArchiveField, type ArchiveOrigin, av2bv, type DataSource, type DataSourceLibrary, type DB, type Page, type Region, save } from './db'

/**
 * User-configured Emby data sources: login, library discovery and the sync
 * that mirrors a source's video libraries into Jumedia archives (one per
 * movie, one multi-page archive per series) and one 合集 per library.
 * Emby is only ever read. Edits made in Jumedia lock the edited fields so later
 * syncs keep them (`ArchiveOrigin.locked`).
 *
 * Media refs: `embyds:{ds}:{item}:{mediaSourceId}:{mode}` — `direct` when the
 * file plays in `<video>` (MP4/M4V/MOV, H.264, AAC/MP3), otherwise
 * `raw-{container}` (e.g. `raw-mkv`): the original file is served untouched and
 * the web player decodes it in the page with libmedia. Emby never transcodes.
 * Canonical paths, shared with Jumedia-server, which proxies them (with Range)
 * and keeps credentials server-side:
 *   /media/emby/{item}.mp4?source={id}&ds={ds}             direct
 *   /media/emby/{item}/file.{container}?source={id}&ds={ds} raw (playurl `format` = container)
 *   /media/emby/{item}/image/{Primary|Backdrop|Thumb}?ds={ds}&tag={tag}
 * Live rooms relaying a data-source video still use the HLS path
 *   /media/emby/{item}/hls/index.m3u8?source={id}&ds={ds}
 * The browser mock cannot proxy `<img>`/`<video>`/segment requests, so it
 * stores direct Emby image URLs and hands out direct stream URLs instead.
 */

const DEVICE = 'jumedia-web-mock'
const AUTH = `MediaBrowser Client="Jumedia", Device="Jumedia Web", DeviceId="${DEVICE}", Version="0.1.0"`
/** The mock keeps its DB in localStorage, so it imports at most this many titles per source (the server has no cap). */
const MOCK_ITEM_LIMIT = 300
/** Library types mirrored as 合集; music, photos, books, boxsets, playlists and live TV are skipped. */
const VIDEO_LIBRARIES = new Set(['movies', 'tvshows', 'homevideos', 'musicvideos', 'mixed', ''])

export class SourceError extends Error {
  /** Set for network errors, 429 and 502–504: the sync retries these with backoff. */
  constructor(message: string, readonly retry = false, readonly retryAfter = 0) { super(message) }
}

let fetcher: typeof fetch = (...a) => fetch(...a)
export const setSourceFetcher = (f: typeof fetch) => { fetcher = f }

/** `https://host[:port][/path]` → Emby API root, appending `/emby` when missing. */
export function embyBase(address: string): string {
  let u: URL
  try { u = new URL(address.trim()) } catch { throw new SourceError('Emby 服务器地址格式不正确') }
  if (!['http:', 'https:'].includes(u.protocol)) throw new SourceError('仅支持 http / https 的 Emby 地址')
  const path = u.pathname.replace(/\/+$/, '')
  return u.origin + (/\/emby$/i.test(path) ? path : path + '/emby')
}

/** Loopback, link-local, private and `.local` hosts — refused for user sources unless the site allows private networks. */
export function privateHost(address: string): boolean {
  let host = ''
  try { host = new URL(address.trim()).hostname.replace(/^\[|\]$/g, '').toLowerCase() } catch { return false }
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || /^f[cd]/.test(host) || /^fe80:/.test(host)
    || /^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
}

interface Session { base: string; token: string; user: string }
export interface ServerInfo { server_name: string; server_id: string; version: string; libraries: { id: string; name: string; type: string }[] }

async function call<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try { res = await fetcher(base + path, init) } catch { throw new SourceError('无法连接 Emby 服务器（网络错误或服务器未开放跨域）', true) }
  if (res.status === 401) throw new SourceError('Emby 用户名或密码错误')
  if (!res.ok) throw new SourceError(`Emby 返回 HTTP ${res.status}`, [429, 502, 503, 504].includes(res.status), Number(res.headers.get('Retry-After')) || 0)
  return res.json() as Promise<T>
}

async function login(url: string, username: string, password: string): Promise<Session> {
  const base = embyBase(url)
  if (!username.trim()) throw new SourceError('请填写 Emby 用户名')
  const auth = await call<{ AccessToken?: string; User?: { Id: string } }>(base, '/Users/AuthenticateByName', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emby-Authorization': AUTH }, body: JSON.stringify({ Username: username.trim(), Pw: password }),
  })
  if (!auth.AccessToken || !auth.User) throw new SourceError('Emby 用户名或密码错误')
  return { base, token: auth.AccessToken, user: auth.User.Id }
}

/** Signs in and lists the account's video libraries (`/x/web/datasource/test`). */
export async function probeSource(url: string, username: string, password: string): Promise<ServerInfo> {
  const s = await login(url, username, password)
  const info = await call<{ ServerName?: string; Id?: string; Version?: string }>(s.base, '/System/Info/Public')
  return { server_name: info.ServerName ?? '', server_id: info.Id ?? '', version: info.Version ?? '', libraries: await libraries(s) }
}

async function libraries(s: Session, get: Get = (p) => call(s.base, p)) {
  const views = await get<{ Items: { Id: string; Name: string; CollectionType?: string }[] }>(`/Users/${s.user}/Views?api_key=${s.token}`)
  return views.Items.filter((v) => VIDEO_LIBRARIES.has(v.CollectionType ?? '')).map((v) => ({ id: v.Id, name: v.Name, type: v.CollectionType ?? 'mixed' }))
}

/** One signed-in session per source, renewed when the source's credentials change. */
const sessions = new Map<number, { key: string; session: Promise<Session> }>()
function sessionFor(ds: DataSource): Promise<Session> {
  const key = `${ds.url}\n${ds.username}\n${ds.password}`
  const cached = sessions.get(ds.id)
  if (cached?.key === key) return cached.session
  const session = login(ds.url, ds.username, ds.password)
  session.catch(() => sessions.delete(ds.id))
  sessions.set(ds.id, { key, session })
  return session
}
export const forgetSession = (id: number) => sessions.delete(id)

// ---------------- sync request budget ----------------

type Get = <T>(path: string) => Promise<T>
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * A source's sync requests: at most `rate` a second and `concurrency` in flight
 * (`settings.dataSourceSyncRate` / `dataSourceSyncConcurrency`). Playback and
 * image proxying are not throttled.
 */
class Throttle {
  private active = 0
  private queue: (() => void)[] = []
  private next = 0
  constructor(private rate: number, private concurrency: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.concurrency) this.active++
    else await new Promise<void>((r) => this.queue.push(r)) // the finishing request hands over its slot
    try {
      const at = Math.max(Date.now(), this.next)
      this.next = at + 1000 / this.rate
      if (at > Date.now()) await sleep(at - Date.now())
      return await fn()
    } finally {
      const waiter = this.queue.shift()
      if (waiter) waiter()
      else this.active--
    }
  }
}

/** Throttled GET that retries retryable errors 3 times (1 s, 2 s, 4 s, or `Retry-After`, at most 60 s). */
function syncGet(s: Session, t: Throttle): Get {
  return async <T,>(path: string): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try { return await t.run(() => call<T>(s.base, path)) } catch (e) {
        if (attempt >= 3 || !(e instanceof SourceError) || !e.retry) throw e
        await sleep(Math.min(60, e.retryAfter || 2 ** attempt) * 1000)
      }
    }
  }
}

// ---------------- metadata mapping ----------------

interface Stream { Type?: string; Codec?: string }
interface MediaSource { Id: string; Container?: string; MediaStreams?: Stream[] }
interface Item {
  Id: string; Name: string; Type: string; Overview?: string; Genres?: string[]; PremiereDate?: string; DateCreated?: string; RunTimeTicks?: number
  ImageTags?: Record<string, string>; BackdropImageTags?: string[]; MediaSources?: MediaSource[]; ParentIndexNumber?: number; IndexNumber?: number; LocationType?: string
}

/** Default region from the library and genres; falls back to 影视 (or the first region) when the tid is not configured. */
export function autoRegion(regions: Region[], library: { name: string; type: string }, genres: string[]): number {
  const g = genres.join(' ')
  const lib = library.name
  const rules: [boolean, number][] = [
    [/美食|烹饪|Food|Cooking/i.test(g), 1020],
    [library.type === 'musicvideos' || /音乐|Music/i.test(g), 1003],
    [/纪录|Documentary/i.test(g), 1010],
    [/体育|运动|Sport/i.test(g), 1018],
    [/旅行|旅游|Travel/i.test(g), 1030],
    [/动画|动漫|番剧|Anime|Animation/i.test(g) || /动漫|动画|番/.test(lib), 1005],
    [/综艺|真人秀|脱口秀|Reality|Talk|Game Show/i.test(g) || /综艺/.test(lib), 1002],
  ]
  const tid = rules.find(([hit]) => hit)?.[1] ?? 1001
  const top = regions.filter((r) => !r.parent)
  return top.some((r) => r.tid === tid) ? tid : top.some((r) => r.tid === 1001) ? 1001 : top[0]?.tid ?? 0
}

const direct = (m: MediaSource) => {
  const streams = m.MediaStreams ?? []
  const video = streams.filter((s) => s.Type === 'Video'), audio = streams.filter((s) => s.Type === 'Audio')
  return ['mp4', 'm4v', 'mov'].includes((m.Container ?? '').toLowerCase()) && video.length > 0 && video.every((s) => s.Codec?.toLowerCase() === 'h264') && audio.every((s) => ['aac', 'mp3'].includes(s.Codec?.toLowerCase() ?? ''))
}
const containerOf = (m: MediaSource) => (m.Container ?? '').toLowerCase().split(',')[0].replace(/[^a-z0-9]/g, '') || 'mkv'
export const dsRef = (ds: number, item: string, m: MediaSource) => `embyds:${ds}:${item}:${m.Id}:${direct(m) ? 'direct' : `raw-${containerOf(m)}`}`
export function parseDsRef(ref: string) {
  const m = /^embyds:(\d+):([^:]+):([^:]+):(direct|raw-[a-z0-9]+)$/.exec(ref)
  return m ? { ds: Number(m[1]), item: m[2], source: m[3], container: m[4] === 'direct' ? null : m[4].slice(4) } : null
}
/** playurl `format`: `mp4` for `<video>`, otherwise the container the web player opens with libmedia. */
export const mediaFormat = (ref: string) => parseDsRef(ref)?.container ?? 'mp4'
const seconds = (ticks?: number) => Math.max(1, Math.round((ticks ?? 0) / 1e7))
const unix = (iso?: string) => (iso ? Math.floor(Date.parse(iso) / 1000) || 0 : 0)
const bareNumber = (name: string) => /^(第\s*)?\d+\s*[集话期]?$/.test(name.trim())

/** Mock: direct Emby image URL (public, no token). Server: `/media/emby/{item}/image/{type}?ds=&tag=`. */
function image(s: Session, item: Item, ...kinds: ('Backdrop' | 'Thumb' | 'Primary')[]): string {
  for (const kind of kinds) {
    const tag = kind === 'Backdrop' ? item.BackdropImageTags?.[0] : item.ImageTags?.[kind]
    if (tag) return `${s.base}/Items/${item.Id}/Images/${kind}?tag=${tag}&maxWidth=1280`
  }
  return ''
}

/** Emby items fetched per page; each page is written before the next one is requested. */
export const SYNC_PAGE = 100

function listPage(s: Session, get: Get, library: string, start: number, limit: number) {
  const fields = 'Overview,Genres,PremiereDate,DateCreated,MediaSources,RunTimeTicks'
  return get<{ Items: Item[]; TotalRecordCount: number }>(`/Users/${s.user}/Items?ParentId=${library}&Recursive=true&IncludeItemTypes=Movie,Series,Video,MusicVideo&SortBy=SortName&SortOrder=Ascending&Fields=${fields}&StartIndex=${start}&Limit=${limit}&api_key=${s.token}`)
}

async function episodes(s: Session, get: Get, series: string): Promise<Item[]> {
  const page = await get<{ Items: Item[] }>(`/Shows/${series}/Episodes?UserId=${s.user}&Fields=Overview,MediaSources,PremiereDate,DateCreated,RunTimeTicks&api_key=${s.token}`)
  // Specials (season 0) and virtual (missing) episodes are left out.
  return page.Items.filter((e) => (e.ParentIndexNumber ?? 1) > 0 && e.LocationType !== 'Virtual' && e.MediaSources?.length)
    .sort((a, b) => (a.ParentIndexNumber ?? 1) - (b.ParentIndexNumber ?? 1) || (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0))
}

interface Mirrored { meta: ArchiveOrigin['meta']; pages: Omit<Page, 'cid'>[]; pubdate: number; ctime: number }
async function mirror(ds: DataSource, s: Session, get: Get, regions: Region[], lib: DataSourceLibrary, item: Item): Promise<Mirrored | null> {
  const genres = item.Genres ?? []
  let pages: Omit<Page, 'cid'>[]
  if (item.Type === 'Series') {
    const eps = await episodes(s, get, item.Id)
    const seasons = new Set(eps.map((e) => e.ParentIndexNumber ?? 1)).size
    pages = eps.map((e) => {
      const n = e.IndexNumber ?? 0
      const label = seasons > 1 ? `S${String(e.ParentIndexNumber ?? 1).padStart(2, '0')}E${String(n).padStart(2, '0')}` : `第${n}集`
      return { part: (bareNumber(e.Name) ? label : `${label} ${e.Name}`).slice(0, 80), duration: seconds(e.RunTimeTicks), media: dsRef(ds.id, e.Id, e.MediaSources![0]) }
    })
  } else {
    if (!item.MediaSources?.length) return null
    pages = [{ part: item.Name.slice(0, 80), duration: seconds(item.RunTimeTicks), media: dsRef(ds.id, item.Id, item.MediaSources[0]) }]
  }
  if (!pages.length) return null
  const meta = {
    title: item.Name.slice(0, 80), desc: (item.Overview ?? '').slice(0, 2000), tid: autoRegion(regions, lib, genres),
    tag: [lib.name, ...genres.slice(0, 3)].filter(Boolean).join(','), pic: image(s, item, 'Backdrop', 'Thumb', 'Primary'),
  }
  const ctime = unix(item.DateCreated) || Math.floor(Date.now() / 1000)
  return { meta, pages, pubdate: unix(item.PremiereDate) || ctime, ctime }
}

/** Page media keyed by Emby item id, so re-synced episodes keep their cid (and danmaku/history). */
const itemOf = (media: string) => parseDsRef(media)?.item ?? media

/**
 * Mirrors the source into `db`, one page of `SYNC_PAGE` items at a time: each
 * page is fetched (series episodes in parallel, within the source's request
 * budget) and saved before the next, and `ds.message` reports progress, so an
 * interrupted sync keeps what it wrote. Items deleted in Jumedia (state -100)
 * stay deleted. Only after a library was listed completely do its items that
 * are gone from Emby become state -6 (hidden); items of disabled or removed
 * libraries do too. Hidden items come back with state 0 when they reappear.
 * An item that fails (after retries) keeps its archive unchanged; a library
 * whose listing fails keeps all of its archives. Either way the sync ends with
 * `failures` > 0 and `error` set to the last error.
 */
export async function syncSource(db: DB, ds: DataSource, nextID: () => number): Promise<{ count: number; failures: number; error: string }> {
  const s = await sessionFor(ds)
  const get = syncGet(s, new Throttle(Number(db.settings.dataSourceSyncRate) || 5, Number(db.settings.dataSourceSyncConcurrency) || 2))
  const found = await libraries(s, get)
  ds.libraries = found.map((l) => {
    const old = ds.libraries.find((x) => x.id === l.id)
    return { ...l, enabled: old?.enabled ?? true, items: old?.items ?? 0, collection_id: old?.collection_id ?? 0 }
  })
  save()
  const auditRequired = !!db.settings.auditRequired && !ds.system && db.users.find((u) => u.mid === ds.mid)?.role !== 'admin'
  const seen = new Set<number>()
  const incomplete = new Set<string>()
  let failures = 0, error = ''
  const fail = (e: unknown) => { failures++; error = e instanceof SourceError ? e.message : (e as Error).message }
  let budget = MOCK_ITEM_LIMIT
  for (const lib of ds.libraries) {
    if (!lib.enabled) continue
    const aids: number[] = []
    let done = 0, total = 0
    const progress = () => { ds.message = `正在同步「${lib.name}」：${done} / ${total}`; save() }
    progress()
    for (let start = 0; budget > 0; start += SYNC_PAGE) {
      let page: { Items: Item[]; TotalRecordCount: number }
      try { page = await listPage(s, get, lib.id, start, Math.min(SYNC_PAGE, budget)) } catch (e) { fail(e); incomplete.add(lib.id); break }
      total = page.TotalRecordCount
      budget -= page.Items.length
      const mirrors = await Promise.all(page.Items.map((item) => mirror(ds, s, get, db.regions, lib, item).catch((e) => { fail(e); return 'failed' as const })))
      page.Items.forEach((item, i) => {
        const m = mirrors[i]
        let a = db.archives.find((x) => x.origin?.ds === ds.id && x.origin.item === item.Id)
        if (m === 'failed') {
          // Keep the existing archive as it is; it is neither updated nor hidden.
          if (a && a.state !== -100 && !seen.has(a.aid)) { seen.add(a.aid); aids.push(a.aid) }
          return
        }
        if (!m || a?.state === -100 || (a && seen.has(a.aid))) return
        if (a) {
          const o = a.origin!
          for (const f of Object.keys(m.meta) as ArchiveField[]) if (!o.locked.includes(f)) (a as unknown as Record<string, unknown>)[f] = m.meta[f]
          Object.assign(o, { library: lib.id, meta: m.meta })
          a.pages = m.pages.map((p) => ({ cid: a!.pages.find((x) => itemOf(x.media) === itemOf(p.media))?.cid ?? nextID(), ...p }))
          if (a.state === -6) a.state = 0
        } else {
          const aid = Math.max(100000, ...db.archives.map((x) => x.aid)) + 1
          const created: Archive = {
            aid, bvid: av2bv(aid), mid: ds.mid, ...m.meta, ctime: m.ctime, pubdate: m.pubdate, state: auditRequired ? -1 : 0, reason: '', copyright: 2, source: `Emby · ${ds.server_name || ds.name}`,
            pages: m.pages.map((p) => ({ cid: nextID(), ...p })), chapters: [], subtitles: [],
            stat: { view: 0, danmaku: 0, reply: 0, favorite: 0, coin: 0, share: 0, like: 0 },
            origin: { type: 'emby', ds: ds.id, item: item.Id, library: lib.id, locked: [], meta: m.meta },
          }
          db.archives.push((a = created))
        }
        seen.add(a.aid)
        aids.push(a.aid)
      })
      // Saved per page: the 合集 grows as pages arrive and only drops stale videos once the library is complete.
      upsertCollection(db, ds, s, lib, aids, nextID, false)
      done += page.Items.length
      lib.items = aids.length
      progress()
      if (start + SYNC_PAGE >= total || !page.Items.length) break
    }
    if (!incomplete.has(lib.id)) upsertCollection(db, ds, s, lib, aids, nextID, true)
  }
  for (const a of db.archives) if (a.origin?.ds === ds.id && !seen.has(a.aid) && a.state !== -100 && !incomplete.has(a.origin.library)) a.state = -6
  const live = new Set(ds.libraries.filter((l) => l.enabled).map((l) => l.id))
  db.collections = db.collections.filter((c) => c.origin?.ds !== ds.id || live.has(c.origin.library))
  for (const l of ds.libraries) if (!l.enabled) l.collection_id = 0
  return { count: seen.size, failures, error }
}

/** `complete`: `aids` is the whole library, in order; otherwise they are added (in order) after the videos already in the 合集. */
function upsertCollection(db: DB, ds: DataSource, s: Session, lib: DataSourceLibrary, aids: number[], nextID: () => number, complete: boolean) {
  const meta = { title: lib.name.slice(0, 40), intro: `同步自 Emby「${ds.server_name || ds.name}」的媒体库`, cover: `${s.base}/Items/${lib.id}/Images/Primary?maxWidth=1280` }
  let c = db.collections.find((x) => x.origin?.ds === ds.id && x.origin.library === lib.id)
  if (!c) {
    c = { id: nextID(), mid: ds.mid, kind: 'season', ...meta, aids: [], ctime: Math.floor(Date.now() / 1000), origin: { type: 'emby', ds: ds.id, library: lib.id, locked: [], meta } }
    db.collections.push(c)
  }
  for (const f of ['title', 'intro', 'cover'] as const) if (!c.origin!.locked.includes(f)) c[f] = meta[f]
  c.origin!.meta = meta
  c.aids = complete ? aids : [...aids, ...c.aids.filter((aid) => !aids.includes(aid))]
  // A video belongs to one 合集: the library's collection claims its archives.
  for (const x of db.collections) if (x !== c && x.kind === 'season') x.aids = x.aids.filter((aid) => !aids.includes(aid))
  lib.collection_id = c.id
}

/** Removes everything a source imported: archives are deleted, its 合集 dropped, rooms relaying its videos fall back to push and stop. */
export function purgeSource(db: DB, ds: DataSource) {
  const gone = new Set<number>()
  for (const a of db.archives) if (a.origin?.ds === ds.id) { a.state = -100; gone.add(a.aid) }
  db.collections = db.collections.filter((c) => c.origin?.ds !== ds.id)
  for (const r of db.rooms) if (r.source?.type === 'video' && gone.has(r.source.aid ?? 0)) { r.source = { type: 'push', url: '', loop: true }; r.live_status = 0; r.pending_start = false }
  forgetSession(ds.id)
}

// ---------------- playback ----------------

export const dsHlsPath = (item: string, source: string, ds: number) => `/media/emby/${item}/hls/index.m3u8?source=${encodeURIComponent(source)}&ds=${ds}`

/** `embyds:` ref → the original file on Emby (`Static=true`: no transcoding). The mock links Emby directly; the server proxies it. */
export async function dsMediaURL(db: DB, ref: string): Promise<string> {
  const r = parseDsRef(ref)
  const ds = r && db.dataSources.find((x) => x.id === r.ds)
  if (!r || !ds) return ''
  const s = await sessionFor(ds)
  return `${s.base}/Videos/${r.item}/stream.${r.container ?? 'mp4'}?Static=true&MediaSourceId=${encodeURIComponent(r.source)}&DeviceId=${DEVICE}&api_key=${s.token}`
}

const playSessions = new Map<string, Promise<string>>()
/** `/media/emby/{item}/hls/{index|main}.m3u8?ds=` — same playlists as the legacy route, with segment URIs pointing at Emby. */
export async function dsPlaylist(db: DB, path: string, source: string, dsID: number): Promise<string | null> {
  const m = /^\/media\/emby\/([^/]+)\/hls\/(index|main)\.m3u8$/.exec(path)
  const ds = db.dataSources.find((x) => x.id === dsID)
  if (!m || !ds) return null
  const [, item, kind] = m
  if (!db.archives.some((a) => a.origin?.ds === dsID && a.state !== -100 && a.pages.some((p) => parseDsRef(p.media)?.item === item && parseDsRef(p.media)?.source === source))) return null
  if (kind === 'index') return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2"\nmain.m3u8?source=${encodeURIComponent(source)}&ds=${dsID}\n`
  const s = await sessionFor(ds)
  const key = `${dsID}:${item}:${source}`
  if (!playSessions.has(key)) {
    const p = call<{ PlaySessionId: string }>(s.base, `/Items/${item}/PlaybackInfo?MediaSourceId=${encodeURIComponent(source)}&api_key=${s.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((d) => d.PlaySessionId)
    p.catch(() => playSessions.delete(key))
    playSessions.set(key, p)
  }
  // MaxWidth keeps Emby from transcoding 4K sources at full size.
  const query = `MediaSourceId=${encodeURIComponent(source)}&VideoCodec=h264&AudioCodec=aac&MaxWidth=1920&DeviceId=${DEVICE}&PlaySessionId=${await playSessions.get(key)}&api_key=${s.token}`
  const text = await fetcher(`${s.base}/Videos/${item}/main.m3u8?${query}`).then((r) => r.text())
  return text.split('\n').map((line) => {
    const t = line.trim()
    return !t || t.startsWith('#') ? line : `${s.base}/Videos/${item}/${t.split('?')[0]}?${query}`
  }).join('\n')
}

/** Data source as returned by the API: credentials reduced to `has_password`. */
export function dataSourceJSON(db: DB, ds: DataSource) {
  const { password, ...rest } = ds
  const u = db.users.find((x) => x.mid === ds.mid)
  return {
    ...rest, has_password: !!password, owner: { mid: ds.mid, name: u?.uname ?? '已注销用户', face: u?.face ?? '' },
    archives: db.archives.filter((a) => a.origin?.ds === ds.id && a.state !== -100 && a.state !== -6).length,
  }
}

/** Creator / admin view of an archive's origin, `null` for uploads. */
export function originJSON(db: DB, a: Pick<Archive, 'origin' | 'state'>) {
  const o = a.origin
  if (!o) return null
  const ds = db.dataSources.find((x) => x.id === o.ds)
  return { type: o.type, datasource_id: o.ds, datasource_name: ds?.name ?? '', item_id: o.item, library: ds?.libraries.find((l) => l.id === o.library)?.name ?? '', locked: o.locked, meta: o.meta, missing: a.state === -6 }
}
