import { dsMediaURL } from './datasource'
import { type Catalog, type CatalogImages, type CatalogSeries, embyHlsPath, embyRef, embyStreamURL, getCatalog } from './emby'

/**
 * Storage model for the in-browser mock server. Records are kept in their
 * own shape and rendered into Juli response shapes by `server.ts`, which is
 * the same split Jumedia-server will need between its tables and the API.
 */

export interface User {
  mid: number; username: string; password: string; uname: string; face: string; sign: string; sex: string; birthday: string
  email: string; level: number; exp: number; coins: number; role: 'user' | 'admin'; status: 0 | 1; ctime: number; top_photo: string; vip: number
  /** Space notice (`/x/space/notice`). */
  notice?: string
}
export interface Page { cid: number; part: string; duration: number; media: string }
export interface Archive {
  aid: number; bvid: string; mid: number; title: string; desc: string; tid: number; tag: string; pic: string; ctime: number; pubdate: number
  state: number; reason: string; copyright: number; source: string; pages: Page[]; chapters: { from: number; to: number; content: string }[]
  stat: { view: number; danmaku: number; reply: number; favorite: number; coin: number; share: number; like: number }
  subtitles: { lan: string; lan_doc: string; body: { from: number; to: number; content: string }[] }[]
  /** Set on archives imported from a data source; `null`/absent for uploads. */
  origin?: ArchiveOrigin
  /** Jumedia sub-region (a `Region` whose `parent` is `tid`); 0 when unset. */
  sub_tid?: number
  /** Scheduled publish time (`dtime`); while in the future an approved archive stays at state -40. */
  dtime?: number
  /** `no_disturbance`: not pushed to followers' dynamic feed. */
  no_disturbance?: boolean
  /** Jumedia: kept out of the TV home feed (`/x/v2/feed/index`). */
  no_tv?: boolean
}
/**
 * Link from a Jumedia record to the data-source item it mirrors. `meta` is the
 * metadata the last sync derived from Emby; fields listed in `locked` were
 * edited in Jumedia and keep their Jumedia value on later syncs. Emby itself is
 * never written to.
 */
export interface ArchiveOrigin { type: 'emby'; ds: number; item: string; library: string; locked: ArchiveField[]; meta: ArchiveMeta }
export interface ArchiveMeta { title: string; desc: string; tid: number; tag: string; pic: string }
export type ArchiveField = keyof ArchiveMeta
export interface CollectionOrigin { type: 'emby'; ds: number; library: string; locked: CollectionField[]; meta: Record<CollectionField, string> }
export type CollectionField = 'title' | 'intro' | 'cover'
export interface Collection { id: number; mid: number; kind: 'season' | 'series'; title: string; intro: string; cover: string; aids: number[]; ctime: number; origin?: CollectionOrigin }

/** A library of the data source; enabled libraries are mirrored as one 合集 each. */
export interface DataSourceLibrary { id: string; name: string; type: string; enabled: boolean; items: number; collection_id: number }
/**
 * Read-only media source owned by a user (`system` sources belong to the
 * official account). Credentials stay server-side: responses carry
 * `has_password`, never the password, and the Emby token lives only in memory.
 */
export interface DataSource {
  id: number; mid: number; system: boolean; type: 'emby'; name: string; url: string; username: string; password: string
  server_name: string; server_id: string; libraries: DataSourceLibrary[]; auto_sync: boolean
  status: 'idle' | 'syncing' | 'ok' | 'error'; message: string; last_sync: number; ctime: number
}
export interface Episode {
  ep_id: number; aid: number; cid: number; title: string; long_title: string; cover: string; duration: number; pub_time: number; media: string; badge: string
  /** Opening (片头) range in seconds, served as the playurl's `clip_info_list`. */
  op?: [number, number]
  /** Highlights (本话看点), served as `view_points` by `/x/player/wbi/v2`. */
  points?: { from: number; content: string }[]
}
export interface Season {
  season_id: number; media_id: number; season_type: number; title: string; cover: string; horizontal: string; evaluate: string; areas: string[]
  styles: string[]; score: number; is_finish: boolean; copyright?: number; weekday: number; pub_time: string; episodes: Episode[]; views: number; follow: number; danmakus: number; ctime: number; state: number
}
export interface LiveArea { id: number; name: string; children: { id: number; name: string }[] }
/**
 * `push` = RTMP from the streamer; `m3u8` = pull an HLS source and relay it as the room's live stream;
 * `video` = relay one page of the owner's data-source video: `cache` is its transcode cache (see liveCache.ts)
 * and `url` the cache's playlist, relayed like a VOD m3u8.
 */
export interface StreamSource { type: 'push' | 'm3u8' | 'video'; url: string; loop: boolean; format?: 'ts' | 'fmp4'; kind?: 'vod' | 'live'; aid?: number; cid?: number; cache?: string }
/** `pending_start`: go live as soon as the `video` source's cache is ready. */
export interface LiveRoom { room_id: number; uid: number; title: string; cover: string; parent_area_id: number; area_id: number; live_status: number; online: number; media: string; banned: boolean; live_time: number; tags: string; description: string; source?: StreamSource; pending_start?: boolean; stream_key?: string }
/** Transcode cache of one media ref at one height; `started` is when the running job began. */
export interface LiveCache { key: string; media: string; height: number; aid: number; cid: number; duration: number; status: 'pending' | 'running' | 'ready' | 'failed'; progress: number; message: string; size: number; dir: string; ctime: number; mtime: number; started: number; unused_since: number }
export interface Reply { rpid: number; oid: number; mid: number; root: number; parent: number; message: string; ctime: number; likers: number[]; haters: number[] }
export interface Danmaku { id: number; cid: number; progress: number; mode: number; fontsize: number; color: number; mid: number; content: string; ctime: number; weight: number }
export interface LiveMessage { id: number; room_id: number; uid: number; text: string; ts: number; price?: number }
export interface FavFolder { id: number; mid: number; title: string; intro: string; privacy: number; ctime: number; attr: number; items: { aid: number; mtime: number }[] }
/** `channel` banners belong to resource location `loc` (`/x/web-show/res/locs`): a region tid or 10 + season_type. */
export interface Banner { id: number; title: string; img: string; url: string; position: 'home' | 'anime' | 'channel'; sort: number; season_id?: number; loc?: number }
/** Top-level regions have no `parent`; sub-regions point at their top-level region. */
export interface Region { tid: number; name: string; sort: number; visible: boolean; parent?: number }
export interface Reservation { sid: number; mid: number; title: string; stime: number; ctime: number }
/** Live fan medal of viewer `mid` for anchor `ruid`; `today` counts intimacy gained on `day` (YYYYMMDD). */
export interface FanMedal { medal_id: number; mid: number; ruid: number; intimacy: number; today: number; day: number; wearing: boolean; ctime: number }

export interface DB {
  version: number; seq: number
  users: User[]; sessions: { token: string; csrf: string; access: string; refresh: string; mid: number; ctime: number }[]
  archives: Archive[]; collections: Collection[]; seasons: Season[]; regions: Region[]; dataSources: DataSource[]
  liveAreas: LiveArea[]; rooms: LiveRoom[]; liveMessages: LiveMessage[]
  replies: Reply[]; danmaku: Danmaku[]; seededDanmaku: number[]
  relations: { mid: number; fid: number; mtime: number }[]; likes: { mid: number; aid: number }[]; dislikes: { mid: number; aid: number }[]; coins: { mid: number; aid: number; n: number }[]
  favFolders: FavFolder[]; history: { mid: number; aid: number; cid: number; epid?: number; sid?: number; view_at: number; progress: number }[]
  historyPaused: number[]; toview: { mid: number; aid: number; add_at: number }[]
  bangumiFollow: { mid: number; season_id: number; status: number; mtime: number }[]
  dmConfig: Record<string, Record<string, string>>; dmFilter: Record<string, { rule: string[]; keyword: string[]; regex: string[] }>
  reservations: Reservation[]
  fanMedals: FanMedal[]
  banners: Banner[]; liveCaches: LiveCache[]; settings: Record<string, string | number | boolean>
  logs: { id: number; mid: number; action: string; target: string; ctime: number }[]
  qrcodes: { code: string; status: 'pending' | 'scanned' | 'confirmed'; mid: number; ctime: number }[]
}

const KEY = 'jumedia.mock.db'
const VERSION = 18
const now = () => Math.floor(Date.now() / 1000)

export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed: number) {
  let s = seed || 1
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}

const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf'
/** av ↔ BV conversion (same algorithm the Juli ecosystem exchanges). */
export function av2bv(aid: number): string {
  const XOR = 23442827791579n, MAX = 1n << 51n
  const bytes = ['B', 'V', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0']
  let idx = bytes.length - 1
  let tmp = (MAX | BigInt(aid)) ^ XOR
  while (tmp > 0n) { bytes[idx] = ALPHABET[Number(tmp % 58n)]; tmp /= 58n; idx-- }
  ;[bytes[3], bytes[9]] = [bytes[9], bytes[3]]
  ;[bytes[4], bytes[7]] = [bytes[7], bytes[4]]
  return bytes.join('')
}
export function bv2av(bvid: string): number {
  const XOR = 23442827791579n, MASK = 2251799813685247n
  const b = bvid.split('')
  ;[b[3], b[9]] = [b[9], b[3]]
  ;[b[4], b[7]] = [b[7], b[4]]
  let tmp = 0n
  for (const c of b.slice(3)) tmp = tmp * 58n + BigInt(ALPHABET.indexOf(c))
  return Number((tmp & MASK) ^ XOR)
}

export const REGIONS: Region[] = [
  [1005, '动画'], [1008, '游戏'], [1007, '鬼畜'], [1003, '音乐'], [1004, '舞蹈'], [1001, '影视'], [1002, '娱乐'], [1010, '知识'],
  [1012, '科技数码'], [1020, '美食'], [1013, '汽车'], [1014, '时尚美妆'], [1018, '体育运动'], [1024, '动物'], [1030, '兴趣'], [1031, '经验'],
].map(([tid, name], i) => ({ tid: tid as number, name: name as string, sort: i, visible: true }))

const PEOPLE = [
  ['jumedia', '聚媒官方', '欢迎来到 Jumedia，一起记录、分享与发现。'], ['lumen', '流明实验室', '用影像拆解光与色。'], ['oolong', '乌龙茶不加糖', '做饭 / 旅行 / 胡思乱想'],
  ['pixel', '像素旅人', '独立游戏发烧友，每周一款宝藏游戏。'], ['wave', '声波工作室', '原创编曲与混音教学。'], ['maple', '枫糖动画社', '手绘动画短片，慢慢画。'],
  ['circuit', '电路板日记', '拆机、焊接、做点没用的小东西。'], ['deer', '小鹿爱跳舞', '街舞 / 爵士 / 编舞分享'], ['atlas', '地图上的猫', '用纪录片的方式看世界。'],
  ['nova', '星野Nova', '天文摄影与科普'], ['bamboo', '竹林喵喵', '三只猫和一个不靠谱的铲屎官'], ['drift', '漂移老王', '赛道日与改装车'],
]

const COMMENTS = ['讲得太清楚了，收藏了！', '这期质量好高，催更下一期', '前排围观～', '背景音乐叫什么名字？', '看完立刻去试了一下，真的有用', '剪辑节奏好舒服', '已三连，期待更多作品', '这个角度从来没想过，学到了', '弹幕护体！', 'UP 主辛苦了', '第一次刷到，已关注', '04:12 那里笑死我了']
const DANMAKU = ['来了来了', '前方高能', '哈哈哈哈哈', '好家伙', '这里好评', '泪目', '学到了', '画质好清晰', '打卡', '太强了', '名场面', '妙啊', '经典', '感谢分享', 'awsl', '下次一定']
const COLORS = [0xffffff, 0xffffff, 0xffffff, 0xfe0302, 0xffd302, 0x00cd00, 0x00a0ea, 0xcc0273]

const LIVE_AREAS: LiveArea[] = [
  { id: 2, name: '网游', children: [{ id: 86, name: '英雄联盟' }, { id: 252, name: '逃离塔科夫' }] },
  { id: 3, name: '手游', children: [{ id: 35, name: '王者荣耀' }, { id: 255, name: '明日方舟' }] },
  { id: 6, name: '单机游戏', children: [{ id: 236, name: '主机游戏' }, { id: 216, name: '独立游戏' }] },
  { id: 1, name: '娱乐', children: [{ id: 21, name: '视频唱见' }, { id: 207, name: '舞见' }] },
  { id: 9, name: '虚拟主播', children: [{ id: 371, name: '虚拟日常' }] },
  { id: 10, name: '生活', children: [{ id: 646, name: '生活分享' }, { id: 215, name: '影音馆' }] },
  { id: 11, name: '知识', children: [{ id: 376, name: '学习·陪伴' }, { id: 377, name: '科技·科学' }] },
]

/** Jumedia region for a catalog title: genre first, then library. */
function regionFor(library: string, genres: string[]): number {
  const g = genres.join(' ')
  if (/美食|Food|Cooking/i.test(g)) return 1020
  if (/音乐|Music/i.test(g)) return 1003
  if (/纪录|Documentary/i.test(g)) return 1010
  if (/体育|Sport/i.test(g)) return 1018
  if (/旅行|Travel/i.test(g)) return 1030
  if (library === '动漫') return 1005
  if (library === '综艺') return 1002
  return 1001
}
/** PGC season_type: 1 番剧, 2 电影, 4 国创, 5 电视剧, 7 综艺. */
function seasonTypeFor(s: CatalogSeries): number {
  if (s.library === '动漫') return s.countries.some((c) => /China|中国|大陆/i.test(c)) ? 4 : 1
  if (s.library === '综艺') return 7
  return 5
}
const COUNTRY: Record<string, string> = { China: '中国大陆', "People's Republic of China": '中国大陆', Japan: '日本', 'South Korea': '韩国', Korea: '韩国', 'United States of America': '美国', USA: '美国', 'Hong Kong': '中国香港', Taiwan: '中国台湾', 'United Kingdom': '英国' }
const WEEKDAY: Record<string, number> = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 }
const bareNumber = (name: string) => /^(第\s*)?\d+\s*[集话期]?$/.test(name.trim())
const wide = (i: CatalogImages) => i.backdrop ?? i.thumb ?? i.primary ?? ''
export const avatarURL = (n: number) => `/mock/avatars/default${(Math.abs(n) % 8) + 1}.png`

interface Clip { title: string; desc: string; tid: number; pic: string; tag: string; pages: { part: string; duration: number; media: string }[] }
function clipsFrom(catalog: Catalog): Clip[] {
  const clips: Clip[] = []
  const tag = (s: { library: string; genres: string[] }) => [s.library, ...s.genres.slice(0, 2)].filter(Boolean).join(',')
  for (let round = 0; clips.length < 40 && round < 16; round++) {
    for (const s of catalog.series) {
      if (clips.length >= 40) break
      const e = s.episodes[round]
      if (!e) continue
      const tid = regionFor(s.library, s.genres)
      if (round === 1 && s.episodes.length >= 4) {
        const eps = s.episodes.slice(1, 4)
        clips.push({ title: `《${s.name}》连看三集`, desc: s.overview, tid, pic: eps[0].image ?? wide(s.images), tag: tag(s), pages: eps.map((x) => ({ part: bareNumber(x.name) ? `第${x.index}集` : x.name, duration: x.runtime, media: embyRef(x.id, x.sourceId) })) })
        continue
      }
      const title = s.library === '综艺' ? `${s.name}：${e.name}` : bareNumber(e.name) ? `${s.name} 第${e.index}${s.library === '动漫' ? '话' : '集'}` : `${s.name} 第${e.index}${s.library === '动漫' ? '话' : '集'} ${e.name}`
      clips.push({ title: title.slice(0, 80), desc: e.overview || s.overview, tid, pic: e.image ?? wide(s.images), tag: tag(s), pages: [{ part: title.slice(0, 40), duration: e.runtime, media: embyRef(e.id, e.sourceId) }] })
    }
  }
  for (const m of catalog.movies.slice(0, 4)) clips.push({ title: m.name, desc: m.overview, tid: regionFor('电影', m.genres), pic: wide(m.images), tag: ['电影', ...m.genres.slice(0, 2)].join(','), pages: [{ part: m.name, duration: m.runtime, media: embyRef(m.id, m.sourceId) }] })
  return clips
}

export function seed(): DB {
  const catalog = getCatalog()
  const r = rng(20261029)
  const t0 = now()
  let seq = 1000
  const id = () => ++seq
  const backdrops = [...catalog.series.map((s) => s.images.backdrop), ...catalog.movies.map((m) => m.images.backdrop)].filter((x): x is string => !!x)
  const users: User[] = PEOPLE.map(([username, uname, sign], i) => ({
    mid: i + 1, username, password: i === 0 ? 'admin123' : 'demo123', uname, face: `/mock/avatars/u${i + 1}.png`, sign, sex: i % 3 === 0 ? '男' : i % 3 === 1 ? '女' : '保密',
    birthday: '1998-06-12', email: `${username}@jumedia.local`, level: 6 - (i % 4), exp: 12000 - i * 700, coins: 120 + i * 13, role: i === 0 ? 'admin' : 'user',
    status: 0, ctime: t0 - 86400 * (400 - i * 20), top_photo: backdrops[i % Math.max(1, backdrops.length)] ?? '', vip: i % 4 === 0 ? 1 : 0,
  }))

  let cid = 50000
  const clips = clipsFrom(catalog)
  const archives: Archive[] = clips.slice(0, 40).map((clip, i) => {
    const aid = 100100 + i * 7
    const view = Math.floor(2000 + r() * r() * 1800000)
    const pub = t0 - Math.floor(r() * 86400 * 60) - i * 3600
    const total = clip.pages.reduce((n, p) => n + p.duration, 0)
    return {
      aid, bvid: av2bv(aid), mid: (i % (users.length - 1)) + 2, title: clip.title, desc: clip.desc, tid: clip.tid, tag: clip.tag, pic: clip.pic,
      ctime: pub - 600, pubdate: pub, state: 0, reason: '', copyright: 2, source: '转载自 Jumedia 演示媒体库', pages: clip.pages.map((p) => ({ cid: ++cid, ...p })),
      chapters: i % 4 === 0 && total > 120 ? [{ from: 0, to: Math.floor(total * 0.1), content: '开场' }, { from: Math.floor(total * 0.1), to: Math.floor(total * 0.9), content: '正片' }, { from: Math.floor(total * 0.9), to: total, content: '片尾' }] : [],
      stat: { view, danmaku: Math.floor(view * 0.004), reply: Math.floor(view * 0.0015), favorite: Math.floor(view * 0.02), coin: Math.floor(view * 0.01), share: Math.floor(view * 0.002), like: Math.floor(view * 0.05) },
      subtitles: [],
    }
  })
  const pendingClip = clips[40] ?? clips[0]
  if (pendingClip) archives.push({ ...archives[0], aid: 100999, bvid: av2bv(100999), title: `待审核：${pendingClip.title}`.slice(0, 80), desc: pendingClip.desc, tid: pendingClip.tid, pic: pendingClip.pic, state: -1, mid: 3, pubdate: t0 - 1200, ctime: t0 - 1800, stat: { view: 0, danmaku: 0, reply: 0, favorite: 0, coin: 0, share: 0, like: 0 }, pages: pendingClip.pages.map((p) => ({ cid: ++cid, ...p })), chapters: [], subtitles: [] })

  const collections: Collection[] = []
  for (const u of users.slice(1, 5)) {
    const mine = archives.filter((a) => a.mid === u.mid && a.state === 0)
    if (mine.length >= 2) {
      collections.push({ id: id(), mid: u.mid, kind: 'season', title: `${u.uname}的精选合集`, intro: '按发布时间整理的系列作品', cover: mine[0].pic, aids: mine.map((a) => a.aid), ctime: t0 - 86400 * 10 })
      collections.push({ id: id(), mid: u.mid, kind: 'series', title: '收藏系列', intro: '', cover: mine[mine.length - 1].pic, aids: mine.slice(0, 2).map((a) => a.aid), ctime: t0 - 86400 * 5 })
    }
  }

  let ep = 300000
  const seasonOf = (i: number, type: number, base: { name: string; overview: string; countries: string[]; genres: string[]; rating: number; images: CatalogImages; ended: boolean; airDays: string[]; airTime: string; premiere: number }, eps: { id: string; sourceId: string; name: string; index: number; runtime: number; premiere: number; image: string | null }[]): Season => {
    const sid = 40000 + i * 11
    const horizontal = wide(base.images)
    return {
      season_id: sid, media_id: 28000000 + sid, season_type: type, title: base.name, cover: base.images.primary ?? horizontal, horizontal, evaluate: base.overview,
      areas: [...new Set(base.countries.map((c) => COUNTRY[c] ?? c))].slice(0, 2), styles: base.genres.slice(0, 3), score: base.rating > 0 ? Math.round(Math.min(10, base.rating) * 10) / 10 : Math.round((8 + r() * 1.9) * 10) / 10,
      is_finish: base.ended, weekday: WEEKDAY[base.airDays[0]] ?? (i % 7) + 1, pub_time: base.airTime || ['18:00', '19:30', '20:00', '22:00', '23:30'][i % 5],
      views: Math.floor(1e5 + r() * 5e7), follow: Math.floor(1e4 + r() * 3e6), danmakus: Math.floor(1e3 + r() * 2e5), ctime: base.premiere || t0 - 86400 * (30 + i * 5), state: 0,
      episodes: eps.map((e, k) => ({
        ep_id: ++ep, aid: 700000 + ep, cid: ++cid, title: type === 2 ? '正片' : String(e.index), long_title: type === 2 ? base.name : bareNumber(e.name) ? '' : e.name,
        cover: e.image ?? horizontal, duration: e.runtime, pub_time: e.premiere || t0 - 86400 * 7 * (eps.length - k), media: embyRef(e.id, e.sourceId), badge: k === eps.length - 1 && !base.ended ? '新' : '',
      })),
    }
  }
  const seasons: Season[] = [
    ...catalog.series.map((s, i) => seasonOf(i, seasonTypeFor(s), s, s.episodes)),
    ...catalog.movies.map((m, i) => seasonOf(catalog.series.length + i, 2, { ...m, ended: true, airDays: [], airTime: '' }, [{ ...m, index: 1, image: m.images.thumb ?? m.images.backdrop }])),
  ]

  // Every demo room relays an Emby title through the m3u8 → live relay, each at its own point in the timeline.
  const shows = [...catalog.movies.map((m) => ({ name: m.name, kind: '电影', item: m, image: wide(m.images) })), ...catalog.series.map((s) => ({ name: s.name, kind: s.library, item: s.episodes[0], image: s.episodes[0].image ?? wide(s.images) }))]
  const areaFor = (kind: string) => (kind === '综艺' ? [1, 21] : kind === '动漫' ? [9, 371] : [10, 215])
  const rooms: LiveRoom[] = shows.slice(1, 17).map((show, i) => {
    const [parent, area] = areaFor(show.kind)
    return {
      room_id: 21000 + i * 3, uid: (i % (users.length - 1)) + 2, title: `【放映厅】${show.name}`.slice(0, 40), cover: show.image, parent_area_id: parent, area_id: area,
      live_status: i % 6 === 5 ? 0 : 1, online: Math.floor(200 + r() * r() * 90000), media: '', banned: false, live_time: t0 - Math.floor(r() * 3600), tags: show.kind, description: `正在放映《${show.name}》，欢迎一起观看～`,
      source: { type: 'm3u8', url: embyHlsPath(show.item.id, show.item.sourceId), loop: true, format: 'ts', kind: 'vod' },
    }
  })
  const feature = shows[0]
  if (feature) rooms.push({ room_id: 20000, uid: 1, title: `聚媒官方 · ${feature.name}`.slice(0, 40), cover: feature.image, parent_area_id: 10, area_id: 215, live_status: 1, online: 3260, media: '', banned: false, live_time: t0, tags: '官方', description: '直播源为 m3u8 点播列表，由平台按时间轴循环转播为直播。', source: { type: 'm3u8', url: embyHlsPath(feature.item.id, feature.item.sourceId), loop: true, format: 'ts', kind: 'vod' } })

  const replies: Reply[] = []
  for (const a of archives.slice(0, 24)) {
    const n = 3 + Math.floor(r() * 5)
    for (let k = 0; k < n; k++) {
      const rpid = id()
      replies.push({ rpid, oid: a.aid, mid: Math.floor(r() * users.length) + 1, root: 0, parent: 0, message: COMMENTS[Math.floor(r() * COMMENTS.length)], ctime: a.pubdate + Math.floor(r() * 86400 * 3), likers: users.filter(() => r() < 0.3).map((u) => u.mid), haters: [] })
      if (r() < 0.45) for (let j = 0; j < 1 + Math.floor(r() * 3); j++) replies.push({ rpid: id(), oid: a.aid, mid: Math.floor(r() * users.length) + 1, root: rpid, parent: rpid, message: ['同意！', '哈哈哈哈确实', '+1', '我也想知道', '感谢解答'][Math.floor(r() * 5)], ctime: a.pubdate + 86400 * 4 + j * 60, likers: [], haters: [] })
    }
  }

  const liveMessages: LiveMessage[] = []
  for (const room of rooms) for (let k = 0; k < 18; k++) liveMessages.push({ id: id(), room_id: room.room_id, uid: Math.floor(r() * users.length) + 1, text: DANMAKU[Math.floor(r() * DANMAKU.length)], ts: t0 - (18 - k) * 20 })
  if (rooms[0]) liveMessages.push({ id: id(), room_id: rooms[0].room_id, uid: 4, text: '这部太好看了，主播再放一遍！', ts: t0 - 60, price: 30 })

  const relations = [[1, 2], [1, 3], [1, 4], [1, 6], [2, 1], [3, 1], [3, 2], [4, 1], [5, 1], [6, 2]].map(([mid, fid], i) => ({ mid, fid, mtime: t0 - i * 3600 }))
  const favFolders: FavFolder[] = users.map((u) => ({ id: 9000 + u.mid * 10, mid: u.mid, title: '默认收藏夹', intro: '', privacy: 0, ctime: u.ctime, attr: 0, items: archives.filter(() => r() < 0.12).map((a) => ({ aid: a.aid, mtime: t0 - Math.floor(r() * 86400 * 20) })) }))
  favFolders.push({ id: 9011, mid: 1, title: '周末追剧', intro: '慢慢看', privacy: 0, ctime: t0 - 86400 * 40, attr: 1, items: archives.filter((a) => a.tid === 1001).map((a) => ({ aid: a.aid, mtime: t0 - 86400 })) })
  const pick = (types: number[]) => seasons.filter((x) => types.includes(x.season_type))

  const fresh: DB = {
    version: VERSION, seq, users, sessions: [], archives, collections, seasons, regions: REGIONS.map((x) => ({ ...x })), dataSources: [], liveCaches: [],
    liveAreas: LIVE_AREAS, rooms, liveMessages, replies, danmaku: [], seededDanmaku: [],
    relations, likes: [], dislikes: [], coins: [], favFolders,
    history: archives.slice(0, 6).map((a, i) => ({ mid: 1, aid: a.aid, cid: a.pages[0].cid, view_at: t0 - i * 5400, progress: i === 0 ? -1 : Math.min(a.pages[0].duration - 5, 60 + i * 30) })),
    historyPaused: [], toview: archives.slice(8, 12).map((a, i) => ({ mid: 1, aid: a.aid, add_at: t0 - i * 7200 })),
    bangumiFollow: [...pick([1, 4]).slice(0, 1), ...pick([5, 7]).slice(0, 1)].map((x, i) => ({ mid: 1, season_id: x.season_id, status: i ? 1 : 2, mtime: t0 - 3600 * (i + 1) })),
    dmConfig: {}, dmFilter: {},
    banners: [
      ...archives.filter((a) => a.state === 0).slice(0, 4).map((a, i) => ({ id: 1 + i, title: a.title, img: backdrops[i] ?? a.pic, url: `/video/${a.bvid}`, position: 'home' as const, sort: i })),
      ...[...pick([1, 4]), ...pick([5, 7, 2])].filter((x) => x.horizontal).slice(0, 4).map((x, i) => ({ id: 11 + i, title: x.title, img: x.horizontal, url: `/bangumi/play/ss${x.season_id}`, position: 'anime' as const, sort: i, season_id: x.season_id })),
    ],
    settings: { siteName: 'Jumedia', allowRegister: true, auditRequired: true, maxUploadMB: 2048, announcement: '欢迎体验 Jumedia 在线媒体平台。演示视频来自 Jumedia 媒体库。', allowGuestPlay: true, defaultQuality: 80, userDataSources: true, dataSourcePrivateNetwork: false, dataSourceSyncHours: 6, dataSourceSyncRate: 5, dataSourceSyncConcurrency: 2, officialMid: 1, liveCacheDir: '', liveTranscodeHeight: 1080, imageCacheEnabled: true, imageCacheDir: '', imageCacheMaxMB: 1024 },
    logs: [{ id: 1, mid: 1, action: '系统初始化', target: '演示数据', ctime: t0 }],
    qrcodes: [], reservations: [], fanMedals: [],
  }
  extend11(fresh)
  extend12(fresh)
  extend13(fresh)
  extend14(fresh)
  extend15(fresh)
  extend16(fresh)
  extend17(fresh)
  extend18(fresh)
  return fresh
}

let db: DB | null = null

/** Needs `loadEmby()` to have run, so the seed can use the media catalog. */
export function getDB(): DB {
  if (db) return db
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DB
      if (parsed.version === 7) upgrade7(parsed)
      if (parsed.version === 8) upgrade8(parsed)
      if (parsed.version === 9) upgrade9(parsed)
      if (parsed.version === 10) upgrade10(parsed)
      if (parsed.version === 11) upgrade11(parsed)
      if (parsed.version === 12) upgrade12(parsed)
      if (parsed.version === 13) upgrade13(parsed)
      if (parsed.version === 14) upgrade14(parsed)
      if (parsed.version === 15) upgrade15(parsed)
      if (parsed.version === 16) upgrade16(parsed)
      if (parsed.version === 17) upgrade17(parsed)
      if (parsed.version === VERSION) return (db = parsed)
    }
  } catch { /* fall through to a fresh seed */ }
  db = seed()
  save()
  return db
}

/** v8 adds transcode caches; the mock server queues caches for rooms already relaying a video on start-up. */
function upgrade7(d: DB) {
  d.liveCaches = []
  Object.assign(d.settings, { liveCacheDir: '', liveTranscodeHeight: 1080 })
  d.version = 8
}

/** v9 adds the per-source sync request budget. */
function upgrade8(d: DB) {
  Object.assign(d.settings, { dataSourceSyncRate: 5, dataSourceSyncConcurrency: 2 })
  d.version = 9
}

/** v10 adds the server's local cache of data-source images. */
function upgrade9(d: DB) {
  Object.assign(d.settings, { imageCacheEnabled: true, imageCacheDir: '', imageCacheMaxMB: 1024 })
  d.version = 10
}

/** v11 adds sub-regions, exclusive seasons, space notices, live reservations and channel banners. */
function upgrade10(d: DB) {
  extend11(d)
  d.version = 11
}

/** v12 adds live fan medals (粉丝团). */
function upgrade11(d: DB) {
  extend12(d)
  d.version = 12
}

/** v13 adds scheduled publishing, drafts, episode openings and highlights, and moderation keywords. */
function upgrade12(d: DB) {
  extend13(d)
  d.version = 13
}

/** v14: demo live rooms relay their anchor's own video through the transcode cache instead of Emby HLS. */
function upgrade13(d: DB) {
  extend14(d)
  d.version = 14
}

/** v15 adds the service distribution settings (`/x/jumedia/service`). */
function upgrade14(d: DB) {
  extend15(d)
  d.version = 15
}

/** v16 adds runtime server settings that override the start-up parameters. */
function upgrade15(d: DB) {
  extend16(d)
  d.version = 16
}

/** v17: Emby is configured per data source, so the runtime Emby overrides are dropped. */
function upgrade16(d: DB) {
  extend17(d)
  d.version = 17
}

/** v18: comment counts come from the comments themselves (the seed used to invent them). */
function upgrade17(d: DB) {
  extend18(d)
  d.version = VERSION
}
function extend18(d: DB) {
  const n = new Map<number, number>()
  for (const r of d.replies) n.set(r.oid, (n.get(r.oid) ?? 0) + 1)
  for (const a of d.archives) a.stat.reply = n.get(a.aid) ?? 0
}
function extend17(d: DB) {
  for (const k of ['serverEmbyUrl', 'serverEmbyUsername', 'serverEmbyPassword']) delete d.settings[k]
}

/**
 * Server parameters an admin may change while it runs; each overrides its
 * `JUMEDIA_*` start-up value, and empty means "use the start-up value".
 * (v16 also had Emby overrides; v17 removes them — Emby belongs to data sources.)
 */
export const SERVER_KEYS = ['serverPublicOrigin', 'serverFfmpeg', 'serverFfprobe', 'serverVideoEncoder'] as const
function extend16(d: DB) {
  for (const k of [...SERVER_KEYS, 'serverEmbyUrl', 'serverEmbyUsername', 'serverEmbyPassword']) if (d.settings[k] === undefined) d.settings[k] = ''
}

/**
 * Where clients reach each API host and which CDNs they may offer. Empty
 * addresses mean "this site"; `serviceCdns` is a JSON array of `{name, url}`.
 */
export const SERVICE_KEYS = ['serviceApi', 'serviceLive', 'serviceApp', 'servicePassport'] as const
function extend15(d: DB) {
  for (const k of SERVICE_KEYS) if (d.settings[k] === undefined) d.settings[k] = ''
  if (d.settings.serviceCdns === undefined) d.settings.serviceCdns = '[]'
  if (d.settings.serviceMtime === undefined) d.settings.serviceMtime = 0
}

/** The demo rooms left live; each loops its anchor's earliest demo video. */
export const DEMO_LIVE_ROOMS = [21000, 21018]

/**
 * Demo rooms used to relay Emby HLS (`/media/emby/…`), which needs Emby's remux
 * permission. Two now relay a video (the server transcodes it into a cache and
 * starts the room once ready — `queueRelayedCaches` on start-up); the rest go
 * offline. Rooms whose source was changed since are left alone.
 */
function extend14(d: DB) {
  for (const r of d.rooms) {
    if (r.source?.type !== 'm3u8' || !r.source.url.startsWith('/media/emby/')) continue
    const a = DEMO_LIVE_ROOMS.includes(r.room_id)
      ? d.archives.filter((x) => x.mid === r.uid && x.state === 0 && x.pages[0]?.media.startsWith('emby:')).sort((x, y) => x.aid - y.aid)[0]
      : undefined
    if (a) Object.assign(r, { title: `【放映厅】${a.title}`.slice(0, 40), cover: a.pic, description: `循环转播《${a.title}》，欢迎一起看～`, live_status: 1, source: { type: 'video', url: '', loop: true, format: 'ts', kind: 'vod', aid: a.aid, cid: a.pages[0].cid } })
    else Object.assign(r, { live_status: 0, online: 0, pending_start: false, source: { type: 'push', url: '', loop: true } })
  }
}

export const DEFAULT_SENSITIVE_WORDS = '加微信\n加V\n代刷\n免费领取\n私聊我\n刷粉'

/** Demo openings and highlights for anime episodes; moderation keywords. */
function extend13(d: DB) {
  if (d.settings.sensitiveWords === undefined) d.settings.sensitiveWords = DEFAULT_SENSITIVE_WORDS
  // Medals now decay after 30 idle days; demo medals that never saw a chat count as active in the last few weeks.
  for (const m of d.fanMedals) if (!m.day) { const t = new Date(Date.now() - (m.medal_id % 20) * 86400000); m.day = t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate() }
  for (const s of d.seasons) {
    if (![1, 4].includes(s.season_type)) continue
    for (const e of s.episodes) {
      if (e.op || e.duration < 600) continue
      const start = 30 + (e.ep_id % 4) * 15
      e.op = [start, start + 89]
      e.points = [{ from: 0, content: '前情回顾' }, { from: start + 90, content: e.long_title || '正片开始' }, { from: Math.floor(e.duration * 0.55), content: '转折' }, { from: Math.floor(e.duration * 0.86), content: '片尾与下集预告' }]
    }
  }
}

function extend12(d: DB) {
  if (d.fanMedals?.length) return
  const t0 = now()
  const anchors = [...new Set(d.rooms.map((r) => r.uid))]
  let id = 7000
  d.fanMedals = []
  // The demo admin follows several streamers' fan clubs; regular demo users each wear one medal so chat shows them.
  anchors.slice(0, 6).forEach((ruid, i) => d.fanMedals.push({ medal_id: ++id, mid: 1, ruid, intimacy: [2480, 1820, 1240, 820, 260, 80][i], today: [45, 20, 0, 35, 5, 0][i], day: 0, wearing: i === 0, ctime: t0 - 86400 * (60 - i * 7) }))
  for (const u of d.users.filter((x) => x.mid > 1)) {
    const ruid = anchors[(u.mid * 7) % Math.max(1, anchors.length)]
    if (ruid && ruid !== u.mid) d.fanMedals.push({ medal_id: ++id, mid: u.mid, ruid, intimacy: (hash('m' + u.mid) % 5000) + 50, today: 0, day: 0, wearing: u.mid % 3 !== 0, ctime: t0 - 86400 * (u.mid % 40) })
  }
}

export const SUB_REGIONS: Record<number, string[]> = {
  1001: ['影视杂谈', '影视剪辑', '影视整活', '小剧场', '预告·资讯', '短片'], 1005: ['短片·手书', 'MAD·AMV', '动画综合'], 1008: ['单机游戏', '网络游戏', '游戏杂谈'],
  1007: ['鬼畜调教', '音MAD', '人力VOCALOID'], 1003: ['原创音乐', '翻唱', '演奏', '音乐现场'], 1004: ['宅舞', '街舞', '舞蹈教程'], 1002: ['综艺', '明星综合', '粉丝创作'],
  1010: ['科学科普', '社科·人文', '财经商业'], 1012: ['数码', '软件应用', '计算机技术'], 1020: ['美食制作', '美食侦探', '美食测评'], 1013: ['赛车', '改装玩车', '购车攻略'],
  1014: ['美妆护肤', '穿搭', '时尚潮流'], 1018: ['篮球', '足球', '健身'], 1024: ['喵星人', '汪星人', '动物综合'], 1030: ['手工', '绘画', '出行'], 1031: ['生活经验', '技能分享'],
}
/** Sub-region tids are `parent * 100 + n`, n from 1. */
function extend11(d: DB) {
  for (const [parent, names] of Object.entries(SUB_REGIONS)) {
    const p = Number(parent)
    if (!d.regions.some((r) => r.tid === p)) continue
    names.forEach((name, i) => { if (!d.regions.some((r) => r.tid === p * 100 + i + 1)) d.regions.push({ tid: p * 100 + i + 1, name, sort: i, visible: true, parent: p }) })
  }
  for (const a of d.archives) {
    const subs = d.regions.filter((r) => r.parent === a.tid)
    a.sub_tid = subs.length ? subs[hash(String(a.aid)) % subs.length].tid : 0
  }
  for (const s of d.seasons) s.copyright = hash('ex' + s.season_id) % 4 === 0 ? 3 : 1
  const notice: Record<number, string> = { 1: '欢迎来到 Jumedia！每周五晚 8 点官方放映厅不见不散。', 2: '新一期光影实验周三更新，评论区留下你想看的题目。' }
  for (const u of d.users) u.notice = notice[u.mid] ?? ''
  const t0 = now()
  const day = (n: number, h: number) => { const x = new Date(); x.setHours(h, 0, 0, 0); return Math.floor(x.getTime() / 1000) + n * 86400 }
  d.reservations = d.rooms.filter((r) => r.uid > 1).slice(0, 6).flatMap((r, i) => [
    { sid: 5000 + i * 2, mid: r.uid, title: `${r.title.replace(/^【放映厅】/, '')} 续集放映`, stime: day(2 + (i % 4), 20), ctime: t0 },
    { sid: 5001 + i * 2, mid: r.uid, title: '周末一起看：观众点播场', stime: day(5 + (i % 3), 19), ctime: t0 },
  ])
  d.reservations.push({ sid: 4999, mid: 1, title: '官方放映厅 · 周五电影夜', stime: day(3, 20), ctime: t0 })
  if (!d.banners.some((b) => b.position === 'channel')) {
    let id = Math.max(0, ...d.banners.map((b) => b.id))
    for (const type of [2, 3, 5, 7]) {
      d.seasons.filter((s) => s.state === 0 && s.season_type === type && s.horizontal).slice(0, 3).forEach((s, i) => d.banners.push({ id: ++id, title: s.title, img: s.horizontal, url: `/bangumi/play/ss${s.season_id}`, position: 'channel', sort: i, season_id: s.season_id, loc: 10 + type }))
    }
    for (const tid of SUB_REGIONS_KEYS()) {
      d.archives.filter((a) => a.state === 0 && a.tid === tid).slice(0, 3).forEach((a, i) => d.banners.push({ id: ++id, title: a.title, img: a.pic, url: `/video/${a.bvid}`, position: 'channel', sort: i, loc: tid }))
    }
  }
}
const SUB_REGIONS_KEYS = () => Object.keys(SUB_REGIONS).map(Number)

let pending = 0
export function save() {
  clearTimeout(pending)
  pending = window.setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(db)) } catch (e) { console.warn('[mock] 无法保存演示数据', e) }
  }, 50)
}

export function resetDB() {
  db = seed()
  try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* ignore */ }
}

export function nextID(): number {
  const d = getDB()
  d.seq += 1
  return d.seq
}

export function seedDanmaku(cid: number, duration: number) {
  const d = getDB()
  if (d.seededDanmaku.includes(cid)) return
  const r = rng(hash(String(cid)))
  const span = Math.max(10, Math.min(duration, 360))
  for (let i = 0; i < 46; i++) {
    const mode = r() < 0.86 ? 1 : r() < 0.5 ? 5 : 4
    d.danmaku.push({ id: nextID(), cid, progress: Math.floor(r() * span * 1000), mode, fontsize: 25, color: COLORS[Math.floor(r() * COLORS.length)], mid: Math.floor(r() * 12) + 1, content: DANMAKU[Math.floor(r() * DANMAKU.length)], ctime: now() - 86400, weight: 1 + Math.floor(r() * 10) })
  }
  d.seededDanmaku.push(cid)
}

export const LIVE_CHATTER = DANMAKU

// ---- Uploaded files (IndexedDB), referenced from records as `idb:<id>` ----

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jumedia-mock', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putFile(file: Blob): Promise<string> {
  const key = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  const store = (await idb()).transaction('files', 'readwrite').objectStore('files')
  await new Promise((res, rej) => { const q = store.put(file, key); q.onsuccess = res; q.onerror = () => rej(q.error) })
  return 'idb:' + key
}

const urls = new Map<string, string>()
/** `idb:` uploads → blob URL, `emby:` demo media → Emby stream URL, `embyds:` data-source media → stream URL or HLS path. */
export async function resolveMedia(ref: string): Promise<string> {
  if (ref.startsWith('emby:')) return embyStreamURL(ref)
  if (ref.startsWith('embyds:')) return dsMediaURL(getDB(), ref)
  if (!ref.startsWith('idb:')) return ref
  const cached = urls.get(ref)
  if (cached) return cached
  const store = (await idb()).transaction('files').objectStore('files')
  const blob = await new Promise<Blob | undefined>((res) => { const q = store.get(ref.slice(4)); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined) })
  if (!blob) return ''
  const url = URL.createObjectURL(blob)
  urls.set(ref, url)
  return url
}
