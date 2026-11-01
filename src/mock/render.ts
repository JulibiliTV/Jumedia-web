import { formatDuration } from '../api/normalize'
import { type Archive, type Collection, type DB, type LiveRoom, type Reply, type Season, type User, getDB } from './db'

// Renders stored records into the response shapes Juli parses.

export const userById = (mid: number): User | undefined => getDB().users.find((u) => u.mid === mid)
export const archiveById = (aid: number) => getDB().archives.find((a) => a.aid === aid)
export const published = (db: DB = getDB()) => db.archives.filter((a) => a.state === 0 && userById(a.mid)?.status === 0)
export const regionName = (tid: number) => getDB().regions.find((r) => r.tid === tid)?.name ?? '其他'
export const followerCount = (mid: number) => getDB().relations.filter((r) => r.fid === mid).length + (mid * 9871) % 50000
export const followingCount = (mid: number) => getDB().relations.filter((r) => r.mid === mid).length

export function owner(mid: number) {
  const u = userById(mid)
  return { mid, name: u?.uname ?? '已注销用户', face: u?.face ?? '' }
}

export function levelInfo(u: User) {
  return { current_level: u.level, current_min: 0, current_exp: u.exp, next_exp: u.level >= 6 ? '--' : (u.level + 1) * 2000 }
}

export function memberJSON(mid: number) {
  const u = userById(mid)
  return { mid: String(mid), uname: u?.uname ?? '已注销用户', avatar: u?.face ?? '', sex: u?.sex ?? '保密', sign: u?.sign ?? '', level_info: u ? levelInfo(u) : { current_level: 0 }, vip: { vipStatus: u?.vip ?? 0, vipType: u?.vip ? 2 : 0 } }
}

const totalDuration = (a: Archive) => a.pages.reduce((s, p) => s + p.duration, 0)

/** `/x/web-interface/view` archive object. */
export function arcView(a: Archive, extra: Record<string, unknown> = {}) {
  const db = getDB()
  const season = db.collections.find((c) => c.kind === 'season' && c.aids.includes(a.aid))
  return {
    aid: a.aid, bvid: a.bvid, videos: a.pages.length, tid: a.tid, tname: regionName(a.tid), copyright: a.copyright, pic: a.pic, title: a.title,
    pubdate: a.pubdate, ctime: a.ctime, desc: a.desc, state: a.state, duration: totalDuration(a), owner: owner(a.mid),
    stat: { aid: a.aid, ...a.stat, his_rank: 0, now_rank: 0, evaluation: '', vt: 0 }, dynamic: '', cid: a.pages[0]?.cid ?? 0,
    dimension: { width: 1280, height: 720, rotate: 0 }, is_upower_exclusive: false, tag: a.tag,
    pages: a.pages.map((p, i) => ({ cid: p.cid, page: i + 1, from: 'vupload', part: p.part, duration: p.duration, dimension: { width: 1280, height: 720, rotate: 0 } })),
    ugc_season: season ? ugcSeason(season) : undefined,
    sub_tid: a.sub_tid ?? 0, sub_tname: a.sub_tid ? regionName(a.sub_tid) : '',
    ...extra,
  }
}

export function ugcSeason(c: Collection) {
  const arcs = c.aids.map(archiveById).filter((a): a is Archive => !!a && a.state === 0)
  return {
    id: c.id, title: c.title, cover: c.cover, mid: c.mid, intro: c.intro, ep_count: arcs.length,
    sections: [{ id: c.id * 10, title: '正片', season_id: c.id, episodes: arcs.map((a) => ({ id: a.aid, aid: a.aid, cid: a.pages[0].cid, bvid: a.bvid, title: a.title, arc: { aid: a.aid, pic: a.pic, title: a.title, duration: totalDuration(a), ctime: a.ctime, pubdate: a.pubdate, stat: { view: a.stat.view, danmaku: a.stat.danmaku }, author: owner(a.mid) } })) }],
  }
}

/** Space archive list row (`arc/search` vlist, `series/archives`). */
export function spaceArc(a: Archive) {
  return {
    aid: a.aid, bvid: a.bvid, title: a.title, pic: a.pic, description: a.desc, play: a.stat.view, video_review: a.stat.danmaku, comment: a.stat.reply,
    length: formatDuration(totalDuration(a)), duration: totalDuration(a), created: a.pubdate, pubdate: a.pubdate, mid: a.mid, author: owner(a.mid).name, typeid: a.tid,
    stat: { view: a.stat.view, danmaku: a.stat.danmaku }, cid: a.pages[0]?.cid,
  }
}

/** App feed card (`/x/v2/feed/index`). */
export function feedCard(a: Archive) {
  return {
    card_type: 'small_cover_v2', card_goto: 'av', goto: 'av', param: String(a.aid), cover: a.pic, title: a.title, uri: `/video/${a.bvid}`,
    cover_left_text_2: compactCount(a.stat.view), cover_left_text_3: compactCount(a.stat.danmaku), cover_right_text: formatDuration(totalDuration(a)),
    args: { up_id: a.mid, up_name: owner(a.mid).name, rid: a.tid, rname: regionName(a.tid), aid: a.aid },
    player_args: { aid: a.aid, cid: a.pages[0]?.cid, type: 'av', duration: totalDuration(a) },
    bvid: a.bvid, pubdate: a.pubdate, owner: owner(a.mid),
    three_point: { dislike_reasons: [{ id: 1, name: '不感兴趣' }, { id: 4, name: `UP主：${owner(a.mid).name}` }, { id: 3, name: `分区：${regionName(a.tid)}` }] },
  }
}

export function compactCount(n: number) {
  return n >= 1e4 ? (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万' : String(n)
}

export function seasonBadge(s: Season) { return ['', '番剧', '电影', '纪录片', '国创', '电视剧', '', '综艺'][s.season_type] ?? '' }
export const indexShow = (s: Season) => { const unit = s.season_type === 7 ? '期' : s.season_type === 5 ? '集' : '话'; return s.season_type === 2 ? '全片' : s.is_finish ? `全${s.episodes.length}${unit}` : `更新至第${s.episodes.length}${unit}` }

export function seasonCard(s: Season, extra: Record<string, unknown> = {}) {
  const last = s.episodes[s.episodes.length - 1]
  return {
    season_id: s.season_id, media_id: s.media_id, season_type: s.season_type, title: s.title, cover: s.cover, ss_horizontal_cover: s.horizontal,
    badge: seasonBadge(s), badge_info: { text: seasonBadge(s) }, index_show: indexShow(s), is_finish: s.is_finish ? 1 : 0, rating: `${s.score}分`, score: String(s.score),
    order: `${compactCount(s.views)}次播放`, stat: { view: s.views, follow: s.follow, danmaku: s.danmakus }, new_ep: { id: last?.ep_id, index_show: indexShow(s), cover: last?.cover },
    first_ep: { ep_id: s.episodes[0]?.ep_id, cover: s.episodes[0]?.cover }, evaluate: s.evaluate, areas: s.areas.join(' '), styles: s.styles.join(' / '),
    link: `/bangumi/play/ss${s.season_id}`, url: `/bangumi/play/ss${s.season_id}`,
    copyright: s.copyright ?? 1, season_status: 1, duration: s.season_type === 2 ? (s.episodes[0]?.duration ?? 0) : 0, year: new Date(s.ctime * 1000).getFullYear(),
    ...extra,
  }
}

export function roomCard(r: LiveRoom) {
  const db = getDB()
  const area = db.liveAreas.find((x) => x.id === r.parent_area_id)
  const child = area?.children.find((c) => c.id === r.area_id)
  const u = owner(r.uid)
  return {
    roomid: r.room_id, room_id: r.room_id, uid: r.uid, title: r.title, uname: u.name, face: u.face, online: r.online, user_cover: r.cover, system_cover: r.cover, cover: r.cover,
    room_cover: r.cover, area_v2_name: child?.name ?? '', area_name: child?.name ?? '', area_v2_parent_name: area?.name ?? '', area_v2_id: r.area_id, area_v2_parent_id: r.parent_area_id,
    live_status: r.live_status, text_small: compactCount(r.online), watched_show: { num: r.online, text_large: `${compactCount(r.online)}人看过`, text_small: compactCount(r.online) },
    live_time: r.live_time,
  }
}

export function replyJSON(r: Reply, me: number | undefined, withChildren = true): Record<string, unknown> {
  const db = getDB()
  const children = withChildren ? db.replies.filter((x) => x.root === r.rpid).sort((a, b) => a.ctime - b.ctime) : []
  const parent = r.parent && r.parent !== r.root ? db.replies.find((x) => x.rpid === r.parent) : undefined
  const prefix = parent ? `回复 @${userById(parent.mid)?.uname ?? '用户'} :` : ''
  return {
    rpid: r.rpid, rpid_str: String(r.rpid), oid: r.oid, type: 1, mid: r.mid, root: r.root, parent: r.parent, count: children.length, rcount: children.length,
    ctime: r.ctime, like: r.likers.length, action: me ? (r.likers.includes(me) ? 1 : r.haters.includes(me) ? 2 : 0) : 0,
    member: memberJSON(r.mid), content: { message: prefix + r.message, members: [], pictures: [] },
    replies: children.slice(0, 3).map((c) => replyJSON(c, me, false)),
    up_action: { like: false, reply: false },
  }
}
