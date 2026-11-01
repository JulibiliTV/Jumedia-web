import { accessKey, bytes, csrf, data, envelope, post } from './client'
import { decodeSegment, decodeWebView, remoteParameters, type DanmakuSettings } from './protobuf'

/**
 * Every endpoint Juli's `BiliAPIClient` calls, with the same path, host,
 * method and parameter names. Comments name the Swift method each mirrors so
 * the two stay in step. Responses are returned as delivered (`data`/`result`).
 */

// ---------- 账号 / 登录 ----------
export const nav = () => data('api', '/x/web-interface/nav') // fetchProfile / confirmsAuthenticatedSession
export const signOut = () => post('passport', '/login/exit/v2', csrf()) // signOut
export const requestLoginTicket = () => post('passport', '/x/passport-tv-login/qrcode/auth_code', {}, { app: true }) // requestLoginTicket
export const pollLogin = (authCode: string) => post('passport', '/x/passport-tv-login/qrcode/poll', { auth_code: authCode }, { app: true, validates: false }) // pollLogin
export const refreshToken = (refresh_token: string) => post('passport', '/api/v2/oauth2/refresh_token', { refresh_token }, { app: true }) // refreshSession

// ---------- 首页 / 推荐 / 热门 / 排行 / 分区 ----------
export function feedIndex(page: number) { // fetchRecommendations
  const key = accessKey()
  return data('app', '/x/v2/feed/index', { idx: Math.max(0, (page - 1) * 20), pull: page === 1 ? 0 : 1, column: 4, device: 'pad', platform: 'ios', access_key: key || undefined }, { app: true })
}
export const feedDislike = (p: { goto: string; id: number; reason_id: number }) => // submitRecommendationFeedback
  data('app', '/x/feed/dislike', { access_key: accessKey(), goto: p.goto, id: p.id, reason_id: p.reason_id, build: 1, platform: 'ios' }, { app: true })
export const popular = (pn: number) => data('api', '/x/web-interface/popular', { pn, ps: 20 }) // fetchPopular
export const ranking = (rid: number) => data('api', '/x/web-interface/ranking/v2', { rid, type: 'all' }) // fetchRanking
export const regionList = () => data('api', '/x/web-interface/region/list') // fetchRankingCategories
export const rankingRegion = (rid: number, day: number) => data('api', '/x/web-interface/ranking/region', { rid, day, original: 0 }) // BangumiPopularCategory.news
export const promotionFeedback = (p: { id: string; mid: number; track_id: string; cm_reason_id: number; ad_cb: string }) => // submitPromotionFeedback (query is WBI-signed, body is the form)
  post('api', '/x/web-interface/feedback/dislike', { ...csrf(), app_id: 100, platform: 5, from_spmid: '', spmid: '333.1007.0.0', goto: 'ad', feedback_page: 1, ...p })
export const pgcRank = (seasonType: number) => data('api', '/pgc/web/rank/list', { day: 3, season_type: seasonType }, { key: 'result' }) // fetchRanking(category:)
export async function regionFeed(regionId: number, page: number) { // fetchRegionFeed (62013 = end of feed)
  const root = await envelope('api', '/x/web-interface/region/feed/rcmd', { from_region: regionId, display_id: page, request_cnt: 15, device: 'web', plat: 30 }, { wbi: true, validates: false })
  if (root.code === 62013) return { archives: [] }
  if (root.code !== 0) throw new Error(root.message)
  return root.data
}
export function pgcFeed(name: string, cursor: number) { // fetchPGCChannelFeed
  const modern = name === 'anime' || name === 'guochuang'
  return data('api', `/pgc/page/web/${modern ? 'v3/' : ''}feed`, { name, coursor: cursor, new_cursor_status: modern ? undefined : 'true' })
}
export const dynamicFeed = (offset?: string) => data('api', '/x/polymer/web-dynamic/v1/feed/all', { type: 'all', timezone_offset: -480, offset: offset || undefined }) // fetchDynamicFeed

// ---------- 搜索 ----------
export const searchAll = (keyword: string) => data('api', '/x/web-interface/search/all/v2', { keyword }) // search
/** `extra` (order / duration / tids) is web-only; Juli sends none of it. */
export const searchType = (keyword: string, search_type: string, page: number, extra: { order?: string; duration?: number; tids?: number } = {}) => // searchPage
  data('api', '/x/web-interface/wbi/search/type', { keyword, search_type, page, page_size: 20, platform: 'pc', web_location: 1430654, order: extra.order || undefined, duration: extra.duration || undefined, tids: extra.tids || undefined }, { wbi: true })
export async function suggest(term: string): Promise<{ term: string; name: string }[]> { // searchSuggestions (root-level `result`)
  const root = (await envelope('api', '/x/web-interface/suggest', { term })) as { result?: { tag?: { term: string; name: string }[] } }
  return root.result?.tag ?? []
}

// ---------- 视频详情 / 播放 ----------
export const view = (p: { bvid?: string; aid?: number }) => data('api', '/x/web-interface/view', p.bvid ? { bvid: p.bvid } : { aid: p.aid }) // fetchDetail / fetchDetailSupplement
export const viewDetail = (aid: number) => data('api', '/x/web-interface/view/detail', { aid }) // fetchDetail
export const playerV2 = (aid: number, cid: number) => data('api', '/x/player/wbi/v2', { aid, cid }, { wbi: true }) // progress / subtitles / chapters / mask
export const videoshot = (aid: number, cid: number) => data('api', '/x/player/videoshot', { aid, cid, index: 1 }) // fetchVideoPreview
export const playurl = (avid: number, cid: number, qn = 80, dash = false) => // requestPlayableMedia (.video)
  data('api', '/x/player/wbi/playurl', { avid, cid, qn, fnval: dash ? 4048 : 0, fnver: 0, fourk: 1, voice_balance: 1 }, { wbi: true })
export const pgcPlayurl = (ep_id: number, qn = 80, dash = false) => // requestPlayableMedia (.bangumi)
  data('api', '/pgc/player/web/playurl', { ep_id, qn, fnval: dash ? 4048 : 0, fnver: 0, fourk: 1, voice_balance: 1 }, { key: 'result' })
export function heartbeat(p: { aid: number; cid: number; played_time: number; bangumi?: { epid?: number; sid?: number } }) { // reportPlaybackHistory
  const b = p.bangumi
  return post('api', '/x/click-interface/web/heartbeat', {
    ...csrf(), aid: p.aid, cid: p.cid, played_time: p.played_time, type: b ? 4 : 3, sub_type: b ? 1 : 0,
    ...(b ? { epid: b.epid, sid: b.sid, mobi_app: 'web', device: 'web', platform: 'web' } : {}),
  })
}

// ---------- 互动 ----------
export const hasLike = (aid: number) => data('api', '/x/web-interface/archive/has/like', { aid }) // fetchLikeStatus
export const like = (aid: number, on: boolean) => post('api', '/x/web-interface/archive/like', { ...csrf(), aid, like: on ? 1 : 2 }) // setLike
export const dislike = (aid: number, on: boolean) => post('app', '/x/v2/view/dislike', { aid, access_key: accessKey(), dislike: on ? 0 : 1 }, { app: true }) // setDislike
export const coin = (aid: number, multiply: 1 | 2) => post('api', '/x/web-interface/coin/add', { ...csrf(), aid, multiply, select_like: 1 }) // setCoin
export const favoured = (aid: number) => data('api', '/x/v2/fav/video/favoured', { aid }) // fetchFavoriteStatus
export const favDeal = (aid: number, folderId: number, add: boolean) => // setFavorite
  post('api', '/x/v3/fav/resource/deal', { ...csrf(), rid: aid, type: 2, [add ? 'add_media_ids' : 'del_media_ids']: folderId })
export function share(aid: number) { // shareVideo
  let extra = {}
  try { extra = csrf() } catch { /* anonymous share */ }
  return post('api', '/x/web-interface/share/add', { aid, ...extra })
}
export const relationModify = (fid: number, follow: boolean) => post('api', '/x/relation/modify', { ...csrf(), fid, act: follow ? 1 : 2, re_src: 14 }) // setFollowing

// ---------- 评论 ----------
export const replies = (oid: number, pn: number, ps = 20, sort = 1) => data('api', '/x/v2/reply', { type: 1, oid, sort, nohot: 0, pn, ps }) // fetchVideoComments (Juli always sends sort=1)
export const replyThread = (oid: number, root: number, pn: number) => data('api', '/x/v2/reply/reply', { type: 1, oid, root, sort: 1, pn, ps: 20 }) // fetchCommentReplies
export const replyAdd = (oid: number, message: string, root?: number, parent?: number) => post('api', '/x/v2/reply/add', { ...csrf(), type: 1, oid, message, root, parent }) // postComment
export const replyDel = (oid: number, rpid: number) => post('api', '/x/v2/reply/del', { ...csrf(), type: 1, oid, rpid }) // deleteComment
export const replyReact = (oid: number, rpid: number, hate: boolean, on: boolean) => // setCommentReaction
  post('api', '/x/v2/reply/' + (hate ? 'hate' : 'action'), { ...csrf(), type: 1, oid, rpid, action: on ? 1 : 0 })

// ---------- 弹幕 ----------
export const dmSegment = async (cid: number, index: number) => decodeSegment(await bytes('api', '/x/v2/dm/list/seg.so', { type: 1, oid: cid, segment_index: index })) // fetchDanmakuSegment
export const dmWebView = async (cid: number) => decodeWebView(await bytes('api', '/x/v2/dm/web/view', { type: 1, oid: cid })) // fetchDanmakuSettings
export async function dmSaveConfig(s: DanmakuSettings) { // saveDanmakuSettings (23004 = unchanged)
  const root = await post('api', '/x/v2/dm/web/config', { ...csrf(), ...remoteParameters(s) }, { validates: false })
  if (root.code !== 0 && root.code !== 23004) throw new Error(root.message)
}
export const dmFilterUser = () => data('api', '/x/dm/filter/user') // fetchRemoteDanmakuRuleCount

// ---------- 历史 / 稍后再看 ----------
export const historyCursor = (max = 0, view_at = 0, ps = 20) => data('api', '/x/web-interface/history/cursor', { type: 'all', ps, max, view_at }) // fetchHistoryPage
export const historyShadow = () => data('api', '/x/v2/history/shadow') // fetchHistoryRecordingPaused
export const historyShadowSet = (paused: boolean) => post('api', '/x/v2/history/shadow/set', { ...csrf(), switch: paused }) // setHistoryRecordingPaused
export const historyClear = () => post('api', '/x/v2/history/clear', csrf()) // clearHistory
export const toview = () => data('api', '/x/v2/history/toview') // fetchWatchLater
export const toviewWeb = (pn: number, asc: boolean) => // fetchWatchLaterPage
  data('api', '/x/v2/history/toview/web', { pn, ps: 20, viewed: 0, key: '', asc, need_split: true, web_location: '333.881' }, { wbi: true })
export const toviewAdd = (aid: number) => post('api', '/x/v2/history/toview/add', { ...csrf(), aid }) // addToWatchLater
export const toviewDel = (aid: number) => post('api', '/x/v2/history/toview/v2/dels', { ...csrf(), resources: aid }) // removeFromWatchLater

// ---------- 收藏 ----------
export const favFolders = (up_mid: number, rid?: number) => data('api', '/x/v3/fav/folder/created/list-all', { up_mid, rid }) // fetchFavoriteFolders (web adds `rid` for fav_state)
export const favResources = (media_id: number, pn: number, order = 'mtime') => // fetchFavoritesPage
  data('api', '/x/v3/fav/resource/list', { media_id, pn, ps: 20, platform: 'web', order, type: 0, tid: 0, keyword: '' })

// ---------- 关注 / UP 空间 ----------
export const followings = (vmid: number, pn: number, ps = 50) => data('api', '/x/relation/followings', { vmid, pn, ps, order: 'desc', order_type: 'attention' }) // fetchFollowingPage
export const accInfo = (mid: number) => data('api', '/x/space/wbi/acc/info', { mid }, { wbi: true }) // fetchUPSpaceProfile
export const accRelation = (mid: number) => data('api', '/x/space/wbi/acc/relation', { mid }, { wbi: true }) // fetchUPInfo
export const relationStat = (vmid: number) => data('api', '/x/relation/stat', { vmid }) // fetchUPInfo
export const card = (mid: number) => data('api', '/x/web-interface/card', { mid, photo: true }) // fetchUPSpaceProfile
export const arcSearch = (mid: number, pn: number, order = 'pubdate', ps = 30) => // fetchUPArchiveWebPage
  data('api', '/x/space/wbi/arc/search', { mid, ps, pn, order, tid: 0, platform: 'web', web_location: '333.1387', order_avoided: true }, { wbi: true })
export const archiveCursor = (vmid: number, order: string, aid?: number) => // fetchUPArchives(.app)
  data('app', '/x/v2/space/archive/cursor', { vmid, ps: 20, order, disable_rcmd: 1, actionKey: 'appkey', fnval: 976, fnver: 0, force_host: 0, fourk: 1, player_net: 1, qn: 120, aid }, { app: true })
export const topArc = (vmid: number) => data('api', '/x/space/top/arc', { vmid }) // fetchUPFeatured
export const masterpiece = (vmid: number) => data('api', '/x/space/masterpiece', { vmid }) // fetchUPFeatured
export const seasonsSeriesList = (mid: number, page_num: number) => data('api', '/x/polymer/web-space/seasons_series_list', { mid, page_num, page_size: 10 }) // fetchUPCollections
export const seasonsArchives = (mid: number, season_id: number, page_num: number, reverse: boolean) => // fetchUPCollectionVideos(.season)
  data('api', '/x/polymer/web-space/seasons_archives_list', { mid, season_id, page_num, page_size: 30, sort_reverse: reverse, web_location: '333.1387' })
export const seriesArchives = (mid: number, series_id: number, pn: number, sort: 'desc' | 'asc') => // fetchUPCollectionVideos(.series)
  data('api', '/x/series/archives', { mid, series_id, pn, ps: 30, sort, web_location: '333.1387' })

// ---------- 番剧 ----------
export const pgcPage = (name: 'anime' | 'guochuang') => data('api', '/pgc/page/web/v3', { name }) // fetchBangumiWebPage
export const pgcTimeline = (types: number) => data('api', '/pgc/web/timeline', { types, before: 6, after: 6 }, { key: 'result' }) // fetchBangumiTimeline
export const pgcRankIndex = () => data('api', '/pgc/season/rank/index', { index_id: 101 }) // fetchBangumiRankingTabs
export const pgcRankList = (style_id: number, season_type = 1) => data('api', '/pgc/season/rank/list', { season_type, style_id, day: 3 }) // BangumiRankingTab / BangumiPopularCategory (热搜榜 210, 会员榜 430 use season_type 0)
export const pgcSeason = (p: { season_id?: number; ep_id?: number }) => data('api', '/pgc/view/web/season', p.ep_id ? { ep_id: p.ep_id } : { season_id: p.season_id }, { key: 'result' }) // fetchBangumiDetail
/** `filters` (area, style_id, year, is_finish, copyright, season_status) are web-only; Juli sends none. */
export const seasonIndex = (p: { season_type: number; order: number; sort: number; page: number; pagesize?: number; filters?: Record<string, string> }) => // fetchBangumiCategory / fetchTopRatedBangumi
  data('api', '/pgc/season/index/result', { ...p.filters, season_type: p.season_type, type: 1, order: p.order, sort: p.sort, page: p.page, pagesize: p.pagesize ?? 24 })
/** type 1 = 追番 (番剧 / 国创, what Juli requests), 2 = 追剧 (other types). */
export const bangumiFollowList = (vmid: number, pn: number, follow_status?: number, type: 1 | 2 = 1) => // fetchFollowedBangumi
  data('api', '/x/space/bangumi/follow/list', { vmid, type, pn, ps: 30, follow_status })
export const seasonUserStatus = (season_id: number) => data('api', '/pgc/view/web/season/user/status', { season_id }, { key: 'result' }) // fetchBangumiFollowState
export const pgcFollow = (season_id: number, on: boolean) => post('api', `/pgc/web/follow/${on ? 'add' : 'del'}`, { ...csrf(), season_id }) // setBangumiFollowing
export const pgcFollowStatus = (season_id: number, status: number) => post('api', '/pgc/web/follow/status/update', { ...csrf(), season_id, status }) // setBangumiWatchStatus

// ---------- 直播 ----------
export const liveAreas = () => data('live', '/xlive/web-interface/v1/index/getWebAreaList', { source_id: 2 }) // fetchLiveAreas
export const liveRoomList = (parent_area_id: number, page: number, sort_type = 'online') => // fetchLiveAreaRooms
  data('live', '/room/v1/area/getRoomList', { parent_area_id, area_id: 0, page, page_size: 20, sort_type })
export const liveRecommend = (page: number) => data('live', '/xlive/web-interface/v1/second/getUserRecommend', { platform: 'web', page_size: 30, page }, { wbi: true }) // fetchCategory(.live)
export const liveFollowing = (page: number) => data('live', '/xlive/web-ucenter/user/following', { page, page_size: 20, ignoreRecord: 1, hit_ab: true }) // fetchFollowedLiveRooms
export const roomInfo = (room_id: number) => data('live', '/room/v1/Room/get_info', { room_id }) // fetchLiveRoomOwner
export const roomInit = (id: number) => data('live', '/room/v1/Room/room_init', { id }) // fetchLiveChatConnection
export const masterInfo = (uid: number) => data('live', '/live_user/v1/Master/info', { uid }) // fetchLiveRoomOwner
export const roomPlayInfo = (room_id: number) => // fetchLivePlayableMedia
  data('live', '/xlive/web-room/v2/index/getRoomPlayInfo', { room_id, protocol: '0,1', format: '0,1,2', codec: '0,1', qn: 10000, platform: 'web', ptype: 8 })
export const danmuInfo = (id: number) => data('live', '/xlive/web-room/v1/index/getDanmuInfo', { id, web_location: '444.8' }, { wbi: true }) // fetchLiveChatConnection
export const liveHistory = (roomid: number) => data('live', '/xlive/web-room/v1/dM/gethistory', { roomid }) // fetchLiveChatHistory
export const superChats = (room_id: number) => data('live', '/av/v1/SuperChat/getMessageList', { room_id }) // fetchLiveSuperChats

export { envelope }
