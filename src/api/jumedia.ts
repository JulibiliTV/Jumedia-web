import { csrf, data, envelope, post } from './client'

/**
 * Jumedia-only endpoints: features the Juli data source does not call
 * (account creation, uploading, creator tools and administration). They use
 * the same envelope, cookie session and CSRF fields as the Juli endpoints, and
 * follow the platform's existing path namespaces where one exists.
 */

// ---------- 站点 ----------
export const site = () => data('api', '/x/jumedia/site')
/** Service distribution for clients: API base addresses (empty settings resolve to this site) and CDNs. */
export const service = () => data('api', '/x/jumedia/service') as Promise<{ api: string; live: string; app: string; passport: string; cdn: { name: string; url: string }[]; mtime: number }>

// ---------- 账号 ----------
export const login = (username: string, password: string) => post('passport', '/x/passport-login/web/login', { username, password })
export const register = (p: { username: string; password: string; uname: string; email?: string }) => post('passport', '/x/passport-login/web/register', p)
/** Phone/web side of the TV QR login: the QR `url` returned by `auth_code` opens `/tv-login?auth_code=`. */
export const qrScan = (auth_code: string) => post('passport', '/x/passport-tv-login/h5/qrcode/scan', { ...csrf(), auth_code })
export const qrConfirm = (auth_code: string) => post('passport', '/x/passport-tv-login/h5/qrcode/confirm', { ...csrf(), auth_code })
export const updateProfile = (p: { uname: string; sign: string; sex: string; birthday: string; face?: string }) => post('api', '/x/member/web/update', { ...csrf(), ...p })
export const updatePassword = (old_password: string, new_password: string) => post('passport', '/x/passport-login/web/password/update', { ...csrf(), old_password, new_password })

// ---------- 收藏夹管理 ----------
export const favFolderAdd = (title: string, intro: string, privacy: number) => post('api', '/x/v3/fav/folder/add', { ...csrf(), title, intro, privacy })
export const favFolderEdit = (media_id: number, title: string, intro: string, privacy: number) => post('api', '/x/v3/fav/folder/edit', { ...csrf(), media_id, title, intro, privacy })
export const favFolderDel = (media_ids: number) => post('api', '/x/v3/fav/folder/del', { ...csrf(), media_ids })

// ---------- 弹幕 / 直播互动 ----------
export const dmPost = (p: { oid: number; aid: number; msg: string; progress: number; mode: number; color: number; fontsize: number }) =>
  post('api', '/x/v2/dm/post', { ...csrf(), type: 1, ...p })
export const liveSend = (roomid: number, msg: string, color = 16777215) => post('live', '/msg/send', { ...csrf(), roomid, msg, color, fontsize: 25, mode: 1, rnd: Math.floor(Date.now() / 1000) })

// ---------- 上传 ----------
export function uploadFile(kind: 'video' | 'image', file: File, onProgress?: (ratio: number) => void) {
  const body = new FormData()
  body.append('file', file)
  onProgress?.(0)
  return post('api', `/x/upload/web/${kind}`, csrf(), { body }).then((r) => { onProgress?.(1); return r.data })
}

// ---------- 创作中心 ----------
export type ArchiveForm = {
  aid?: number; title: string; tid: number; sub_tid?: number; tag: string; desc: string; cover: string; copyright: number; source?: string
  season_id?: number; videos: { filename: string; title: string; duration: number }[]; chapters?: { from: number; to: number; content: string }[]
  /** Scheduled publish time (unix seconds, 0 = publish on approval); `draft` saves without submitting. */
  dtime?: number; draft?: number; no_disturbance?: number; no_tv?: number
}
export const archiveSubmit = (f: ArchiveForm) => post('api', f.aid ? '/x/vu/web/edit' : '/x/vu/web/add/v3', { ...csrf(), ...f, videos: JSON.stringify(f.videos), chapters: JSON.stringify(f.chapters ?? []) })
export const creatorArchives = (p: { pn: number; ps?: number; status?: string; keyword?: string; origin?: '' | 'upload' | 'datasource' }) => data('api', '/x/web/archives', { ps: 10, ...p })
/** Restores Emby metadata on a data-source archive (all locked fields when `fields` is omitted). */
export const archiveOriginReset = (aid: number, fields?: string[]) => post('api', '/x/web/archive/origin/reset', { ...csrf(), aid, fields: fields?.join(',') })
export const creatorArchive = (aid: number) => data('api', '/x/web/archive/view', { aid })
export const archiveDelete = (aid: number) => post('api', '/x/web/archive/delete', { ...csrf(), aid })
export const creatorStat = () => data('api', '/x/web/data/stat')
/** The web home feed (`/x/v2/feed/index` is the TV feed). */
export const homeRcmd = (page: number, ps = 20) => data('api', '/x/web-interface/wbi/index/top/feed/rcmd', { fresh_idx: page, ps }, { wbi: true }) as Promise<{ item: unknown[] }>
export const creatorSeasons = () => data('api', '/x/web/seasons')
export const seasonSave = (p: { season_id?: number; title: string; intro: string; cover: string; aids: string; kind: 'season' | 'series' }) => post('api', '/x/web/season/save', { ...csrf(), ...p })
export const seasonDelete = (season_id: number, kind: 'season' | 'series') => post('api', '/x/web/season/delete', { ...csrf(), season_id, kind })
export const seasonOriginReset = (season_id: number) => post('api', '/x/web/season/origin/reset', { ...csrf(), season_id })
export const liveRoomMine = () => data('live', '/xlive/app-blink/v1/room/GetInfo')
/** Issues a new stream key; the old key stops working. */
export const streamKeyReset = () => post('live', '/xlive/app-blink/v1/live/getWebUpStreamAddr', { ...csrf(), reset_key: true })
export const liveRoomUpdate = (p: { title: string; area_id: number; cover?: string }) => post('live', '/room/v1/Room/update', { ...csrf(), ...p })
export const liveStart = (area_v2: number) => post('live', '/room/v1/Room/startLive', { ...csrf(), area_v2, platform: 'pc' })
export const liveStop = () => post('live', '/room/v1/Room/stopLive', csrf())
/**
 * m3u8 pull source: a VOD playlist is relayed as a looping live stream, a live playlist is passed through.
 * `video`: one page (`aid` + `cid`) of the streamer's data-source videos. The server transcodes it into a cache
 * first; the room can go live once that is ready, or automatically with `auto_start`.
 */
export type SourceForm = { source_type: 'push' | 'm3u8' | 'video'; source_url: string; loop: boolean; aid?: number; cid?: number; auto_start?: boolean }
/** Transcode cache of a `video` source. */
/** Server-side cache of data-source images (`/x/admin/imagecache`). */
export interface ImageCacheState { enabled: boolean; dir: string; max_mb: number; files: number; bytes: number }
export interface LiveCacheState { key: string; status: 'pending' | 'running' | 'ready' | 'failed'; progress: number; message: string; height: number; size: number }
export const streamSourceProbe = (url: string) => data('live', '/xlive/app-blink/v1/streamSource/probe', { url })
export const streamSourceUpdate = (f: SourceForm) => post('live', '/xlive/app-blink/v1/streamSource/update', { ...csrf(), ...f })
export const streamSourceRetry = () => post('live', '/xlive/app-blink/v1/streamSource/retry', csrf())
export const streamSourceVideos = (p: { pn: number; keyword?: string }) => data('live', '/xlive/app-blink/v1/streamSource/videos', { ps: 12, ...p })

// ---------- B 方案：Juli 不调用的接口 ----------
export const onlineTotal = (aid: number, cid: number) => data('api', '/x/player/online/total', { aid, cid })
export const upStat = (mid: number) => data('api', '/x/space/upstat', { mid })
export const spaceNotice = (mid: number) => data<string>('api', '/x/space/notice', { mid })
export const spaceNoticeSet = (notice: string) => post('api', '/x/space/notice/set', { ...csrf(), notice })
/** Hot search words, a bare `list`. */
export const hotwords = async (): Promise<{ keyword: string; show_name: string; word_type: number }[]> => ((await envelope('api', '/main/hotword')) as unknown as { list?: { keyword: string; show_name: string; word_type: number }[] }).list ?? []
export const searchDefault = () => data('api', '/x/web-interface/wbi/search/default')
export const dynamicPortal = () => data('api', '/x/polymer/web-dynamic/v1/portal')
export const regionOnline = () => data('api', '/x/web-interface/online')
export const tagHots = (rid: number) => data('api', '/x/tag/hots', { rid, type: 0 })
/** Region videos. `order` (pubdate|click|dm|stow) and `duration` (0–4) are Jumedia extensions; `rid` may be a sub-region. */
export const regionDynamic = (p: { rid: number; pn: number; ps?: number; order?: string; duration?: number }) => data('api', '/x/web-interface/dynamic/region', { ps: 20, ...p, order: p.order || undefined, duration: p.duration || undefined })
/** Channel carousels: `ids` are region tids (UGC) or 10 + season_type (PGC). */
export const resLocs = (ids: number[]) => data<Record<string, any[]>>('api', '/x/web-show/res/locs', { pf: 0, ids: ids.join(',') })
/** mode 2 = 最新, 3 = 最热; `next` is the 1-based page. */
export const replyMain = (oid: number, mode: 2 | 3, next = 1) => data('api', '/x/v2/reply/wbi/main', { type: 1, oid, mode, next, ps: 20 }, { wbi: true })
export const seasonIndexCondition = (season_type: number) => data('api', '/pgc/season/index/condition', { season_type, type: 1 })
export const liveGoldRank = (roomId: number, ruid: number, page = 1) => data('live', '/xlive/general-interface/v1/rank/getOnlineGoldRank', { roomId, ruid, page, pageSize: 20 })
export const liveGuards = (roomid: number, ruid: number, page = 1) => data('live', '/xlive/app-room/v1/guardTab/topList', { roomid, ruid, page, page_size: 20 })
export const reservations = (vmid: number) => data<any[]>('api', '/x/space/reservation', { vmid })
export const reservationAdd = (title: string, stime: number) => post('api', '/x/web/reservation/add', { ...csrf(), title, stime })
export const reservationDelete = (sid: number) => post('api', '/x/web/reservation/delete', { ...csrf(), sid })

// ---------- 每周必看 / 历史 / 粉丝勋章 ----------
export const weeklyList = () => data('api', '/x/web-interface/popular/series/list', { web_location: '333.934' })
export const weeklyOne = (number: number) => data('api', '/x/web-interface/popular/series/one', { number, web_location: '333.934' })
/** kid: `archive_{aid}` or `pgc_{season_id}`. */
export const historyDelete = (kid: string) => post('api', '/x/v2/history/delete', { ...csrf(), kid })
export const medalPanel = (page = 1, target_id?: number) => data('live', '/xlive/app-ucenter/v1/fansMedal/panel', { page, pageSize: 50, target_id })
export const medalRank = (roomid: number, ruid: number) => data('live', '/rankdb/v1/RoomRank/webMedalRank', { roomid, ruid })
export const medalWear = (medal_id: number) => post('live', '/xlive/web-room/v1/fansMedal/wear', { ...csrf(), medal_id })
export const medalTakeOff = () => post('live', '/xlive/web-room/v1/fansMedal/take_off', csrf())
/** Jumedia: free 粉丝团 join. */
export const medalJoin = (roomid: number) => post('live', '/xlive/web-room/v1/fansMedal/join', { ...csrf(), roomid })

// ---------- 数据源（Emby，只读） ----------
export type DataSourceForm = { id?: number; name: string; url: string; username: string; password: string; clear_password?: boolean; libraries?: string; auto_sync: boolean; proxy_playback: boolean }
/** Same routes under `/x/web/` (the caller's own sources) and `/x/admin/` (system sources, owned by the official account). */
export function dataSourceAPI(scope: 'web' | 'admin') {
  const base = `/x/${scope}/datasource`
  return {
    test: (f: DataSourceForm) => data('api', `${base}/test`, { ...csrf(), ...f }, { method: 'POST' }),
    save: (f: DataSourceForm) => data('api', `${base}/save`, { ...csrf(), ...f }, { method: 'POST' }),
    sync: (id: number) => data('api', `${base}/sync`, { ...csrf(), id }, { method: 'POST' }),
    remove: (id: number) => post('api', `${base}/delete`, { ...csrf(), id }),
  }
}
export const dataSources = () => data('api', '/x/web/datasources')

// ---------- 管理后台 ----------
export interface DanmakuSync {
  cid: number; aid: number; status: 'idle' | 'pending' | 'fetching' | 'ready' | 'unmatched' | 'error'
  message: string; episode_id: number; anime_title: string; episode_title: string; count: number; updated_at: number
}
export interface SyncedDanmaku { id: number; cid: number; progress: number; mode: number; fontsize: number; color: number; content: string; ctime: number; weight: number }
export interface ArchiveDanmaku {
  pages: { cid: number; part: string; sync: DanmakuSync }[]; sync: DanmakuSync; list: SyncedDanmaku[]
  page: { pn: number; ps: number; total: number }
}
export const admin = {
  dashboard: () => data('api', '/x/admin/dashboard'),
  users: (p: { pn: number; keyword?: string; role?: string; status?: string }) => data('api', '/x/admin/users', { ps: 20, ...p }),
  userUpdate: (p: { mid: number; role?: string; status?: number; coins?: number }) => post('api', '/x/admin/user/update', { ...csrf(), ...p }),
  archives: (p: { pn: number; state?: string; keyword?: string; tid?: number }) => data('api', '/x/admin/archives', { ps: 20, ...p }),
  archiveDanmaku: (aid: number, cid: number, pn = 1) => data<ArchiveDanmaku>('api', '/x/admin/archive/danmaku', { aid, cid, pn, ps: 20 }),
  archiveAudit: (aid: number, state: number, reason = '') => post('api', '/x/admin/archive/audit', { ...csrf(), aid, state, reason }),
  archiveDelete: (aid: number) => post('api', '/x/admin/archive/delete', { ...csrf(), aid }),
  seasons: (p: { pn: number; season_type?: number; keyword?: string }) => data('api', '/x/admin/seasons', { ps: 20, ...p }),
  seasonSave: (season: unknown) => post('api', '/x/admin/season/save', { ...csrf(), season: JSON.stringify(season) }),
  seasonDelete: (season_id: number) => post('api', '/x/admin/season/delete', { ...csrf(), season_id }),
  liveRooms: (p: { pn: number; keyword?: string }) => data('api', '/x/admin/live/rooms', { ps: 20, ...p }),
  liveRoomBan: (room_id: number, banned: boolean) => post('api', '/x/admin/live/room/ban', { ...csrf(), room_id, banned }),
  liveRoomSource: (room_id: number, f: SourceForm & { start?: boolean }) => post('api', '/x/admin/live/room/source', { ...csrf(), room_id, ...f }),
  liveRoomVideos: (room_id: number, p: { pn: number; keyword?: string }) => data('api', '/x/admin/live/room/videos', { ps: 12, room_id, ...p }),
  liveCaches: (p: { pn: number }) => data('api', '/x/admin/live/caches', { ps: 20, ...p }),
  liveCacheRetry: (key: string) => post('api', '/x/admin/live/cache/retry', { ...csrf(), key }),
  liveCacheDelete: (key: string) => post('api', '/x/admin/live/cache/delete', { ...csrf(), key }),
  dataSources: (p: { pn: number; scope?: string; keyword?: string }) => data('api', '/x/admin/datasources', { ps: 20, ...p }),
  replies: (p: { pn: number; keyword?: string; flagged?: number; reported?: number }) => data('api', '/x/admin/replies', { ps: 20, ...p }),
  replyReportDismiss: (rpid: number) => post('api', '/x/admin/reply/report/dismiss', { ...csrf(), rpid }),
  replyDelete: (rpid: number) => post('api', '/x/admin/reply/delete', { ...csrf(), rpid }),
  danmaku: (p: { pn: number; keyword?: string; flagged?: number }) => data('api', '/x/admin/danmaku', { ps: 20, ...p }),
  danmakuDelete: (id: number) => post('api', '/x/admin/danmaku/delete', { ...csrf(), id }),
  regions: () => data('api', '/x/admin/regions'),
  regionSort: (tids: number[]) => post('api', '/x/admin/region/sort', { ...csrf(), tids: tids.join(',') }),
  regionSave: (p: { tid?: number; name: string; sort: number; visible: boolean; parent?: number }) => post('api', '/x/admin/region/save', { ...csrf(), ...p }),
  regionDelete: (tid: number) => post('api', '/x/admin/region/delete', { ...csrf(), tid }),
  liveAreas: () => data('api', '/x/admin/live/areas'),
  liveAreaSave: (p: { id?: number; name: string }) => post('api', '/x/admin/live/area/save', { ...csrf(), ...p }),
  banners: () => data('api', '/x/admin/banners'),
  bannerSave: (p: { id?: number; title: string; img: string; url: string; position: string; sort: number; loc?: number }) => post('api', '/x/admin/banner/save', { ...csrf(), ...p }),
  bannerDelete: (id: number) => post('api', '/x/admin/banner/delete', { ...csrf(), id }),
  settings: () => data('api', '/x/admin/settings'),
  imageCache: () => data<ImageCacheState>('api', '/x/admin/imagecache'),
  imageCacheClear: () => post<{ files: number; bytes: number }>('api', '/x/admin/imagecache/clear', { ...csrf() }).then((r) => r.data!),
  settingsSave: (p: Record<string, string | number | boolean>) => post('api', '/x/admin/settings/save', { ...csrf(), ...p }),
  /** Start-up parameters (read-only) and the start-up values behind the runtime server settings. */
  server: () => data('api', '/x/admin/server') as Promise<{ boot: { key: string; label: string; value: string }[]; startup: { publicOrigin: string; ffmpeg: string; ffprobe: string; videoEncoder: string } }>,
  logs: (p: { pn: number; kind?: string; days?: number; mid?: number }) => data('api', '/x/admin/logs', { ps: 30, ...p, kind: p.kind || undefined, days: p.days || undefined, mid: p.mid || undefined }),
}
