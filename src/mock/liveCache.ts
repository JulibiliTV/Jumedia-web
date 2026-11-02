/**
 * Transcode cache for relayed videos (`source_type=video`).
 *
 * Choosing a video for a live room queues a job on the Jumedia server: ffmpeg
 * reads the original file (through Jumedia, never Emby's transcoder) and writes
 * an H.264/AAC HLS VOD (`index.m3u8` + `seg00000.ts`…, at most
 * `settings.liveTranscodeHeight` lines) under `{settings.liveCacheDir}/{key}/`.
 * The relay serves `/live-cache/{key}/index.m3u8` through the usual live window,
 * so web and TV players get plain TS. A room can only go live once its cache is
 * `ready`; `pending_start` starts it automatically when the job finishes.
 *
 * - One cache per (media ref, height); rooms relaying the same page share it.
 *   Changing the height only affects caches created afterwards.
 * - Jobs run one at a time, oldest first. A failed job stays failed until retried.
 * - A cache no room references is deleted after `CACHE_KEEP` seconds.
 * - `dir` is recorded per cache, so changing `liveCacheDir` leaves existing caches
 *   where they are; only new jobs use the new directory.
 *
 * The mock has no ffmpeg: a job advances on a timer, and a finished cache's
 * playlist is stood in by the media's Emby HLS playlist.
 */
import { parseDsRef } from './datasource'
import { type DB, type LiveCache, type LiveRoom, save } from './db'

export const CACHE_KEEP = 24 * 3600
/** Simulated transcode time of one job, seconds. */
const MOCK_JOB_SECONDS = 20
export const TRANSCODE_HEIGHTS = [720, 1080, 1440, 2160]

const now = () => Math.floor(Date.now() / 1000)
const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

export const cachePath = (key: string) => `/live-cache/${key}/index.m3u8`
export const cacheKeyOf = (url: string) => /^\/live-cache\/([0-9a-f]{32})\/index\.m3u8$/.exec(url)?.[1] ?? ''
export const cacheDir = (db: DB) => String(db.settings.liveCacheDir || '') || '{数据目录}/live-cache'

/** The cache for `media` at the current height, if any. */
export function findCache(db: DB, media: string) {
  const height = Number(db.settings.liveTranscodeHeight) || 1080
  const exact = db.liveCaches.find((x) => x.media === media && x.height === height)
  if (exact) return exact
  const ref = parseDsRef(media), ids = db.settings._demo_datasource_ids
  if (!ref || !Array.isArray(ids) || !ids.includes(ref.ds)) return undefined
  const own = db.dataSources.find((x) => x.id === ref.ds)
  if (!own) return undefined
  return db.liveCaches.find((cache) => {
    const otherRef = parseDsRef(cache.media)
    if (cache.status !== 'ready' || cache.height !== height || !otherRef || !ids.includes(otherRef.ds) || otherRef.item !== ref.item || otherRef.source !== ref.source || otherRef.container !== ref.container) return false
    const other = db.dataSources.find((x) => x.id === otherRef.ds)
    return other && own.url.replace(/\/+$/, '') === other.url.replace(/\/+$/, '') && own.username === other.username && own.password === other.password
  })
}

/** The cache for `media` at the current height, queued if there is none yet. */
export function ensureCache(db: DB, media: string, aid: number, cid: number, duration: number): LiveCache {
  const height = Number(db.settings.liveTranscodeHeight) || 1080
  let c = findCache(db, media)
  if (!c) {
    const key = randomKey()
    c = { key, media, height, aid, cid, duration, status: 'pending', progress: 0, message: '', size: 0, dir: `${cacheDir(db).replace(/\/+$/, '')}/${key}`, ctime: now(), mtime: now(), started: 0, unused_since: 0 }
    db.liveCaches.push(c)
  }
  return c
}

export const roomCache = (db: DB, r: LiveRoom) => (r.source?.type === 'video' ? db.liveCaches.find((x) => x.key === r.source!.cache) : undefined)

export function cacheJSON(c: LiveCache | undefined) {
  return c ? { key: c.key, status: c.status, progress: c.progress, message: c.message, height: c.height, size: c.size } : null
}

/** Error text for starting a room whose cache is not playable yet, else ''. */
export function notReady(c: LiveCache | undefined) {
  if (!c) return '转播视频的转码缓存不存在，请重新选择视频'
  if (c.status === 'failed') return `转播视频转码失败：${c.message}`
  if (c.status !== 'ready') return `转播视频正在转码缓存（${c.status === 'running' ? `${c.progress}%` : '排队中'}），完成后才能开播`
  return ''
}

export function retryCache(c: LiveCache) {
  if (c.status !== 'failed') return
  Object.assign(c, { status: 'pending', progress: 0, message: '', mtime: now() })
}

/** Advances jobs, starts rooms waiting on finished caches, and drops caches unused for a day. */
export function tickCaches(db: DB) {
  let changed = false
  const t = now()
  const running = db.liveCaches.find((c) => c.status === 'running')
  if (running) {
    const p = Math.min(100, Math.floor(((Date.now() / 1000 - running.started) / MOCK_JOB_SECONDS) * 100))
    if (p >= 100) {
      // ~3 Mbps video + 160 kbps audio
      Object.assign(running, { status: 'ready', progress: 100, size: Math.round(running.duration * 395_000), mtime: t })
      for (const r of db.rooms) {
        if (!r.pending_start || r.source?.cache !== running.key) continue
        r.pending_start = false
        if (!r.banned) Object.assign(r, { live_status: 1, live_time: t, online: Math.max(1, r.online) })
      }
      changed = true
    } else if (p !== running.progress) { running.progress = p; changed = true }
  } else {
    const next = db.liveCaches.filter((c) => c.status === 'pending').sort((a, b) => a.ctime - b.ctime)[0]
    if (next) { Object.assign(next, { status: 'running', progress: 0, started: Date.now() / 1000, mtime: t }); changed = true }
  }
  const used = new Set(db.rooms.map((r) => r.source?.cache).filter(Boolean))
  for (const c of db.liveCaches) {
    const since = used.has(c.key) ? 0 : c.unused_since || t
    if (since !== c.unused_since) { c.unused_since = since; changed = true }
  }
  const keep = db.liveCaches.filter((c) => !c.unused_since || t - c.unused_since < CACHE_KEEP || c.status === 'running')
  if (keep.length !== db.liveCaches.length) { db.liveCaches = keep; changed = true }
  if (changed) save()
}
