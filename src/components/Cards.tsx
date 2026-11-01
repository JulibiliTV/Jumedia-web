import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { countText, timeText, type VideoItem } from '../api/normalize'
import { Icon } from './Icon'
import { Avatar } from './ui'

export function itemLink(it: VideoItem): string {
  if (it.kind === 'live') return `/live/${it.roomId}`
  if (it.kind === 'bangumi') return it.episodeId ? `/bangumi/play/ep${it.episodeId}` : `/bangumi/play/ss${it.seasonId}`
  return it.bvid ? `/video/${it.bvid}` : `/video/av${it.aid}`
}

function Thumb({ it, children }: { it: VideoItem; children?: ReactNode }) {
  const progress = it.finished ? 100 : it.progress && it.duration ? Math.min(100, (it.progress / it.duration) * 100) : 0
  return (
    <div className="thumb">
      {it.cover && <img src={it.cover} alt="" loading="lazy" />}
      {it.kind === 'live' ? (
        <>
          <span className="live-dot">直播中</span>
          <div className="meta"><span><Icon name="user" size={14} />{it.ownerName}</span><span className="dur"><Icon name="eye" size={14} />{countText(it.view)}</span></div>
        </>
      ) : (
        <div className="meta">
          {it.view && <span><Icon name="play" size={13} />{countText(it.view)}</span>}
          {it.danmaku && <span><Icon name="danmaku" size={14} />{countText(it.danmaku)}</span>}
          {it.durationText && <span className="dur">{it.durationText}</span>}
        </div>
      )}
      {progress > 0 && <div className="progress" style={{ width: `${progress}%` }} />}
      {children}
    </div>
  )
}

export function VideoCard({ it, showDate = true, actions }: { it: VideoItem; showDate?: boolean; actions?: ReactNode }) {
  const link = itemLink(it)
  return (
    <div className="vcard">
      <Link to={link}><Thumb it={it}>{it.badge && <span className="tag badge accent">{it.badge}</span>}</Thumb></Link>
      <Link to={link} className="title clamp-2" title={it.title}>{it.title}</Link>
      <div className="by">
        {it.reason && <span className="reason">{it.reason}</span>}
        {it.kind === 'live' ? (
          <span className="clamp-1">{it.reason ? '' : it.ownerName}</span>
        ) : (
          <>
            {it.avatar ? <Avatar src={it.avatar} size={20} /> : <Icon name="user" size={14} />}
            {it.ownerId ? <Link to={`/space/${it.ownerId}`} className="clamp-1">{it.ownerName}</Link> : <span className="clamp-1">{it.ownerName}</span>}
            {showDate && it.pubdate && <span className="nowrap">· {timeText(it.pubdate)}</span>}
          </>
        )}
      </div>
      {actions && <div className="more">{actions}</div>}
    </div>
  )
}

export function PosterCard({ it, sub }: { it: VideoItem; sub?: string }) {
  return (
    <Link to={itemLink(it)} className="poster">
      <div className="thumb" style={{ aspectRatio: '3/4' }}>
        {it.cover && <img src={it.cover} alt="" loading="lazy" />}
        {it.badge && <span className="tag badge accent">{it.badge}</span>}
        {it.rating && /\d/.test(it.rating) && <span className="score">{it.rating.replace('分', '')}</span>}
      </div>
      <div className="title clamp-1">{it.title}</div>
      <div className="sub clamp-1">{sub ?? it.ownerName}</div>
    </Link>
  )
}

export function RowCard({ it, sub, actions }: { it: VideoItem; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="hrow">
      <Link to={itemLink(it)}><Thumb it={it} /></Link>
      <div className="info">
        <Link to={itemLink(it)} className="title clamp-2">{it.title}</Link>
        <div className="sub">
          {it.ownerName && (it.ownerId ? <Link to={`/space/${it.ownerId}`} className="row" style={{ gap: 6 }}>{it.avatar && <Avatar src={it.avatar} size={18} />}{it.ownerName}</Link> : <span>{it.ownerName}</span>)}
          {sub}
        </div>
      </div>
      {actions && <div className="side-actions">{actions}</div>}
    </div>
  )
}

export function Grid({ items, poster = false, empty }: { items: VideoItem[]; poster?: boolean; empty?: ReactNode }) {
  if (!items.length && empty) return <>{empty}</>
  return <div className={`grid ${poster ? 'posters' : ''}`}>{items.map((it) => (poster ? <PosterCard key={it.id} it={it} /> : <VideoCard key={it.id} it={it} />))}</div>
}

export function UserCard({ u, right }: { u: { mid: number; uname: string; face?: string; sign?: string; extra?: string }; right?: ReactNode }) {
  return (
    <div className="ucard">
      <Link to={`/space/${u.mid}`}><Avatar src={u.face} size={52} /></Link>
      <div className="info">
        <Link to={`/space/${u.mid}`} className="name">{u.uname}</Link>
        <div className="sign clamp-1">{u.sign || '这个人很神秘，什么都没有写'}</div>
        {u.extra && <div className="sign">{u.extra}</div>}
      </div>
      {right}
    </div>
  )
}

/** Raw `seasonCard` JSON (pgc rank / index / feed). Web-only fields: `copyright`, `stat.follow`, `styles`, `duration`, `year`. */
export type Season = {
  season_id: number; season_type?: number; title: string; cover: string; ss_horizontal_cover?: string; badge?: string; copyright?: number; index_show?: string; new_ep?: { index_show?: string; cover?: string }
  score?: string; rating?: string; stat?: { view?: number; follow?: number; danmaku?: number }; styles?: string; areas?: string; duration?: number; year?: number; evaluate?: string; is_finish?: number
}
export const seasonLink = (s: Season) => `/bangumi/play/ss${s.season_id}`
const followWord = (s: Season) => ([1, 4].includes(s.season_type ?? 1) ? '追番' : s.season_type === 2 ? '想看' : '追剧')
/** 独家 first, then the type badge. */
export function seasonBadge(s: Season): { text: string; bg: string } | null {
  if (s.copyright === 3) return { text: '独家', bg: 'var(--accent)' }
  return s.badge ? { text: s.badge, bg: 'var(--brand)' } : null
}
export const movieMeta = (s: Season) => [s.duration ? `${Math.round(s.duration / 60)} 分钟` : '', s.year ? String(s.year) : ''].filter(Boolean).join(' · ')

export function SeasonPoster({ s, sub, rank }: { s: Season; sub?: string; rank?: number }) {
  const badge = seasonBadge(s)
  const score = parseFloat(s.score ?? s.rating ?? '')
  return (
    <Link to={seasonLink(s)} className="sposter">
      <div className="art">
        <img src={s.cover} alt="" loading="lazy" />
        {badge && <span className="badge-r" style={{ background: badge.bg }}>{badge.text}</span>}
        {rank !== undefined && <span className={`rank-badge ${rank <= 3 ? 'top' : ''}`}>{rank}</span>}
        {rank !== undefined
          ? <div className="shade" style={{ flexDirection: 'column', gap: 2, padding: '30px 10px 8px' }}><span className="row" style={{ gap: 4 }}><Icon name="play" size={12} />{countText(s.stat?.view ?? 0)} 播放</span><span>{countText(s.stat?.follow ?? 0)} {followWord(s)} · {s.season_type === 2 ? movieMeta(s) : s.new_ep?.index_show ?? s.index_show}</span></div>
          : <div className="shade">{!!s.stat?.follow && <span>{countText(s.stat.follow)} {followWord(s)}</span>}<span style={{ marginLeft: 'auto' }}>{s.season_type === 2 ? movieMeta(s) : s.new_ep?.index_show ?? s.index_show}</span></div>}
      </div>
      <span className="name"><b>{s.title}</b>{score > 0 && <i>{score.toFixed(1)}</i>}</span>
      <span className="tags">{sub ?? (s.styles || s.areas || '')}</span>
    </Link>
  )
}

export function SeasonWide({ s, sub }: { s: Season; sub?: string }) {
  const badge = seasonBadge(s)
  return (
    <Link to={seasonLink(s)} className="wcard">
      <div className="art">
        <img src={s.ss_horizontal_cover || s.new_ep?.cover || s.cover} alt="" loading="lazy" />
        {badge && <span className="badge-r" style={{ background: badge.bg }}>{badge.text}</span>}
        <div className="shade"><span>{countText(s.stat?.follow ?? s.stat?.view ?? 0)} {s.stat?.follow ? followWord(s) : '播放'}</span><span className="r">{s.season_type === 2 ? movieMeta(s) : s.new_ep?.index_show ?? s.index_show}</span></div>
      </div>
      <span className="name"><b>{s.title}</b>{parseFloat(s.score ?? s.rating ?? '') > 0 && <i>{parseFloat(s.score ?? s.rating ?? '').toFixed(1)}</i>}</span>
      <span className="sub">{sub ?? (s.evaluate || s.styles)}</span>
    </Link>
  )
}

const watchingText = (v?: string) => `${String(v ?? '0').replace(/人看过$/, '')} 人在看`

/** 直播卡片（设计稿）：左上角「直播中」，底部渐变上是分区和在看人数。 */
export function LiveCard({ it }: { it: VideoItem }) {
  return (
    <Link to={itemLink(it)} className="lcard">
      <div className="art">
        {it.cover && <img src={it.cover} alt="" loading="lazy" />}
        <span className="on-air"><i />直播中</span>
        <div className="shade"><span>{it.reason}</span><span style={{ marginLeft: 'auto' }}>{watchingText(it.view)}</span></div>
      </div>
      <b>{it.title}</b>
      <span className="host">{it.avatar && <img src={it.avatar} alt="" />}{it.ownerName}</span>
    </Link>
  )
}

export function LiveFeature({ it }: { it: VideoItem }) {
  return (
    <Link to={itemLink(it)} className="feature">
      {it.cover && <img src={it.cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      <span className="on-air big"><i />直播中 · 本周热门</span>
      <div className="feat-txt">
        <span className="t">{it.title}</span>
        <span className="m"><span className="who">{it.avatar && <img src={it.avatar} alt="" />}{it.ownerName}</span><span>{it.reason}</span><span>{watchingText(it.view)}</span></span>
      </div>
    </Link>
  )
}
