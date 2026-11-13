import { formatDuration } from '../api/normalize'
import { Writer } from '../api/protobuf'
import { idleSync, requestMockDanmaku } from './dandanplay'
import { type Archive, type ArchiveField, type Banner, type CollectionField, type DataSource, type DB, type LiveRoom, type StreamSource, type User, av2bv, avatarURL, bv2av, getDB, importDemo, LIVE_CHATTER, nextID, putFile, resetDB, resolveMedia, save, seedDanmaku } from './db'
import { sourceNames, type SourceType } from '../lib/dataSource'
import { browseSource, importSourceDrafts, dataSourceJSON, dsHlsPath, dsPlaylist, sourceBase, forgetSession, mediaFormat, originJSON, parseDsRef, privateHost, probeSource, purgeSource, setSourceFetcher, SourceError, syncSource } from './datasource'
import { parseDemoPackage } from './emby'
import { cacheDir, cacheJSON, cacheKeyOf, cachePath, ensureCache, findCache, notReady, retryCache, roomCache, tickCaches, TRANSCODE_HEIGHTS } from './liveCache'
import { liveWindow, parsePlaylist, passthrough, type Playlist, relayMaster } from './hlsRelay'
import { archiveById, arcView, compactCount, feedCard, followerCount, followingCount, indexShow, levelInfo, owner, published, regionName, replyJSON, commentVisible, roomCard, seasonBadge, seasonCard, spaceArc, userById, userFace } from './render'

/**
 * In-browser implementation of the Jumedia API, installed over `fetch` while
 * Jumedia-server is not available. Each route answers with the envelope and
 * field names Juli parses, so it doubles as the server's response contract.
 *
 * Image fields (`pic`, `cover`, `face`, `top_photo`, banners…) are always
 * http(s) or site-relative URLs of raster images (JPEG/PNG/WebP/GIF), never
 * `data:` URIs: JumediaTV decodes them with UIImage, needs an HTTP response,
 * and its bangumi carousel accepts only https. Demo media comes from the Emby
 * catalog (see `emby.ts`); a real server returns these as absolute URLs.
 */

type P = Record<string, string>
interface Ctx { p: P; method: string; form?: FormData; me?: User; session?: DB['sessions'][number]; db: DB; origin: string }
type Handler = (c: Ctx) => unknown | Promise<unknown>

class Fail { constructor(public code: number, public message: string, public data: unknown = null) {} }
const fail = (code: number, message: string, data: unknown = null): never => { throw new Fail(code, message, data) }
const ts = () => Math.floor(Date.now() / 1000)
const int = (v: string | undefined, d = 0) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d)
const truthy = (v?: string) => v === 'true' || v === '1'
const page = <T,>(list: T[], pn: number, ps: number) => list.slice((Math.max(1, pn) - 1) * ps, Math.max(1, pn) * ps)
const rand = (n: number) => Math.random().toString(36).slice(2, 2 + n)

function login(c: Ctx): User {
  if (!c.me) fail(-101, '账号未登录')
  if (c.me!.status !== 0) fail(-403, '账号已被封禁')
  return c.me!
}
function csrf(c: Ctx): User {
  const u = login(c)
  const session = c.db.sessions.find((s) => s.mid === u.mid && s.csrf === (c.p.csrf || c.p.biliCSRF))
  if (!session) fail(-111, 'csrf 校验失败')
  return u
}
function recommendationFeedback(c: Ctx, cancel = false, legacy = false) {
  const u = login(c)
  const accessAuth = legacy && !!c.p.access_key && c.p.access_key === c.session?.access
  if (!accessAuth && (!c.session || !(c.p.csrf || c.p.biliCSRF) || (c.p.csrf || c.p.biliCSRF) !== c.session.csrf)) fail(-111, 'csrf 校验失败')
  if (c.method !== 'POST' && !(accessAuth && c.method === 'GET')) fail(-405, '请求方法不支持')
  // Promotion acknowledgements do not create recommendation preferences.
  if (!legacy && c.p.goto === 'ad') return null
  if (c.p.goto !== 'av') fail(-400, '推荐目标类型不支持')
  if (c.p.reason_id !== '1' && c.p.reason_id !== '4') fail(-400, '推荐反馈原因不支持')
  const reason = Number(c.p.reason_id) as 1 | 4
  const aid = Number(c.p.id)
  if (!/^[+]?\d+$/.test(c.p.id ?? '') || !Number.isSafeInteger(aid) || aid <= 0) fail(-400, '视频 ID 无效')
  const a = c.db.archives.find((a) => a.aid === aid)
  if (!a) fail(-404, '视频不存在')
  if (c.p.mid) {
    const mid = Number(c.p.mid)
    if (!/^[+]?\d+$/.test(c.p.mid) || !Number.isSafeInteger(mid) || mid < 0 || (mid !== 0 && mid !== a!.mid)) fail(-400, '作者与视频不匹配')
  }
  const target = reason === 4 ? a!.mid : aid
  const records = c.db.recommendationFeedback ??= []
  const matches = (r: typeof records[number]) => r.mid === u.mid && r.reason_id === reason && r.target_id === target
  if (cancel) c.db.recommendationFeedback = records.filter((r) => !matches(r))
  else if (!records.some(matches)) records.push({ mid: u.mid, reason_id: reason, target_id: target, ctime: ts() })
  return null
}
function recommendationCandidates(c: Ctx) {
  const preferences = (c.db.recommendationFeedback ?? []).filter((r) => r.mid === c.me?.mid)
  const videos = new Set(preferences.filter((r) => r.reason_id === 1).map((r) => r.target_id))
  const authors = new Set(preferences.filter((r) => r.reason_id === 4).map((r) => r.target_id))
  return published(c.db).filter((a) => !videos.has(a.aid) && !authors.has(a.mid))
}
function admin(c: Ctx): User {
  const u = c.method === 'GET' ? login(c) : csrf(c)
  if (u.role !== 'admin') fail(-403, '需要管理员权限')
  return u
}
function log(c: Ctx, action: string, target: string) {
  c.db.logs.unshift({ id: nextID(), mid: c.me?.mid ?? 0, action, target, ctime: ts() })
  c.db.logs.length = Math.min(c.db.logs.length, 500)
}

function cookieValue(name: string) {
  const m = document.cookie.split('; ').find((x) => x.startsWith(name + '='))
  return m ? decodeURIComponent(m.slice(name.length + 1)) : ''
}

function createSession(db: DB, mid: number) {
  const s = { token: rand(10) + '-' + (ts() + 86400 * 180) + '-' + rand(6), csrf: rand(10) + rand(10) + rand(12), access: rand(16) + rand(16), refresh: rand(16) + rand(16), mid, ctime: ts() }
  db.sessions.push(s)
  return s
}
function setCookies(s: { token: string; csrf: string; mid: number }) {
  const age = 'path=/; max-age=' + 86400 * 180
  document.cookie = `SESSDATA=${s.token}; ${age}`
  document.cookie = `bili_jct=${s.csrf}; ${age}`
  document.cookie = `DedeUserID=${s.mid}; ${age}`
}
function cookieInfo(s: { token: string; csrf: string; mid: number }) {
  const exp = ts() + 86400 * 180
  return { cookies: [['SESSDATA', s.token], ['bili_jct', s.csrf], ['DedeUserID', String(s.mid)]].map(([name, value]) => ({ name, value, http_only: name === 'SESSDATA' ? 1 : 0, expires: exp, secure: 0 })), domains: [location.hostname] }
}

const archiveOf = (c: Ctx, key = 'aid') => {
  const a = archiveById(int(c.p[key] ?? c.p.oid ?? c.p.rid ?? c.p.avid))
  if (!a || (a.state !== 0 && a.mid !== c.me?.mid && c.me?.role !== 'admin')) fail(-404, '啥都木有')
  return a!
}
const pageOfCid = (cid: number) => {
  for (const a of getDB().archives) { const p = a.pages.find((x) => x.cid === cid); if (p) return { a, p } }
  for (const s of getDB().seasons) { const e = s.episodes.find((x) => x.cid === cid); if (e) return { s, e } }
  return undefined
}
const visibleRegions = (db: DB) => [...db.regions].filter((r) => r.visible && !r.parent).sort((a, b) => a.sort - b.sort)
const subRegions = (db: DB, tid: number, all = false) => db.regions.filter((r) => r.parent === tid && (all || r.visible)).sort((a, b) => a.sort - b.sort)

function searchMatch(text: string, keyword: string) { return text.toLowerCase().includes(keyword.toLowerCase()) }
const em = (text: string, keyword: string) => (keyword ? text.split(keyword).join(`<em class="keyword">${keyword}</em>`) : text)
function searchVideo(a: Archive, kw: string) {
  return { type: 'video', id: a.aid, aid: a.aid, bvid: a.bvid, title: em(a.title, kw), pic: a.pic, author: owner(a.mid).name, mid: a.mid, upic: owner(a.mid).face, play: a.stat.view, video_review: a.stat.danmaku, favorites: a.stat.favorite, duration: formatDuration(a.pages.reduce((s, p) => s + p.duration, 0)), pubdate: a.pubdate, description: a.desc, tag: a.tag, typename: regionName(a.tid) }
}
function searchUser(u: User) {
  return { type: 'bili_user', mid: u.mid, uname: u.uname, usign: u.sign, upic: userFace(u.mid, u.face), fans: followerCount(u.mid), videos: getDB().archives.filter((a) => a.mid === u.mid && a.state === 0).length, level: u.level }
}

/** `format` is `mp4` for media `<video>` plays; data-source files it cannot play carry their container (`mkv`…) for the libmedia player. */
function playurlPayload(media: string, duration: number, qn: number, format = 'mp4') {
  const qualities = [{ quality: 80, format: 'flv', new_description: '1080P 高清', display_desc: '1080P' }, { quality: 64, format: 'flv720', new_description: '720P 准高清', display_desc: '720P' }, { quality: 32, format: 'flv480', new_description: '480P 标清', display_desc: '480P' }]
  const quality = qualities.find((q) => q.quality <= qn)?.quality ?? 32
  return {
    from: 'local', result: 'suee', quality, format, timelength: duration * 1000, accept_format: 'mp4,mp4720,mp4480',
    accept_description: qualities.map((q) => q.new_description), accept_quality: qualities.map((q) => q.quality), video_codecid: 7,
    durl: [{ order: 1, length: duration * 1000, size: 0, ahead: '', vhead: '', url: media, backup_url: [] }], support_formats: qualities,
  }
}

/** Raster images only (what browsers and JumediaTV's UIImage can decode). */
async function rasterImage(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const at = (o: number, bytes: number[]) => bytes.every((b, i) => head[o + i] === b)
  return at(0, [0x89, 0x50, 0x4e, 0x47]) || at(0, [0xff, 0xd8, 0xff]) || at(0, [0x47, 0x49, 0x46, 0x38]) || (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]))
}

function historyRow(db: DB, h: DB['history'][number]) {
  if (h.epid) {
    const s = db.seasons.find((x) => x.season_id === h.sid)
    const e = s?.episodes.find((x) => x.ep_id === h.epid)
    if (!s || !e) return null
    return { title: s.title, long_title: `第${e.title}话 ${e.long_title}`, cover: e.cover, author_name: '番剧', author_face: '', author_mid: 0, view_at: h.view_at, progress: h.progress, duration: e.duration, badge: seasonBadge(s), kid: s.season_id, uri: `/bangumi/play/ep${e.ep_id}`, history: { oid: e.aid, epid: e.ep_id, bvid: '', cid: e.cid, page: 1, part: e.long_title, business: 'pgc', dt: 2 } }
  }
  const a = archiveById(h.aid)
  if (!a) return null
  const p = a.pages.find((x) => x.cid === h.cid) ?? a.pages[0]
  const o = owner(a.mid)
  return { title: a.title, long_title: '', cover: a.pic, author_name: o.name, author_face: o.face, author_mid: a.mid, view_at: h.view_at, progress: h.progress, duration: p.duration, videos: a.pages.length, badge: '', kid: a.aid, uri: `/video/${a.bvid}`, history: { oid: a.aid, epid: 0, bvid: a.bvid, cid: p.cid, page: a.pages.indexOf(p) + 1, part: p.part, business: 'archive', dt: 2 } }
}

function seasonResult(c: Ctx, s: DB['seasons'][number]) {
  const db = c.db
  const follow = c.me ? db.bangumiFollow.find((f) => f.mid === c.me!.mid && f.season_id === s.season_id) : undefined
  const last = c.me ? db.history.filter((h) => h.mid === c.me!.mid && h.sid === s.season_id).sort((a, b) => b.view_at - a.view_at)[0] : undefined
  return {
    season_id: s.season_id, media_id: s.media_id, season_title: s.title, title: s.title, cover: s.cover, evaluate: s.evaluate, type: s.season_type, total: s.episodes.length,
    areas: s.areas.map((name, i) => ({ id: i + 1, name })), styles: s.styles, rating: { score: s.score, count: Math.floor(s.follow / 30) },
    new_ep: { id: s.episodes.at(-1)?.ep_id, desc: s.is_finish ? `已完结, 全${s.episodes.length}话` : `连载中, 每周${'一二三四五六日'[s.weekday - 1]} ${s.pub_time}更新`, is_new: s.is_finish ? 0 : 1, title: s.episodes.at(-1)?.title },
    publish: { is_finish: s.is_finish ? 1 : 0, pub_time: new Date(s.ctime * 1000).toISOString().slice(0, 10), weekday: s.weekday },
    stat: { views: s.views, favorites: s.follow, danmakus: s.danmakus, coins: Math.floor(s.views / 200), likes: Math.floor(s.views / 40), reply: Math.floor(s.views / 900), share: Math.floor(s.views / 1200), follow: s.follow },
    episodes: s.episodes.map((e, i) => ({ id: e.ep_id, ep_id: e.ep_id, aid: e.aid, cid: e.cid, bvid: av2bv(e.aid), title: e.title, long_title: e.long_title, show_title: s.season_type === 2 ? '正片' : `第${e.title}话 ${e.long_title}`, cover: e.cover, duration: e.duration * 1000, pub_time: e.pub_time, badge: e.badge, index: i + 1, link: `/bangumi/play/ep${e.ep_id}` })),
    section: [], seasons: db.seasons.filter((x) => x.season_type === s.season_type && x.season_id !== s.season_id).slice(0, 6).map((x) => seasonCard(x)),
    up_info: { mid: 1, uname: '聚媒番剧', avatar: owner(1).face, follower: compactCount(followerCount(1)) },
    user_status: { follow: follow ? 1 : 0, follow_status: follow?.status ?? 0, progress: last ? { last_ep_id: last.epid, last_time: last.progress, last_ep_index: s.episodes.find((e) => e.ep_id === last.epid)?.title } : {} },
  }
}

function adminUser(u: User) {
  const { password: _password, ...rest } = u
  void _password
  return { ...rest, face: userFace(u.mid, u.face), archives: getDB().archives.filter((a) => a.mid === u.mid).length, follower: followerCount(u.mid) }
}

function creatorRow(a: Archive) {
  const states: Record<number, string> = { 0: '已通过', [-1]: '审核中', [-2]: '已退回', [-6]: '源已移除', [-20]: '草稿', [-40]: '定时发布', [-100]: '已删除' }
  return {
    Archive: { aid: a.aid, bvid: a.bvid, title: a.title, cover: a.pic, desc: a.desc, tid: a.tid, tname: regionName(a.tid), sub_tid: a.sub_tid ?? 0, tag: a.tag, state: a.state, state_desc: states[a.state] ?? '', reject_reason: a.reason, ptime: a.pubdate, ctime: a.ctime, duration: a.pages.reduce((s, p) => s + p.duration, 0), copyright: a.copyright, source: a.source, dtime: a.dtime ?? 0, no_disturbance: a.no_disturbance ? 1 : 0, no_tv: a.no_tv ? 1 : 0 },
    stat: a.stat, Videos: a.pages.map((p) => ({ cid: p.cid, title: p.part, duration: p.duration, filename: p.media })), chapters: a.chapters,
    season_id: getDB().collections.find((x) => x.kind === 'season' && x.aids.includes(a.aid))?.id ?? 0,
    origin: originJSON(getDB(), a),
  }
}

function dmBytes(db: DB, cid: number, index: number) {
  const found = pageOfCid(cid)
  seedDanmaku(cid, found ? ('p' in found ? found.p!.duration : found.e!.duration) : 24)
  const lo = (index - 1) * 360000, hi = index * 360000
  const w = new Writer()
  for (const d of [...db.danmaku, ...(db.dandanplay?.[cid]?.comments ?? [])].filter((x) => x.cid === cid && x.progress >= lo && x.progress < hi)) {
    w.bytes(1, new Writer().uint(1, d.id).uint(2, d.progress).uint(3, d.mode).uint(4, d.fontsize).uint(5, d.color).string(6, String(d.mid)).string(7, d.content).uint(8, d.ctime).uint(9, d.weight).string(12, String(d.id)).finish())
  }
  return w.finish()
}

function dmView(db: DB, mid?: number) {
  const s = (mid && db.dmConfig[mid]) || {}
  const b = (k: string, d = true) => (s[k] === undefined ? d : s[k] === 'true')
  const area = int(s.dmarea, 50)
  const state = !b('dm_switch') ? 3 : s.dm_switch_state === '2' ? 2 : 1
  const cfg = new Writer().bool(1, b('dm_switch')).bool(2, b('ai_switch', false)).uint(3, int(s.ai_level, 1)).bool(4, b('blocktop')).bool(5, b('blockscroll')).bool(6, b('blockbottom')).bool(7, b('blockcolor'))
    .bool(9, b('preventshade')).bool(10, b('dmask')).float(11, Number(s.opacity ?? 0.8)).uint(12, area).float(13, Number(s.speedplus ?? 1)).float(14, Number(s.fontsize ?? 1))
    .bool(24, b('blocktop') && b('blockbottom')).uint(25, area).uint(28, state)
  return new Writer().uint(1, 1).bytes(10, cfg.finish()).finish()
}


// ---------------- B 方案 additions (not called by Juli) ----------------

const totalSeconds = (a: Archive) => a.pages.reduce((s, p) => s + p.duration, 0)
/** Search `duration`: 0 any, 1 ≤10 min, 2 10–30, 3 30–60, 4 >60. */
function durationIn(sec: number, d: number) {
  const m = sec / 60
  return d === 1 ? m <= 10 : d === 2 ? m > 10 && m <= 30 : d === 3 ? m > 30 && m <= 60 : d === 4 ? m > 60 : true
}
/** Search `order` keys; totalrank (relevance) keeps the match order. */
const ORDER_KEYS: Record<string, ((a: Archive) => number) | undefined> = {
  click: (a) => a.stat.view, pubdate: (a) => a.pubdate, dm: (a) => a.stat.danmaku, stow: (a) => a.stat.favorite, scores: (a) => a.stat.reply,
}
/** `/pgc/season/index/result` area codes, mapped onto stored area names. */
const AREA_CODES: Record<number, string[]> = { 1: ['中国大陆'], 2: ['日本'], 3: ['美国'], 4: ['英国'], 6: ['中国香港', '中国台湾'], 8: ['韩国'], 9: ['法国'], 10: ['泰国'], 13: ['西班牙'], 15: ['德国'] }
const seasonYear = (s: DB['seasons'][number]) => new Date(s.ctime * 1000).getFullYear()
/** Style ids of one season type: 1-based positions in the sorted style list (what `/pgc/season/index/condition` lists). */
const stylesOf = (db: DB, type: number) => [...new Set(db.seasons.filter((s) => s.state === 0 && s.season_type === type).flatMap((s) => s.styles))].sort((a, b) => a.localeCompare(b, 'zh'))
const multi = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== '-1')
/** `[2010,2020)` range or a single year. */
function yearIn(v: string, y: number) {
  const m = /^\[(\d{4}),(\d{4})\)$/.exec(v)
  return m ? y >= Number(m[1]) && y < Number(m[2]) : y === Number(v)
}
/** Optional filters of `/pgc/season/index/result` (Juli sends none of them). */
function indexFilter(c: Ctx, s: DB['seasons'][number]) {
  const areas = multi(c.p.area).flatMap((x) => AREA_CODES[Number(x)] ?? ['—'])
  if (areas.length && !s.areas.some((a) => areas.includes(a))) return false
  const styles = multi(c.p.style_id).map((x) => stylesOf(c.db, s.season_type)[Number(x) - 1])
  if (styles.length && !s.styles.some((x) => styles.includes(x))) return false
  const year = c.p.year && c.p.year !== '-1' ? c.p.year : c.p.release_date && c.p.release_date !== '-1' ? c.p.release_date : ''
  if (year && !yearIn(year, seasonYear(s))) return false
  if (multi(c.p.is_finish).length && !multi(c.p.is_finish).includes(s.is_finish ? '1' : '0')) return false
  if (multi(c.p.copyright).length && !multi(c.p.copyright).includes(String(s.copyright === 3 ? 3 : 1))) return false
  // Every Jumedia title is free: season_status 1 matches all, paid / member-only (2, 4, 6) match none.
  if (multi(c.p.season_status).length && !multi(c.p.season_status).includes('1')) return false
  return true
}
const replyOrder = (mode: number) => (a: DB['replies'][number], b: DB['replies'][number]) => (mode === 2 ? b.ctime - a.ctime : b.likers.length - a.likers.length || b.ctime - a.ctime)
const reportReasons: Record<string, string> = { 9: '违法违规', 2: '色情', 10: '低俗', 12: '赌博诈骗', 23: '违法信息外链', 19: '涉政谣言', 22: '虚假不实信息', 20: '涉社会事件谣言', 7: '人身攻击', 15: '侵犯隐私', 1: '垃圾广告', 4: '引战', 5: '剧透', 3: '刷屏', 8: '视频不相关', 18: '违规抽奖', 17: '青少年不良信息', 0: '其他' }
const pendingReports = (db: DB, rpid: number) => (db.commentReports ?? []).filter((r) => r.rpid === rpid && r.status === 'pending').map((r) => ({ ...r, reason: (reportReasons[r.reason] ?? r.reason) + (r.content ? `：${r.content}` : '') }))
/** Deterministic "watching now" for a video: scales with plays, shifts every minute. */
const watching = (aid: number, view: number) => Math.max(1, Math.round(view / 4000 + ((aid * 7 + Math.floor(Date.now() / 60000)) % 23)))
const regionArcs = (db: DB, rid: number) => {
  const r = db.regions.find((x) => x.tid === rid)
  return published(db).filter((a) => (r?.parent ? a.sub_tid === rid : a.tid === rid))
}
const hashTag = (name: string) => [...name].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7) % 1000000
const LOG_KINDS: Record<string, RegExp | undefined> = { archive: /稿件|投稿|审核|番剧|合集|评论|弹幕/, user: /用户|封禁|登录|密码|资料/, live: /直播|转码|分区/, datasource: /数据源|元信息|图片缓存/, settings: /设置|轮播|重置|初始化/ }
const localDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000) }


// ---------------- 粉丝勋章 / 每周必看 ----------------

/** Cumulative intimacy needed to reach each level (index = level - 1). */
const MEDAL_LEVELS = [0, 100, 200, 300, 500, 700, 1000, 1300, 1600, 2000, 2500, 3000, 4000, 5000, 6500, 8000, 10000, 13000, 16000, 20000]
const medalLevel = (intimacy: number) => MEDAL_LEVELS.filter((n) => intimacy >= n).length
const medalColor = (lv: number) => (lv >= 17 ? 0xc79d24 : lv >= 13 ? 0xbe6686 : lv >= 9 ? 0x8d7ca6 : lv >= 5 ? 0x5d7b9e : 0x5c968e)
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
/** Medal name: the anchor's first two characters + 团. */
const medalName = (ruid: number) => `${[...(userById(ruid)?.uname ?? '主播')].slice(0, 2).join('')}团`
const todayKey = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() }
/** After 30 days without chatting in the anchor's room a medal loses 20 intimacy a day (never below 0). */
const MEDAL_IDLE_DAYS = 30, MEDAL_DECAY = 20
const keyStart = (k: number) => new Date(Math.floor(k / 10000), (Math.floor(k / 100) % 100) - 1, k % 100).getTime() / 1000
function medalIntimacy(m: DB['fanMedals'][number]) {
  const idle = Math.floor((ts() - (m.day ? keyStart(m.day) : m.ctime)) / 86400) - MEDAL_IDLE_DAYS
  return idle > 0 ? Math.max(0, m.intimacy - idle * MEDAL_DECAY) : m.intimacy
}
function medalJSON(m: DB['fanMedals'][number]) {
  const intimacy = medalIntimacy(m)
  const level = medalLevel(intimacy)
  const today = m.day === todayKey() ? m.today : 0
  return {
    medal_id: m.medal_id, uid: m.mid, target_id: m.ruid, medal_name: medalName(m.ruid), level, intimacy: intimacy - MEDAL_LEVELS[level - 1],
    next_intimacy: (MEDAL_LEVELS[level] ?? MEDAL_LEVELS[level - 1] + 5000) - MEDAL_LEVELS[level - 1], today_feed: today, day_limit: 100, wearing_status: m.wearing ? 1 : 0, is_lighted: 1,
    medal_color: medalColor(level), medal_color_start: medalColor(level), medal_color_end: medalColor(level), medal_color_border: medalColor(level), guard_level: 0, total_intimacy: intimacy,
  }
}
/** The medal a viewer wears, in the shape Juli reads from chat (`user.medal`). */
function wornMedal(db: DB, mid: number) {
  const m = db.fanMedals.find((x) => x.mid === mid && x.wearing)
  if (!m) return undefined
  const level = medalLevel(medalIntimacy(m))
  return { name: medalName(m.ruid), level, ruid: m.ruid, color_start: medalColor(level), color_end: medalColor(level), color_border: medalColor(level), v2_medal_color_start: hex(medalColor(level)), v2_medal_color_text: hex(medalColor(level)), guard_level: 0, is_light: 1 }
}
/** Chatting in an anchor's room grows the medal by 5, up to 100 a day. */
function feedMedal(db: DB, mid: number, ruid: number) {
  const m = db.fanMedals.find((x) => x.mid === mid && x.ruid === ruid)
  if (!m) return
  const day = todayKey()
  if (m.day !== day) { m.intimacy = medalIntimacy(m); m.day = day; m.today = 0 }
  const add = Math.min(5, 100 - m.today)
  if (add > 0) { m.today += add; m.intimacy += add }
}

/** Weekly picks: issue 1 starts on the first Friday of 2026; a new issue every Friday 18:00. */
const WEEKLY_EPOCH = Math.floor(new Date(2026, 0, 2, 18).getTime() / 1000)
const weeklyCurrent = () => Math.max(1, Math.floor((ts() - WEEKLY_EPOCH) / (7 * 86400)) + 1)
const WEEKLY_SUBJECTS = ['秋天的第一场追剧马拉松', '名场面放映室', '这周的快乐来自综艺', '老番新看', '下饭视频大赏', '幕后与彩蛋', '值得二刷的剧集', '周末宅家片单']
const WEEKLY_REASONS = ['本周最多人看完', '编辑推荐', '百万播放', '老番新看', '综艺幕后', '下饭必备', '名场面', '幕后揭秘', '二刷必看', '高分好评']
function weeklyIssue(db: DB, number: number) {
  const stime = WEEKLY_EPOCH + (number - 1) * 7 * 86400 - 7 * 86400, etime = stime + 7 * 86400
  const pool = published(db).sort((a, b) => b.stat.view + b.stat.like * 10 - (a.stat.view + a.stat.like * 10))
  const offset = (number * 3) % Math.max(1, pool.length)
  const picks = [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, 12)
  const d = new Date(etime * 1000)
  return {
    config: { id: number, type: 'weekly_selected', number, subject: WEEKLY_SUBJECTS[number % WEEKLY_SUBJECTS.length], label: `第${number}期`, name: `${d.getFullYear()}第${number}期`, stime, etime, status: 2, share_title: `每周必看 · 第${number}期`, share_subtitle: '' },
    reminder: '每周五 18:00 更新',
    list: picks.map((a, i) => arcView(a, { rcmd_reason: WEEKLY_REASONS[(a.aid + i) % WEEKLY_REASONS.length] })),
  }
}

const routes: Record<string, Handler> = {
  // ---------------- passport ----------------
  '/login/exit/v2': (c) => {
    const u = csrf(c)
    c.db.sessions = c.db.sessions.filter((s) => s.mid !== u.mid || s.token !== cookieValue('SESSDATA'))
    for (const k of ['SESSDATA', 'bili_jct', 'DedeUserID']) document.cookie = `${k}=; path=/; max-age=0`
    return { __root: { code: 0, status: true, ts: ts(), data: { redirectUrl: '/' } } }
  },
  '/x/passport-tv-login/qrcode/auth_code': (c) => {
    const code = rand(16) + rand(16)
    c.db.qrcodes.push({ code, status: 'pending', mid: 0, ctime: ts() })
    return { url: `${c.origin}/tv-login?auth_code=${code}`, auth_code: code }
  },
  '/x/passport-tv-login/qrcode/poll': (c) => {
    const q = c.db.qrcodes.find((x) => x.code === c.p.auth_code)
    if (!q || ts() - q.ctime > 180) fail(86038, '二维码已失效')
    if (q!.status === 'pending') fail(86039, '二维码尚未确认')
    if (q!.status === 'scanned') fail(86090, '二维码已扫码未确认')
    const s = createSession(c.db, q!.mid)
    c.db.qrcodes = c.db.qrcodes.filter((x) => x !== q)
    return { mid: s.mid, access_token: s.access, refresh_token: s.refresh, expires_in: 86400 * 180, token_info: { mid: s.mid, access_token: s.access, refresh_token: s.refresh, expires_in: 86400 * 180 }, cookie_info: cookieInfo(s) }
  },
  '/api/v2/oauth2/refresh_token': (c) => {
    const old = c.db.sessions.find((s) => s.refresh === c.p.refresh_token)
    if (!old) fail(-101, '刷新令牌无效')
    c.db.sessions = c.db.sessions.filter((s) => s !== old)
    const s = createSession(c.db, old!.mid)
    return { token_info: { mid: s.mid, access_token: s.access, refresh_token: s.refresh, expires_in: 86400 * 180 }, cookie_info: cookieInfo(s) }
  },
  '/x/passport-login/web/login': (c) => {
    const u = c.db.users.find((x) => x.username === c.p.username.trim() || x.email === c.p.username.trim())
    if (!u || u.password !== c.p.password) fail(-629, '账号或密码错误')
    if (u!.status !== 0) fail(-403, '账号已被封禁，请联系管理员')
    const s = createSession(c.db, u!.mid)
    setCookies(s)
    localStorage.setItem('jumedia.access_key', s.access)
    log({ ...c, me: u }, '登录', u!.uname)
    return { mid: u!.mid, status: 0, message: '', url: '/', refresh_token: s.refresh }
  },
  '/x/passport-login/web/register': (c) => {
    if (!c.db.settings.allowRegister) fail(-403, '当前暂停开放注册')
    const username = (c.p.username ?? '').trim(), uname = (c.p.uname ?? '').trim()
    if (!/^[a-zA-Z0-9_]{4,20}$/.test(username)) fail(-400, '用户名需为 4–20 位字母、数字或下划线')
    if ((c.p.password ?? '').length < 6) fail(-400, '密码至少 6 位')
    if (!uname || uname.length > 16) fail(-400, '昵称需为 1–16 个字符')
    if (c.db.users.some((u) => u.username === username)) fail(-400, '用户名已被占用')
    if (c.db.users.some((u) => u.uname === uname)) fail(-400, '昵称已被占用')
    const mid = Math.max(...c.db.users.map((u) => u.mid)) + 1
    const u: User = { mid, username, password: c.p.password, uname, face: avatarURL(mid), sign: '', sex: '保密', birthday: '', email: c.p.email ?? '', level: 1, exp: 0, coins: 10, role: 'user', status: 0, ctime: ts(), top_photo: '', vip: 0 }
    c.db.users.push(u)
    c.db.favFolders.push({ id: nextID(), mid, title: '默认收藏夹', intro: '', privacy: 0, ctime: ts(), attr: 0, items: [] })
    const s = createSession(c.db, mid)
    setCookies(s)
    localStorage.setItem('jumedia.access_key', s.access)
    log({ ...c, me: u }, '注册', uname)
    return { mid }
  },
  '/x/passport-tv-login/h5/qrcode/scan': (c) => {
    login(c)
    const q = c.db.qrcodes.find((x) => x.code === c.p.auth_code)
    if (!q || ts() - q.ctime > 180) fail(86038, '二维码已失效')
    if (q!.status === 'pending') q!.status = 'scanned'
    return null
  },
  '/x/passport-tv-login/h5/qrcode/confirm': (c) => {
    const u = csrf(c)
    const q = c.db.qrcodes.find((x) => x.code === c.p.auth_code)
    if (!q || ts() - q.ctime > 180) fail(86038, '二维码已失效')
    q!.status = 'confirmed'; q!.mid = u.mid
    log(c, 'TV 扫码登录', u.uname)
    return null
  },
  '/x/passport-login/web/password/update': (c) => {
    const u = csrf(c)
    if (u.password !== c.p.old_password) fail(-400, '原密码错误')
    if ((c.p.new_password ?? '').length < 6) fail(-400, '新密码至少 6 位')
    u.password = c.p.new_password
    return null
  },

  // ---------------- 首页 ----------------
  '/x/web-interface/nav': (c) => {
    const wbi_img = { img_url: `${c.origin}/bfs/wbi/7cd084941338484aae1ad9425b84077c.png`, sub_url: `${c.origin}/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png` }
    if (!c.me) fail(-101, '账号未登录', { isLogin: false, wbi_img })
    const u = c.me!
    return { isLogin: true, mid: u.mid, uname: u.uname, face: userFace(u.mid, u.face), level_info: levelInfo(u), money: u.coins, moral: 70, email_verified: 1, mobile_verified: 0, vipStatus: u.vip, vipType: u.vip ? 2 : 0, vip_label: { text: u.vip ? '年度大会员' : '' }, official: { type: -1 }, wbi_img, role: u.role, sign: u.sign }
  },
  '/x/v2/feed/index': (c) => {
    const idx = int(c.p.idx)
    // The TV home feed: archives whose uploader turned off TV recommendation are left out.
    const list = recommendationCandidates(c).filter((a) => !a.no_tv)
    const mixed = [...list].sort((a, b) => ((a.aid * 2654435761 + idx) % 1000) - ((b.aid * 2654435761 + idx) % 1000))
    const items = Array.from({ length: mixed.length ? 20 : 0 }, (_, i) => mixed[(idx + i) % mixed.length]).map(feedCard)
    if (c.me) {
      const follows = new Set(c.db.relations.filter((r) => r.mid === c.me!.mid).map((r) => r.fid))
      for (const it of items) if (follows.has(it.args.up_id)) Object.assign(it, { rcmd_reason: { content: '已关注' } })
    }
    return { items, config: { column: 4 } }
  },
  '/x/feed/dislike': (c) => recommendationFeedback(c, false, true),
  // The web home feed; unlike `/x/v2/feed/index` it includes every published archive.
  '/x/web-interface/wbi/index/top/feed/rcmd': (c) => {
    const idx = Math.max(0, int(c.p.fresh_idx, 1) - 1) * int(c.p.ps, 12), ps = int(c.p.ps, 12)
    const list = recommendationCandidates(c)
    const mixed = [...list].sort((a, b) => ((a.aid * 2654435761 + idx) % 1000) - ((b.aid * 2654435761 + idx) % 1000))
    const item = Array.from({ length: Math.min(ps, mixed.length) }, (_, i) => mixed[(idx + i) % mixed.length]).map((a) => ({ ...arcView(a), id: a.aid, goto: 'av', uri: `/video/${a.bvid}`, dislike_switch: !!c.me, is_followed: !!c.me && c.db.relations.some((r) => r.mid === c.me!.mid && r.fid === a.mid) ? 1 : 0 }))
    return { item, mid: c.me?.mid ?? 0 }
  },
  '/x/web-interface/popular': (c) => {
    const list = [...published(c.db)].sort((a, b) => b.stat.view - a.stat.view)
    const pn = int(c.p.pn, 1), ps = int(c.p.ps, 20)
    return { list: page(list, pn, ps).map((a) => arcView(a, { rcmd_reason: { content: a.stat.view > 500000 ? '百万播放' : '' } })), no_more: pn * ps >= list.length }
  },
  '/x/web-interface/ranking/v2': (c) => {
    const rid = int(c.p.rid)
    const list = published(c.db).filter((a) => !rid || a.tid === rid).map((a) => ({ a, score: a.stat.view + a.stat.like * 10 + a.stat.coin * 20 })).sort((x, y) => y.score - x.score).slice(0, 100)
    return { note: '根据稿件内容质量、近期的数据综合展示，动态更新', list: list.map(({ a, score }) => arcView(a, { score })) }
  },
  // Legacy partition ranking (Juli's 资讯榜 sends rid=51). Legacy rids map onto Jumedia
  // regions; a Jumedia tid is accepted as-is. Videos published within `day` days rank first.
  '/x/web-interface/ranking/region': (c) => {
    const rid = int(c.p.rid), day = int(c.p.day, 3)
    const tids = LEGACY_RIDS[rid] ?? (c.db.regions.some((r) => r.tid === rid) ? [rid] : [])
    const since = ts() - day * 86400
    const score = (a: Archive) => a.stat.view + a.stat.like * 10 + a.stat.coin * 20
    const list = published(c.db).filter((a) => tids.includes(a.tid)).sort((x, y) => Number(y.pubdate >= since) - Number(x.pubdate >= since) || score(y) - score(x)).slice(0, 100)
    return list.map((a) => ({
      aid: a.aid, bvid: a.bvid, typename: regionName(a.tid), title: a.title, subtitle: '', play: a.stat.view, review: a.stat.reply, video_review: a.stat.danmaku, favorites: a.stat.favorite,
      mid: a.mid, author: owner(a.mid).name, description: a.desc, create: new Date(a.pubdate * 1000).toISOString().replace('T', ' ').slice(0, 16), pic: a.pic, coins: a.stat.coin,
      duration: formatDuration(a.pages.reduce((s, p) => s + p.duration, 0)), badgepay: false, pts: score(a),
    }))
  },
  '/x/web-interface/feedback/dislike': (c) => recommendationFeedback(c),
  '/x/web-interface/feedback/dislike/cancel': (c) => recommendationFeedback(c, true),
  // `children` (sub-regions) is a Jumedia extension; Juli reads only tid/name/id.
  '/x/web-interface/region/list': (c) => visibleRegions(c.db).map((r) => ({ tid: r.tid, name: r.name, id: r.tid, children: subRegions(c.db, r.tid).map((x) => ({ tid: x.tid, name: x.name, id: x.tid })) })),
  '/pgc/web/rank/list': (c) => ({ __result: { list: c.db.seasons.filter((s) => s.state === 0 && s.season_type === int(c.p.season_type, 1)).sort((a, b) => b.views - a.views).map((s, i) => seasonCard(s, { rank: i + 1 })), note: '根据播放、追番、互动数据综合计算' } }),
  '/x/web-interface/region/feed/rcmd': (c) => {
    const rid = int(c.p.from_region)
    const list = published(c.db).filter((a) => a.tid === rid).sort((a, b) => b.pubdate - a.pubdate)
    const items = page(list, int(c.p.display_id, 1), int(c.p.request_cnt, 15))
    if (!items.length) fail(62013, '没有更多了')
    return { archives: items.map((a) => arcView(a)) }
  },
  '/pgc/page/web/v3/feed': (c) => pgcFeed(c),
  '/pgc/page/web/feed': (c) => pgcFeed(c),
  '/pgc/page/web/v3': (c) => {
    const type = c.p.name === 'guochuang' ? 4 : 1
    const banners = c.db.banners.filter((b) => b.position === 'anime').sort((a, b) => a.sort - b.sort)
    const follows = c.me ? c.db.bangumiFollow.filter((f) => f.mid === c.me!.mid) : []
    return {
      modules: [
        { style: 'web_banner_v3', title: '', items: banners.map((b) => { const s = c.db.seasons.find((x) => x.season_id === b.season_id); return { season_id: b.season_id ?? 0, title: b.title, cover: b.img, big_cover: b.img, play_title: s ? indexShow(s) : '', evaluate: s?.evaluate ?? '', link: b.url } }) },
        { style: 'web_follow_v3', title: '我的追番', items: follows.map((f) => { const s = c.db.seasons.find((x) => x.season_id === f.season_id)!; return { follow_item_type: 'user', season_id: f.season_id, title: s?.title, cover: s?.cover, progress: '尚未观看', link: `/bangumi/play/ss${f.season_id}` } }) },
        { style: 'web_feed_v3', title: '猜你喜欢', ...pgcFeed({ ...c, p: { name: type === 4 ? 'guochuang' : 'anime', coursor: '0' } }) },
      ],
    }
  },
  '/x/polymer/web-dynamic/v1/feed/all': (c) => {
    const u = login(c)
    const follows = new Set(c.db.relations.filter((r) => r.mid === u.mid).map((r) => r.fid))
    const list = published(c.db).filter((a) => follows.has(a.mid) && !a.no_disturbance).sort((a, b) => b.pubdate - a.pubdate)
    const offset = int(c.p.offset)
    const items = list.slice(offset, offset + 12).map((a) => {
      const o = owner(a.mid)
      return {
        id_str: String(a.aid * 31), type: 'DYNAMIC_TYPE_AV', visible: true,
        modules: {
          module_author: { mid: a.mid, name: o.name, face: o.face, pub_ts: a.pubdate, pub_time: '', pub_action: '投稿了视频', jump_url: `/space/${a.mid}` },
          module_dynamic: { desc: { text: a.desc }, major: { type: 'MAJOR_TYPE_ARCHIVE', archive: { aid: String(a.aid), bvid: a.bvid, title: a.title, cover: a.pic, desc: a.desc, duration_text: formatDuration(a.pages.reduce((s, p) => s + p.duration, 0)), stat: { play: compactCount(a.stat.view), danmaku: compactCount(a.stat.danmaku) }, jump_url: `/video/${a.bvid}` } } },
          module_stat: { comment: { count: a.stat.reply }, like: { count: a.stat.like }, forward: { count: a.stat.share } },
        },
      }
    })
    return { items, offset: String(offset + items.length), has_more: offset + items.length < list.length, update_num: 0 }
  },

  // ---------------- 搜索 ----------------
  '/x/web-interface/search/all/v2': (c) => {
    const kw = (c.p.keyword ?? '').trim()
    const videos = published(c.db).filter((a) => searchMatch(a.title + a.desc + a.tag, kw))
    const seasons = c.db.seasons.filter((s) => s.state === 0 && searchMatch(s.title + s.styles.join(''), kw))
    const rooms = c.db.rooms.filter((r) => !r.banned && searchMatch(r.title + owner(r.uid).name, kw))
    const users = c.db.users.filter((u) => u.status === 0 && searchMatch(u.uname, kw))
    return {
      seid: rand(12), page: 1, pagesize: 20, numResults: videos.length, numPages: Math.ceil(videos.length / 20),
      top_tlist: { video: videos.length, media_bangumi: seasons.filter((s) => [1, 4].includes(s.season_type)).length, media_ft: seasons.filter((s) => ![1, 4].includes(s.season_type)).length, live_room: rooms.length, bili_user: users.length },
      result: [
        { result_type: 'media_bangumi', data: seasons.filter((s) => [1, 4].includes(s.season_type)).map((s) => seasonCard(s, { title: em(s.title, kw) })) },
        { result_type: 'media_ft', data: seasons.filter((s) => ![1, 4].includes(s.season_type)).map((s) => seasonCard(s, { title: em(s.title, kw) })) },
        { result_type: 'bili_user', data: users.slice(0, 1).map(searchUser) },
        { result_type: 'live_room', data: rooms.slice(0, 4).map(roomCard) },
        { result_type: 'video', data: videos.slice(0, 20).map((a) => searchVideo(a, kw)) },
      ],
    }
  },
  '/x/web-interface/wbi/search/type': (c) => {
    const kw = (c.p.keyword ?? '').trim(), type = c.p.search_type, pn = int(c.p.page, 1), ps = int(c.p.page_size, 20)
    let rows: unknown[] = []
    if (type === 'video') {
      // Optional (Juli sends none): order totalrank|click|pubdate|dm|stow|scores, duration 0–4, tids (top-level region).
      const tids = int(c.p.tids), dur = int(c.p.duration)
      const arcs = published(c.db).filter((a) => searchMatch(a.title + a.desc + a.tag, kw) && (!tids || a.tid === tids) && durationIn(totalSeconds(a), dur))
      const key = ORDER_KEYS[c.p.order ?? '']
      if (key) arcs.sort((x, y) => key(y) - key(x))
      rows = arcs.map((a) => searchVideo(a, kw))
    }
    else if (type === 'media_bangumi' || type === 'media_ft') rows = c.db.seasons.filter((s) => s.state === 0 && ([1, 4].includes(s.season_type) === (type === 'media_bangumi')) && searchMatch(s.title, kw)).map((s) => seasonCard(s, { title: em(s.title, kw) }))
    else if (type === 'live_room') rows = c.db.rooms.filter((r) => !r.banned && searchMatch(r.title + owner(r.uid).name, kw)).map(roomCard)
    else if (type === 'bili_user') rows = c.db.users.filter((u) => u.status === 0 && searchMatch(u.uname + u.sign, kw)).map(searchUser)
    const numPages = Math.max(1, Math.ceil(rows.length / ps))
    const result = page(rows, pn, ps)
    return type === 'live_room'
      ? { page: pn, pagesize: ps, numResults: rows.length, numPages, result: { live_room: result }, pageinfo: { live_room: { numResults: rows.length, numPages } } }
      : { page: pn, pagesize: ps, numResults: rows.length, numPages, result }
  },
  '/x/web-interface/suggest': (c) => {
    const kw = (c.p.term ?? '').trim()
    if (!kw) return { __root: { code: 0, result: { tag: [] } } }
    const pool = [...published(c.db).map((a) => a.title), ...c.db.seasons.map((s) => s.title), ...c.db.users.map((u) => u.uname)]
    return { __root: { code: 0, result: { tag: pool.filter((t) => searchMatch(t, kw)).slice(0, 10).map((t, i) => ({ value: t, term: t, ref: i, name: em(t, kw), spid: 0 })) } } }
  },

  // ---------------- 视频 ----------------
  '/x/web-interface/view': (c) => arcView(c.p.bvid ? archiveOf({ ...c, p: { aid: String(bv2av(c.p.bvid)) } }) : archiveOf(c)),
  '/x/web-interface/view/detail': (c) => {
    const a = archiveOf(c)
    const u = userById(a.mid)!
    const related = published(c.db).filter((x) => x.aid !== a.aid).sort((x, y) => (x.tid === a.tid ? -1 : 0) - (y.tid === a.tid ? -1 : 0) || y.stat.view - x.stat.view).slice(0, 12)
    const following = !!c.me && c.db.relations.some((r) => r.mid === c.me!.mid && r.fid === a.mid)
    return {
      View: arcView(a), Card: { card: { mid: String(u.mid), name: u.uname, face: userFace(u.mid, u.face), sign: u.sign, fans: followerCount(u.mid), attention: followingCount(u.mid), level_info: levelInfo(u) }, following, archive_count: c.db.archives.filter((x) => x.mid === u.mid && x.state === 0).length, follower: followerCount(u.mid), like_num: 0 },
      Tags: a.tag.split(',').filter(Boolean).map((t, i) => ({ tag_id: i + 1, tag_name: t })), Related: related.map((x) => arcView(x)),
    }
  },
  '/x/player/wbi/v2': (c) => {
    const aid = int(c.p.aid), cid = int(c.p.cid)
    const a = archiveById(aid)
    const h = c.me ? c.db.history.find((x) => x.mid === c.me!.mid && x.aid === aid) : undefined
    return {
      aid, bvid: a?.bvid ?? '', cid, login_mid: c.me?.mid ?? 0, online_count: 1 + (cid % 97), last_play_time: h && h.progress > 0 ? h.progress * 1000 : 0, last_play_cid: h?.cid ?? 0,
      subtitle: { allow_submit: false, subtitles: (a?.subtitles ?? []).map((s, i) => ({ id: aid * 10 + i, id_str: String(aid * 10 + i), lan: s.lan, lan_doc: s.lan_doc, subtitle_url: `${c.origin}/bfs/subtitle/${aid}-${i}.json`, type: 0 })) },
      view_points: a ? a.chapters.map((ch) => ({ type: 2, from: ch.from, to: ch.to, content: ch.content, imgUrl: a.pic })) : episodePoints(c.db, cid),
    }
  },
  '/x/player/videoshot': () => ({ pvdata: '', img_x_len: 0, img_y_len: 0, img_x_size: 0, img_y_size: 0, image: [], index: [] }),
  '/x/player/wbi/playurl': async (c) => {
    const found = pageOfCid(int(c.p.cid))
    if (!found || !('p' in found) || !found.p) return fail(-404, '视频不存在')
    if (!c.db.settings.allowGuestPlay && !c.me) fail(-101, '请登录后观看')
    if (found.a!.state === 0) found.a!.stat.view += 1
    return playurlPayload(await resolveMedia(found.p.media), found.p.duration, int(c.p.qn, 80), mediaFormat(found.p.media))
  },
  '/pgc/player/web/playurl': async (c) => {
    const s = c.db.seasons.find((x) => x.episodes.some((e) => e.ep_id === int(c.p.ep_id)))
    const e = s?.episodes.find((x) => x.ep_id === int(c.p.ep_id))
    if (!s || !e) return fail(-404, '剧集不存在')
    s.views += 1
    // The opening for 跳过片头 goes in `clip_info_list` (seconds).
    const clip_info_list = e.op ? [{ start: e.op[0], end: e.op[1], clipType: 'CLIP_TYPE_OP', toastText: '即将跳过片头' }] : []
    return { __result: { ...playurlPayload(await resolveMedia(e.media), e.duration, int(c.p.qn, 80)), clip_info_list } }
  },
  '/x/click-interface/web/heartbeat': (c) => {
    const u = csrf(c)
    if (c.db.historyPaused.includes(u.mid)) return null
    const aid = int(c.p.aid), cid = int(c.p.cid), epid = int(c.p.epid) || undefined
    c.db.history = c.db.history.filter((h) => !(h.mid === u.mid && h.aid === aid))
    c.db.history.unshift({ mid: u.mid, aid, cid, epid, sid: int(c.p.sid) || undefined, view_at: ts(), progress: int(c.p.played_time) })
    return null
  },

  // ---------------- 互动 ----------------
  '/x/web-interface/archive/has/like': (c) => (c.me && c.db.likes.some((l) => l.mid === c.me!.mid && l.aid === int(c.p.aid)) ? 1 : 0),
  '/x/web-interface/archive/like': (c) => {
    const u = csrf(c), a = archiveOf(c)
    const has = c.db.likes.some((l) => l.mid === u.mid && l.aid === a.aid)
    if (c.p.like === '1' && !has) { c.db.likes.push({ mid: u.mid, aid: a.aid }); a.stat.like++ }
    if (c.p.like === '2' && has) { c.db.likes = c.db.likes.filter((l) => !(l.mid === u.mid && l.aid === a.aid)); a.stat.like-- }
    return null
  },
  '/x/v2/view/dislike': (c) => {
    const u = login(c), aid = int(c.p.aid)
    c.db.dislikes = c.db.dislikes.filter((d) => !(d.mid === u.mid && d.aid === aid))
    if (c.p.dislike === '0') c.db.dislikes.push({ mid: u.mid, aid })
    return null
  },
  '/x/web-interface/coin/add': (c) => {
    const u = csrf(c), a = archiveOf(c), n = int(c.p.multiply, 1)
    if (a.mid === u.mid) fail(34002, '不能给自己投币哦')
    const given = c.db.coins.filter((x) => x.mid === u.mid && x.aid === a.aid).reduce((s, x) => s + x.n, 0)
    if (given + n > 2) fail(34005, '超过投币上限啦')
    if (u.coins < n) fail(-104, '硬币不足')
    u.coins -= n; a.stat.coin += n
    c.db.coins.push({ mid: u.mid, aid: a.aid, n })
    const owner = userById(a.mid); if (owner) owner.coins += n / 10
    if (c.p.select_like === '1' && !c.db.likes.some((l) => l.mid === u.mid && l.aid === a.aid)) { c.db.likes.push({ mid: u.mid, aid: a.aid }); a.stat.like++ }
    return { like: c.p.select_like === '1' }
  },
  '/x/v2/fav/video/favoured': (c) => ({ count: 1, favoured: !!c.me && c.db.favFolders.some((f) => f.mid === c.me!.mid && f.items.some((i) => i.aid === int(c.p.aid))) }),
  '/x/v3/fav/resource/deal': (c) => {
    const u = csrf(c), a = archiveOf({ ...c, p: { aid: c.p.rid } })
    for (const id of (c.p.add_media_ids ?? '').split(',').filter(Boolean)) {
      const f = c.db.favFolders.find((x) => x.id === int(id) && x.mid === u.mid)
      if (f && !f.items.some((i) => i.aid === a.aid)) { f.items.unshift({ aid: a.aid, mtime: ts() }); a.stat.favorite++ }
    }
    for (const id of (c.p.del_media_ids ?? '').split(',').filter(Boolean)) {
      const f = c.db.favFolders.find((x) => x.id === int(id) && x.mid === u.mid)
      if (f && f.items.some((i) => i.aid === a.aid)) { f.items = f.items.filter((i) => i.aid !== a.aid); a.stat.favorite-- }
    }
    return { prompt: false }
  },
  '/x/web-interface/share/add': (c) => { const a = archiveOf(c); a.stat.share++; return { share_url: `${c.origin}/video/${a.bvid}`, count: a.stat.share } },
  '/x/relation/modify': (c) => {
    const u = csrf(c), fid = int(c.p.fid)
    if (fid === u.mid) fail(22001, c.p.act === '5' || c.p.act === '6' ? '不能拉黑自己' : '不能关注自己')
    if (!userById(fid)) fail(22003, '用户不存在')
    if (c.p.act === '5' || c.p.act === '6') {
      if (c.method !== 'POST') fail(-400, '请使用 POST')
      c.db.userBlocks = (c.db.userBlocks ?? []).filter((b) => b.mid !== u.mid || b.fid !== fid)
      if (c.p.act === '5') {
        c.db.userBlocks.push({ mid: u.mid, fid, ctime: ts() })
        c.db.relations = c.db.relations.filter((r) => r.mid !== u.mid || r.fid !== fid)
      }
      return null
    }
    if (c.p.act === '1' && (c.db.userBlocks ?? []).some((b) => b.mid === u.mid && b.fid === fid)) fail(-403, '请先解除拉黑')
    c.db.relations = c.db.relations.filter((r) => !(r.mid === u.mid && r.fid === fid))
    if (c.p.act === '1') c.db.relations.push({ mid: u.mid, fid, mtime: ts() })
    return null
  },

  // ---------------- 评论 ----------------
  '/x/v2/reply/report': (c) => {
    const u = csrf(c)
    if (c.method !== 'POST') fail(-400, '请使用 POST')
    if (c.p.type !== '1') fail(-400, '评论区类型无效')
    const r = c.db.replies.find((r) => r.rpid === int(c.p.rpid) && r.oid === int(c.p.oid))
    if (!r) fail(12022, '评论已被删除')
    if (!reportReasons[c.p.reason]) fail(-400, '请选择举报原因')
    const content = (c.p.content ?? '').trim()
    if (content.length > 1000 || (['0', '22'].includes(c.p.reason) && !content)) fail(-400, '请填写举报说明（1–1000 字）')
    if (r!.mid === u.mid) fail(-400, '不能举报自己的评论')
    const reports = c.db.commentReports ??= []
    if (!reports.some((x) => x.mid === u.mid && x.rpid === r!.rpid)) reports.push({ mid: u.mid, rpid: r!.rpid, reason: c.p.reason, content, status: 'pending', ctime: ts() })
    if (truthy(c.p.add_blacklist) && !(c.db.userBlocks ?? []).some((b) => b.mid === u.mid && b.fid === r!.mid)) {
      (c.db.userBlocks ??= []).push({ mid: u.mid, fid: r!.mid, ctime: ts() })
      c.db.relations = c.db.relations.filter((x) => x.mid !== u.mid || x.fid !== r!.mid)
    }
    return null
  },
  '/x/relation/blacks': (c) => {
    const u = login(c)
    const list = (c.db.userBlocks ?? []).filter((b) => b.mid === u.mid).sort((a, b) => b.ctime - a.ctime || a.fid - b.fid).map((b) => ({ mid: b.fid, uname: userById(b.fid)?.uname ?? '', face: userFace(b.fid, userById(b.fid)?.face), sign: userById(b.fid)?.sign ?? '', mtime: b.ctime, attribute: 128, tag: null, special: 0 }))
    return { list: page(list, int(c.p.pn, 1), Math.min(50, int(c.p.ps, 50))), total: list.length, re_version: 0 }
  },
  '/x/v2/reply': (c) => {
    const oid = int(c.p.oid), pn = int(c.p.pn, 1), ps = int(c.p.ps, 20)
    const top = c.db.replies.filter((r) => r.oid === oid && r.root === 0 && commentVisible(c.db, c.me?.mid, r))
      .sort((a, b) => (c.p.sort === '0' ? b.ctime - a.ctime : b.likers.length - a.likers.length || b.ctime - a.ctime))
    return { page: { num: pn, size: ps, count: top.length, acount: c.db.replies.filter((r) => r.oid === oid && commentVisible(c.db, c.me?.mid, r)).length }, replies: page(top, pn, ps).map((r) => replyJSON(r, c.me?.mid)), upper: { mid: archiveById(oid)?.mid ?? 0 } }
  },
  '/x/v2/reply/reply': (c) => {
    const root = c.db.replies.find((r) => r.rpid === int(c.p.root))
    if (!root || !commentVisible(c.db, c.me?.mid, root)) return fail(12022, '评论已被删除')
    const children = c.db.replies.filter((r) => r.root === root.rpid && commentVisible(c.db, c.me?.mid, r)).sort((a, b) => a.ctime - b.ctime)
    const pn = int(c.p.pn, 1)
    return { page: { num: pn, size: 20, count: children.length }, root: replyJSON(root, c.me?.mid, false), replies: page(children, pn, 20).map((r) => replyJSON(r, c.me?.mid, false)) }
  },
  '/x/v2/reply/add': (c) => {
    if (c.me && c.me.status !== 0) fail(-102, '账号已被封停')
    const u = csrf(c), oid = int(c.p.oid)
    if (c.method !== 'POST') fail(-400, '请使用 POST')
    if (c.p.type !== '1') fail(12009, '评论主体的type不合法')
    const message = (c.p.message ?? '').trim()
    if (!message || message.length > 1000) fail(12025, '评论字数需在 1–1000 字之间')
    if (String(c.db.settings.sensitiveWords ?? '').split('\n').some((w) => w.trim() && message.toLowerCase().includes(w.trim().toLowerCase()))) fail(12016, '评论内容包含敏感信息，请修改后重试')
    const a = c.db.archives.find((x) => x.aid === oid && x.state === 0)
    if (!a) fail(-404, '啥都木有')
    if (c.db.settings.commentEnabled === false) fail(12002, '评论区已关闭')
    const root = int(c.p.root), parent = int(c.p.parent)
    if ((root || parent) && c.db.settings.commentReplyEnabled === false) fail(12003, '禁止回复')
    if (c.db.userBlocks?.some((b) => b.mid === a!.mid && b.fid === u.mid)) fail(12035, '该账号被UP主列入评论黑名单')
    for (const key of ['root', 'parent']) if (c.p[key] && c.p[key] !== '0' && (!Number.isSafeInteger(Number(c.p[key])) || Number(c.p[key]) <= 0)) fail(12006, '没有该评论')
    if (root || parent) {
      const r = c.db.replies.find((r) => r.rpid === root && r.oid === oid && r.root === 0)
      const p = c.db.replies.find((r) => r.rpid === parent && r.oid === oid && (r.rpid === root || r.root === root))
      if (!r || !p) fail(12006, '没有该评论')
    }
    const now = ts(), duplicate = Number(c.db.settings.commentDuplicateWindow ?? 0), interval = Number(c.db.settings.commentMinInterval ?? 0)
    if (duplicate > 0 && c.db.replies.some((r) => r.mid === u.mid && r.oid === oid && r.root === root && r.parent === parent && r.message === message && r.ctime > now - duplicate)) fail(12051, '重复评论，请勿刷屏')
    if (interval > 0 && c.db.replies.some((r) => r.mid === u.mid && r.ctime > now - interval)) fail(-509, '请求过于频繁，请稍后再试')
    const r = { rpid: nextID(), oid, mid: u.mid, root, parent, message, ctime: now, likers: [], haters: [] }
    c.db.replies.push(r)
    syncReplyCount(c.db, oid)
    return { success_action: 0, success_toast: '发送成功', need_captcha: false, url: '', rpid: r.rpid, rpid_str: String(r.rpid), dialog: parent, dialog_str: String(parent), root, root_str: String(root), parent, parent_str: String(parent), emote: {}, reply: replyJSON(r, u.mid) }
  },
  '/x/v2/reply/del': (c) => {
    const u = csrf(c)
    const r = c.db.replies.find((x) => x.rpid === int(c.p.rpid))
    if (!r) return fail(12022, '评论已被删除')
    if (r.mid !== u.mid && archiveById(r.oid)?.mid !== u.mid && u.role !== 'admin') fail(-403, '没有权限')
    c.db.replies = c.db.replies.filter((x) => x.rpid !== r.rpid && x.root !== r.rpid)
    for (const report of c.db.commentReports ?? []) if (report.status === 'pending' && !c.db.replies.some((x) => x.rpid === report.rpid)) report.status = 'removed'
    syncReplyCount(c.db, r.oid)
    return null
  },
  '/x/v2/reply/action': (c) => react(c, 'likers'),
  '/x/v2/reply/hate': (c) => react(c, 'haters'),

  // ---------------- 弹幕 ----------------
  '/x/v2/dm/list/seg.so': (c) => {
    const pending = requestMockDanmaku(c.db, int(c.p.oid))
    return { __bytes: dmBytes(c.db, int(c.p.oid), int(c.p.segment_index, 1)), __headers: { 'X-Jumedia-Danmaku-Pending': String(pending), 'Cache-Control': 'no-store' } }
  },
  '/x/v2/dm/web/view': (c) => ({ __bytes: dmView(c.db, c.me?.mid), __headers: { 'Cache-Control': 'private, no-store' } }),
  '/x/v2/dm/web/config': (c) => {
    const u = csrf(c)
    const keys = ['dm_switch', 'blockscroll', 'blocktop', 'blockbottom', 'blockcolor', 'opacity', 'fontsize', 'speedplus', 'dmarea', 'preventshade', 'ai_switch', 'ai_level', 'dmask']
    const next = Object.fromEntries(keys.filter((k) => c.p[k] !== undefined).map((k) => [k, c.p[k]]))
    const prev = c.db.dmConfig[u.mid] ?? {}
    const { dm_area_v2: area, blocktop_bottom: fixed, dm_switch_state: state } = c.p
    if (area !== undefined) {
      if (!/^[+-]?\d+$/.test(area) || Number(area) < 0 || Number(area) > 100) fail(-400, '弹幕显示区域无效')
      next.dmarea = String(Number(area))
    }
    if (fixed !== undefined) {
      if (fixed !== 'true' && fixed !== 'false') fail(-400, '固定弹幕开关无效')
      next.blocktop = next.blockbottom = fixed
    }
    if (state !== undefined) {
      if (!['1', '2', '3'].includes(state)) fail(-400, '弹幕开关状态无效')
      next.dm_switch_state = state
      next.dm_switch = String(state !== '3')
    } else if (next.dm_switch !== undefined && prev.dm_switch_state !== undefined) {
      next.dm_switch_state = next.dm_switch !== 'true' ? '3' : prev.dm_switch_state === '2' ? '2' : '1'
    }
    if (Object.keys(prev).length === Object.keys(next).length && Object.keys(next).every((k) => prev[k] === next[k])) fail(23004, '设置未变更')
    c.db.dmConfig[u.mid] = { ...prev, ...next }
    return null
  },
  '/x/dm/filter/user': (c) => { const u = login(c); return c.db.dmFilter[u.mid] ?? { rule: [], keyword: [], regex: [] } },
  '/x/v2/dm/post': (c) => {
    const u = csrf(c)
    const msg = (c.p.msg ?? '').trim()
    if (!msg || msg.length > 100) fail(36700, '弹幕内容需在 1–100 字之间')
    const id = nextID()
    c.db.danmaku.push({ id, cid: int(c.p.oid), progress: int(c.p.progress), mode: int(c.p.mode, 1), fontsize: int(c.p.fontsize, 25), color: int(c.p.color, 0xffffff), mid: u.mid, content: msg, ctime: ts(), weight: 10 })
    const a = archiveById(int(c.p.aid)); if (a) a.stat.danmaku++
    return { dmid: id, dmid_str: String(id), action: '' }
  },

  // ---------------- 历史 / 稍后再看 ----------------
  '/x/web-interface/history/cursor': (c) => {
    const u = login(c)
    const ps = int(c.p.ps, 20), max = int(c.p.max), viewAt = int(c.p.view_at)
    let list = c.db.history.filter((h) => h.mid === u.mid).sort((a, b) => b.view_at - a.view_at)
    if (viewAt) list = list.filter((h) => h.view_at < viewAt || (h.view_at === viewAt && h.aid < max))
    const rows = list.slice(0, ps).map((h) => historyRow(c.db, h)).filter(Boolean) as { history: { oid: number }; view_at: number }[]
    const last = rows.at(-1)
    return { cursor: { max: last?.history.oid ?? 0, view_at: last?.view_at ?? 0, business: '', ps }, tab: [{ type: 'archive', name: '视频' }], list: rows }
  },
  '/x/v2/history/shadow': (c) => login(c) && c.db.historyPaused.includes(c.me!.mid),
  '/x/v2/history/shadow/set': (c) => {
    const u = csrf(c)
    c.db.historyPaused = c.db.historyPaused.filter((m) => m !== u.mid)
    if (truthy(c.p.switch)) c.db.historyPaused.push(u.mid)
    return null
  },
  '/x/v2/history/clear': (c) => { const u = csrf(c); c.db.history = c.db.history.filter((h) => h.mid !== u.mid); return null },
  '/x/v2/history/toview': (c) => { const rows = toview(c, true); return { count: rows.length, list: rows } },
  '/x/v2/history/toview/web': (c) => {
    const rows = toview(c, c.p.asc !== 'true')
    return { count: rows.length, list: page(rows, int(c.p.pn, 1), int(c.p.ps, 20)) }
  },
  '/x/v2/history/toview/add': (c) => {
    const u = csrf(c), a = archiveOf(c)
    if (c.db.toview.some((t) => t.mid === u.mid && t.aid === a.aid)) fail(90001, '已经在稍后再看里了')
    c.db.toview.push({ mid: u.mid, aid: a.aid, add_at: ts() })
    return null
  },
  '/x/v2/history/toview/v2/dels': (c) => {
    const u = csrf(c)
    const ids = (c.p.resources ?? '').split(',').map((x) => int(x.split(':')[0]))
    c.db.toview = c.db.toview.filter((t) => !(t.mid === u.mid && ids.includes(t.aid)))
    return null
  },

  // ---------------- 收藏 ----------------
  '/x/v3/fav/folder/created/list-all': (c) => {
    const mid = int(c.p.up_mid)
    const folders = c.db.favFolders.filter((f) => f.mid === mid && (f.privacy === 0 || c.me?.mid === mid))
    const rid = int(c.p.rid)
    return { count: folders.length, list: folders.map((f) => ({ id: f.id, fid: f.id, mid: f.mid, attr: f.attr, title: f.title, intro: f.intro, privacy: f.privacy, media_count: f.items.length, fav_state: rid && f.items.some((i) => i.aid === rid) ? 1 : 0, cover: archiveById(f.items[0]?.aid ?? 0)?.pic ?? '', ctime: f.ctime })) }
  },
  '/x/v3/fav/resource/list': (c) => {
    const f = c.db.favFolders.find((x) => x.id === int(c.p.media_id))
    if (!f || (f.privacy === 1 && c.me?.mid !== f.mid)) return fail(-403, '收藏夹不存在或已设为私密')
    const order = c.p.order
    const rows = f.items.map((i) => ({ i, a: archiveById(i.aid) })).filter((x): x is { i: typeof x.i; a: Archive } => !!x.a)
      .sort((x, y) => (order === 'view' ? y.a.stat.view - x.a.stat.view : order === 'pubtime' ? y.a.pubdate - x.a.pubdate : y.i.mtime - x.i.mtime))
    const pn = int(c.p.pn, 1), ps = int(c.p.ps, 20)
    const kw = c.p.keyword ?? ''
    const filtered = kw ? rows.filter((r) => searchMatch(r.a.title, kw)) : rows
    const u = userById(f.mid)!
    return {
      info: { id: f.id, fid: f.id, mid: f.mid, title: f.title, intro: f.intro, cover: filtered[0]?.a.pic ?? '', media_count: f.items.length, privacy: f.privacy, upper: { mid: u.mid, name: u.uname, face: userFace(u.mid, u.face) }, ctime: f.ctime },
      medias: page(filtered, pn, ps).map(({ i, a }) => ({ id: a.aid, type: 2, title: a.state === 0 ? a.title : '已失效视频', cover: a.pic, intro: a.desc, duration: a.pages.reduce((s, p) => s + p.duration, 0), upper: owner(a.mid), attr: a.state === 0 ? 0 : 9, cnt_info: { collect: a.stat.favorite, play: a.stat.view, danmaku: a.stat.danmaku }, bvid: a.bvid, bv_id: a.bvid, pubtime: a.pubdate, fav_time: i.mtime, ugc: { first_cid: a.pages[0]?.cid } })),
      has_more: pn * ps < filtered.length,
    }
  },
  '/x/v3/fav/folder/add': (c) => {
    const u = csrf(c)
    if (!(c.p.title ?? '').trim()) fail(-400, '请填写收藏夹名称')
    const f = { id: nextID(), mid: u.mid, title: c.p.title.trim(), intro: c.p.intro ?? '', privacy: int(c.p.privacy), ctime: ts(), attr: 0, items: [] }
    c.db.favFolders.push(f)
    return { id: f.id, title: f.title }
  },
  '/x/v3/fav/folder/edit': (c) => {
    const u = csrf(c)
    const f = c.db.favFolders.find((x) => x.id === int(c.p.media_id) && x.mid === u.mid)
    if (!f) return fail(-404, '收藏夹不存在')
    Object.assign(f, { title: c.p.title, intro: c.p.intro ?? '', privacy: int(c.p.privacy) })
    return { id: f.id }
  },
  '/x/v3/fav/folder/del': (c) => {
    const u = csrf(c)
    const ids = (c.p.media_ids ?? '').split(',').map(Number)
    const def = c.db.favFolders.find((f) => f.mid === u.mid)
    if (def && ids.includes(def.id)) fail(-400, '默认收藏夹不能删除')
    c.db.favFolders = c.db.favFolders.filter((f) => !(f.mid === u.mid && ids.includes(f.id)))
    return 0
  },

  // ---------------- 用户空间 ----------------
  '/x/relation/followings': (c) => {
    const vmid = int(c.p.vmid)
    const rows = c.db.relations.filter((r) => r.mid === vmid).sort((a, b) => b.mtime - a.mtime)
    const pn = int(c.p.pn, 1), ps = int(c.p.ps, 50)
    return { total: rows.length, list: page(rows, pn, ps).map((r) => { const u = userById(r.fid); return { mid: r.fid, uname: u?.uname ?? '', face: userFace(r.fid, u?.face), sign: u?.sign ?? '', mtime: r.mtime, attribute: c.db.relations.some((x) => x.mid === r.fid && x.fid === vmid) ? 6 : 2 } }) }
  },
  '/x/space/wbi/acc/info': (c) => {
    const u = userById(int(c.p.mid))
    if (!u) return fail(-404, '啥都木有')
    return { mid: u.mid, name: u.uname, sex: u.sex, face: userFace(u.mid, u.face), jointime: u.ctime, sign: u.sign, level: u.level, birthday: u.birthday.slice(5), top_photo: u.top_photo, is_followed: !!c.me && c.db.relations.some((r) => r.mid === c.me!.mid && r.fid === u.mid), silence: u.status, vip: { status: u.vip, label: { text: u.vip ? '年度大会员' : '' } }, official: { role: u.role === 'admin' ? 1 : 0, title: u.role === 'admin' ? 'Jumedia 官方账号' : '' }, live_room: liveRoomOf(c.db, u.mid) }
  },
  '/x/space/wbi/acc/relation': (c) => {
    const mid = int(c.p.mid)
    const me = c.me?.mid
    const a = me && c.db.relations.some((r) => r.mid === me && r.fid === mid), b = me && c.db.relations.some((r) => r.mid === mid && r.fid === me)
    const blocked = (c.db.userBlocks ?? []).some((x) => x.mid === me && x.fid === mid)
    const blockedBy = (c.db.userBlocks ?? []).some((x) => x.mid === mid && x.fid === me)
    return { relation: { mid, attribute: blocked ? 128 : a ? (b ? 6 : 2) : 0, mtime: 0 }, be_relation: { mid: me ?? 0, attribute: blockedBy ? 128 : b ? (a ? 6 : 2) : 0 } }
  },
  '/x/relation/stat': (c) => { const mid = int(c.p.vmid); return { mid, following: followingCount(mid), whisper: 0, black: (c.db.userBlocks ?? []).filter((b) => b.mid === mid).length, follower: followerCount(mid) } },
  '/x/web-interface/card': (c) => {
    const u = userById(int(c.p.mid))
    if (!u) return fail(-404, '啥都木有')
    const likes = c.db.archives.filter((a) => a.mid === u.mid).reduce((s, a) => s + a.stat.like, 0)
    return { card: { mid: String(u.mid), name: u.uname, face: userFace(u.mid, u.face), sign: u.sign, sex: u.sex, fans: followerCount(u.mid), attention: followingCount(u.mid), level_info: levelInfo(u) }, space: { s_img: u.top_photo, l_img: u.top_photo }, following: !!c.me && c.db.relations.some((r) => r.mid === c.me!.mid && r.fid === u.mid), archive_count: c.db.archives.filter((a) => a.mid === u.mid && a.state === 0).length, follower: followerCount(u.mid), like_num: likes }
  },
  '/x/space/wbi/arc/search': (c) => {
    const mid = int(c.p.mid), pn = int(c.p.pn, 1), ps = int(c.p.ps, 30), kw = c.p.keyword ?? ''
    const order = c.p.order
    const list = c.db.archives.filter((a) => a.mid === mid && a.state === 0 && (!int(c.p.tid) || a.tid === int(c.p.tid)) && (!kw || searchMatch(a.title, kw)))
      .sort((a, b) => (order === 'click' ? b.stat.view - a.stat.view : order === 'stow' ? b.stat.favorite - a.stat.favorite : b.pubdate - a.pubdate))
    const tlist = Object.fromEntries([...new Set(list.map((a) => a.tid))].map((tid) => [tid, { tid, name: regionName(tid), count: list.filter((a) => a.tid === tid).length }]))
    return { list: { vlist: page(list, pn, ps).map(spaceArc), tlist }, page: { pn, ps, count: list.length } }
  },
  '/x/v2/space/archive/cursor': (c) => {
    const vmid = int(c.p.vmid), lastAid = int(c.p.aid)
    const list = c.db.archives.filter((a) => a.mid === vmid && a.state === 0).sort((a, b) => (c.p.order === 'click' ? b.stat.view - a.stat.view : b.pubdate - a.pubdate))
    const start = lastAid ? list.findIndex((a) => a.aid === lastAid) + 1 : 0
    const items = list.slice(start, start + 20)
    return { item: items.map((a) => ({ ...spaceArc(a), param: String(a.aid), goto: 'av', cover: a.pic, ctime: a.pubdate })), has_next: start + 20 < list.length, count: list.length }
  },
  '/x/space/top/arc': (c) => {
    const list = c.db.archives.filter((a) => a.mid === int(c.p.vmid) && a.state === 0).sort((a, b) => b.stat.view - a.stat.view)
    if (!list.length) fail(53016, '没有置顶视频')
    return { ...arcView(list[0]), reason: '代表作' }
  },
  '/x/space/masterpiece': (c) => c.db.archives.filter((a) => a.mid === int(c.p.vmid) && a.state === 0).sort((a, b) => b.stat.like - a.stat.like).slice(1, 4).map((a) => arcView(a)),
  '/x/polymer/web-space/seasons_series_list': (c) => {
    const mid = int(c.p.mid), pn = int(c.p.page_num, 1), ps = int(c.p.page_size, 10)
    const mine = c.db.collections.filter((x) => x.mid === mid)
    const meta = (x: DB['collections'][number]) => x.aids.map(archiveById).filter((a): a is Archive => !!a && a.state === 0)
    const pageRows = page(mine, pn, ps)
    return {
      items_lists: {
        page: { page_num: pn, page_size: ps, total: mine.length },
        seasons_list: pageRows.filter((x) => x.kind === 'season').map((x) => ({ meta: { season_id: x.id, name: x.title, cover: x.cover, description: x.intro, total: meta(x).length, mid, ptime: x.ctime }, recent_aids: x.aids.slice(0, 4), archives: meta(x).slice(0, 4).map(spaceArc) })),
        series_list: pageRows.filter((x) => x.kind === 'series').map((x) => ({ meta: { series_id: x.id, name: x.title, cover: x.cover, description: x.intro, total: meta(x).length, mid, mtime: x.ctime }, recent_aids: x.aids.slice(0, 4), archives: meta(x).slice(0, 4).map(spaceArc) })),
      },
    }
  },
  '/x/polymer/web-space/seasons_archives_list': (c) => collectionVideos(c, int(c.p.season_id), int(c.p.page_num, 1), truthy(c.p.sort_reverse)),
  '/x/series/archives': (c) => collectionVideos(c, int(c.p.series_id), int(c.p.pn, 1), c.p.sort === 'asc'),

  // ---------------- 番剧 ----------------
  '/pgc/web/timeline': (c) => {
    const types = int(c.p.types, 1), before = int(c.p.before, 6), after = int(c.p.after, 6)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const days = []
    for (let d = -before; d <= after; d++) {
      const date = new Date(today.getTime() + d * 86400000)
      const weekday = ((date.getDay() + 6) % 7) + 1
      const eps = c.db.seasons.filter((s) => s.state === 0 && s.season_type === types && s.weekday === weekday)
      days.push({
        date: `${date.getMonth() + 1}-${date.getDate()}`, date_ts: Math.floor(date.getTime() / 1000), day_of_week: weekday, is_today: d === 0 ? 1 : 0,
        episodes: eps.map((s) => ({ season_id: s.season_id, episode_id: s.episodes.at(-1)?.ep_id, title: s.title, cover: s.cover, square_cover: s.cover, ep_cover: s.episodes.at(-1)?.cover || s.horizontal || s.cover, pub_time: s.pub_time, pub_index: s.is_finish ? '已完结' : `第${s.episodes.length + (d > 0 ? 1 : 0)}话`, published: d <= 0 ? 1 : 0, follow: c.me && c.db.bangumiFollow.some((f) => f.mid === c.me!.mid && f.season_id === s.season_id) ? 1 : 0 })),
      })
    }
    return { __result: days }
  },
  '/pgc/season/rank/index': (c) => {
    const styles = [...new Set(c.db.seasons.filter((s) => s.season_type === 1).flatMap((s) => s.styles))]
    return { index: [{ tab_id: 1, title: '综合', url: '/pgc/season/rank/list?season_type=1&style_id=0&day=3' }, ...styles.map((name, i) => ({ tab_id: i + 2, title: name, url: `/pgc/season/rank/list?season_type=1&style_id=${i + 2}&day=3` }))] }
  },
  // season_type 0 = every type. style_id 2.. are the style tabs from rank/index; Juli's
  // fixed tabs 210 (热搜榜) rank by plays and 430 (会员榜) by follows across all types.
  '/pgc/season/rank/list': (c) => {
    const styles = [...new Set(c.db.seasons.filter((s) => s.season_type === 1).flatMap((s) => s.styles))]
    const styleID = int(c.p.style_id)
    const style = styleID >= 2 && styleID < 210 ? styles[styleID - 2] : undefined
    const type = int(c.p.season_type, 1)
    const key = (s: DB['seasons'][number]) => (styleID === 430 ? s.follow : s.views)
    return { list: c.db.seasons.filter((s) => s.state === 0 && (type === 0 || s.season_type === type) && (!style || s.styles.includes(style))).sort((a, b) => key(b) - key(a)).slice(0, 100).map((s, i) => seasonCard(s, { rank: i + 1 })) }
  },
  '/pgc/view/web/season': (c) => {
    const epid = int(c.p.ep_id)
    const s = c.db.seasons.find((x) => x.state === 0 && (epid ? x.episodes.some((e) => e.ep_id === epid) : x.season_id === int(c.p.season_id)))
    if (!s) return fail(-404, '番剧不存在')
    return { __result: seasonResult(c, s) }
  },
  '/pgc/season/index/result': (c) => {
    const type = int(c.p.season_type, 1), order = int(c.p.order, 2), asc = c.p.sort === '1'
    const key = (s: DB['seasons'][number]) => (order === 4 ? s.score : order === 3 ? s.follow : order === 0 || order === 5 ? s.ctime : s.views)
    const list = c.db.seasons.filter((s) => s.state === 0 && s.season_type === type && indexFilter(c, s)).sort((a, b) => (asc ? key(a) - key(b) : key(b) - key(a)))
    const pn = int(c.p.page, 1), ps = int(c.p.pagesize, 24)
    return { list: page(list, pn, ps).map((s) => seasonCard(s, { order: order === 4 ? `${s.score}分` : order === 3 ? `${compactCount(s.follow)}追番` : `${compactCount(s.views)}次播放` })), has_next: pn * ps < list.length ? 1 : 0, num: pn, size: ps, total: list.length }
  },
  // type 1 = 追番 (番剧 / 国创), 2 = 追剧 (电影 / 纪录片 / 电视剧 / 综艺); any other or missing type,
  // and ps outside 1–30 (default 15), answer -400.
  '/x/space/bangumi/follow/list': (c) => {
    const vmid = int(c.p.vmid), status = int(c.p.follow_status)
    if (c.p.type !== '1' && c.p.type !== '2') fail(-400, '请求错误')
    const pn = int(c.p.pn, 1), ps = int(c.p.ps, 15)
    if (pn < 1 || ps < 1 || ps > 30) fail(-400, '请求错误')
    const anime = (sid: number) => [1, 4].includes(c.db.seasons.find((x) => x.season_id === sid)?.season_type ?? 0)
    const rows = c.db.bangumiFollow.filter((f) => f.mid === vmid && (!status || f.status === status) && anime(f.season_id) === (c.p.type === '1')).sort((a, b) => b.mtime - a.mtime)
    return {
      pn, ps, total: rows.length,
      list: page(rows, pn, ps).map((f) => {
        const s = c.db.seasons.find((x) => x.season_id === f.season_id)!
        const h = c.db.history.filter((x) => x.mid === vmid && x.sid === f.season_id).sort((a, b) => b.view_at - a.view_at)[0]
        const ep = h && s.episodes.find((e) => e.ep_id === h.epid)
        const latest = s.episodes[s.episodes.length - 1]
        const at = ep ? s.episodes.indexOf(ep) : -1
        return seasonCard(s, {
          follow_status: f.status, progress: ep ? `看到第${ep.title}话` : '尚未观看', renewal_time: s.is_finish ? '' : `每周${'一二三四五六日'[s.weekday - 1]} ${s.pub_time}`,
          // Jumedia additions for 我的追番 (Juli reads only the fields above).
          total_count: s.episodes.length, follow_mtime: f.mtime,
          new_ep: { ...seasonCard(s).new_ep, title: latest?.title ?? '', pub_time: latest?.pub_time ?? 0 },
          last_ep: ep ? { ep_id: ep.ep_id, index: ep.title, title: ep.long_title, position: at + 1, time: h!.progress, view_at: h!.view_at } : null,
          // A newer episode came out after the one last watched.
          has_update: !!ep && at < s.episodes.length - 1 && (latest?.pub_time ?? 0) > h!.view_at,
        })
      }),
    }
  },
  '/pgc/view/web/season/user/status': (c) => {
    const f = c.me ? c.db.bangumiFollow.find((x) => x.mid === c.me!.mid && x.season_id === int(c.p.season_id)) : undefined
    return { __result: { follow: f ? 1 : 0, follow_status: f?.status ?? 0, pay: 0, sponsor: 0, vip: c.me?.vip ?? 0 } }
  },
  '/pgc/web/follow/add': (c) => {
    const u = csrf(c), sid = int(c.p.season_id)
    if (!c.db.bangumiFollow.some((f) => f.mid === u.mid && f.season_id === sid)) {
      c.db.bangumiFollow.push({ mid: u.mid, season_id: sid, status: 1, mtime: ts() })
      const s = c.db.seasons.find((x) => x.season_id === sid); if (s) s.follow++
    }
    return { __result: { toast: '追番成功', relation: true, status: 2 } }
  },
  '/pgc/web/follow/del': (c) => {
    const u = csrf(c), sid = int(c.p.season_id)
    c.db.bangumiFollow = c.db.bangumiFollow.filter((f) => !(f.mid === u.mid && f.season_id === sid))
    return { __result: { toast: '已取消追番', relation: false, status: 0 } }
  },
  '/pgc/web/follow/status/update': (c) => {
    const u = csrf(c)
    const f = c.db.bangumiFollow.find((x) => x.mid === u.mid && x.season_id === int(c.p.season_id))
    if (!f) return fail(-404, '尚未追番')
    f.status = int(c.p.status, 1); f.mtime = ts()
    return { __result: { toast: '已更新' } }
  },

  // ---------------- 直播 ----------------
  '/xlive/web-interface/v1/index/getWebAreaList': (c) => ({ data: c.db.liveAreas.map((a) => ({ id: a.id, name: a.name, list: a.children.map((x) => ({ id: String(x.id), name: x.name, parent_id: String(a.id), parent_name: a.name })) })) }),
  '/room/v1/area/getRoomList': (c) => {
    const parent = int(c.p.parent_area_id), area = int(c.p.area_id)
    const list = c.db.rooms.filter((r) => r.live_status === 1 && !r.banned && (!parent || r.parent_area_id === parent) && (!area || r.area_id === area))
      .sort((a, b) => (c.p.sort_type === 'live_time' ? b.live_time - a.live_time : b.online - a.online))
    return page(list, int(c.p.page, 1), int(c.p.page_size, 20)).map(roomCard)
  },
  '/xlive/web-interface/v1/second/getUserRecommend': (c) => {
    const list = c.db.rooms.filter((r) => r.live_status === 1 && !r.banned).sort((a, b) => b.online - a.online)
    const pn = int(c.p.page, 1), ps = int(c.p.page_size, 30)
    return { list: page(list, pn, ps).map(roomCard), has_more: pn * ps < list.length ? 1 : 0 }
  },
  '/xlive/web-ucenter/user/following': (c) => {
    const u = login(c)
    const follows = c.db.relations.filter((r) => r.mid === u.mid).map((r) => r.fid)
    const rooms = c.db.rooms.filter((r) => follows.includes(r.uid)).sort((a, b) => b.live_status - a.live_status || b.online - a.online)
    const pn = int(c.p.page, 1), ps = int(c.p.page_size, 20)
    return { title: '我的关注', pageSize: ps, totalPage: Math.max(1, Math.ceil(rooms.length / ps)), count: rooms.length, live_count: rooms.filter((r) => r.live_status === 1).length, list: page(rooms, pn, ps).map((r) => ({ ...roomCard(r), area_name_v2: roomCard(r).area_v2_name })) }
  },
  '/room/v1/Room/get_info': (c) => {
    const r = room(c, int(c.p.room_id))
    const card = roomCard(r)
    return { uid: r.uid, room_id: r.room_id, short_id: 0, title: r.title, user_cover: r.cover, keyframe: r.cover, live_status: r.live_status, online: r.online, area_id: r.area_id, area_name: card.area_v2_name, parent_area_id: r.parent_area_id, parent_area_name: card.area_v2_parent_name, description: r.description, tags: r.tags, live_time: r.live_time ? new Date(r.live_time * 1000).toISOString().replace('T', ' ').slice(0, 19) : '0000-00-00 00:00:00', attention: followerCount(r.uid) }
  },
  '/room/v1/Room/room_init': (c) => { const r = room(c, int(c.p.id)); return { room_id: r.room_id, short_id: 0, uid: r.uid, live_status: r.live_status, live_time: r.live_time, is_locked: r.banned } },
  '/live_user/v1/Master/info': (c) => { const u = userById(int(c.p.uid)); return { info: { uid: u?.mid ?? 0, uname: u?.uname ?? '', face: userFace(int(c.p.uid), u?.face), gender: 0, official_verify: { type: -1, desc: '' } }, follower_num: followerCount(u?.mid ?? 0), room_id: c.db.rooms.find((r) => r.uid === u?.mid)?.room_id ?? 0, room_news: { content: '' } } },
  '/xlive/web-room/v2/index/getRoomPlayInfo': async (c) => {
    const r = room(c, int(c.p.room_id))
    const relayed = r.source?.type === 'm3u8' || r.source?.type === 'video'
    if (r.live_status === 1 && relayed && !r.source!.loop && r.source!.kind === 'vod') await relayedPlaylist(r)
    if (r.live_status !== 1) return { room_id: r.room_id, uid: r.uid, live_status: r.live_status, playurl_info: null }
    // Mock only: the browser can't transcode, so a relayed video plays its original file from the live position.
    // The server serves the transcoded cache as HLS at `/live-relay/{room}/index.m3u8` instead.
    if (r.source?.type === 'video') {
      const a = archiveById(r.source.aid ?? 0), p = a?.pages.find((x) => x.cid === r.source!.cid)
      if (!p || roomCache(c.db, r)?.status !== 'ready') return { room_id: r.room_id, uid: r.uid, live_status: 1, live_time: r.live_time, playurl_info: null }
      const elapsed = Math.max(0, ts() - r.live_time)
      const at = r.source.loop ? elapsed % p.duration : Math.min(elapsed, p.duration)
      const codec = { codec_name: 'avc', current_qn: 10000, accept_qn: [10000], base_url: `${await resolveMedia(p.media)}#t=${at}`, url_info: [{ host: '', extra: '', stream_ttl: 3600 }] }
      return { room_id: r.room_id, uid: r.uid, live_status: 1, live_time: r.live_time, playurl_info: { playurl: { g_qn_desc: [{ qn: 10000, desc: '原画' }], stream: [{ protocol_name: 'http_stream', format: [{ format_name: 'mp4', codec: [codec] }] }] } } }
    }
    if (relayed) {
      // The relay is an ordinary HLS route, ranked by Juli's liveRouteRank like any other (ts before fmp4).
      const codec = { codec_name: 'avc', current_qn: 10000, accept_qn: [10000], base_url: `/live-relay/${r.room_id}/index.m3u8`, url_info: [{ host: c.origin, extra: '', stream_ttl: 3600 }] }
      return { room_id: r.room_id, uid: r.uid, live_status: 1, live_time: r.live_time, playurl_info: { playurl: { g_qn_desc: [{ qn: 10000, desc: '原画' }], stream: [{ protocol_name: 'http_hls', format: [{ format_name: r.source!.format ?? 'ts', codec: [codec] }] }] } } }
    }
    // RTMP ingest is not implemented, so a push room has no stream to offer.
    return { room_id: r.room_id, uid: r.uid, live_status: r.live_status, live_time: r.live_time, playurl_info: null }
  },
  '/xlive/web-room/v1/index/getDanmuInfo': (c) => ({ group: 'live', business_id: 0, refresh_row_factor: 0.125, max_delay: 5000, token: rand(24), host_list: [{ host: location.hostname, port: 2243, wss_port: 443, ws_port: 2244 }], room_id: int(c.p.id) }),
  '/xlive/web-room/v1/dM/gethistory': (c) => {
    const rid = int(c.p.roomid)
    const r = room(c, rid)
    if (r.live_status === 1 && Math.random() < 0.7) c.db.liveMessages.push({ id: nextID(), room_id: rid, uid: 1 + Math.floor(Math.random() * c.db.users.length), text: LIVE_CHATTER[Math.floor(Math.random() * LIVE_CHATTER.length)], ts: ts() })
    const rows = c.db.liveMessages.filter((m) => m.room_id === rid && !m.price).slice(-30)
    return { admin: [], room: rows.map((m) => { const u = userById(m.uid); return { text: m.text, uid: m.uid, nickname: u?.uname ?? '观众', timeline: new Date(m.ts * 1000).toISOString().replace('T', ' ').slice(0, 19), id_str: String(m.id), check_info: { ts: m.ts }, user: { uid: m.uid, base: { name: u?.uname ?? '观众', face: userFace(m.uid, u?.face) }, medal: wornMedal(c.db, m.uid) ?? null }, medal_info: null } }) }
  },
  '/av/v1/SuperChat/getMessageList': (c) => {
    const rid = int(c.p.room_id)
    return { list: c.db.liveMessages.filter((m) => m.room_id === rid && m.price).map((m) => { const u = userById(m.uid); return { id: m.id, uid: m.uid, message: m.text, price: m.price, background_bottom_color: '#2A60B2', background_color: '#EDF5FF', start_time: m.ts, end_time: m.ts + 120 + (m.price ?? 0) * 4, time: 120, user_info: { uname: u?.uname ?? '', face: userFace(m.uid, u?.face) } } }) }
  },
  '/msg/send': (c) => {
    const u = csrf(c)
    const r = room(c, int(c.p.roomid))
    const msg = (c.p.msg ?? '').trim()
    if (!msg || msg.length > 40) fail(-400, '弹幕需在 1–40 字之间')
    c.db.liveMessages.push({ id: nextID(), room_id: r.room_id, uid: u.mid, text: msg, ts: ts() })
    feedMedal(c.db, u.mid, r.uid)
    return { mode_info: { mode: 0 } }
  },

  // ---------------- 个人资料 / 上传 ----------------
  '/x/member/web/update': (c) => {
    const u = csrf(c)
    const uname = (c.p.uname ?? '').trim()
    if (!uname || uname.length > 16) fail(-400, '昵称需为 1–16 个字符')
    if (c.db.users.some((x) => x.uname === uname && x.mid !== u.mid)) fail(-400, '昵称已被占用')
    Object.assign(u, { uname, sign: (c.p.sign ?? '').slice(0, 70), sex: c.p.sex || '保密', birthday: c.p.birthday ?? '', face: c.p.face || u.face })
    return null
  },
  '/x/upload/web/video': async (c) => {
    csrf(c)
    const file = c.form?.get('file')
    if (!(file instanceof File)) return fail(-400, '请选择视频文件')
    if (file.size > Number(c.db.settings.maxUploadMB) * 1024 * 1024) fail(-400, `文件超过 ${c.db.settings.maxUploadMB}MB 上限`)
    const ref = await putFile(file)
    return { filename: ref, name: file.name, size: file.size }
  },
  '/x/upload/web/image': async (c) => {
    csrf(c)
    const file = c.form?.get('file')
    if (!(file instanceof File)) return fail(-400, '请选择图片')
    if (!(await rasterImage(file))) fail(-400, '仅支持 PNG、JPEG、WebP 或 GIF 图片')
    return { url: await putFile(file) }
  },

  // ---------------- 创作中心 ----------------
  '/x/vu/web/add/v3': (c) => submitArchive(c),
  '/x/vu/web/edit': (c) => submitArchive(c),
  '/x/web/archives': (c) => {
    const u = login(c)
    const status = c.p.status ?? '', kw = c.p.keyword ?? '', origin = c.p.origin ?? ''
    const mine = c.db.archives.filter((a) => a.mid === u.mid && a.state !== -100 && (origin === 'upload' ? !a.origin : origin === 'datasource' ? !!a.origin : true))
    const want: Record<string, number> = { pubed: 0, is_pubing: -1, not_pubed: -2, missing: -6, timer: -40, draft: -20 }
    const list = mine.filter((a) => (status in want ? a.state === want[status] : true) && (!kw || searchMatch(a.title, kw))).sort((a, b) => b.ctime - a.ctime || b.aid - a.aid)
    const pn = int(c.p.pn, 1), ps = int(c.p.ps, 10)
    return { class: { pubed: mine.filter((a) => a.state === 0).length, is_pubing: mine.filter((a) => a.state === -1).length, not_pubed: mine.filter((a) => a.state === -2).length, missing: mine.filter((a) => a.state === -6).length, timer: mine.filter((a) => a.state === -40).length, draft: mine.filter((a) => a.state === -20).length }, arc_audits: page(list, pn, ps).map(creatorRow), page: { pn, ps, count: list.length } }
  },
  '/x/web/archive/view': (c) => { const u = login(c); const a = archiveById(int(c.p.aid)); if (!a || a.mid !== u.mid || a.state === -100) return fail(-404, '稿件不存在'); return creatorRow(a) },
  /** Restores Emby metadata for the given (default: all) locked fields. Jumedia only; Emby is not touched. */
  '/x/web/archive/origin/reset': (c) => {
    const u = csrf(c); const a = archiveById(int(c.p.aid))
    if (!a || a.mid !== u.mid || a.state === -100) return fail(-404, '稿件不存在')
    if (!a.origin) return fail(-400, '该稿件不是数据源中的视频')
    const fields = (c.p.fields ? c.p.fields.split(',') : a.origin.locked).filter((f): f is ArchiveField => ARCHIVE_FIELDS.includes(f as ArchiveField))
    for (const f of fields) (a as unknown as Record<string, unknown>)[f] = a.origin.meta[f]
    a.origin.locked = a.origin.locked.filter((f) => !fields.includes(f))
    log(c, '恢复数据源元信息', a.title)
    return creatorRow(a)
  },
  '/x/web/archive/delete': (c) => {
    const u = csrf(c); const a = archiveById(int(c.p.aid))
    if (!a || a.mid !== u.mid) return fail(-404, '稿件不存在')
    a.state = -100
    log(c, '删除稿件', a.title)
    return null
  },
  '/x/web/data/stat': (c) => {
    const u = login(c)
    const mine = c.db.archives.filter((a) => a.mid === u.mid && a.state === 0)
    const sum = (k: keyof Archive['stat']) => mine.reduce((s, a) => s + a.stat[k], 0)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const total = sum('view')
    const dayView = (i: number) => Math.floor((total / 400) * (0.6 + Math.abs(Math.sin(i * 1.7 + u.mid)) * 0.9))
    const aids = new Set(mine.map((a) => a.aid))
    return {
      total_fans: followerCount(u.mid), total_click: total, total_like: sum('like'), total_coin: sum('coin'), total_fav: sum('favorite'), total_reply: sum('reply'), total_dm: sum('danmaku'), total_share: sum('share'),
      incr_fans: 3 + (u.mid % 20), incr_click: Math.floor(total * 0.012), archive_count: mine.length, coins: u.coins,
      // Jumedia: views of the 14 days before `series`, and replies received today.
      prev_view: Array.from({ length: 14 }, (_, i) => dayView(i - 14)).reduce((s, n) => s + n, 0), reply_today: c.db.replies.filter((r) => aids.has(r.oid) && r.ctime >= today.getTime() / 1000).length,
      series: Array.from({ length: 14 }, (_, i) => { const d = new Date(today.getTime() - (13 - i) * 86400000); return { date: `${d.getMonth() + 1}-${d.getDate()}`, view: dayView(i), fans: Math.floor(1 + Math.abs(Math.cos(i + u.mid)) * 6) } }),
      top: mine.sort((a, b) => b.stat.view - a.stat.view).slice(0, 5).map((a) => arcView(a)),
    }
  },
  '/x/web/seasons': (c) => {
    const u = login(c)
    return { seasons: c.db.collections.filter((x) => x.mid === u.mid).map((x) => ({ id: x.id, kind: x.kind, title: x.title, intro: x.intro, cover: x.cover, aids: x.aids, ep_count: x.aids.length, ctime: x.ctime, archives: x.aids.map(archiveById).filter(Boolean).map((a) => ({ aid: a!.aid, title: a!.title, pic: a!.pic, state: a!.state })), origin: collectionOrigin(c.db, x) })) }
  },
  '/x/web/season/save': (c) => {
    const u = csrf(c)
    const title = (c.p.title ?? '').trim()
    if (!title) fail(-400, '请填写名称')
    const existing = c.db.collections.find((x) => x.id === int(c.p.season_id) && x.mid === u.mid)
    if (existing?.origin) {
      // Library 合集: membership follows the data source; title/intro/cover can be changed here and stay locked.
      const o = existing.origin
      const next: Record<CollectionField, string> = { title, intro: c.p.intro ?? '', cover: c.p.cover || existing.cover }
      for (const f of COLLECTION_FIELDS) { existing[f] = next[f]; o.locked = next[f] === o.meta[f] ? o.locked.filter((x) => x !== f) : [...new Set([...o.locked, f])] }
      return null
    }
    // Data-source videos belong to their library's 合集, so only 系列 can include them.
    const aids = (c.p.aids ?? '').split(',').map(Number).filter((aid) => archiveById(aid)?.mid === u.mid && (c.p.kind !== 'season' || !archiveById(aid)?.origin))
    if (c.p.kind === 'season') for (const x of c.db.collections) if (x !== existing && x.kind === 'season') x.aids = x.aids.filter((aid) => !aids.includes(aid))
    if (existing) Object.assign(existing, { title, intro: c.p.intro ?? '', cover: c.p.cover || existing.cover, aids })
    else c.db.collections.push({ id: nextID(), mid: u.mid, kind: c.p.kind === 'series' ? 'series' : 'season', title, intro: c.p.intro ?? '', cover: c.p.cover || archiveById(aids[0])?.pic || '', aids, ctime: ts() })
    return null
  },
  '/x/web/season/delete': (c) => {
    const u = csrf(c)
    if (c.db.collections.find((x) => x.id === int(c.p.season_id) && x.mid === u.mid)?.origin) fail(-400, '媒体库合集由数据源管理，请在数据源中停用对应媒体库')
    c.db.collections = c.db.collections.filter((x) => !(x.id === int(c.p.season_id) && x.mid === u.mid))
    return null
  },
  '/x/web/season/origin/reset': (c) => {
    const u = csrf(c)
    const x = c.db.collections.find((y) => y.id === int(c.p.season_id) && y.mid === u.mid)
    if (!x) return fail(-404, '合集不存在')
    if (!x.origin) return fail(-400, '该合集不是数据源媒体库')
    for (const f of x.origin.locked) x[f] = x.origin.meta[f]
    x.origin.locked = []
    return null
  },

  // ---------------- 数据源（Emby，只读） ----------------
  '/x/web/datasources': (c) => {
    const u = login(c)
    return { list: c.db.dataSources.filter((x) => x.mid === u.mid && !x.system).sort((a, b) => a.ctime - b.ctime).map((x) => dataSourceJSON(c.db, x)), enabled: !!c.db.settings.userDataSources, max: MAX_SOURCES, sync_hours: Number(c.db.settings.dataSourceSyncHours) }
  },
  '/x/web/datasource/test': async (c) => { csrf(c); userSources(c); return testSource(c, ownSource(c, true), false) },
  '/x/web/datasource/save': async (c) => { csrf(c); userSources(c); return saveSource(c, ownSource(c, true), false) },
  '/x/web/datasource/sync': (c) => { csrf(c); userSources(c); return startSync(c, ownSource(c)!) },
  '/x/web/datasource/delete': (c) => { csrf(c); deleteSource(c, ownSource(c)!); return null },
  '/x/web/datasource/items': async (c) => {
    login(c); userSources(c)
    const ds = ownSource(c)!
    try { return await browseSource(c.db, ds, c.p.library, (c.p.keyword ?? '').trim(), Math.max(1, int(c.p.pn, 1)), Math.max(1, Math.min(100, int(c.p.ps, 20)))) }
    catch (e) { return fail(-400, e instanceof Error ? e.message : '获取视频失败') }
  },
  '/x/web/datasource/import': async (c) => {
    csrf(c); userSources(c)
    const ds = ownSource(c)!
    let ids: unknown
    try { ids = JSON.parse(c.p.item_ids) } catch { return fail(-400, '每次请选择 1–20 个视频') }
    try { const result = await importSourceDrafts(c.db, ds, c.p.library, ids, nextID); log(c, '数据源导入草稿', ds.name); return result }
    catch (e) { return fail(-400, e instanceof Error ? e.message : '获取视频失败') }
  },
  '/xlive/app-blink/v1/room/GetInfo': (c) => {
    const u = login(c)
    const r = ownRoom(c, u)
    return { ...roomCard(r), rtmp: streamAddr(r), banned: r.banned, source: sourceJSON(r), pending_start: !!r.pending_start }
  },
  // 直播中心「推流码」; `reset_key=true` issues a new key (the old one stops working).
  '/xlive/app-blink/v1/live/getWebUpStreamAddr': (c) => {
    const reset = truthy(c.p.reset_key)
    const u = reset ? csrf(c) : login(c)
    const r = ownRoom(c, u)
    if (reset) { r.stream_key = streamToken(); log(c, '重置推流码', r.title) }
    return { addr: streamAddr(r), line_list: [], srt_addr: null }
  },
  /** The streamer's data-source videos that can be relayed (`source_type=video`). */
  '/xlive/app-blink/v1/streamSource/videos': (c) => relayableVideos(c, login(c).mid),
  '/xlive/app-blink/v1/streamSource/probe': async (c) => { login(c); return probe(c.p.url ?? '') },
  '/xlive/app-blink/v1/streamSource/update': async (c) => {
    const u = csrf(c)
    const r = c.db.rooms.find((x) => x.uid === u.mid)
    if (!r) return fail(-404, '尚未开通直播间')
    await applySource(c, r)
    return { source: sourceJSON(r), pending_start: !!r.pending_start }
  },
  /** Re-queues the room's failed transcode job. */
  '/xlive/app-blink/v1/streamSource/retry': (c) => {
    const u = csrf(c)
    const r = c.db.rooms.find((x) => x.uid === u.mid)
    const cache = r && roomCache(c.db, r)
    if (!cache) return fail(-404, '当前直播源没有转码任务')
    retryCache(cache)
    return { source: sourceJSON(r!) }
  },
  '/room/v1/Room/update': (c) => {
    const u = csrf(c)
    const r = c.db.rooms.find((x) => x.uid === u.mid)
    if (!r) return fail(-404, '尚未开通直播间')
    if (c.p.title) r.title = c.p.title.slice(0, 40)
    if (c.p.area_id) { r.area_id = int(c.p.area_id); r.parent_area_id = c.db.liveAreas.find((a) => a.children.some((x) => x.id === r.area_id))?.id ?? r.parent_area_id }
    if (c.p.cover) r.cover = c.p.cover
    return null
  },
  '/room/v1/Room/startLive': (c) => {
    const u = csrf(c)
    const r = c.db.rooms.find((x) => x.uid === u.mid)
    if (!r) return fail(-404, '尚未开通直播间')
    if (r.banned) fail(60009, '直播间已被封禁')
    if ((r.source?.type !== 'm3u8' && r.source?.type !== 'video') || !r.source.url) fail(-400, '暂未接入 RTMP 推流服务，请先配置 m3u8 直播源或选择转播视频')
    if (r.source!.type === 'video') { const why = notReady(roomCache(c.db, r)); if (why) fail(-400, why) }
    Object.assign(r, { live_status: 1, live_time: ts(), online: 1, area_id: int(c.p.area_v2) || r.area_id, pending_start: false })
    return { change: 1, status: 'LIVE' }
  },
  '/room/v1/Room/stopLive': (c) => { const u = csrf(c); const r = c.db.rooms.find((x) => x.uid === u.mid); if (r) Object.assign(r, { live_status: 0, pending_start: false }); return { change: 1, status: 'PREPARING' } },

  // ---------------- 管理后台 ----------------
  // ---------- B 方案: paths Juli does not call ----------
  '/x/player/online/total': (c) => {
    const a = c.p.bvid ? archiveById(bv2av(c.p.bvid)) : archiveById(int(c.p.aid))
    if (!a) fail(-404, '啥都木有')
    const n = watching(a!.aid, a!.stat.view)
    const text = n >= 1000 ? `${Math.floor(n / 1000) * 1000}+` : String(n)
    return { total: text, count: String(Math.max(1, Math.round(n * 0.6))), show_switch: { total: true, count: true }, abtest: { group: 'b' } }
  },
  '/x/space/upstat': (c) => {
    const arcs = published(c.db).filter((a) => a.mid === int(c.p.mid))
    return { archive: { view: arcs.reduce((s, a) => s + a.stat.view, 0), vt: 0, enable_vt: 0 }, article: { view: 0 }, likes: arcs.reduce((s, a) => s + a.stat.like, 0) }
  },
  '/x/space/notice': (c) => userById(int(c.p.mid))?.notice ?? '',
  '/x/space/notice/set': (c) => {
    const u = csrf(c)
    const notice = (c.p.notice ?? '').trim()
    if (notice.length > 150) fail(-400, '公告最多 150 个字符')
    u.notice = notice
    return null
  },
  '/main/hotword': (c) => {
    const words = published(c.db).sort((a, b) => b.stat.view - a.stat.view).slice(0, 10).map((a) => a.title.replace(/[《》【】「」]/g, ' ').trim().split(/\s+/)[0].slice(0, 16))
    return { __root: { code: 0, exp_str: '', list: [...new Set(words)].map((w, i) => ({ id: i + 1, pos: i + 1, keyword: w, show_name: w, word_type: i < 3 ? 4 : 1, icon: '', hot_id: i + 1, is_commercial: '0' })), top_list: [], hotword_egg_info: '', seid: '', timestamp: ts(), total_count: 10 } }
  },
  '/x/web-interface/wbi/search/default': (c) => {
    const pool = published(c.db).sort((a, b) => b.stat.view - a.stat.view).slice(0, 8)
    const a = pool[Math.floor(Date.now() / 600000) % Math.max(1, pool.length)]
    if (!a) return { seid: '', id: 0, type: 0, show_name: '', name: '', goto_type: 0, goto_value: '', url: '' }
    return { seid: '', id: a.aid, type: 0, show_name: a.title, name: a.title, goto_type: 1, goto_value: a.bvid, url: `/video/${a.bvid}` }
  },
  '/x/polymer/web-dynamic/v1/portal': (c) => {
    const u = login(c)
    const since = ts() - 86400 * 3
    const ups = c.db.relations.filter((r) => r.mid === u.mid).map((r) => userById(r.fid)).filter((x): x is User => !!x && x.status === 0)
    const live = ups.map((x) => c.db.rooms.find((r) => r.uid === x.mid && r.live_status === 1 && !r.banned)).filter((r): r is LiveRoom => !!r)
    return {
      live_users: { count: live.length, group: '', items: live.map((r) => ({ mid: r.uid, uname: owner(r.uid).name, face: owner(r.uid).face, room_id: r.room_id, title: r.title, jump_url: `/live/${r.room_id}`, is_reserve_recall: false })) },
      my_info: { mid: u.mid, name: u.uname, face: userFace(u.mid, u.face), follower: followerCount(u.mid), following: followingCount(u.mid), dyns: published(c.db).filter((a) => a.mid === u.mid).length },
      up_list: { has_more: false, items: ups.map((x) => ({ mid: x.mid, uname: x.uname, face: userFace(x.mid, x.face), has_update: published(c.db).some((a) => a.mid === x.mid && a.pubdate >= since), is_reserve_recall: false })) },
    }
  },
  '/x/web-interface/online': (c) => {
    const since = localDay()
    const counts: Record<string, number> = {}
    for (const r of visibleRegions(c.db)) counts[r.tid] = published(c.db).filter((a) => a.tid === r.tid && a.pubdate >= since).length
    for (const r of c.db.regions.filter((x) => x.parent)) counts[r.tid] = published(c.db).filter((a) => a.sub_tid === r.tid && a.pubdate >= since).length
    return { region_count: counts, all_count: published(c.db).length, web_online: c.db.sessions.length, play_online: c.db.rooms.reduce((s, r) => s + (r.live_status === 1 ? r.online : 0), 0) }
  },
  '/x/tag/hots': (c) => {
    const rid = int(c.p.rid)
    const n = new Map<string, number>()
    for (const a of regionArcs(c.db, rid)) for (const t of a.tag.split(',').map((x) => x.trim()).filter(Boolean)) n.set(t, (n.get(t) ?? 0) + a.stat.view)
    const tags = [...n].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, view]) => ({ tag_id: hashTag(name), tag_name: name, highlight: 0, is_atten: 0, count: { view, use: 0, atten: 0 } }))
    return [{ rid, tags }]
  },
  // Region latest, newest first. `order` (click|dm|stow|pubdate), `duration` 0–4 and a sub-region `rid` are Jumedia extensions.
  '/x/web-interface/dynamic/region': (c) => {
    const rid = int(c.p.rid), pn = int(c.p.pn, 1), ps = Math.min(50, int(c.p.ps, 20)), dur = int(c.p.duration)
    if (!c.db.regions.some((r) => r.tid === rid)) fail(-400, '分区不存在')
    const key = ORDER_KEYS[c.p.order ?? ''] ?? ((a: Archive) => a.pubdate)
    const list = regionArcs(c.db, rid).filter((a) => durationIn(totalSeconds(a), dur)).sort((x, y) => key(y) - key(x))
    return { archives: page(list, pn, ps).map((a) => arcView(a)), page: { count: list.length, num: pn, size: ps } }
  },
  // Resource locations: `ids` are region tids (UGC channels) or 10 + season_type (PGC channels).
  '/x/web-show/res/locs': (c) => {
    const out: Record<string, unknown[]> = {}
    for (const id of (c.p.ids ?? '').split(',').map(Number).filter(Boolean)) {
      out[id] = c.db.banners.filter((b) => b.position === 'channel' && b.loc === id).sort((a, b) => a.sort - b.sort).map((b, i) => ({ id: b.id, contract_id: '', pos_num: i + 1, name: b.title, pic: b.img, litpic: '', url: b.url, style: 0, agency: '', label: '', intro: '', creative_type: 0, request_id: '', src_id: id, area: 0, is_ad_loc: false, is_ad: false, server_type: 0, cm_mark: 0, stime: 0, mid: '', activity_type: 0, epid: 0, season_id: b.season_id ?? 0, sub_title: '', ad_cb: '', null_frame: false }))
    }
    return out
  },
  '/x/v2/reply/wbi/main': (c) => {
    const oid = int(c.p.oid), mode = int(c.p.mode, 3), ps = Math.min(30, int(c.p.ps, 20))
    const next = int(c.p.next, 1) || 1
    const top = c.db.replies.filter((r) => r.oid === oid && r.root === 0 && commentVisible(c.db, c.me?.mid, r)).sort(replyOrder(mode))
    const rows = page(top, next, ps)
    return {
      cursor: { is_begin: next === 1, prev: next - 1, next: next + 1, is_end: next * ps >= top.length, mode, mode_text: mode === 2 ? '最新评论' : '最热评论', all_count: c.db.replies.filter((r) => r.oid === oid && commentVisible(c.db, c.me?.mid, r)).length, name: mode === 2 ? '最新评论' : '最热评论' },
      replies: rows.map((r) => replyJSON(r, c.me?.mid)), top_replies: [], upper: { mid: archiveById(oid)?.mid ?? 0 },
    }
  },
  '/pgc/season/index/condition': (c) => {
    const type = int(c.p.season_type, 1)
    const years = [...new Set(c.db.seasons.filter((s) => s.season_type === type).map(seasonYear))].sort((a, b) => b - a)
    const opt = (keyword: string, name: string) => ({ keyword, name })
    const filter = [
      { field: 'area', name: '地区', values: [opt('-1', '全部'), ...Object.entries(AREA_CODES).filter(([, names]) => c.db.seasons.some((s) => s.season_type === type && s.areas.some((a) => names.includes(a)))).map(([k, names]) => opt(k, names.join('/')))] },
      { field: 'style_id', name: '类型', values: [opt('-1', '全部'), ...stylesOf(c.db, type).map((name, i) => opt(String(i + 1), name))] },
      { field: 'year', name: '年份', values: [opt('-1', '全部'), ...years.map((y) => opt(String(y), String(y)))] },
      ...(type === 2 ? [] : [{ field: 'is_finish', name: '状态', values: [opt('-1', '全部'), opt('1', '完结'), opt('0', '连载')] }]),
      { field: 'copyright', name: '版权', values: [opt('-1', '全部'), opt('3', '独家'), opt('1', '其他')] },
      { field: 'season_status', name: '付费', values: [opt('-1', '全部'), opt('1', '免费'), opt('2,6', '付费'), opt('4,6', '大会员')] },
    ]
    const order = [{ field: '0', name: '更新时间', sort: '0' }, { field: '2', name: '播放数量', sort: '0' }, { field: '4', name: '最高评分', sort: '0' }, { field: '3', name: type === 1 || type === 4 ? '追番人数' : '追剧人数', sort: '0' }, { field: '1', name: '弹幕数量', sort: '0' }]
    return { filter, order }
  },
  '/xlive/general-interface/v1/rank/getOnlineGoldRank': (c) => {
    const r = room(c, int(c.p.roomId))
    const page2 = int(c.p.page, 1), ps = Math.min(50, int(c.p.pageSize, 20))
    const score = new Map<number, number>()
    for (const m of c.db.liveMessages.filter((x) => x.room_id === r.room_id)) score.set(m.uid, (score.get(m.uid) ?? 0) + 1 + (m.price ?? 0) * 10)
    const rows = [...score].filter(([uid]) => uid !== r.uid).sort((a, b) => b[1] - a[1])
    return { onlineNum: rows.length, OnlineRankItem: page(rows, page2, ps).map(([uid, n], i) => ({ userRank: (page2 - 1) * ps + i + 1, uid, name: owner(uid).name, face: owner(uid).face, score: n, medalInfo: null, guard_level: 0 })), ownInfo: null, tips_text: '' }
  },
  '/xlive/app-room/v1/guardTab/topList': (c) => {
    const r = room(c, int(c.p.roomid))
    const pn = int(c.p.page, 1), ps = Math.min(30, int(c.p.page_size, 20))
    const fans = c.db.relations.filter((x) => x.fid === r.uid).sort((a, b) => a.mtime - b.mtime)
    const rows = fans.map((x, i) => ({ uid: x.mid, ruid: r.uid, rank: i + 1, username: owner(x.mid).name, face: owner(x.mid).face, is_alive: 1, guard_level: i === 0 ? 2 : 3, guard_sub_level: 0 }))
    return { info: { num: rows.length, page: Math.max(1, Math.ceil(rows.length / ps)), now: pn, achievement_level: 1 }, top3: pn === 1 ? rows.slice(0, 3) : [], list: page(rows.slice(3), pn, ps) }
  },
  '/x/space/reservation': (c) => {
    const vmid = int(c.p.vmid)
    return c.db.reservations.filter((x) => x.mid === vmid && x.stime > ts()).sort((a, b) => a.stime - b.stime).map((x) => ({
      sid: x.sid, name: x.title, total: 0, stime: x.stime, etime: x.stime + 7200, is_follow: 0, state: 100, oid: '', type: 2, up_mid: x.mid, reserve_record_ctime: x.ctime, live_plan_start_time: x.stime,
      lottery_type: 0, lottery_prize_info: null, show_total: true, subtitle: `${new Date(x.stime * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 直播`, attached_badge_text: '', ugc_info: null, desc: '',
    }))
  },
  // Jumedia: streamers manage their own live reservations.
  '/x/web/reservation/add': (c) => {
    const u = csrf(c)
    const title = (c.p.title ?? '').trim(), stime = int(c.p.stime)
    if (!title || title.length > 40) fail(-400, '标题需为 1–40 个字符')
    if (stime <= ts()) fail(-400, '开播时间需晚于现在')
    const x = { sid: nextID(), mid: u.mid, title, stime, ctime: ts() }
    c.db.reservations.push(x)
    return { sid: x.sid }
  },
  '/x/web/reservation/delete': (c) => {
    const u = csrf(c)
    const x = c.db.reservations.find((r) => r.sid === int(c.p.sid) && r.mid === u.mid)
    if (!x) fail(-404, '预约不存在')
    c.db.reservations = c.db.reservations.filter((r) => r !== x)
    return null
  },
  // ---------- 每周必看 / 单条删除历史 / 粉丝勋章 ----------
  '/x/web-interface/popular/series/list': () => {
    const cur = weeklyCurrent()
    return { list: Array.from({ length: Math.min(cur, 30) }, (_, i) => { const n = cur - i, e = WEEKLY_EPOCH + (n - 1) * 7 * 86400; return { number: n, subject: WEEKLY_SUBJECTS[n % WEEKLY_SUBJECTS.length], status: 2, name: `${new Date(e * 1000).getFullYear()}第${n}期` } }) }
  },
  '/x/web-interface/popular/series/one': (c) => {
    const n = int(c.p.number, weeklyCurrent())
    if (n < 1 || n > weeklyCurrent()) fail(-404, '啥都木有')
    return weeklyIssue(c.db, n)
  },
  // kid: archive_{aid} or pgc_{season_id}.
  '/x/v2/history/delete': (c) => {
    const u = csrf(c)
    const m = /^(archive|pgc)_(\d+)$/.exec(c.p.kid ?? '')
    if (!m) fail(-400, '请求错误')
    const id = Number(m![2])
    c.db.history = c.db.history.filter((h) => h.mid !== u.mid || (m![1] === 'pgc' ? h.sid !== id : h.aid !== id || !!h.sid))
    return null
  },
  '/xlive/app-ucenter/v1/fansMedal/panel': (c) => {
    const u = login(c)
    const pn = int(c.p.page, 1), ps = int(c.p.pageSize, 10), target = int(c.p.target_id)
    const mine = c.db.fanMedals.filter((m) => m.mid === u.mid && (!target || m.ruid === target)).sort((a, b) => Number(b.wearing) - Number(a.wearing) || medalIntimacy(b) - medalIntimacy(a))
    const row = (m: DB['fanMedals'][number]) => { const r = c.db.rooms.find((x) => x.uid === m.ruid); return { medal: medalJSON(m), anchor_info: { nick_name: owner(m.ruid).name, avatar: owner(m.ruid).face, verify: 0 }, room_info: { room_id: r?.room_id ?? 0, living_status: r?.live_status === 1 && !r.banned ? 1 : 0, url: r ? `/live/${r.room_id}` : '' } } }
    const wearing = mine.filter((m) => m.wearing)
    return { list: page(mine.filter((m) => !m.wearing), pn, ps).map(row), special_list: pn === 1 ? wearing.map(row) : [], total_number: mine.length, page_info: { number: mine.length, current_page: pn, has_more: pn * ps < mine.length, total_page: Math.max(1, Math.ceil(mine.length / ps)) } }
  },
  '/rankdb/v1/RoomRank/webMedalRank': (c) => {
    const r = room(c, int(c.p.roomid))
    const fans = c.db.fanMedals.filter((m) => m.ruid === r.uid).sort((a, b) => medalIntimacy(b) - medalIntimacy(a))
    const item = (m: DB['fanMedals'][number], i: number) => ({ uid: m.mid, uname: owner(m.mid).name, face: owner(m.mid).face, rank: i + 1, medal_name: medalName(r.uid), level: medalLevel(medalIntimacy(m)), color: medalColor(medalLevel(medalIntimacy(m))), target_id: r.uid, special: '', isSelf: c.me?.mid === m.mid ? 1 : 0 })
    const meIdx = c.me ? fans.findIndex((m) => m.mid === c.me!.mid) : -1
    return { list: fans.slice(0, 50).map(item), own: meIdx >= 0 ? item(fans[meIdx], meIdx) : null, medal_name: medalName(r.uid), total: fans.length }
  },
  '/xlive/web-room/v1/fansMedal/wear': (c) => {
    const u = csrf(c)
    const m = c.db.fanMedals.find((x) => x.mid === u.mid && x.medal_id === int(c.p.medal_id))
    if (!m) fail(-404, '勋章不存在')
    for (const x of c.db.fanMedals) if (x.mid === u.mid) x.wearing = x === m
    return null
  },
  '/xlive/web-room/v1/fansMedal/take_off': (c) => { const u = csrf(c); for (const x of c.db.fanMedals) if (x.mid === u.mid) x.wearing = false; return null },
  // Jumedia has no gifts, so joining a fan club is free.
  '/xlive/web-room/v1/fansMedal/join': (c) => {
    const u = csrf(c)
    const r = room(c, int(c.p.roomid))
    if (r.uid === u.mid) fail(-400, '不能加入自己的粉丝团')
    let m = c.db.fanMedals.find((x) => x.mid === u.mid && x.ruid === r.uid)
    if (!m) {
      m = { medal_id: nextID(), mid: u.mid, ruid: r.uid, intimacy: 0, today: 0, day: 0, wearing: !c.db.fanMedals.some((x) => x.mid === u.mid && x.wearing), ctime: ts() }
      c.db.fanMedals.push(m)
    }
    return { medal: medalJSON(m) }
  },
  '/x/admin/dashboard': (c) => {
    admin(c)
    const db = c.db
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const day = (i: number) => Math.floor((today.getTime() - (13 - i) * 86400000) / 1000)
    return {
      users: db.users.length, banned: db.users.filter((u) => u.status !== 0).length, archives: db.archives.filter((a) => a.state === 0).length, pending: db.archives.filter((a) => a.state === -1).length,
      seasons: db.seasons.length, episodes: db.seasons.reduce((s, x) => s + x.episodes.length, 0), rooms: db.rooms.length, live_now: db.rooms.filter((r) => r.live_status === 1).length,
      replies: db.replies.length, danmaku: db.danmaku.length, views: db.archives.reduce((s, a) => s + a.stat.view, 0), ...moderationStat(db),
      trend: Array.from({ length: 14 }, (_, i) => ({ date: new Date(day(i) * 1000).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }), uploads: db.archives.filter((a) => a.ctime >= day(i) && a.ctime < day(i) + 86400).length, users: db.users.filter((u) => u.ctime >= day(i) && u.ctime < day(i) + 86400).length, views: Math.floor(db.archives.reduce((s, a) => s + a.stat.view, 0) / 300 * (0.7 + Math.abs(Math.sin(i)) * 0.6)) })),
      regions: visibleRegions(db).map((r) => ({ tid: r.tid, name: r.name, count: db.archives.filter((a) => a.tid === r.tid && a.state === 0).length })),
      top: published(db).sort((a, b) => b.stat.view - a.stat.view).slice(0, 6).map((a) => arcView(a)),
      recent: db.logs.slice(0, 8),
    }
  },
  '/x/admin/users': (c) => {
    admin(c)
    const kw = c.p.keyword ?? ''
    const list = c.db.users.filter((u) => (!kw || searchMatch(u.uname + u.username + u.mid, kw)) && (!c.p.role || u.role === c.p.role) && (c.p.status === undefined || c.p.status === '' || u.status === int(c.p.status)))
    return { list: page(list, int(c.p.pn, 1), int(c.p.ps, 20)).map(adminUser), page: { pn: int(c.p.pn, 1), ps: int(c.p.ps, 20), total: list.length } }
  },
  '/x/admin/user/password': (c) => {
    const me = admin(c)
    if (c.method !== 'POST') fail(-405, '请使用 POST 请求')
    const u = userById(int(c.p.mid))
    if (!u) return fail(-404, '用户不存在')
    if ((c.p.new_password ?? '').length < 6) fail(-400, '新密码至少 6 位')
    u.password = c.p.new_password
    c.db.sessions = c.db.sessions.filter((s) => s.mid !== u.mid)
    c.db.qrcodes = c.db.qrcodes.filter((q) => q.mid !== u.mid)
    log(c, '修改用户密码', u.uname)
    if (u.mid === me.mid) for (const name of ['SESSDATA', 'bili_jct', 'DedeUserID']) document.cookie = `${name}=; path=/; max-age=0`
    return null
  },
  '/x/admin/user/update': (c) => {
    const me = admin(c)
    const u = userById(int(c.p.mid))
    if (!u) return fail(-404, '用户不存在')
    if (u.mid === me.mid && (c.p.status === '1' || c.p.role === 'user')) fail(-400, '不能修改自己的管理权限或封禁自己')
    if (c.p.role) u.role = c.p.role === 'admin' ? 'admin' : 'user'
    if (c.p.status !== undefined) u.status = int(c.p.status) ? 1 : 0
    if (c.p.coins !== undefined) u.coins = int(c.p.coins)
    if (u.status) c.db.sessions = c.db.sessions.filter((s) => s.mid !== u.mid)
    log(c, u.status ? '封禁用户' : '更新用户', u.uname)
    return null
  },
  '/x/admin/archives': (c) => {
    admin(c)
    const kw = c.p.keyword ?? '', state = c.p.state ?? ''
    const list = c.db.archives.filter((a) => (state === '' ? a.state !== -100 && a.state !== -20 : a.state === int(state)) && (!kw || searchMatch(a.title + a.bvid + owner(a.mid).name, kw)) && (!int(c.p.tid) || a.tid === int(c.p.tid))).sort((a, b) => b.ctime - a.ctime)
    const pn = int(c.p.pn, 1), ps = int(c.p.ps, 20)
    return { list: page(list, pn, ps).map((a) => ({ ...arcView(a), origin: a.origin, reason: a.reason, media: a.pages[0]?.media })), page: { pn, ps, total: list.length }, counts: { pending: c.db.archives.filter((a) => a.state === -1).length, rejected: c.db.archives.filter((a) => a.state === -2).length } }
  },
  '/x/admin/archive/danmaku': (c) => {
    admin(c)
    const a = archiveById(int(c.p.aid))
    if (!a || !a.pages.length) return fail(-404, '稿件不存在')
    const cid = int(c.p.cid) || a.pages[0].cid
    if (!a.pages.some((p) => p.cid === cid)) return fail(-404, '分集不存在')
    const cached = c.db.dandanplay?.[cid], pn = int(c.p.pn, 1), ps = int(c.p.ps, 20)
    const comments = cached?.comments ?? []
    return { pages: a.pages.map((p) => ({ cid: p.cid, part: p.part, sync: c.db.dandanplay?.[p.cid]?.sync ?? idleSync(a.aid, p.cid) })), sync: cached?.sync ?? idleSync(a.aid, cid), list: page(comments, pn, ps), page: { pn, ps, total: comments.length } }
  },
  '/x/admin/archive/audit': (c) => {
    admin(c)
    const a = archiveById(int(c.p.aid))
    if (!a) return fail(-404, '稿件不存在')
    a.state = int(c.p.state); a.reason = a.state === -2 ? c.p.reason || '内容不符合社区规范' : ''
    if (a.state === 0 && (a.dtime ?? 0) > ts()) { a.state = -40; a.pubdate = a.dtime! } else if (a.state === 0) a.pubdate = ts()
    log(c, a.state === -2 ? '退回稿件' : '审核通过', a.title)
    return null
  },
  '/x/admin/archive/delete': (c) => { admin(c); const a = archiveById(int(c.p.aid)); if (a) { a.state = -100; log(c, '删除稿件', a.title) } return null },
  '/x/admin/seasons': (c) => {
    admin(c)
    const kw = c.p.keyword ?? ''
    const matched = c.db.seasons.filter((s) => !kw || searchMatch(s.title, kw))
    const list = matched.filter((s) => !int(c.p.season_type) || s.season_type === int(c.p.season_type)).sort((a, b) => b.ctime - a.ctime)
    // `counts`: seasons per season_type (0 = all) for the type chips, under the same keyword.
    const counts: Record<number, number> = { 0: matched.length }
    for (const s of matched) counts[s.season_type] = (counts[s.season_type] ?? 0) + 1
    return { list: page(list, int(c.p.pn, 1), int(c.p.ps, 20)), page: { pn: int(c.p.pn, 1), ps: int(c.p.ps, 20), total: list.length }, counts }
  },
  '/x/admin/season/save': (c) => {
    admin(c)
    const input = JSON.parse(c.p.season ?? '{}')
    if (!input.title) fail(-400, '请填写标题')
    let s = c.db.seasons.find((x) => x.season_id === input.season_id)
    const episodes = (input.episodes ?? []).map((e: Record<string, unknown>, i: number) => ({ ep_id: Number(e.ep_id) || nextID(), aid: Number(e.aid) || nextID(), cid: Number(e.cid) || nextID(), title: String(e.title || i + 1), long_title: String(e.long_title ?? ''), cover: String(e.cover || input.horizontal || ''), duration: Number(e.duration) || 1440, pub_time: Number(e.pub_time) || ts(), media: String(e.media || ''), badge: String(e.badge ?? ''), ...episodeExtras(e, Number(e.duration) || 1440) }))
    const fields = { title: input.title, evaluate: input.evaluate ?? '', season_type: Number(input.season_type) || 1, areas: input.areas ?? [], styles: input.styles ?? [], score: Number(input.score) || 0, is_finish: !!input.is_finish, weekday: Number(input.weekday) || 1, pub_time: input.pub_time || '20:00', cover: input.cover || '', horizontal: input.horizontal || input.cover || '', state: Number(input.state) || 0, episodes }
    if (s) Object.assign(s, fields)
    else { s = { season_id: nextID(), media_id: nextID(), views: 0, follow: 0, danmakus: 0, ctime: ts(), ...fields }; c.db.seasons.push(s) }
    log(c, input.season_id ? '编辑番剧' : '新建番剧', input.title)
    return { season_id: s.season_id }
  },
  '/x/admin/season/delete': (c) => { admin(c); const s = c.db.seasons.find((x) => x.season_id === int(c.p.season_id)); c.db.seasons = c.db.seasons.filter((x) => x !== s); if (s) log(c, '删除番剧', s.title); return null },
  '/x/admin/live/rooms': (c) => {
    admin(c)
    const kw = c.p.keyword ?? ''
    const list = c.db.rooms.filter((r) => !kw || searchMatch(r.title + owner(r.uid).name + r.room_id, kw)).sort((a, b) => b.live_status - a.live_status || b.online - a.online)
    return { list: page(list, int(c.p.pn, 1), int(c.p.ps, 20)).map((r) => ({ ...roomCard(r), banned: r.banned, source: sourceJSON(r), pending_start: !!r.pending_start })), page: { pn: int(c.p.pn, 1), ps: int(c.p.ps, 20), total: list.length } }
  },
  '/x/admin/live/room/videos': (c) => { admin(c); return relayableVideos(c, room(c, int(c.p.room_id)).uid) },
  '/x/admin/live/room/source': async (c) => {
    admin(c)
    const r = room(c, int(c.p.room_id))
    await applySource(c, r)
    // A video whose cache is still transcoding starts once it is ready.
    if (truthy(c.p.start) && !r.banned && r.live_status !== 1) {
      if (r.source?.type === 'video' && notReady(roomCache(c.db, r))) r.pending_start = true
      else Object.assign(r, { live_status: 1, live_time: ts(), online: Math.max(1, r.online), pending_start: false })
    }
    log(c, '配置直播源', `${r.title} · ${r.source?.type === 'm3u8' ? r.source.url : r.source?.type === 'video' ? `转播视频 av${r.source.aid}` : 'RTMP 推流'}`)
    return { source: sourceJSON(r), live_status: r.live_status, pending_start: !!r.pending_start }
  },
  /** Transcode caches of relayed videos, newest first; `rooms` are the rooms relaying each. */
  '/x/admin/live/caches': (c) => {
    admin(c)
    const pn = int(c.p.pn, 1), ps = int(c.p.ps, 20)
    const list = [...c.db.liveCaches].sort((a, b) => b.ctime - a.ctime)
    return {
      list: page(list, pn, ps).map((x) => {
        const a = archiveById(x.aid), p = a?.pages.find((y) => y.cid === x.cid)
        return { ...cacheJSON(x), aid: x.aid, cid: x.cid, title: a?.title ?? '', part: p?.part ?? '', pic: a?.pic ?? '', duration: x.duration, dir: x.dir, ctime: x.ctime, mtime: x.mtime, unused_since: x.unused_since, rooms: c.db.rooms.filter((r) => r.source?.cache === x.key).map((r) => ({ room_id: r.room_id, title: r.title })) }
      }),
      page: { pn, ps, total: list.length },
      dir: cacheDir(c.db), height: Number(c.db.settings.liveTranscodeHeight), keep_hours: 24, bytes: c.db.liveCaches.reduce((n, x) => n + x.size, 0),
    }
  },
  /**
   * Local cache of data-source images (`/media/emby/{item}/image/{kind}?ds=&tag=`).
   * With `imageCacheEnabled` the server keeps each image it proxies under
   * `imageCacheDir` (empty: `{数据目录}/image-cache`) and serves repeats from disk;
   * least recently used images are evicted beyond `imageCacheMaxMB`. Access
   * checks still run on every request. The browser mock links Emby images
   * directly, so it has nothing cached and reports zero usage.
   */
  '/x/admin/imagecache': (c) => {
    admin(c)
    const s = c.db.settings
    return { enabled: !!s.imageCacheEnabled, dir: String(s.imageCacheDir || '') || '{数据目录}/image-cache', max_mb: Number(s.imageCacheMaxMB), files: 0, bytes: 0 }
  },
  '/x/admin/imagecache/clear': (c) => {
    admin(c)
    log(c, '清空图片缓存', '')
    return { files: 0, bytes: 0 }
  },
  '/x/admin/live/cache/retry': (c) => {
    admin(c)
    const x = c.db.liveCaches.find((y) => y.key === c.p.key)
    if (!x) return fail(-404, '缓存不存在')
    retryCache(x)
    log(c, '重试转码', `av${x.aid}`)
    return cacheJSON(x)
  },
  '/x/admin/live/cache/delete': (c) => {
    admin(c)
    const x = c.db.liveCaches.find((y) => y.key === c.p.key)
    if (!x) return fail(-404, '缓存不存在')
    if (c.db.rooms.some((r) => r.source?.cache === x.key)) fail(-400, '仍有直播间在使用该缓存，请先更换它们的直播源')
    c.db.liveCaches = c.db.liveCaches.filter((y) => y !== x)
    log(c, '删除转码缓存', `av${x.aid}`)
    return null
  },
  '/x/admin/live/room/ban': (c) => { admin(c); const r = room(c, int(c.p.room_id)); r.banned = truthy(c.p.banned); if (r.banned) r.live_status = 0; log(c, r.banned ? '封禁直播间' : '解封直播间', r.title); return null },
  '/x/admin/replies': (c) => {
    admin(c)
    const kw = c.p.keyword ?? '', flagged = truthy(c.p.flagged)
    const list = c.db.replies.filter((r) => (!kw || searchMatch(r.message + (userById(r.mid)?.uname ?? ''), kw)) && (!flagged || flagOf(c.db, r.message)) && (!truthy(c.p.reported) || pendingReports(c.db, r.rpid).length > 0)).sort((a, b) => pendingReports(c.db, b.rpid).length - pendingReports(c.db, a.rpid).length || b.ctime - a.ctime)
    return { list: page(list, int(c.p.pn, 1), int(c.p.ps, 20)).map((r) => ({ ...replyJSON(r, undefined, false), flag: flagOf(c.db, r.message), report_count: pendingReports(c.db, r.rpid).length, report_reasons: [...new Set(pendingReports(c.db, r.rpid).map((x) => x.reason))], archive: archiveById(r.oid) ? { aid: r.oid, bvid: archiveById(r.oid)!.bvid, title: archiveById(r.oid)!.title } : null })), page: { pn: int(c.p.pn, 1), ps: int(c.p.ps, 20), total: list.length }, stat: moderationStat(c.db) }
  },
  '/x/admin/reply/report/dismiss': (c) => {
    csrf(c); admin(c)
    if (c.method !== 'POST') fail(-400, '请使用 POST')
    for (const r of c.db.commentReports ?? []) if (r.rpid === int(c.p.rpid) && r.status === 'pending') r.status = 'dismissed'
    log(c, '驳回评论举报', c.p.rpid)
    return null
  },
  '/x/admin/reply/delete': (c) => { admin(c); const r = c.db.replies.find((x) => x.rpid === int(c.p.rpid)); c.db.replies = c.db.replies.filter((x) => x.rpid !== r?.rpid && x.root !== r?.rpid); for (const report of c.db.commentReports ?? []) if (report.status === 'pending' && !c.db.replies.some((x) => x.rpid === report.rpid)) report.status = 'removed'; if (r) { syncReplyCount(c.db, r.oid); log(c, '删除评论', r.message.slice(0, 20)) } return null },
  '/x/admin/danmaku': (c) => {
    admin(c)
    const kw = c.p.keyword ?? '', flagged = truthy(c.p.flagged)
    const list = c.db.danmaku.filter((d) => d.weight === 10 || kw).filter((d) => (!kw || searchMatch(d.content, kw)) && (!flagged || flagOf(c.db, d.content))).sort((a, b) => b.ctime - a.ctime)
    return { list: page(list, int(c.p.pn, 1), int(c.p.ps, 20)).map((d) => { const f = pageOfCid(d.cid); return { ...d, flag: flagOf(c.db, d.content), member: owner(d.mid), target: f && 'a' in f && f.a ? f.a.title : f && 's' in f && f.s ? f.s.title : '' } }), page: { pn: int(c.p.pn, 1), ps: int(c.p.ps, 20), total: list.length }, stat: moderationStat(c.db) }
  },
  '/x/admin/danmaku/delete': (c) => { admin(c); c.db.danmaku = c.db.danmaku.filter((d) => d.id !== int(c.p.id)); log(c, '删除弹幕', c.p.id); return null },
  '/x/admin/regions': (c) => { admin(c); return { list: [...c.db.regions].sort((a, b) => a.sort - b.sort).map((r) => ({ ...r, parent: r.parent ?? 0, count: c.db.archives.filter((a) => (r.parent ? a.sub_tid : a.tid) === r.tid && a.state === 0).length })) } },
  '/x/admin/region/save': (c) => {
    admin(c)
    const r = c.db.regions.find((x) => x.tid === int(c.p.tid))
    const fields = { name: (c.p.name ?? '').trim(), sort: int(c.p.sort), visible: truthy(c.p.visible) }
    if (!fields.name) fail(-400, '请填写分区名称')
    // `parent` (create only) makes a sub-region of a top-level region; tids are parent * 100 + n.
    const parent = int(c.p.parent)
    if (parent && !c.db.regions.some((x) => x.tid === parent && !x.parent)) fail(-400, '上级分区不存在')
    if (r) Object.assign(r, fields)
    else if (parent) c.db.regions.push({ tid: Math.max(parent * 100, ...subRegions(c.db, parent, true).map((x) => x.tid)) + 1, ...fields, parent })
    else c.db.regions.push({ tid: Math.max(...c.db.regions.filter((x) => !x.parent).map((x) => x.tid)) + 1, ...fields })
    log(c, r ? '编辑分区' : '新建分区', fields.name)
    return null
  },
  // Jumedia: drag-to-reorder; `tids` lists one level (top-level regions or one parent's sub-regions) in the new order.
  '/x/admin/region/sort': (c) => {
    admin(c)
    const tids = (c.p.tids ?? '').split(',').map(Number).filter(Boolean)
    const rows = tids.map((t) => c.db.regions.find((x) => x.tid === t))
    if (!rows.length || rows.some((r) => !r) || new Set(rows.map((r) => r!.parent ?? 0)).size !== 1 || new Set(tids).size !== tids.length) fail(-400, '分区排序参数无效')
    rows.forEach((r, i) => { r!.sort = i })
    log(c, '调整分区排序', rows.map((r) => r!.name).join('、'))
    return null
  },
  '/x/admin/region/delete': (c) => {
    admin(c)
    const tid = int(c.p.tid)
    if (c.db.archives.some((a) => a.tid === tid && a.state !== -100)) fail(-400, '该分区下仍有稿件，请先迁移')
    for (const a of c.db.archives) if (a.sub_tid === tid) a.sub_tid = 0
    c.db.regions = c.db.regions.filter((r) => r.tid !== tid && r.parent !== tid)
    return null
  },
  '/x/admin/live/areas': (c) => { admin(c); return { list: c.db.liveAreas.map((a) => ({ ...a, rooms: c.db.rooms.filter((r) => r.parent_area_id === a.id).length })) } },
  '/x/admin/live/area/save': (c) => {
    admin(c)
    const a = c.db.liveAreas.find((x) => x.id === int(c.p.id))
    if (a) a.name = c.p.name
    else c.db.liveAreas.push({ id: Math.max(...c.db.liveAreas.map((x) => x.id)) + 1, name: c.p.name, children: [{ id: nextID(), name: c.p.name }] })
    return null
  },
  '/x/admin/banners': (c) => { admin(c); return { list: [...c.db.banners].sort((a, b) => a.position.localeCompare(b.position) || a.sort - b.sort) } },
  '/x/admin/banner/save': (c) => {
    admin(c)
    const b = c.db.banners.find((x) => x.id === int(c.p.id))
    const sid = /\/ss(\d+)/.exec(c.p.url ?? '')
    const position = (['anime', 'channel'].includes(c.p.position) ? c.p.position : 'home') as Banner['position']
    if (position === 'channel' && !int(c.p.loc)) fail(-400, '请选择频道')
    const fields = { title: c.p.title, img: c.p.img || fail(-400, '请上传轮播图片'), url: c.p.url, position, sort: int(c.p.sort), season_id: sid ? Number(sid[1]) : undefined, loc: position === 'channel' ? int(c.p.loc) : undefined }
    if (b) Object.assign(b, fields)
    else c.db.banners.push({ id: nextID(), ...fields })
    log(c, b ? '编辑轮播' : '新建轮播', c.p.title)
    return null
  },
  '/x/admin/banner/delete': (c) => { admin(c); c.db.banners = c.db.banners.filter((b) => b.id !== int(c.p.id)); return null },
  '/x/admin/settings': (c) => { admin(c); return { ...Object.fromEntries(Object.entries(c.db.settings).filter(([k]) => !k.startsWith('_demo_') && !k.startsWith('_dandanplay_'))), dandanplayHasSecret: !!c.db.settings._dandanplay_has_secret } },
  /**
   * Jumedia: start-up parameters (read-only; changing them needs a restart) and the start-up
   * values behind the runtime overrides in settings. The browser mock has no process, so these are placeholders.
   */
  '/x/admin/server': (c) => {
    admin(c)
    return {
      boot: [
        { key: 'JUMEDIA_ADDR', label: '监听地址', value: ':8080' },
        { key: 'JUMEDIA_DB_DRIVER', label: '数据库', value: 'sqlite' },
        { key: 'JUMEDIA_DB_DSN', label: '数据库连接', value: 'data/jumedia.db' },
        { key: 'JUMEDIA_DATA_DIR', label: '数据目录', value: 'data' },
        { key: 'JUMEDIA_WEB_DIR', label: '网页目录', value: '' },
        { key: 'JUMEDIA_STATIC_DIR', label: '静态资源目录', value: '../Jumedia-web/public' },
        { key: 'JUMEDIA_DATASOURCE_KEY', label: '数据源密钥', value: '未设置' },
      ],
      startup: { publicOrigin: '', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', videoEncoder: 'auto' },
    }
  },
  '/x/admin/demo/import': async (c) => {
    admin(c); csrf(c)
    if (c.method !== 'POST') fail(-400, '请使用 POST 上传演示数据包')
    const file = c.form?.get('file')
    if (!(file instanceof File)) fail(-400, '请选择演示数据包文件')
    if ((file as File).size > 32 * 1024 * 1024) fail(-400, '演示数据包格式无效')
    try { importDemo(parseDemoPackage(await (file as File).text())) } catch (e) { fail(-400, e instanceof Error ? e.message : '演示数据包格式无效') }
    queueRelayedCaches(getDB())
    return null
  },
  '/x/admin/settings/save': (c) => {
    admin(c)
    if (c.p.reset === 'true') { resetDB(); return null }
    for (const key of ['commentMinInterval', 'commentDuplicateWindow']) {
      const v = c.p[key]
      if (v !== undefined && (!v.trim() || !Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 86400)) fail(-400, '评论防刷时间应为 0–86400 秒的整数')
    }
    for (const key of ['commentEnabled', 'commentReplyEnabled']) if (c.p[key] !== undefined && !['true', 'false'].includes(c.p[key])) fail(-400, '评论开关参数无效')
    // The server also checks it can create and write the directory.
    if (c.p.liveCacheDir !== undefined && c.p.liveCacheDir.trim() && !c.p.liveCacheDir.trim().startsWith('/')) fail(-400, '缓存目录必须是绝对路径')
    if (c.p.liveTranscodeHeight !== undefined && !TRANSCODE_HEIGHTS.includes(Number(c.p.liveTranscodeHeight))) fail(-400, '转码分辨率无效')
    if (c.p.dataSourceSyncRate !== undefined && !(Number.isInteger(Number(c.p.dataSourceSyncRate)) && Number(c.p.dataSourceSyncRate) >= 1 && Number(c.p.dataSourceSyncRate) <= 50)) fail(-400, '每秒请求数应为 1–50 的整数')
    if (c.p.dataSourceSyncConcurrency !== undefined && !(Number.isInteger(Number(c.p.dataSourceSyncConcurrency)) && Number(c.p.dataSourceSyncConcurrency) >= 1 && Number(c.p.dataSourceSyncConcurrency) <= 8)) fail(-400, '并发请求数应为 1–8 的整数')
    if (c.p.imageCacheDir !== undefined && c.p.imageCacheDir.trim() && !c.p.imageCacheDir.trim().startsWith('/')) fail(-400, '图片缓存目录必须是绝对路径')
    if (c.p.imageCacheMaxMB !== undefined && !(Number.isInteger(Number(c.p.imageCacheMaxMB)) && Number(c.p.imageCacheMaxMB) >= 64 && Number(c.p.imageCacheMaxMB) <= 1048576)) fail(-400, '图片缓存上限应为 64–1048576 MB 的整数')
    if (c.p.imageCacheDir !== undefined) c.p.imageCacheDir = c.p.imageCacheDir.trim()
    if (c.p.liveCacheDir !== undefined) c.p.liveCacheDir = c.p.liveCacheDir.trim()
    serverInput(c)
    const before = { ...c.db.settings }
    const services = serviceInput(c)
    if (services) Object.assign(c.p, services)
    if (c.p.dandanplayEnabled !== undefined && !['true', 'false'].includes(c.p.dandanplayEnabled)) fail(-400, '弹幕同步开关无效')
    if (c.p.dandanplayApi !== undefined) {
      const address = c.p.dandanplayApi.trim().replace(/\/+$/, '') || 'https://api.dandanplay.net'
      try { const u = new URL(address); if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || u.username || u.password || u.search || u.hash) throw new Error() } catch { fail(-400, '弹弹play 接口地址无效') }
      c.p.dandanplayApi = address
    }
    if (c.p.dandanplayAppId !== undefined) c.p.dandanplayAppId = c.p.dandanplayAppId.trim()
    const hasSecret = !!c.p.dandanplayAppSecret?.trim() || (c.p.dandanplaySecretClear !== 'true' && !!c.db.settings._dandanplay_has_secret)
    const enabled = c.p.dandanplayEnabled === undefined ? c.db.settings.dandanplayEnabled : c.p.dandanplayEnabled === 'true'
    if (enabled && Boolean(c.p.dandanplayAppId ?? c.db.settings.dandanplayAppId) !== hasSecret) fail(-400, 'App ID 和 App Secret 请同时填写，或同时留空以使用无需签名的服务')
    c.db.settings._dandanplay_has_secret = hasSecret
    for (const [k, v] of Object.entries(c.p)) {
      if (k.startsWith('_demo_') || k.startsWith('_dandanplay_') || k === 'csrf' || k === 'biliCSRF' || k === 'serviceMtime' || !(k in c.db.settings)) continue
      const cur = c.db.settings[k]
      c.db.settings[k] = typeof cur === 'boolean' ? v === 'true' : typeof cur === 'number' ? Number(v) : v
    }
    if (services && SERVICE_FIELDS.some((k) => String(c.db.settings[k]) !== String(before[k]))) c.db.settings.serviceMtime = ts()
    log(c, '修改站点设置', '')
    return null
  },
  // Optional filters (web only): `kind` (archive|user|live|datasource|settings), `days` (0 = any), `mid` (operator).
  '/x/admin/logs': (c) => {
    admin(c)
    const pn = int(c.p.pn, 1), ps = int(c.p.ps, 30), days = int(c.p.days), mid = int(c.p.mid)
    const kind = LOG_KINDS[c.p.kind ?? '']
    const list = c.db.logs.filter((l) => (!kind || kind.test(l.action)) && (!days || l.ctime >= ts() - days * 86400) && (!mid || l.mid === mid))
    const operators = [...new Set(c.db.logs.map((l) => l.mid))].map((m) => owner(m))
    return { list: page(list, pn, ps).map((l) => ({ ...l, member: owner(l.mid) })), page: { pn, ps, total: list.length }, operators }
  },
  // Site-wide public settings used by the shell (announcement, registration switch).
  // Jumedia: the service distribution clients read at start-up. Addresses left empty resolve to this site.
  '/x/jumedia/service': (c) => {
    const base = (k: string) => String(c.db.settings[k] ?? '') || c.origin
    return { api: base('serviceApi'), live: base('serviceLive'), app: base('serviceApp'), passport: base('servicePassport'), cdn: JSON.parse(String(c.db.settings.serviceCdns || '[]')), mtime: Number(c.db.settings.serviceMtime ?? 0) }
  },
  '/x/jumedia/site': (c) => ({ version: 'mock', siteName: c.db.settings.siteName, allowRegister: c.db.settings.allowRegister, announcement: c.db.settings.announcement, banners: c.db.banners.filter((b) => b.position === 'home').sort((a, b) => a.sort - b.sort) }),

  /** All data sources; `system` ones belong to the official account (`settings.officialMid`). */
  '/x/admin/datasources': (c) => {
    admin(c)
    const kw = c.p.keyword ?? '', scope = c.p.scope ?? ''
    const list = c.db.dataSources.filter((x) => (scope === 'system' ? x.system : scope === 'user' ? !x.system : true) && (!kw || searchMatch(`${x.name} ${x.url} ${x.server_name} ${owner(x.mid).name}`, kw)))
      .sort((a, b) => Number(b.system) - Number(a.system) || a.ctime - b.ctime)
    const pn = int(c.p.pn, 1), ps = int(c.p.ps, 20)
    return { list: page(list, pn, ps).map((x) => dataSourceJSON(c.db, x)), page: { pn, ps, total: list.length }, official: owner(Number(c.db.settings.officialMid)) }
  },
  '/x/admin/datasource/test': async (c) => { admin(c); return testSource(c, c.p.id ? anySource(c) : undefined, true) },
  '/x/admin/datasource/save': async (c) => { admin(c); return saveSource(c, c.p.id ? anySource(c) : undefined, true) },
  '/x/admin/datasource/sync': (c) => { admin(c); return startSync(c, anySource(c)) },
  '/x/admin/datasource/delete': (c) => { admin(c); deleteSource(c, anySource(c)); return null },
}

// ---------------- data sources ----------------

const MAX_SOURCES = 5
const ARCHIVE_FIELDS: ArchiveField[] = ['title', 'desc', 'tid', 'tag', 'pic']
const COLLECTION_FIELDS: CollectionField[] = ['title', 'intro', 'cover']

function userSources(c: Ctx) { if (!c.db.settings.userDataSources) fail(-403, '站点未开放个人数据源') }
/** The caller's own source named by `id`; `optional` allows no id (creating one). */
function ownSource(c: Ctx, optional = false): DataSource | undefined {
  if (optional && !c.p.id) return undefined
  const ds = c.db.dataSources.find((x) => x.id === int(c.p.id) && x.mid === c.me!.mid && !x.system)
  return ds ?? fail(-404, '数据源不存在')
}
const anySource = (c: Ctx) => c.db.dataSources.find((x) => x.id === int(c.p.id)) ?? fail(-404, '数据源不存在')

/** Address and credentials from the request; an empty password keeps the stored one unless `clear_password`. */
function credentials(c: Ctx, existing: DataSource | undefined, system: boolean): { type: SourceType; url: string; username: string; password: string } {
  const type = c.p.type || existing?.type || 'emby'
  if (type !== 'emby' && type !== 'jellyfin' && type !== 'fntv' && type !== 'plex') return fail(-400, '不支持的数据源类型')
  if (type === 'fntv' && c.p.proxy_playback === 'false') return fail(-400, '飞牛影视需要通过 Jumedia 代理播放')
  if (existing && type !== existing.type) return fail(-400, '已保存的数据源不能更改类型')
  const url = (c.p.url ?? '').trim(), username = (c.p.username ?? '').trim()
  if (!url) fail(-400, `请填写 ${sourceNames[type]} 服务器地址`)
  if (!username) fail(-400, `请填写 ${sourceNames[type]} 用户名`)
  try { sourceBase(url, type) } catch (e) { fail(-400, (e as Error).message) }
  if (!system && !c.db.settings.dataSourcePrivateNetwork && privateHost(url)) fail(-400, '站点不允许使用内网地址的媒体服务器')
  const password = c.p.password ? c.p.password : truthy(c.p.clear_password) ? '' : existing?.password ?? ''
  return { type, url, username, password }
}
async function connect(type: SourceType, url: string, username: string, password: string) {
  try { return await probeSource(type, url, username, password) } catch (e) { return fail(-400, e instanceof SourceError ? e.message : '无法连接媒体服务器') }
}
function testSource(c: Ctx, existing: DataSource | undefined, system: boolean) {
  const { type, url, username, password } = credentials(c, existing, existing?.system ?? system)
  return connect(type, url, username, password)
}

async function saveSource(c: Ctx, existing: DataSource | undefined, system: boolean) {
  system = existing?.system ?? system
  const { type, url, username, password } = credentials(c, existing, system)
  if (!existing && !system && c.db.dataSources.filter((x) => x.mid === c.me!.mid && !x.system).length >= MAX_SOURCES) fail(-400, `最多添加 ${MAX_SOURCES} 个数据源`)
  if (existing?.status === 'syncing') fail(-400, '正在同步中，请稍后再修改')
  const mid = existing?.mid ?? (system ? Number(c.db.settings.officialMid) : c.me!.mid)
  if (!userById(mid)) fail(-400, '官方账号不存在，请先在站点设置中配置')
  const info = await connect(type, url, username, password)
  if (c.db.dataSources.some((x) => x !== existing && x.mid === mid && x.system === system && x.server_id === info.server_id && x.username === username)) fail(-400, `已经添加过这个 ${sourceNames[type]} 账号`)
  const enabled = c.p.libraries === undefined ? null : new Set(c.p.libraries.split(',').filter(Boolean))
  const libraries = info.libraries.map((l) => {
    const old = existing?.libraries.find((x) => x.id === l.id)
    return { ...l, enabled: enabled ? enabled.has(l.id) : old?.enabled ?? true, items: old?.items ?? 0, collection_id: old?.collection_id ?? 0 }
  })
  const name = (c.p.name ?? '').trim().slice(0, 30) || info.server_name || sourceNames[type]
  const ds: DataSource = existing ?? { id: nextID(), mid, system, type, name, url, username, password, server_name: '', server_id: '', libraries: [], auto_sync: true, proxy_playback: true, status: 'idle', message: '', last_sync: 0, ctime: ts() }
  Object.assign(ds, { name, url, username, password, server_name: info.server_name, server_id: info.server_id, libraries, auto_sync: c.p.auto_sync === undefined ? ds.auto_sync : truthy(c.p.auto_sync), proxy_playback: c.p.proxy_playback === undefined ? ds.proxy_playback ?? true : truthy(c.p.proxy_playback) })
  if (!existing) c.db.dataSources.push(ds)
  forgetSession(ds.id)
  log(c, existing ? '修改数据源' : '添加数据源', `${ds.name}${system ? '（系统）' : ''}`)
  return c.p.sync_now !== undefined && !truthy(c.p.sync_now) ? dataSourceJSON(c.db, ds) : startSync(c, ds)
}

/** Starts a sync in the background; callers poll the source list until `status` leaves `syncing`. */
function startSync(c: Ctx, ds: DataSource) {
  if (ds.status === 'syncing') fail(-400, '正在同步中，请稍后')
  Object.assign(ds, { status: 'syncing', message: '正在同步媒体库…' })
  const db = c.db
  syncSource(db, ds, nextID)
    .then((r) => Object.assign(ds, r.failures
      ? { status: 'error', message: `部分内容同步失败（${r.failures} 处）：${r.error}；已同步 ${r.count} 个视频` }
      : { status: 'ok', message: `已同步 ${r.count} 个视频` }))
    .catch((e) => Object.assign(ds, { status: 'error', message: e instanceof SourceError ? e.message : `同步失败：${(e as Error).message}` }))
    .finally(() => { ds.last_sync = ts(); save() })
  return dataSourceJSON(db, ds)
}

function deleteSource(c: Ctx, ds: DataSource) {
  purgeSource(c.db, ds)
  c.db.dataSources = c.db.dataSources.filter((x) => x !== ds)
  log(c, '删除数据源', ds.name)
}

function collectionOrigin(db: DB, x: DB['collections'][number]) {
  const o = x.origin
  if (!o) return null
  const ds = db.dataSources.find((d) => d.id === o.ds)
  return { type: o.type, datasource_id: o.ds, datasource_name: ds?.name ?? '', library: ds?.libraries.find((l) => l.id === o.library)?.name ?? '', locked: o.locked, meta: o.meta }
}

/** Edit of a data-source archive: only Jumedia metadata changes, media stays as synced; changed fields are locked. */
function editOrigin(c: Ctx, u: User, a: Archive, title: string) {
  const draft = truthy(c.p.draft), oldState = a.state
  if (draft) {
    if (oldState !== -20) fail(-400, '已投稿的稿件不能存为草稿')
    title = title.slice(0, 80) || '未命名草稿'
  } else if (!title || title.length > 80) fail(21001, '标题需为 1–80 个字符')
  if (!c.db.regions.some(r => r.tid === int(c.p.tid) && !r.parent)) fail(21002, '请选择分区')
  const sub = int(c.p.sub_tid)
  if (sub && !c.db.regions.some(r => r.tid === sub && r.parent === int(c.p.tid))) fail(21002, '子分区不属于所选分区')
  const dtime = !draft && oldState === 0 ? 0 : int(c.p.dtime)
  if (!draft && dtime && (dtime < ts() + DTIME_MIN - 60 || dtime > ts() + DTIME_MAX)) fail(21004, '定时发布时间需在 2 小时后、15 天内')
  const o = a.origin!
  const next: Record<ArchiveField, string | number> = { title, desc: c.p.desc ?? '', tid: int(c.p.tid), tag: c.p.tag ?? '', pic: c.p.cover || a.pic }
  for (const f of ARCHIVE_FIELDS) {
    if (next[f] === a[f]) continue
    ;(a as unknown as Record<string, unknown>)[f] = next[f]
    o.locked = next[f] === o.meta[f] ? o.locked.filter((x) => x !== f) : [...new Set([...o.locked, f])]
  }
  const ds = c.db.dataSources.find((x) => x.id === o.ds)
  if (draft) a.state = -20
  else if (a.state !== -6) a.state = c.db.settings.auditRequired && u.role !== 'admin' && !ds?.system ? -1 : dtime ? -40 : 0
  if (!draft) { if (dtime) a.pubdate = dtime; else if (oldState === -20) a.pubdate = ts() }
  Object.assign(a, { sub_tid: sub, dtime: dtime || undefined, no_disturbance: truthy(c.p.no_disturbance), no_tv: truthy(c.p.no_tv) })
  a.reason = ''
  if (!draft) log(c, oldState === -20 ? '投稿' : '编辑稿件', title)
  return { aid: a.aid, bvid: a.bvid, state: a.state }
}

// ---------------- relaying a video ----------------

/** HLS path of a relayable page (data-source or demo Emby media), else ''. */
function mediaHlsPath(media: string) {
  const ds = parseDsRef(media)
  if (ds) return dsHlsPath(ds.item, ds.source, ds.ds)
  return ''
}
function relayableVideos(c: Ctx, mid: number) {
  const kw = c.p.keyword ?? ''
  const list = c.db.archives.filter((a) => a.mid === mid && a.state !== -100 && a.state !== -6 && a.pages.some((p) => mediaHlsPath(p.media)) && (!kw || searchMatch(a.title, kw))).sort((a, b) => b.ctime - a.ctime || b.aid - a.aid)
  const pn = int(c.p.pn, 1), ps = int(c.p.ps, 20)
  return {
    list: page(list, pn, ps).map((a) => ({ aid: a.aid, bvid: a.bvid, title: a.title, pic: a.pic, state: a.state, datasource: originJSON(c.db, a)?.datasource_name ?? '', pages: a.pages.filter((p) => mediaHlsPath(p.media)).map((p) => ({ cid: p.cid, part: p.part, duration: p.duration })) })),
    page: { pn, ps, total: list.length },
  }
}
/** Rooms saved before transcode caches (v7) relay Emby HLS; give them a cache like a fresh save would. */
function queueRelayedCaches(db: DB) {
  for (const r of db.rooms) {
    if (r.source?.type !== 'video' || r.source.cache) continue
    const a = archiveById(r.source.aid ?? 0), p = a?.pages.find((x) => x.cid === r.source!.cid)
    if (!a || !p || !mediaHlsPath(p.media)) { r.source = { type: 'push', url: '', loop: true }; r.live_status = 0; continue }
    const cache = ensureCache(db, p.media, a.aid, p.cid, p.duration)
    Object.assign(r.source, { url: cachePath(cache.key), cache: cache.key })
    if (r.live_status === 1) Object.assign(r, { live_status: 0, pending_start: true })
  }
}
/** Room source as returned to the streamer/admin; `video` carries the relayed page. */
function sourceJSON(r: LiveRoom) {
  const src = r.source ?? { type: 'push' as const, url: '', loop: true }
  if (src.type !== 'video') return src
  const a = archiveById(src.aid ?? 0), p = a?.pages.find((x) => x.cid === src.cid)
  return { ...src, video: a && p ? { aid: a.aid, bvid: a.bvid, cid: p.cid, title: a.title, part: p.part, pic: a.pic, duration: p.duration } : null, cache: cacheJSON(roomCache(getDB(), r)) }
}

/** Legacy ranking rids → Jumedia region tids. */
const LEGACY_RIDS: Record<number, number[]> = {
  1: [1005], 13: [1005], 32: [1005], 33: [1005], 51: [1005], 152: [1005], 167: [1005], 3: [1003], 129: [1004], 4: [1008], 36: [1010], 188: [1012],
  234: [1018], 223: [1013], 160: [1030, 1031], 211: [1020], 217: [1024], 119: [1007], 155: [1014], 5: [1002], 181: [1001],
}

function react(c: Ctx, field: 'likers' | 'haters') {
  const u = csrf(c)
  const r = c.db.replies.find((x) => x.rpid === int(c.p.rpid))
  if (!r) return fail(12022, '评论已被删除')
  r.likers = r.likers.filter((m) => m !== u.mid); r.haters = r.haters.filter((m) => m !== u.mid)
  if (c.p.action === '1') r[field].push(u.mid)
  return null
}

function pgcFeed(c: Ctx) {
  const type = { anime: 1, guochuang: 4, documentary: 3, movie: 2, tv: 5, variety: 7 }[c.p.name as 'anime'] ?? 1
  const list = c.db.seasons.filter((s) => s.state === 0 && s.season_type === type).sort((a, b) => b.follow - a.follow)
  const cursor = int(c.p.coursor)
  const rows = list.slice(cursor, cursor + 12)
  const sub = rows.map((s) => ({ season_id: s.season_id, episode_id: s.episodes[0]?.ep_id, title: s.title, cover: s.cover, sub_title: indexShow(s), rating: String(s.score), stat: { view: compactCount(s.views), follow: compactCount(s.follow) }, hover: { text: [`${s.score}分`, s.styles.join(' ')] }, link: `/bangumi/play/ss${s.season_id}`, badge_info: { text: seasonBadge(s) } }))
  return { items: type === 1 || type === 4 ? [{ card_style: 'v_card', sub_items: sub }] : sub, coursor: cursor + rows.length, has_next: cursor + rows.length < list.length }
}

function toview(c: Ctx, desc: boolean) {
  const u = login(c)
  return c.db.toview.filter((t) => t.mid === u.mid).sort((a, b) => (desc ? b.add_at - a.add_at : a.add_at - b.add_at))
    .map((t) => { const a = archiveById(t.aid); const h = c.db.history.find((x) => x.mid === u.mid && x.aid === t.aid); return a ? arcView(a, { add_at: t.add_at, progress: h?.progress ?? 0 }) : null }).filter(Boolean)
}

function collectionVideos(c: Ctx, id: number, pn: number, reverse: boolean) {
  const x = c.db.collections.find((y) => y.id === id)
  if (!x) return fail(-404, '合集不存在')
  const arcs = x.aids.map(archiveById).filter((a): a is Archive => !!a && a.state === 0)
  const ordered = x.kind === 'season' ? (reverse ? [...arcs].reverse() : arcs) : [...arcs].sort((a, b) => (reverse ? a.pubdate - b.pubdate : b.pubdate - a.pubdate))
  return { aids: ordered.map((a) => a.aid), archives: page(ordered, pn, 30).map(spaceArc), meta: { season_id: x.id, series_id: x.id, name: x.title, cover: x.cover, description: x.intro, total: arcs.length, mid: x.mid }, page: { page_num: pn, num: pn, page_size: 30, size: 30, total: arcs.length } }
}

function room(c: Ctx, id: number) {
  const r = c.db.rooms.find((x) => x.room_id === id)
  if (!r || (r.banned && c.me?.role !== 'admin' && c.me?.mid !== r.uid)) fail(19002003, '房间不存在或已被封禁')
  return r!
}

function liveRoomOf(db: DB, mid: number) {
  const r = db.rooms.find((x) => x.uid === mid && !x.banned)
  return r ? { roomStatus: 1, liveStatus: r.live_status, title: r.title, cover: r.cover, roomid: r.room_id, url: `/live/${r.room_id}`, watched_show: { text_large: `${compactCount(r.online)}人看过` } } : null
}

/** Earliest and latest scheduled publish times: 2 hours to 15 days ahead. */
const DTIME_MIN = 2 * 3600, DTIME_MAX = 15 * 86400

function submitArchive(c: Ctx) {
  const u = csrf(c)
  const target = c.p.aid ? archiveById(int(c.p.aid)) : undefined
  if (target?.origin && target.mid === u.mid && target.state !== -100) return editOrigin(c, u, target, (c.p.title ?? '').trim())
  if (c.p.aid && (!target || target.mid !== u.mid || target.state === -100)) fail(-404, '稿件不存在')
  // Jumedia: `draft=1` saves without review or validation (state -20, 创建未提交).
  if (truthy(c.p.draft)) {
    if (target && target.state !== -20) fail(-400, '已投稿的稿件不能存为草稿')
    return saveArchive(c, u, target, { title: (c.p.title ?? '').trim().slice(0, 80) || '未命名草稿', state: -20, pubdate: 0, dtime: int(c.p.dtime) || undefined })
  }
  const title = (c.p.title ?? '').trim()
  if (!title || title.length > 80) fail(21001, '标题需为 1–80 个字符')
  if (!c.db.regions.some((r) => r.tid === int(c.p.tid) && !r.parent)) fail(21002, '请选择分区')
  const sub = int(c.p.sub_tid)
  if (sub && !c.db.regions.some((r) => r.tid === sub && r.parent === int(c.p.tid))) fail(21002, '子分区不属于所选分区')
  if (!JSON.parse(c.p.videos || '[]').length) fail(21003, '请至少上传一个视频')
  // A published archive can't be rescheduled; editing it keeps its publish time.
  const dtime = target && target.state === 0 ? 0 : int(c.p.dtime)
  if (dtime && (dtime < ts() + DTIME_MIN - 60 || dtime > ts() + DTIME_MAX)) fail(21004, '定时发布时间需在 2 小时后、15 天内')
  const state = c.db.settings.auditRequired && u.role !== 'admin' ? -1 : dtime ? -40 : 0
  const pubdate = dtime || (target && target.state !== -20 ? target.pubdate : ts())
  const r = saveArchive(c, u, target, { title, state, pubdate, dtime: dtime || undefined })
  log(c, target && target.state !== -20 ? '编辑稿件' : '投稿', title)
  return r
}

function saveArchive(c: Ctx, u: User, existing: Archive | undefined, over: { title: string; state: number; pubdate: number; dtime?: number }) {
  const videos = JSON.parse(c.p.videos || '[]') as { filename: string; title: string; duration: number }[]
  const oldPages = existing?.pages ?? []
  const pages = videos.map((v) => ({ cid: oldPages.find((p) => p.media === v.filename)?.cid ?? nextID(), part: v.title || over.title, duration: Math.max(1, Math.round(v.duration || 1)), media: v.filename }))
  const fields = {
    title: over.title, desc: c.p.desc ?? '', tid: int(c.p.tid), sub_tid: int(c.p.sub_tid), tag: c.p.tag ?? '', pic: c.p.cover || '', copyright: int(c.p.copyright, 1), source: c.p.source ?? '',
    pages, chapters: JSON.parse(c.p.chapters || '[]'), state: over.state, reason: '', dtime: over.dtime, no_disturbance: truthy(c.p.no_disturbance), no_tv: truthy(c.p.no_tv),
  }
  let a = existing
  if (a) Object.assign(a, fields, over.pubdate ? { pubdate: over.pubdate } : {})
  else {
    const aid = Math.max(100000, ...c.db.archives.map((x) => x.aid)) + 1
    a = { aid, bvid: av2bv(aid), mid: u.mid, ctime: ts(), pubdate: over.pubdate, stat: { view: 0, danmaku: 0, reply: 0, favorite: 0, coin: 0, share: 0, like: 0 }, subtitles: [], ...fields }
    c.db.archives.push(a)
  }
  for (const x of c.db.collections) if (x.kind === 'season') x.aids = x.aids.filter((aid) => aid !== a!.aid)
  const season = c.db.collections.find((x) => x.id === int(c.p.season_id) && x.mid === u.mid)
  if (season) season.aids.push(a.aid)
  return { aid: a.aid, bvid: a.bvid, state: a.state }
}

/** Approved archives whose scheduled time has come are published (state -40 → 0). */
function promoteScheduled(db: DB) {
  const now = ts()
  for (const a of db.archives) if (a.state === -40 && (a.dtime ?? 0) <= now) { a.state = 0; a.pubdate = a.dtime ?? now }
}

function ownRoom(c: Ctx, u: User) {
  let r = c.db.rooms.find((x) => x.uid === u.mid)
  if (!r) { r = { room_id: 30000 + u.mid, uid: u.mid, title: `${u.uname}的直播间`, cover: '', parent_area_id: 10, area_id: 646, live_status: 0, online: 0, media: '', banned: false, live_time: 0, tags: '', description: '' }; c.db.rooms.push(r) }
  return r
}
const streamToken = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')
/** The room's persistent stream key (created on first use). */
function streamAddr(r: LiveRoom) {
  r.stream_key ||= streamToken()
  return { addr: `rtmp://${location.hostname}/live-jumedia/`, code: `?streamname=live_${r.uid}_${r.room_id}&key=${r.stream_key}` }
}

/** An episode's highlights (本话看点) as `view_points`; each ends where the next starts. */
function episodePoints(db: DB, cid: number) {
  const e = db.seasons.flatMap((s) => s.episodes).find((x) => x.cid === cid)
  const pts = [...(e?.points ?? [])].sort((a, b) => a.from - b.from)
  return pts.map((p, i) => ({ type: 2, from: p.from, to: pts[i + 1]?.from ?? e!.duration, content: p.content, imgUrl: e!.cover }))
}

/** Validated opening range and highlights from the admin episode editor. */
function episodeExtras(e: Record<string, unknown>, duration: number) {
  const op = Array.isArray(e.op) ? e.op.map(Number) : []
  const points = Array.isArray(e.points) ? (e.points as Record<string, unknown>[]).map((x) => ({ from: Math.round(Number(x.from)), content: String(x.content ?? '').trim().slice(0, 40) })).filter((x) => x.content && x.from >= 0 && x.from < duration) : []
  return {
    op: op.length === 2 && op[0] >= 0 && op[1] > op[0] && op[1] <= duration ? [Math.round(op[0]), Math.round(op[1])] as [number, number] : undefined,
    points: points.length ? points.sort((a, b) => a.from - b.from) : undefined,
  }
}

/** Why a comment or danmaku looks like spam (疑似违规), or ''. Keywords come from settings.sensitiveWords. */
function flagOf(db: DB, text: string) {
  const t = text.toLowerCase()
  const word = String(db.settings.sensitiveWords ?? '').split('\n').map((w) => w.trim()).filter(Boolean).find((w) => t.includes(w.toLowerCase()))
  if (word) return `敏感词「${word}」`
  if (/https?:\/\/|www\./i.test(text) || /\d{7,}/.test(text)) return '疑似广告'
  return ''
}

/** Today's user comments and user danmaku (seeded danmaku have weight < 10). */
function moderationStat(db: DB) {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  const start = d.getTime() / 1000
  return { reply_today: db.replies.filter((r) => r.ctime >= start).length, danmaku_today: db.danmaku.filter((x) => x.weight === 10 && x.ctime >= start).length }
}

const SERVICE_FIELDS = ['serviceApi', 'serviceLive', 'serviceApp', 'servicePassport', 'serviceCdns']
const SERVICE_LABELS: Record<string, string> = { serviceApi: '主站接口', serviceLive: '直播接口', serviceApp: '客户端接口', servicePassport: '登录接口' }
/** An http(s) base address without query or fragment; the trailing slash is dropped. Empty is allowed. */
function serviceURL(v: string, label: string) {
  const t = v.trim()
  if (!t) return ''
  let u: URL
  try { u = new URL(t) } catch { return fail(-400, `${label}地址格式不正确`) }
  if (!['http:', 'https:'].includes(u.protocol) || u.search || u.hash || u.username || u.password) fail(-400, `${label}地址需为 http(s) 地址，不能带参数`)
  return t.replace(/\/+$/, '')
}
/** Validated service settings from a settings save, or null when none were sent. */
function serviceInput(c: Ctx): Record<string, string> | null {
  if (!SERVICE_FIELDS.some((k) => c.p[k] !== undefined)) return null
  const out: Record<string, string> = {}
  for (const k of Object.keys(SERVICE_LABELS)) if (c.p[k] !== undefined) out[k] = serviceURL(c.p[k], SERVICE_LABELS[k])
  if (c.p.serviceCdns !== undefined) {
    let list: unknown
    try { list = JSON.parse(c.p.serviceCdns || '[]') } catch { return fail(-400, 'CDN 集合格式不正确') }
    if (!Array.isArray(list)) fail(-400, 'CDN 集合格式不正确')
    if ((list as unknown[]).length > 20) fail(-400, 'CDN 集合最多 20 个')
    const cdns = (list as Record<string, unknown>[]).map((x) => ({ name: String(x?.name ?? '').trim(), url: serviceURL(String(x?.url ?? ''), 'CDN ') }))
    if (cdns.some((x) => !x.name || [...x.name].length > 20 || !x.url)) fail(-400, '每个 CDN 需要填写 1–20 字的名称和地址')
    if (new Set(cdns.map((x) => x.url)).size !== cdns.length) fail(-400, 'CDN 地址不能重复')
    out.serviceCdns = JSON.stringify(cdns)
  }
  return out
}

export const VIDEO_ENCODERS = ['auto', 'libx264', 'h264_vaapi', 'h264_videotoolbox', 'h264_nvenc', 'h264_qsv']
/** Validates and normalises runtime server settings in a settings save (in place on `c.p`). */
function serverInput(c: Ctx) {
  const p = c.p
  if (p.serverPublicOrigin !== undefined) {
    const t = p.serverPublicOrigin.trim()
    if (t) {
      let u: URL | undefined
      try { u = new URL(t) } catch { /* reported below */ }
      if (!u || !['http:', 'https:'].includes(u.protocol) || u.pathname !== '/' || u.search || u.hash || u.username || u.password) fail(-400, '公开地址需为 http(s)://主机[:端口]，不能带路径或参数')
      p.serverPublicOrigin = u!.origin
    } else p.serverPublicOrigin = ''
  }
  for (const [k, label] of [['serverFfmpeg', 'ffmpeg'], ['serverFfprobe', 'ffprobe']] as const) {
    if (p[k] === undefined) continue
    p[k] = p[k].trim()
    if (p[k] && !/^(\/[^\0\n\r]+|[A-Za-z0-9._-]+)$/.test(p[k])) fail(-400, `${label} 路径需为绝对路径或命令名`)
  }
  if (p.serverVideoEncoder !== undefined && p.serverVideoEncoder && !VIDEO_ENCODERS.includes(p.serverVideoEncoder)) fail(-400, '不支持的视频编码器')
}

/** An archive's comment count (`stat.reply`) is the number of its comments, replies included. */
function syncReplyCount(db: DB, oid: number) {
  const a = db.archives.find((x) => x.aid === oid)
  if (a) a.stat.reply = db.replies.filter((r) => r.oid === oid).length
}

// ---------------- m3u8 live relay ----------------

let nativeFetch: typeof fetch = (...a) => fetch(...a)
const playlistCache = new Map<string, { at: number; text: string; url: string }>()

async function loadPlaylist(address: string, maxAge: number): Promise<{ list: Playlist; text: string; url: string }> {
  let url: URL
  try { url = new URL(address.trim(), location.origin) } catch { return fail(-400, 'm3u8 地址格式不正确') }
  if (!['http:', 'https:'].includes(url.protocol)) fail(-400, '仅支持 http / https 的 m3u8 地址')
  // Mock only: a finished cache's playlist is stood in by its media's Emby HLS.
  const cacheKey = url.origin === location.origin ? cacheKeyOf(url.pathname) : ''
  if (cacheKey) {
    const x = getDB().liveCaches.find((y) => y.key === cacheKey && y.status === 'ready')
    if (!x) fail(-404, '转码缓存不存在')
    url = new URL(mediaHlsPath(x!.media), location.origin)
  }
  const cached = playlistCache.get(url.href)
  let text = cached && Date.now() - cached.at < maxAge ? cached.text : ''
  if (!text && url.origin === location.origin && url.pathname.startsWith('/media/emby/')) {
    const source = url.searchParams.get('source') ?? '', ds = Number(url.searchParams.get('ds') ?? 0)
    const emby = await (ds ? dsPlaylist(getDB(), url.pathname, source, ds) : Promise.resolve(null)).catch(() => null)
    if (!emby) fail(-400, '无法读取媒体库播放列表')
    playlistCache.set(url.href, { at: Date.now(), text: emby!, url: url.href })
    text = emby!
  }
  if (!text) {
    let res: Response
    try { res = await nativeFetch(url.href, { cache: 'no-store' }) } catch { return fail(-400, '无法访问该地址（网络错误或源站未开放跨域）') }
    if (!res.ok) fail(-400, `源站返回 HTTP ${res.status}`)
    text = await res.text()
    playlistCache.set(url.href, { at: Date.now(), text, url: res.url || url.href })
  }
  const final = playlistCache.get(url.href)!.url
  try { return { list: parsePlaylist(text, final), text, url: final } } catch (e) { return fail(-400, (e as Error).message) }
}

async function probe(address: string) {
  if (!address.trim()) fail(-400, '请填写 m3u8 地址')
  const top = await loadPlaylist(address, 0)
  const variants = top.list.kind === 'master' ? top.list.variants : []
  const media = top.list.kind === 'master' ? await loadPlaylist(top.list.variants[0].uri, 0) : top
  if (media.list.kind !== 'media') return fail(-400, '码率播放列表无效')
  const m = media.list
  return {
    url: top.url, master: top.list.kind === 'master', kind: m.ended ? 'vod' : 'live', format: m.format, duration: Math.round(m.duration), segments: m.segments.length,
    target_duration: m.targetDuration, encrypted: m.segments.some((s) => s.key), variants: variants.map((v) => ({ bandwidth: v.bandwidth, resolution: v.resolution })),
  }
}

async function applySource(c: Ctx, r: LiveRoom) {
  const type = c.p.source_type === 'm3u8' || c.p.source_type === 'video' ? c.p.source_type : 'push'
  let next: StreamSource = { type: 'push', url: '', loop: true }
  if (type === 'video') {
    if (!int(c.p.aid) || !int(c.p.cid)) fail(-400, '请选择要转播的视频')
    const a = archiveById(int(c.p.aid))
    const p = a?.pages.find((x) => x.cid === int(c.p.cid))
    if (!a || !p || a.mid !== r.uid || a.state === -100 || a.state === -6) fail(-404, '视频不存在或不属于该直播间的主播')
    if (!mediaHlsPath(p!.media)) fail(-400, '只能转播数据源中的视频')
    // Switching a live room needs a playable cache; otherwise viewers would get nothing. Checked before queueing.
    if (r.live_status === 1 && notReady(findCache(c.db, p!.media))) fail(-400, '直播中只能切换到已完成转码缓存的视频，请先下播或等待转码完成')
    const cache = ensureCache(c.db, p!.media, a!.aid, p!.cid, p!.duration)
    next = { type, url: cachePath(cache.key), loop: c.p.loop !== 'false', format: 'ts', kind: 'vod', aid: a!.aid, cid: p!.cid, cache: cache.key }
  } else if (type === 'm3u8') {
    const info = await probe(c.p.source_url ?? '')
    next = { type, url: c.p.source_url.trim(), loop: c.p.loop !== 'false', format: info.format as 'ts' | 'fmp4', kind: info.kind as 'vod' | 'live' }
  }
  const changed = JSON.stringify(next) !== JSON.stringify(r.source ?? { type: 'push', url: '', loop: true })
  r.source = next
  // `auto_start` asks to go live when the cache is ready; any other source clears it.
  r.pending_start = type === 'video' && r.live_status !== 1 && truthy(c.p.auto_start) && !!notReady(roomCache(c.db, r))
  // A new source restarts the relay timeline for everyone watching.
  if (changed && r.live_status === 1) r.live_time = ts()
}

/** Playlist served at `/live-relay/{room}/index.m3u8` (and `v{n}.m3u8` per variant). */
async function relayedPlaylist(r: LiveRoom, variant?: number): Promise<string | null> {
  if (r.banned || r.live_status !== 1 || (r.source?.type !== 'm3u8' && r.source?.type !== 'video')) return null
  if (r.source.type === 'video' && roomCache(getDB(), r)?.status !== 'ready') return null
  const top = await loadPlaylist(r.source.url, r.source.kind === 'live' ? 1000 : 60000)
  let media = top
  if (top.list.kind === 'master') {
    if (variant === undefined) return relayMaster(top.list, (i) => `/live-relay/${r.room_id}/v${i}.m3u8`)
    const v = top.list.variants[variant]
    if (!v) return null
    media = await loadPlaylist(v.uri, r.source.kind === 'live' ? 1000 : 60000)
  }
  if (media.list.kind !== 'media') return null
  if (!media.list.ended) return passthrough(media.text, media.url)
  const w = liveWindow(media.list, r.live_time, Date.now() / 1000, { loop: r.source.loop })
  if (w.ended) { r.live_status = 0; save() }
  return w.text
}

// ---------------- fetch interception ----------------

function resolveRoute(path: string): Handler | undefined {
  if (routes[path]) return routes[path]
  const emby = /^\/media\/emby\/[^/]+\/hls\/(index|main)\.m3u8$/.exec(path)
  if (emby) return async (c) => {
    const text = await (c.p.ds ? dsPlaylist(c.db, path, c.p.source ?? '', int(c.p.ds)) : Promise.resolve(null)).catch(() => null)
    return { __text: text ?? '#EXTM3U\n', __status: text ? 200 : 404 }
  }
  const relay = /^\/live-relay\/(\d+)\/(?:index|v(\d+))\.m3u8$/.exec(path)
  if (relay) return async (c) => {
    const r = c.db.rooms.find((x) => x.room_id === Number(relay[1]))
    const text = r ? await relayedPlaylist(r, relay[2] === undefined ? undefined : Number(relay[2])) : null
    return { __text: text ?? '#EXTM3U\n#EXT-X-ENDLIST\n', __status: text ? 200 : 404 }
  }
  const sub = /^\/bfs\/subtitle\/(\d+)-(\d+)\.json$/.exec(path)
  if (sub) return () => { const a = archiveById(Number(sub[1])); return { __raw: { font_size: 0.4, font_color: '#FFFFFF', background_alpha: 0.5, background_color: '#9C27B0', Stroke: 'none', body: a?.subtitles[Number(sub[2])]?.body ?? [] } } }
  return undefined
}

/** Uploaded files are stored as `idb:` refs; responses carry blob URLs instead. */
async function withUploads(body: unknown): Promise<unknown> {
  const refs = new Set<string>()
  const walk = (v: unknown) => { if (typeof v === 'string') { if (v.startsWith('idb:') || /^\/media\/emby\/[^/]+\/image\//.test(v)) refs.add(v) } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x) }
  walk(body)
  if (!refs.size) return body
  const urls = new Map(await Promise.all([...refs].map(async (r) => [r, await resolveMedia(r).catch(() => '')] as const)))
  const swap = (v: unknown): unknown => (typeof v === 'string' ? urls.get(v) ?? v : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v)
  return swap(body)
}

export async function installMockServer() {
  const native = window.fetch.bind(window)
  nativeFetch = native
  setSourceFetcher(native)
  getDB()
  // A reload interrupts in-flight syncs (the server marks them the same way on start-up).
  for (const ds of getDB().dataSources) if (ds.status === 'syncing') Object.assign(ds, { status: 'error', message: '同步被中断，请重新同步' })
  queueRelayedCaches(getDB())
  window.setInterval(() => tickCaches(getDB()), 1000)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    const handler = url.origin === location.origin ? resolveRoute(url.pathname) : undefined
    if (!handler) return native(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    const p: P = Object.fromEntries(url.searchParams)
    let form: FormData | undefined
    if (init?.body instanceof FormData) { form = init.body; for (const [k, v] of form) if (typeof v === 'string') p[k] = v }
    else if (typeof init?.body === 'string') Object.assign(p, Object.fromEntries(new URLSearchParams(init.body)))
    const db = getDB()
    promoteScheduled(db)
    const token = cookieValue('SESSDATA')
    const session = db.sessions.find((s) => (token && s.token === token) || (p.access_key && s.access === p.access_key))
    const me = session ? userById(session.mid) : undefined
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 140))
    let body: unknown
    try {
      // The admin's public origin (`serverPublicOrigin`) replaces the page origin in generated addresses.
      const out = (await handler({ p, method, form, me, session, db, origin: String(db.settings.serverPublicOrigin || '') || location.origin })) as Record<string, unknown> | null
      save()
      if (out && typeof out === 'object' && '__bytes' in out) return new Response(out.__bytes as Uint8Array, { headers: { 'Content-Type': 'application/octet-stream', ...(out.__headers as Record<string, string> ?? {}) } })
      if (out && typeof out === 'object' && '__text' in out) return new Response(out.__text as string, { status: (out.__status as number) ?? 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' } })
      if (out && typeof out === 'object' && '__raw' in out) body = out.__raw
      else if (out && typeof out === 'object' && '__root' in out) body = out.__root
      else if (out && typeof out === 'object' && '__result' in out) body = { code: 0, message: 'success', result: out.__result }
      else body = { code: 0, message: '0', ttl: 1, data: out }
    } catch (e) {
      if (!(e instanceof Fail)) { console.error('[mock]', url.pathname, e); body = { code: -500, message: '服务器内部错误', ttl: 1 } }
      else body = { code: e.code, message: e.message, ttl: 1, data: e.data }
    }
    return new Response(JSON.stringify(await withUploads(body)), { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  }
  console.info('[Jumedia] 使用浏览器内 Mock 服务（VITE_MOCK=0 可切换到真实 Jumedia-server）')
}
