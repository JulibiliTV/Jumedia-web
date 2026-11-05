import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'
import { countText } from '../api/normalize'
import { CHANNELS } from '../lib/categories'
import { useAsync, useDebounced } from '../lib/hooks'
import { useSession } from '../lib/session'
import { Icon } from './Icon'
import { LogoWordmark } from './Logo'
import { RouteContent } from './RouteContent'
import { Avatar, Level } from './ui'

export function Wordmark({ suffix }: { suffix?: string }) {
  return (
    <Link to="/" className="wordmark" aria-label="Jumedia 首页">
      <LogoWordmark size={30} />{suffix && <small>{suffix}</small>}
    </Link>
  )
}

/** Short-lived shared results for data every page's chrome shows (hot words, followed UPs). */
const memo = new Map<string, { at: number; p: Promise<unknown> }>()
export function shared<T>(key: string, load: () => Promise<T>, ttl = 60_000): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>
  const p = load().catch((e) => { memo.delete(key); throw e })
  memo.set(key, { at: Date.now(), p })
  return p
}
export const forgetShared = (key: string) => memo.delete(key)

// ---------- 主题 ----------
type Theme = '' | 'light' | 'dark'
function readTheme(): Theme { try { return (localStorage.getItem('jumedia.theme') as Theme) ?? '' } catch { return '' } }
function applyTheme(theme: Theme) {
  if (theme) document.documentElement.dataset.theme = theme
  else delete document.documentElement.dataset.theme
  try { localStorage.setItem('jumedia.theme', theme) } catch { /* storage unavailable */ }
}

// ---------- 搜索（历史记录只保存在本机浏览器） ----------
const HISTORY_KEY = 'jumedia.searchHistory'
function readHistory(): string[] { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[] } catch { return [] } }
function writeHistory(list: string[]) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 10))) } catch { /* storage unavailable */ } }
export function rememberSearch(keyword: string) { const k = keyword.trim(); if (k) writeHistory([k, ...readHistory().filter((x) => x !== k)]) }

export const hotwords = () => shared('hotwords', jm.hotwords, 300_000)

function SearchBox() {
  const nav = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('keyword') ?? '')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<{ term: string; name: string }[]>([])
  const [history, setHistory] = useState<string[]>(readHistory)
  const [active, setActive] = useState(-1)
  const term = useDebounced(q.trim(), 160)
  const fallback = useAsync(async () => (await jm.searchDefault()) as { show_name: string; name: string }, [])
  const hot = useAsync(hotwords, [])
  useEffect(() => { if (location.pathname === '/search') setQ(new URLSearchParams(location.search).get('keyword') ?? '') }, [location])
  useEffect(() => {
    if (!term) { setItems([]); return }
    let live = true
    juli.suggest(term).then((tags) => live && setItems(tags)).catch(() => live && setItems([]))
    return () => { live = false }
  }, [term])
  const go = (keyword: string) => {
    const k = keyword.trim()
    if (!k) return
    rememberSearch(k); setHistory(readHistory()); setOpen(false); setQ(k)
    nav(`/search?keyword=${encodeURIComponent(k)}`)
  }
  const submit = (e: FormEvent) => { e.preventDefault(); go(active >= 0 ? items[active].term : q || fallback.data?.name || '') }
  const typing = q.trim().length > 0
  return (
    <div className="bsearch" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTimeout(() => setOpen(false), 120) }}>
      <form onSubmit={submit} role="search">
        <input value={q} placeholder={fallback.data?.show_name || '搜索视频、番剧、直播间或用户'} aria-label="搜索"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1) }} onFocus={() => { setHistory(readHistory()); setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)) }
            if (e.key === 'Escape') setOpen(false)
          }} />
        <button type="submit" aria-label="搜索"><Icon name="search" size={18} /></button>
      </form>
      {open && typing && items.length > 0 && (
        <div className="bsearch-pop">
          {items.map((it, i) => <button type="button" key={it.term} className={`row-btn ${i === active ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); go(it.term) }}><Icon name="search" size={14} /><span dangerouslySetInnerHTML={{ __html: it.name }} /></button>)}
        </div>
      )}
      {open && !typing && (history.length > 0 || (hot.data?.length ?? 0) > 0) && (
        <div className="bsearch-pop">
          {history.length > 0 && <>
            <h4>搜索历史<button type="button" onMouseDown={(e) => { e.preventDefault(); writeHistory([]); setHistory([]) }}>清空</button></h4>
            <div className="history">{history.map((h) => <button type="button" key={h} onMouseDown={(e) => { e.preventDefault(); go(h) }}>{h}</button>)}</div>
          </>}
          {!!hot.data?.length && <>
            <h4>热搜</h4>
            <div className="hot">
              {hot.data.map((h, i) => <button type="button" key={h.keyword} className="row-btn" onMouseDown={(e) => { e.preventDefault(); go(h.keyword) }}><span className={`rank-n ${i < 3 ? 'top' : ''}`}>{i + 1}</span><span>{h.show_name}</span>{h.word_type === 4 && <span className="hot-tag">热</span>}</button>)}
            </div>
          </>}
        </div>
      )}
    </div>
  )
}

// ---------- 用户菜单 ----------
function UserMenu({ onClose }: { onClose: () => void }) {
  const { me, logout } = useSession()
  const nav = useNavigate()
  const [theme, setTheme] = useState<Theme>(readTheme)
  const stat = useAsync(async () => (me ? juli.relationStat(me.mid) : null) as Promise<{ following: number; follower: number } | null>, [me?.mid])
  if (!me) return null
  const pick = (t: Theme) => { setTheme(t); applyTheme(t) }
  const item = (to: string, icon: string, label: string, note?: string) => <Link className="it" to={to} onClick={onClose}><Icon name={icon} size={18} />{label}{note && <span className="note">{note}</span>}</Link>
  return (
    <div className="umenu" role="menu" aria-label="用户菜单">
      <Link className="me" to={`/space/${me.mid}`} onClick={onClose}>
        <Avatar src={me.face} size={48} />
        <span className="t">
          <b>{me.uname}<Level n={me.level_info?.current_level} /></b>
          <span className="roles"><span className="role creator">创作者</span>{me.role === 'admin' && <span className="role admin">管理员</span>}</span>
        </span>
        <Icon name="chevron-right" size={16} />
      </Link>
      <div className="stats">
        <Link to="/account/following" onClick={onClose}><b>{countText(stat.data?.following ?? 0)}</b><span>关注</span></Link>
        <Link to={`/space/${me.mid}`} onClick={onClose}><b>{countText(stat.data?.follower ?? 0)}</b><span>粉丝</span></Link>
        <Link to={`/space/${me.mid}`} onClick={onClose}><b>{Math.floor(me.money)}</b><span>硬币</span></Link>
      </div>
      {item(`/space/${me.mid}`, 'user', '个人空间')}
      {item('/account/favorites', 'star', '我的收藏')}
      {item('/account/history', 'history', '历史记录')}
      {item('/account/watchlater', 'clock', '稍后再看')}
      {item('/account/medals', 'award', '粉丝勋章')}
      <div className="sep" />
      {item('/creator', 'chart', '创作中心')}
      {me.role === 'admin' && item('/admin', 'shield', '管理后台')}
      <div className="sep" />
      {item('/tv-login', 'tv', '电视扫码登录', 'JulibiliTV')}
      {item('/account/settings', 'settings', '账号设置')}
      <div className="theme">
        <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={18} />外观
        <span className="seg">{([['light', '浅色'], ['dark', '深色'], ['', '跟随系统']] as [Theme, string][]).map(([t, label]) => <button type="button" key={t || 'auto'} className={theme === t ? 'on' : ''} onClick={() => pick(t)}>{label}</button>)}</span>
      </div>
      <div className="sep" />
      <button type="button" className="it muted" onClick={async () => { onClose(); await logout(); nav('/') }}><Icon name="logout" size={18} />退出登录</button>
    </div>
  )
}

function AvatarMenu() {
  const { me } = useSession()
  const [open, setOpen] = useState(false)
  const timer = useRef(0)
  if (!me) return <Link to="/login" className="btn primary" style={{ borderRadius: 20 }}>登录</Link>
  const show = () => { clearTimeout(timer.current); setOpen(true) }
  const hide = () => { timer.current = window.setTimeout(() => setOpen(false), 180) }
  return (
    <div className={`bh-avatar ${open ? 'open' : ''}`} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      <Link to={`/space/${me.mid}`} aria-label="个人空间，悬停打开用户菜单" aria-haspopup="menu"><Avatar src={me.face} size={38} /></Link>
      {open && <div className="bh-pop"><UserMenu onClose={() => setOpen(false)} /></div>}
    </div>
  )
}

type Portal = { up_list?: { items: { mid: number; uname: string; face: string; has_update: boolean }[] }; live_users?: { items: { mid: number; room_id: number }[] } }
export const portal = (mid: number) => shared(`portal:${mid}`, () => jm.dynamicPortal() as Promise<Portal>)

/** `wide` matches `.frame.wide` (play pages), so the header lines up with the content on large screens. */
export function Header({ wide = false }: { wide?: boolean }) {
  const { me } = useSession()
  const updates = useAsync(async () => (me ? (await portal(me.mid)).up_list?.items.filter((u) => u.has_update).length ?? 0 : 0), [me?.mid])
  return (
    <header className="bh">
      <div className={`bh-inner ${wide ? 'wide' : ''}`}>
        <Wordmark />
        <SearchBox />
        <div className="bh-actions">
          {me && <Link to="/dynamic" className="bh-icon" aria-label={updates.data ? `动态，${updates.data} 条新内容` : '动态'}><Icon name="bell" size={20} />{!!updates.data && <span className="dot">{updates.data}</span>}</Link>}
          <Link to="/creator/upload" className="bh-upload" aria-label="投稿"><Icon name="upload" size={16} /><span>投稿</span></Link>
          <AvatarMenu />
        </div>
      </div>
    </header>
  )
}

// ---------- 侧栏 ----------
const NAV = [
  { to: '/', label: '首页', icon: 'home', end: true },
  { to: '/popular', label: '热门', icon: 'fire', end: false },
  { to: '/anime', label: '番剧', icon: 'tv' },
  { to: '/live', label: '直播', icon: 'live', end: true },
  { to: '/ranking', label: '排行榜', icon: 'trophy' },
]
const MINE = [
  { to: '/account/history', label: '历史记录', icon: 'history' },
  { to: '/account/watchlater', label: '稍后再看', icon: 'clock' },
  { to: '/account/favorites', label: '我的收藏', icon: 'star' },
  { to: '/account/bangumi', label: '我的追番', icon: 'heart' },
  { to: '/account/following', label: '关注', icon: 'users' },
]
const navClass = ({ isActive }: { isActive: boolean }) => `item ${isActive ? 'on' : ''}`

function FollowedUps() {
  const { me } = useSession()
  const ups = useAsync(async () => {
    if (!me) return []
    const p = await portal(me.mid)
    const live = new Map((p.live_users?.items ?? []).map((l) => [l.mid, l.room_id]))
    return (p.up_list?.items ?? []).map((u) => ({ ...u, room: live.get(u.mid) })).sort((a, b) => Number(!!b.room) - Number(!!a.room) || Number(b.has_update) - Number(a.has_update)).slice(0, 8)
  }, [me?.mid])
  if (!ups.data?.length) return null
  return <>
    <div className="sep" />
    <span className="label">关注的 UP 主</span>
    {ups.data.map((u) => (
      <Link key={u.mid} className="up" to={u.room ? `/live/${u.room}` : `/space/${u.mid}`}>
        <Avatar src={u.face} size={24} /><span>{u.uname}</span>
        {u.room ? <span className="live-badge">直播中</span> : u.has_update && <i className="fresh" aria-label="有更新" />}
      </Link>
    ))}
  </>
}

const SIDE_CHANNELS = ['番剧', '国创', '电影', '电视剧', '纪录片', '影视', '游戏', '音乐', '知识', '科技数码', '生活', '美食']

/** 首页侧栏额外显示：我的追番、热搜、频道。 */
function HomeExtras() {
  const { me } = useSession()
  const shows = useAsync(async () => (me ? ((await juli.bangumiFollowList(me.mid, 1)).list ?? []).slice(0, 4) : []) as Promise<{ season_id: number; title: string; cover: string; progress?: string; new_ep?: { index_show?: string } }[]>, [me?.mid])
  const hot = useAsync(hotwords, [])
  const nav = useNavigate()
  return <>
    {!!shows.data?.length && <>
      <div className="sep" />
      <span className="label">我的追番</span>
      {shows.data.map((s) => <Link key={s.season_id} className="show" to={`/bangumi/play/ss${s.season_id}`}><img src={s.cover} alt="" /><span className="t"><b>{s.title}</b><span>{s.progress || s.new_ep?.index_show}</span></span></Link>)}
    </>}
    <FollowedUps />
    {!!hot.data?.length && <>
      <div className="sep" />
      <span className="label">热搜</span>
      {hot.data.slice(0, 8).map((h, i) => <a key={h.keyword} className="hot" href={`/search?keyword=${encodeURIComponent(h.keyword)}`} onClick={(e) => { e.preventDefault(); rememberSearch(h.keyword); nav(`/search?keyword=${encodeURIComponent(h.keyword)}`) }}><span className={`rank-n ${i < 3 ? 'top' : ''}`}>{i + 1}</span><span>{h.show_name}</span>{h.word_type === 4 && <span className="hot-tag">热</span>}</a>)}
    </>}
    <div className="sep" />
    <span className="label">频道</span>
    <div className="chips">{SIDE_CHANNELS.map((t) => { const c = CHANNELS.find((x) => x.title === t); return c && <Link key={c.kind} to={c.kind === 'anime' ? '/anime' : `/c/${c.kind}`}>{c.title}</Link> })}</div>
  </>
}

export function Sidebar({ home = false }: { home?: boolean }) {
  const { me } = useSession()
  return (
    <aside className="sidebar" aria-label="侧栏">
      {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={navClass}><Icon name={n.icon} size={18} />{n.label}</NavLink>)}
      {me && <>
        <div className="sep" />
        <span className="label">我的</span>
        {(home ? MINE.slice(0, 3) : MINE).map((n) => <NavLink key={n.to} to={n.to} className={navClass}><Icon name={n.icon} size={18} />{n.label}</NavLink>)}
      </>}
      {home ? <HomeExtras /> : <FollowedUps />}
      <div className="tv">
        <b><Icon name="tv" size={16} />在电视上看</b>
        <p>用 JulibiliTV 扫码登录，历史记录和追番会自动同步。</p>
        <Link to="/tv-login">电视扫码登录</Link>
      </div>
      <div className="foot">
        <Link to="/creator">创作中心</Link><Link to="/creator/live">开播</Link><Link to="/account/settings">账号设置</Link>{!me && <Link to="/register">注册账号</Link>}
        <span>© Jumedia</span>
      </div>
    </aside>
  )
}

/** 播放页 / 直播间的窄侧栏。 */
export function Rail() {
  return (
    <nav className="side-rail" aria-label="主导航">
      {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}><Icon name={n.icon} size={20} />{n.label}</NavLink>)}
      <div className="sep" />
      <NavLink to="/account/history"><Icon name="history" size={20} />历史</NavLink>
      <NavLink to="/account/watchlater"><Icon name="clock" size={20} />稍后再看</NavLink>
      <NavLink to="/account/favorites"><Icon name="star" size={20} />收藏</NavLink>
    </nav>
  )
}

// ---------- 创作中心 / 管理后台导航 ----------
export type ConsoleItem = { to: string; label: string; icon: string; end?: boolean; badge?: number }
export function ConsoleNav({ area, groups }: { area: 'creator' | 'admin'; groups: { group: string; items: ConsoleItem[] }[] }) {
  const { me, site } = useSession()
  const creator = area === 'creator'
  return (
    <nav className="console-nav" aria-label={creator ? '创作中心' : '管理后台'}>
      <div className="who">
        <span className={`ic ${area}`}><Icon name={creator ? 'sparkle' : 'shield'} size={18} /></span>
        <span><b>{creator ? '创作中心' : '管理后台'}</b><span>{creator ? me?.uname : `${site?.siteName ?? 'Jumedia'} 站点管理`}</span></span>
      </div>
      {creator && <Link to="/creator/upload" className="cta"><Icon name="upload" size={16} />投稿</Link>}
      {groups.map((g) => (
        <div key={g.group} style={{ display: 'contents' }}>
          <span className="group">{g.group}</span>
          {g.items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `item ${isActive ? 'active' : ''}`}><Icon name={i.icon} size={18} />{i.label}{!!i.badge && <span className="count">{i.badge}</span>}</NavLink>)}
        </div>
      ))}
      <div className="sep" />
      <Link to="/" className="item"><Icon name="home" size={18} />返回 Jumedia</Link>
    </nav>
  )
}

/** Header + console navigation + page (creator center and admin). */
export function ConsoleFrame({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return <div className="frame"><div className="side">{nav}</div><div className="content">{children}</div></div>
}

// ---------- 页面外框 ----------
const RAIL = /^\/(video\/|bangumi\/play\/|live\/\d)/
const BARE = /^\/(login|register|tv-login|creator)(\/|$)/

export function SiteLayout() {
  const { site } = useSession()
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  const announcement = site?.announcement && pathname === '/' ? <div className="announcement">{site.announcement}</div> : null
  return (
    <>
      <Header wide={RAIL.test(pathname)} />
      {BARE.test(pathname) ? <RouteContent><Outlet /></RouteContent>
        : RAIL.test(pathname) ? <div className="frame wide"><div className="rail-col"><Rail /></div><div className="content"><RouteContent><Outlet /></RouteContent></div></div>
        : <>
          <nav className="mnav" aria-label="主导航">{NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>)}</nav>
          <div className="frame"><div className="side"><Sidebar home={pathname === '/'} /></div><main className="content">{announcement}<RouteContent><Outlet /></RouteContent></main></div>
        </>}
    </>
  )
}

export function RequireLogin({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { me, ready } = useSession()
  const location = useLocation()
  const nav = useNavigate()
  useEffect(() => {
    if (ready && !me) nav(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
  }, [ready, me, nav, location])
  if (!ready || !me) return null
  if (admin && me.role !== 'admin') return <div className="state" style={{ minHeight: '60vh' }}><Icon name="shield" size={48} /><div className="title">需要管理员权限</div><Link to="/" className="btn">返回首页</Link></div>
  return <>{children}</>
}
