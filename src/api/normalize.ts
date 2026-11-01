// Ports of Juli's response parsers (`videoItem`, `seasonItem`, `liveItem`,
// `dynamicItem`, `videoComment`) so every page consumes one card model no
// matter which endpoint produced it.

export type Kind = 'video' | 'bangumi' | 'live'

export interface VideoItem {
  id: string
  kind: Kind
  aid?: number
  bvid?: string
  cid?: number
  seasonId?: number
  episodeId?: number
  roomId?: number
  title: string
  ownerName: string
  ownerId?: number
  cover?: string
  avatar?: string
  view?: string
  danmaku?: string
  duration?: number
  durationText?: string
  reason?: string
  pubdate?: number
  progress?: number
  finished?: boolean
  like?: string
  coin?: string
  favorite?: string
  reply?: string
  fans?: string
  badge?: string
  rating?: string
}

export interface Comment {
  id: number
  authorId?: number
  authorName: string
  avatar?: string
  message: string
  pictures: string[]
  ctime?: number
  like: number
  replyCount: number
  replies: Comment[]
  action: number
  level?: number
}

type J = any

export const firstPositive = (...values: unknown[]) => {
  for (const v of values) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n }
  return 0
}
export const firstNonempty = (...values: unknown[]) => {
  for (const v of values) if (v !== undefined && v !== null && String(v) !== '') return String(v)
  return ''
}
const firstURL = (...values: unknown[]) => {
  const v = firstNonempty(...values)
  if (!v) return undefined
  return v.startsWith('//') ? 'https:' + v : v
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function cleanTitle(value: unknown): string {
  return String(value ?? '').replace(/<[^>]+>/g, '').replace(/&(\w+);/g, (m, e) => entities[e] ?? m).trim()
}

export function parseDuration(text: unknown): number {
  const s = String(text ?? '').trim()
  if (!s) return 0
  if (/^\d+$/.test(s)) return Number(s)
  const parts = s.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`
}

function bangumiEpisodeID(v: J): number | undefined {
  const h = v.history ?? {}
  if (h.business === 'pgc' && h.epid > 0) return h.epid
  const m = /\/bangumi\/play\/ep(\d+)/.exec(String(v.redirect_url ?? ''))
  return m ? Number(m[1]) : undefined
}

export function videoItem(v: J): VideoItem | null {
  if (!v || typeof v !== 'object') return null
  const aid = firstPositive(v.aid, v.id, v.args?.aid, v.player_args?.aid, v.history?.oid)
  const title = cleanTitle(v.title)
  if (!aid || !title) return null
  const ownerName = cleanTitle(firstNonempty(v.owner?.name, v.author?.name, v.author_name, typeof v.author === 'string' ? v.author : '', v.name, v.upper?.name, v.args?.up_name))
  const ownerId = firstPositive(v.owner?.mid, v.author_mid, v.mid, v.args?.up_id, v.author?.mid, v.upper?.mid)
  const numeric = firstPositive(v.duration, v.player_args?.duration, v.history?.duration)
  const formatted = [v.duration_text, v.duration, v.length, v.cover_right_text].map(parseDuration).find((n) => n > 0) ?? 0
  const duration = firstPositive(numeric, formatted)
  const progress = firstPositive(v.progress, v.history?.progress, v.player_args?.progress)
  const finished = [v.progress, v.history?.progress, v.player_args?.progress].includes(-1)
  const episodeId = bangumiEpisodeID(v)
  const bvid = firstNonempty(v.bvid, v.history?.bvid)
  return {
    id: episodeId ? `episode-${episodeId}` : `av${aid}`,
    kind: episodeId ? 'bangumi' : 'video',
    aid, bvid: bvid || undefined,
    cid: firstPositive(v.cid, v.player_args?.cid, v.history?.cid) || undefined,
    episodeId, title, ownerName, ownerId: ownerId || undefined,
    cover: firstURL(v.pic, v.cover, v.cover_left_text_1),
    avatar: firstURL(v.owner?.face, v.author_face, v.upic, v.avatar?.cover, v.face),
    view: firstNonempty(v.stat?.view, v.play, v.play_count, v.cnt_info?.play, v.cover_left_text_2),
    danmaku: firstNonempty(v.stat?.danmaku, v.video_review, v.cnt_info?.danmaku, v.cover_left_text_3),
    duration: duration || undefined,
    durationText: duration ? formatDuration(duration) : undefined,
    reason: firstNonempty(v.rcmd_reason?.content, v.reason_style?.text),
    pubdate: firstPositive(v.pubdate, v.ctime, v.senddate, v.created) || undefined,
    progress: progress || undefined, finished,
    fans: firstNonempty(v.owner?.fans, v.owner?.followers, v.stat?.fans),
    reply: firstNonempty(v.stat?.reply, v.reply),
    like: firstNonempty(v.stat?.like, v.like),
    coin: firstNonempty(v.stat?.coin, v.coin),
    favorite: firstNonempty(v.stat?.favorite, v.stat?.fav, v.favorite),
    badge: firstNonempty(v.badge),
  }
}

export function seasonItem(v: J): VideoItem | null {
  if (!v) return null
  const seasonId = firstPositive(v.season_id)
  const episodeId = firstPositive(v.ep_id, v.epid, v.first_ep?.ep_id)
  const title = cleanTitle(firstNonempty(v.title, v.season_name))
  if (!title || (!seasonId && !episodeId)) return null
  const d = firstPositive(v.duration, v.duration_seconds)
  return {
    id: episodeId ? `episode-${episodeId}` : `season-${seasonId}`, kind: 'bangumi',
    seasonId: seasonId || undefined, episodeId: episodeId || undefined, title,
    ownerName: firstNonempty(v.new_ep?.index_show, v.index_show, '番剧'),
    cover: firstURL(v.cover, v.eps?.cover),
    view: firstNonempty(v.stat?.view, v.stat?.views),
    durationText: d ? formatDuration(d) : firstNonempty(v.duration_text) || undefined,
    reason: cleanTitle(firstNonempty(Array.isArray(v.areas) ? v.areas.map((a: J) => a.name ?? a).join(' ') : v.areas, Array.isArray(v.styles) ? v.styles.join(' ') : v.styles)),
    badge: firstNonempty(v.badge, v.badge_info?.text),
    rating: firstNonempty(v.rating?.score, v.score, v.order),
  }
}

export function liveItem(v: J): VideoItem | null {
  if (!v) return null
  const roomId = firstPositive(v.roomid, v.room_id)
  const title = cleanTitle(v.title)
  if (!roomId || !title) return null
  const ownerId = firstPositive(v.uid, v.mid, v.ruid, v.owner_uid)
  return {
    id: `live-${roomId}`, kind: 'live', roomId, title,
    ownerName: cleanTitle(firstNonempty(v.uname, v.name)), ownerId: ownerId || undefined,
    cover: firstURL(v.system_cover, v.user_cover, v.cover, v.room_cover),
    avatar: firstURL(v.face),
    view: firstNonempty(v.watched_show?.text_large, v.text_small, v.online),
    reason: firstNonempty(v.area_v2_name, v.area_name),
  }
}

export function dynamicItem(v: J): VideoItem | null {
  const major = v?.modules?.module_dynamic?.major ?? {}
  const author = v?.modules?.module_author ?? {}
  const a = major.archive
  if (a?.aid > 0) {
    const d = parseDuration(a.duration_text)
    return {
      id: `av${a.aid}`, kind: 'video', aid: Number(a.aid), bvid: a.bvid, title: a.title, ownerName: author.name, ownerId: author.mid,
      cover: a.cover, avatar: author.face, view: firstNonempty(a.stat?.play), danmaku: firstNonempty(a.stat?.danmaku),
      duration: d || undefined, durationText: a.duration_text, pubdate: author.pub_ts || undefined, reason: author.pub_ts ? '' : author.pub_time,
    }
  }
  return seasonItem(major.pgc)
}

export function videoComment(v: J): Comment | null {
  const id = firstPositive(v?.rpid, v?.rpid_str)
  const message = String(v?.content?.message ?? '').trim()
  const pictures = (v?.content?.pictures ?? []).map((p: J) => firstURL(p.img_src, p.img_url, p.url)).filter(Boolean)
  if (!id || (!message && !pictures.length)) return null
  const member = v.member ?? {}
  const replies = (v.replies ?? []).map(videoComment).filter(Boolean) as Comment[]
  return {
    id, authorId: firstPositive(v.mid, member.mid) || undefined,
    authorName: firstNonempty(member.uname, '用户'), avatar: firstURL(member.avatar, member.face),
    message, pictures, ctime: v.ctime || undefined, like: Math.max(0, Number(v.like ?? 0)),
    replyCount: Math.max(firstPositive(v.rcount, v.count), replies.length), replies,
    action: Number(v.action ?? 0), level: member.level_info?.current_level,
  }
}

export const compact = <T = VideoItem,>(values: readonly (T | null | undefined)[]): T[] => values.filter((v): v is T => v != null)

export function countText(value: unknown): string {
  const s = String(value ?? '')
  const n = Number(s)
  if (!s || !Number.isFinite(n)) return s
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万'
  return String(n)
}

export function timeText(ts?: number): string {
  if (!ts) return ''
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 86400 * 2) return '昨天'
  const d = new Date(ts * 1000), now = new Date()
  const md = `${d.getMonth() + 1}-${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`
}

export function dateTimeText(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
