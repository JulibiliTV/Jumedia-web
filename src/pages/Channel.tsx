import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'
import { compact, countText, type VideoItem, videoItem } from '../api/normalize'
import { movieMeta, type Season, SeasonPoster, seasonLink, VideoCard } from '../components/Cards'
import { Icon } from '../components/Icon'
import { Avatar, Empty, ErrorState, LoadMore, SkeletonGrid, toast, toastError } from '../components/ui'
import { type Channel, CHANNELS, RANKINGS } from '../lib/categories'
import { useAsync, useInfinite, useSentinel, useTitle } from '../lib/hooks'
import { useSession } from '../lib/session'
import { Carousel, HeroCarousel } from './Home'

function ChannelChips({ current }: { current: string }) {
  return (
    <nav className="chips-b" aria-label="频道">
      {CHANNELS.map((c, i) => (
        <span key={c.kind} style={{ display: 'contents' }}>
          {i > 0 && !!c.regionIDs && !CHANNELS[i - 1].regionIDs && <span className="gap" />}
          <Link to={c.kind === 'anime' ? '/anime' : `/c/${c.kind}`} className={c.kind === current ? 'on' : ''}>{c.title}</Link>
        </span>
      ))}
    </nav>
  )
}

const rankingOf = (ch: Channel) => RANKINGS.find((r) => (ch.seasonType ? r.seasonType === ch.seasonType : r.rid === ch.regionIDs?.[0]))?.id ?? 'all'
type Slide = { id: number; title: string; img: string; url: string; sub?: string; tag?: string; sid?: number }
const slidesFromLocs = (rows: any[] | undefined): Slide[] => (rows ?? []).map((b) => ({ id: b.id, title: b.name, img: b.pic, url: b.url, sid: b.season_id }))

/** 频道 — 片库频道（带 `pgc`）用通用 PGC 频道版式，分区频道（带 `regionIDs`）用 UGC 分区版式。 */
export function ChannelPage() {
  const { kind = '' } = useParams()
  const ch = CHANNELS.find((c) => c.kind === kind)
  useTitle(ch?.title)
  if (!ch) return <div className="page"><Empty title="频道不存在" /></div>
  if (ch.pgc === 'anime') return <Navigate to="/anime" replace />
  return ch.seasonType ? <PgcChannel key={ch.kind} ch={ch} /> : <UgcChannel key={ch.kind} ch={ch} />
}

// ---------------- 片库频道 ----------------

type Condition = { filter: { field: string; name: string; values: { keyword: string; name: string }[] }[]; order: { field: string; name: string }[] }

function PgcChannel({ ch }: { ch: Channel }) {
  const type = ch.seasonType!
  const movie = type === 2
  const word = movie ? '想看' : '追剧'
  const { me } = useSession()
  const loc = 10 + type
  const banners = useAsync(async () => slidesFromLocs((await jm.resLocs([loc]))[loc]), [loc])
  const hot = useAsync(async () => ((await juli.pgcRank(type)).list ?? []) as Season[], [type])
  const cond = useAsync(async () => (await jm.seasonIndexCondition(type)) as Condition, [type])
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [order, setOrder] = useState(2)
  const lib = useInfinite(async (page: number) => {
    const d = await juli.seasonIndex({ season_type: type, order, sort: 0, page, pagesize: 18, filters })
    return { items: (d.list ?? []) as Season[], next: d.has_next ? page + 1 : null }
  }, 1, [type, order, JSON.stringify(filters)])
  const total = useAsync(async () => (await juli.seasonIndex({ season_type: type, order: 2, sort: 0, page: 1, pagesize: 1 })).total as number, [type]).data
  const sentinel = useSentinel(lib.more, !lib.loading && !lib.done && lib.items.length > 0)
  const fromHot = (sid: number) => (hot.data ?? []).find((x) => x.season_id === sid)
  const slides: Slide[] = banners.data?.length ? banners.data.map((b) => { const h = fromHot(b.sid ?? 0); return { ...b, id: b.sid || b.id, sub: h?.evaluate, tag: h ? (h.copyright === 3 ? '独家' : h.season_type === 2 ? movieMeta(h) : h.new_ep?.index_show ?? h.index_show) : undefined } }) : (hot.data ?? []).slice(0, 4).map((s) => ({ id: s.season_id, title: s.title, img: s.ss_horizontal_cover || s.cover, url: seasonLink(s), sub: s.evaluate, tag: s.copyright === 3 ? '独家' : s.badge }))
  const chosen = (cond.data?.filter ?? []).flatMap((f) => { const v = filters[f.field]; const o = v && v !== '-1' ? f.values.find((x) => x.keyword === v) : undefined; return o ? [{ field: f.field, label: o.name }] : [] })

  return (
    <div className="page">
      <div className="chead">
        <span className="ic"><Icon name={movie ? 'film' : 'tv'} size={24} /></span>
        <div><h1>{ch.title}</h1><p>精选正版内容{total !== undefined && ` · 片库共 ${total} 部`}</p></div>
        <span className="grow" />
        {me && <Link to={`/account/bangumi?type=2`} className="pill"><Icon name="heart" size={15} />我的{word}</Link>}
        <Link to={`/ranking?c=${rankingOf(ch)}`} className="pill"><Icon name="trophy" size={15} />{ch.title}排行</Link>
      </div>
      <ChannelChips current={ch.kind} />

      <div className="g4" style={{ gap: 16 }}>
        <div style={{ gridColumn: 'span 3', minHeight: 400 }}><HeroCarousel slides={slides} minHeight={400} follow={me ? { label: word, on: async (id) => { try { await juli.pgcFollow(Number(id), true); toast(`${word}成功`, 'success') } catch (e) { toastError(e) } } } : undefined} /></div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row between"><b style={{ fontSize: 16, lineHeight: '20px' }}>热播榜</b><Link to={`/ranking?c=${rankingOf(ch)}`} className="faint" style={{ fontSize: 12 }}>更多</Link></div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8 }}>
            {(hot.data ?? []).slice(0, 5).map((s, i) => (
              <Link key={s.season_id} to={seasonLink(s)} className="mini" style={{ gap: 12 }}>
                <span className="art" style={{ width: 108, height: 68, aspectRatio: 'auto', borderRadius: 8 }}><img src={s.ss_horizontal_cover || s.cover} alt="" /><span className={`rank-corner ${i < 3 ? 'top' : ''}`}>{i + 1}</span></span>
                <span className="t"><b style={{ fontSize: 14, WebkitLineClamp: 1 }}>{s.title}</b><span style={{ color: 'var(--text-2)' }}>{s.styles || s.areas}</span><span>{movie ? [s.year, `${countText(s.stat?.view ?? 0)} 播放`].filter(Boolean).join(' · ') : `${s.index_show ?? ''} · ${countText(s.stat?.view ?? 0)} 播放`}</span></span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="head-b" style={{ marginBottom: 0 }}><h2>片库<small>{lib.items.length ? `按条件筛选` : ''}</small></h2></div>
        {cond.data && (
          <div className="filters">
            {cond.data.filter.map((f) => (
              <div key={f.field} className="line">
                <span>{f.name}</span>
                <div className="opts">{f.values.map((v) => <button type="button" key={v.keyword} className={(filters[f.field] ?? '-1') === v.keyword ? 'on' : ''} onClick={() => setFilters((x) => ({ ...x, [f.field]: v.keyword }))}>{v.name}</button>)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="sort-b">
          {(cond.data?.order ?? []).map((o) => <button type="button" key={o.field} className={order === Number(o.field) ? 'on' : ''} onClick={() => setOrder(Number(o.field))}>{o.name}</button>)}
          <span className="spacer" />
          {chosen.length > 0 && <span className="muted" style={{ fontSize: 13 }}>已选：</span>}
          {chosen.map((c) => <button type="button" key={c.field} className="chip on" style={{ height: 26 }} onClick={() => setFilters((x) => ({ ...x, [c.field]: '-1' }))}>{c.label}<Icon name="x" size={12} /></button>)}
          {chosen.length > 0 && <button type="button" onClick={() => setFilters({})}>清空</button>}
        </div>
        {lib.error && !lib.items.length ? <ErrorState error={lib.error} retry={lib.reload} />
          : lib.items.length ? <div className="g6">{lib.items.map((s) => <SeasonPoster key={s.season_id} s={s} sub={movie ? [s.styles, s.areas].filter(Boolean).join(' · ') : undefined} />)}</div>
          : lib.loading ? <SkeletonGrid poster count={12} /> : <Empty title="没有符合条件的内容" hint="换几个筛选条件试试" />}
        <div ref={sentinel} />
        <LoadMore loading={lib.loading && lib.items.length > 0} done={lib.done} onMore={lib.more} empty={!lib.items.length} />
      </section>
    </div>
  )
}

// ---------------- 分区频道 ----------------

const SORTS = [{ v: 'pubdate', label: '最新发布' }, { v: 'click', label: '最多播放' }, { v: 'dm', label: '最多弹幕' }, { v: 'stow', label: '最多收藏' }]
const DURATIONS = ['全部时长', '10 分钟以下', '10–30 分钟', '30–60 分钟', '60 分钟以上']
type Region = { tid: number; name: string; children?: { tid: number; name: string }[] }
type RankRow = { aid: number; bvid: string; title: string; pic: string; play: number; mid: number; author: string; video_review: number; duration: string }

function UgcChannel({ ch }: { ch: Channel }) {
  const rid = ch.regionIDs![0]
  const regions = useAsync(async () => (await juli.regionList()) as Region[], [])
  const online = useAsync(async () => ((await jm.regionOnline()) as { region_count: Record<string, number> }).region_count, [])
  const banners = useAsync(async () => slidesFromLocs((await jm.resLocs([rid]))[rid]), [rid])
  const week = useAsync(async () => (await juli.rankingRegion(rid, 7)) as RankRow[], [rid])
  const tags = useAsync(async () => ((await jm.tagHots(rid)) as { tags: { tag_id: number; tag_name: string }[] }[])[0]?.tags ?? [], [rid])
  // 多个顶级分区组成的频道（如「生活」）把这些分区当作子分区；否则用该分区的子分区。
  const subs = useMemo(() => {
    const all = regions.data ?? []
    if ((ch.regionIDs?.length ?? 0) > 1) return all.filter((r) => ch.regionIDs!.includes(r.tid)).map((r) => ({ tid: r.tid, name: r.name }))
    return all.find((r) => r.tid === rid)?.children ?? []
  }, [regions.data, ch, rid])
  const [sub, setSub] = useState(0)
  const [order, setOrder] = useState('pubdate')
  const [duration, setDuration] = useState(0)
  const list = useInfinite(async (pn: number) => {
    const target = sub || rid
    const d = await jm.regionDynamic({ rid: target, pn, ps: 18, order, duration })
    return { items: compact<VideoItem>((d.archives ?? []).map(videoItem)), next: pn * 18 < (d.page?.count ?? 0) ? pn + 1 : null }
  }, 1, [rid, sub, order, duration])
  const sentinel = useSentinel(list.more, !list.loading && !list.done && list.items.length > 0)
  const today = (ch.regionIDs ?? []).reduce((n, t) => n + (online.data?.[t] ?? 0), 0)
  const top = compact<VideoItem>((week.data ?? []).slice(0, 5).map(videoItem))
  const featured = top.slice(0, 4)
  const slides: Slide[] = banners.data?.length ? banners.data : top.slice(0, 3).map((v, i) => ({ id: i, title: v.title, img: v.cover ?? '', url: `/video/${v.bvid}` }))
  // 活跃 UP 主：本周排行里出现次数最多的作者。
  const ups = useMemo(() => {
    const n = new Map<number, { mid: number; name: string; count: number; play: number }>()
    for (const r of week.data ?? []) { const x = n.get(r.mid) ?? { mid: r.mid, name: r.author, count: 0, play: 0 }; x.count++; x.play += r.play; n.set(r.mid, x) }
    return [...n.values()].sort((a, b) => b.count - a.count || b.play - a.play).slice(0, 15)
  }, [week.data])
  // 换一批 pages through the 15 most active uploaders five at a time.
  const [upPage, setUpPage] = useState(0)
  const shownUps = ups.slice(upPage * 5, upPage * 5 + 5)
  const faces = useAsync(async () => Object.fromEntries(await Promise.all(shownUps.map(async (u) => [u.mid, ((await juli.card(u.mid)) as { card?: { face?: string } }).card?.face ?? ''] as const))), [shownUps.map((u) => u.mid).join()])

  return (
    <div className="page">
      <div className="chead">
        <span className="ic"><Icon name="grid" size={24} /></span>
        <div><h1>{ch.title}</h1><p>今日新增 {today} 个视频{subs.length > 0 && ` · ${subs.length} 个子分区`}</p></div>
        <span className="grow" />
        <Link to={`/ranking?c=${rankingOf(ch)}`} className="pill"><Icon name="trophy" size={15} />分区排行榜</Link>
        <Link to={`/creator/upload?tid=${rid}`} className="pill"><Icon name="upload" size={15} />投稿到{ch.title}区</Link>
      </div>
      <ChannelChips current={ch.kind} />

      <div className="g4">
        <div className="feature">{slides.length > 0 && <span className="pick">分区精选</span>}<Carousel slides={slides} /></div>
        {featured.length ? featured.map((it) => <VideoCard key={it.id} it={it} />) : Array.from({ length: 4 }, (_, k) => <div key={k} className="skeleton" style={{ aspectRatio: '16/13', borderRadius: 10 }} />)}
      </div>

      <div className="split">
        <div className="main">
          {subs.length > 0 && (
            <div className="subtabs">
              <button type="button" className={sub === 0 ? 'on' : ''} onClick={() => setSub(0)}>全部</button>
              {subs.map((s) => <button type="button" key={s.tid} className={sub === s.tid ? 'on' : ''} onClick={() => setSub(s.tid)}>{s.name}{!!online.data?.[s.tid] && <small>+{online.data[s.tid]}</small>}</button>)}
            </div>
          )}
          <div className="sort-b">
            {SORTS.map((s) => <button type="button" key={s.v} className={order === s.v ? 'on' : ''} onClick={() => setOrder(s.v)}>{s.label}</button>)}
            <span className="spacer" />
            <span className="seg-b">{DURATIONS.map((d, i) => <button type="button" key={d} className={duration === i ? 'on' : ''} onClick={() => setDuration(i)}>{d}</button>)}</span>
          </div>
          {list.error && !list.items.length ? <ErrorState error={list.error} retry={list.reload} />
            : list.items.length ? <div className="g3">{list.items.map((it) => <VideoCard key={it.id} it={it} />)}</div>
            : list.loading ? <SkeletonGrid count={9} /> : <Empty title="这里还没有投稿" />}
          <div ref={sentinel} />
          <LoadMore loading={list.loading && list.items.length > 0} done={list.done} onMore={list.more} empty={!list.items.length} />
        </div>
        <aside className="aside">
          <div className="box-b">
            <h3>本周热门<Link to={`/ranking?c=${rankingOf(ch)}`}>完整榜单</Link></h3>
            {top.map((v, i) => <Link key={v.id} to={`/video/${v.bvid}`} className="mini"><span className="art"><img src={v.cover} alt="" /><span className={`rank-corner ${i < 3 ? 'top' : ''}`}>{i + 1}</span></span><span className="t"><b>{v.title}</b><span>{countText(v.view)} 播放</span></span></Link>)}
            {!top.length && <span className="faint" style={{ fontSize: 13 }}>本周还没有热门视频</span>}
          </div>
          {ups.length > 0 && (
            <div className="box-b">
              <h3>活跃 UP 主{ups.length > 5 && <button type="button" onClick={() => setUpPage((n) => (n + 1) % Math.ceil(ups.length / 5))}>换一批</button>}</h3>
              {shownUps.map((u) => <Link key={u.mid} to={`/space/${u.mid}`} className="mini"><Avatar src={faces.data?.[u.mid]} size={36} /><span className="t"><b style={{ WebkitLineClamp: 1 }}>{u.name}</b><span>本周 {u.count} 个热门 · {countText(u.play)} 播放</span></span></Link>)}
            </div>
          )}
          {!!tags.data?.length && (
            <div className="box-b">
              <h3>热门标签</h3>
              <div className="tagcloud">{tags.data.slice(0, 14).map((t) => <Link key={t.tag_id} to={`/search?keyword=${encodeURIComponent(t.tag_name)}`}>#{t.tag_name}</Link>)}</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
