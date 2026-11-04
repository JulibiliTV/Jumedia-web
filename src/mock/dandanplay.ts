import { type Archive, type DB, getDB, nextID, save } from './db'
import { type DanmakuSync } from '../api/jumedia'

const retrySeconds = 30 * 60

export function idleSync(aid: number, cid: number): DanmakuSync {
  return { aid, cid, status: 'idle', message: '', count: 0, episode_id: 0, anime_title: '', episode_title: '', updated_at: 0 }
}

/** Browser mock uses local sample comments and never sends app credentials upstream. */
export function queueMockDanmaku(db: DB, archive: Archive, cid?: number) {
  const cache = db.dandanplay ??= {}
  for (const [cid, entry] of Object.entries(cache)) {
    if (entry.sync.aid === archive.aid && !archive.pages.some((p) => p.cid === Number(cid))) {
      archive.stat.danmaku = Math.max(0, archive.stat.danmaku - entry.sync.count)
      delete cache[Number(cid)]
    }
  }
  if (!db.settings.dandanplayEnabled) return
  for (const p of archive.pages) {
    if (cid !== undefined && p.cid !== cid) continue
    enqueueMock(db, archive.aid, archive.title, p,
      () => db.archives.includes(archive) && archive.pages.includes(p) && ![-100, -6].includes(archive.state) && hasSource(db, p.media, archive.origin?.ds),
      delta => { archive.stat.danmaku += delta })
  }
}

function hasSource(db: DB, media: string, originDS?: number) {
  const ds = originDS || Number(/^embyds:(\d+):/.exec(media)?.[1])
  return db.dataSources.some(source => source.id === ds && source.type === 'emby')
}

function enqueueMock(db: DB, aid: number, title: string, p: { cid: number; duration: number; part: string }, valid: () => boolean, addCount: (delta: number) => void) {
  const cache = db.dandanplay ??= {}
  const old = cache[p.cid]
  if (old && (['pending', 'fetching'].includes(old.sync.status) || Date.now() / 1000 - (old.attemptedAt ?? 0) < retrySeconds)) return
  const entry = { sync: { ...(old?.sync ?? idleSync(aid, p.cid)), status: 'pending' as const }, comments: old?.comments ?? [], attemptedAt: Math.floor(Date.now() / 1000) }
  cache[p.cid] = entry
  setTimeout(() => {
    if (getDB() !== db || cache[p.cid] !== entry || !valid()) return
    const now = Math.floor(Date.now() / 1000)
    const comments = ['浏览器 Mock 示例弹幕', '这段很精彩', '一起看下一集'].map((content, i) => ({ id: nextID(), cid: p.cid, progress: Math.min(Math.max(0, p.duration - 1), 2 + i * 5) * 1000, mode: i === 2 ? 5 : 1, fontsize: 25, color: 0xffffff, mid: 0, content, ctime: now, weight: 5 }))
    addCount(comments.length - entry.sync.count)
    cache[p.cid] = { ...entry, sync: { ...entry.sync, status: 'ready', count: comments.length, updated_at: now, episode_id: p.cid, anime_title: title, episode_title: p.part }, comments }
    save()
  }, 600)
}

export function requestMockDanmaku(db: DB, cid: number): boolean {
  if (!db.settings.dandanplayEnabled || Boolean(db.settings.dandanplayAppId) !== Boolean(db.settings._dandanplay_has_secret)) return false
  const archive = db.archives.find(a => ![-100, -6].includes(a.state) && a.pages.some(p => p.cid === cid && hasSource(db, p.media, a.origin?.ds)))
  const season = db.seasons.find(s => s.state !== -100 && s.episodes.some(e => e.cid === cid && hasSource(db, e.media)))
  if (!archive && !season) return false
  const old = db.dandanplay?.[cid]
  if (old && (['pending', 'fetching'].includes(old.sync.status) || old.sync.status === 'ready' && old.comments.length > 0 || Date.now() / 1000 - (old.attemptedAt ?? 0) < retrySeconds)) {
    return ['pending', 'fetching'].includes(old.sync.status)
  }
  if (archive) queueMockDanmaku(db, archive, cid)
  else if (season) {
    const episode = season.episodes.find(e => e.cid === cid)!
    enqueueMock(db, episode.aid, season.title, { ...episode, part: episode.title },
      () => db.seasons.includes(season) && season.state !== -100 && season.episodes.includes(episode) && hasSource(db, episode.media), () => {})
  }
  return true
}
