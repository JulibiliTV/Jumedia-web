import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as juli from '../api/juli'
import { compact, countText, formatDuration, seasonItem } from '../api/normalize'
import { PosterCard, type Season, seasonLink, SeasonPoster, SeasonWide } from '../components/Cards'
import { Comments } from '../components/Comments'
import { Icon } from '../components/Icon'
import { type Chapter, Player } from '../components/Player'
import { Empty, ErrorState, Loading, LoadMore, SkeletonGrid, toast, toastError } from '../components/ui'
import { SEASON_TYPES, WATCH_STATUS } from '../lib/categories'
import { useAsync, useInfinite, useSentinel, useTitle } from '../lib/hooks'
import { useSession } from '../lib/session'
import { HeroCarousel } from './Home'

/** 番剧首页 — `/pgc/page/web/v3`, `/pgc/web/timeline`, `/pgc/season/rank/*`, `/pgc/page/web/v3/feed`. */
export function Anime() {
  useTitle('番剧')
  const { me } = useSession()
  const [kind, setKind] = useState<'anime' | 'guochuang'>('anime')
  const types = kind === 'anime' ? 1 : 4
  const page = useAsync(() => juli.pgcPage(kind), [kind])
  const timeline = useAsync(() => juli.pgcTimeline(types), [types])
  const tabs = useAsync(async () => (await juli.pgcRankIndex()).index as { tab_id: number; title: string; url: string }[], [])
  const [tab, setTab] = useState(1)
  const rank = useAsync(async () => {
    const t = tabs.data?.find((x) => x.tab_id === tab)
    const style = t ? Number(new URL(t.url, location.origin).searchParams.get('style_id') ?? 0) : 0
    return (((kind === 'anime' ? await juli.pgcRankList(style) : await juli.pgcRank(4)).list ?? []) as Season[]).slice(0, 6)
  }, [tab, tabs.data, kind])
  const mine = useAsync(async () => (me ? (await juli.bangumiFollowList(me.mid, 1)) as { total: number; list: (Season & { progress?: string })[] } : null), [me?.mid])
  const [day, setDay] = useState<number>()
  useEffect(() => { const t = timeline.data?.find((d: any) => d.is_today); setDay(t?.date_ts) }, [timeline.data])
  const feed = useInfinite(async (cursor: number) => {
    const d = await juli.pgcFeed(kind, cursor)
    const rows = (d.items ?? []).filter((x: any) => x.card_style !== 'rank').flatMap((x: any) => x.sub_items ?? []) as (Season & { sub_title?: string })[]
    return { items: rows, next: d.has_next ? d.coursor : null }
  }, 0, [kind])
  const modules: any[] = page.data?.modules ?? []
  const banners = (modules.find((m) => m.style === 'web_banner_v3')?.items ?? []).map((b: any) => ({ id: b.season_id, title: b.title, img: b.big_cover || b.cover, url: `/bangumi/play/ss${b.season_id}`, sub: b.evaluate, tag: b.play_title }))
  const today = timeline.data?.find((d: any) => d.date_ts === day)
  const todayCount = timeline.data?.find((d: any) => d.is_today)?.episodes?.length ?? 0
  const follows = (mine.data?.list ?? []).filter((s) => [1, 4].includes(s.season_type ?? 1)).slice(0, 4)
  const word = kind === 'anime' ? '番剧' : '国创'

  const pct = (sx: Season & { progress?: string }) => {
    const seen = Number(/(\d+)/.exec(sx.progress ?? '')?.[1] ?? 0)
    const total = Number(/(\d+)/.exec(sx.new_ep?.index_show ?? sx.index_show ?? '')?.[1] ?? 0)
    return total ? Math.min(100, (seen / total) * 100) : 0
  }
  const toggleFollow = async (sid: string | number) => {
    if (!me) return toast('登录后才能追番', 'error')
    try { await juli.pgcFollow(Number(sid), true); toast('追番成功', 'success'); mine.reload() } catch (e) { toastError(e) }
  }
  const week = (timeline.data ?? []).filter((_: any, i: number, all: any[]) => Math.abs(i - all.findIndex((x: any) => x.is_today)) <= 3)
  return (
    <div className="page" style={{ gap: 28 }}>
      <div className="chead">
        <h1>{word}</h1>
        <span className="seg-blue"><button type="button" className={kind === 'anime' ? 'on' : ''} onClick={() => setKind('anime')}>番剧</button><button type="button" className={kind === 'guochuang' ? 'on' : ''} onClick={() => setKind('guochuang')}>国创</button></span>
        <span className="grow" />
        <Link to={`/anime/index?type=${types}`} className="pill" style={{ height: 34, borderRadius: 17 }}><Icon name="list" size={15} />{word}索引</Link>
      </div>

      <div className="g4" style={{ gap: 16 }}>
        <div style={{ gridColumn: 'span 3', minHeight: 380 }}><HeroCarousel slides={banners} follow={{ label: '追番', on: toggleFollow }} /></div>
        <div className="box-b" style={{ minWidth: 0, gap: 12, padding: 16 }}>
          <h3>{me ? '我的追番' : '热门推荐'}{me && !!mine.data?.total && <Link to="/account/bangumi">全部 {mine.data.total}</Link>}</h3>
          {(me ? follows : (rank.data ?? []).slice(0, 4)).map((x) => (
            <Link key={x.season_id} to={seasonLink(x)} className="minep">
              <img src={x.cover} alt="" />
              <span className="t"><b>{x.title}</b><span>{(x as { progress?: string }).progress || x.new_ep?.index_show || x.index_show}</span>{me && <span className="bar"><i style={{ width: `${pct(x)}%` }} /></span>}</span>
            </Link>
          ))}
          {me && !follows.length && <span className="faint" style={{ fontSize: 13 }}>还没有追番，去下面看看吧</span>}
        </div>
      </div>

      <section>
        <div className="row wrap" style={{ gap: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>新番时间表</h2>
          <span className="muted" style={{ fontSize: 13 }}>北京时间 · 今天更新 {todayCount} 部</span>
          <span className="grow" />
          <span className="day-pills">{week.map((d: any) => <button type="button" key={d.date_ts} className={d.date_ts === day ? 'on' : ''} onClick={() => setDay(d.date_ts)}>{d.is_today ? '今天' : `周${'一二三四五六日'[d.day_of_week - 1]}`}<small>{d.date}</small></button>)}</span>
        </div>
        {timeline.loading && !timeline.data ? <Loading /> : timeline.error ? <ErrorState error={timeline.error} /> : today?.episodes?.length ? (
          <div className="g5">
            {today.episodes.map((e: any) => (
              <Link key={e.season_id} to={`/bangumi/play/ss${e.season_id}`} className="tl3">
                <div className="art">
                  <img src={e.cover} alt="" loading="lazy" />
                  <span className={`time ${e.published ? 'done' : ''}`}><Icon name="clock" size={13} />{e.pub_time}</span>
                  {!!e.follow && <span className="fo">已追番</span>}
                  <div className="ep">{e.pub_index}</div>
                </div>
                <b>{e.title}</b>
                <span>{e.published ? '已更新' : `${e.pub_time} 更新`}</span>
              </Link>
            ))}
          </div>
        ) : <Empty title="当天没有更新" icon="calendar" />}
      </section>

      <section>
        <div className="row wrap" style={{ gap: 12, marginBottom: 14 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>热播榜</h2>
          {kind === 'anime' && <span className="tab-pills">{tabs.data?.map((t) => <button type="button" key={t.tab_id} className={t.tab_id === tab ? 'on' : ''} onClick={() => setTab(t.tab_id)}>{t.title}</button>)}</span>}
        </div>
        {rank.loading && !rank.data ? <SkeletonGrid poster count={6} /> : <div className="g6">{rank.data?.map((x, i) => <SeasonPoster key={x.season_id} s={x} rank={i + 1} />)}</div>}
      </section>

      <section>
        <div className="row between" style={{ marginBottom: 14 }}><h2 style={{ fontSize: 20, fontWeight: 800 }}>猜你喜欢</h2><button type="button" className="soft-btn" onClick={feed.reload}><Icon name="refresh" size={14} />换一换</button></div>
        {feed.items.length ? <div className="g4">{feed.items.map((x) => <SeasonWide key={x.season_id} s={x} sub={x.styles || x.sub_title} />)}</div> : <SkeletonGrid count={8} />}
      </section>
      {!feed.done && <div className="more-btn"><button type="button" disabled={feed.loading} onClick={feed.more}>{feed.loading ? '加载中…' : '加载更多'}</button></div>}
    </div>
  )
}

/** 番剧索引 — `/pgc/season/index/result` with Juli's order/sort values. */
export function AnimeIndex() {
  const [params, setParams] = useSearchParams()
  const type = Number(params.get('type') ?? 1)
  const order = Number(params.get('order') ?? 2)
  const sort = Number(params.get('sort') ?? 0)
  useTitle('番剧索引')
  const feed = useInfinite(async (page: number) => {
    const d = await juli.seasonIndex({ season_type: type, order, sort, page })
    return { items: compact((d.list ?? []).map((v: any) => { const it = seasonItem(v); if (it) it.ownerName = `${v.index_show} · ${v.order}` ; return it })), next: d.has_next ? page + 1 : null }
  }, 1, [type, order, sort])
  const sentinel = useSentinel(feed.more, !feed.loading && !feed.done)
  const set = (k: string, v: number) => { const p = new URLSearchParams(params); p.set(k, String(v)); setParams(p) }
  return (
    <div className="page">
      <div className="page-head"><div><h1>索引</h1><p>按类型与热度浏览全部正版内容</p></div></div>
      <div className="panel stack" style={{ marginBottom: 20 }}>
        <div className="row wrap"><span className="faint" style={{ width: 48 }}>类型</span>{SEASON_TYPES.map((t) => <button key={t.value} className={`chip ${t.value === type ? 'on' : ''}`} onClick={() => set('type', t.value)}>{t.label}</button>)}</div>
        <div className="row wrap"><span className="faint" style={{ width: 48 }}>排序</span>{[{ v: 2, l: '播放数量' }, { v: 3, l: '追番人数' }, { v: 4, l: '最高评分' }, { v: 0, l: '更新时间' }].map((o) => <button key={o.v} className={`chip ${o.v === order ? 'on' : ''}`} onClick={() => set('order', o.v)}>{o.l}</button>)}<button className="btn ghost sm" onClick={() => set('sort', sort ? 0 : 1)}><Icon name={sort ? 'arrow-up' : 'arrow-down'} size={14} />{sort ? '升序' : '降序'}</button></div>
      </div>
      {feed.error ? <ErrorState error={feed.error} retry={feed.reload} /> : feed.items.length ? <div className="grid posters">{feed.items.map((it) => <PosterCard key={it.id} it={it} />)}</div> : feed.loading ? <SkeletonGrid poster /> : <Empty />}
      <div ref={sentinel} />
      <LoadMore loading={feed.loading && feed.items.length > 0} done={feed.done} onMore={feed.more} empty={!feed.items.length} />
    </div>
  )
}

/** 番剧播放 — `/pgc/view/web/season`, `/pgc/player/web/playurl`, follow/status endpoints. */
export function BangumiPlay() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { me } = useSession()
  const epParam = id.startsWith('ep') ? Number(id.slice(2)) : undefined
  const ssParam = id.startsWith('ss') ? Number(id.slice(2)) : undefined
  const season = useAsync(() => juli.pgcSeason(epParam ? { ep_id: epParam } : { season_id: ssParam }), [id])
  const s = season.data
  useTitle(s?.title)
  const eps: any[] = s?.episodes ?? []
  const progress = s?.user_status?.progress
  const current = eps.find((e) => e.ep_id === (epParam ?? progress?.last_ep_id)) ?? eps[0]
  const [follow, setFollow] = useState<{ follow: boolean; status: number }>({ follow: false, status: 0 })
  // 本话看点: the episode's highlights (view_points), loaded by the player.
  const [points, setPoints] = useState<Chapter[]>([])
  const [seekTo, setSeekTo] = useState<{ at: number; n: number }>()
  useEffect(() => {
    if (!s || !me) return
    juli.seasonUserStatus(s.season_id).then((r) => setFollow({ follow: !!r.follow, status: r.follow_status })).catch(() => {})
  }, [s?.season_id, me?.mid]) // eslint-disable-line react-hooks/exhaustive-deps
  if (season.loading && !s) return <Loading />
  if (season.error) return <ErrorState error={season.error} retry={season.reload} />
  if (!s || !current) return <Empty title="暂无剧集" />

  const toggle = async () => {
    if (!me) return nav('/login')
    try { await juli.pgcFollow(s.season_id, !follow.follow); setFollow({ follow: !follow.follow, status: follow.follow ? 0 : 1 }); toast(follow.follow ? `已取消${word}` : `${word}成功`, 'success') } catch (e) { toastError(e) }
  }
  const setStatus = async (status: number) => {
    try { await juli.pgcFollowStatus(s.season_id, status); setFollow({ ...follow, status }); toast('已标记为' + WATCH_STATUS.find((w) => w.value === status)?.label, 'success') } catch (e) { toastError(e) }
  }
  const idx = eps.indexOf(current)
  const word = [1, 4].includes(s.type) ? '追番' : s.type === 2 ? '想看' : '追剧'
  const startAt = progress?.last_ep_id === current.ep_id ? progress.last_time : undefined
  return (
    <div className="watch">
      <div style={{ minWidth: 0 }}>
        <Player key={current.cid} source={{ kind: 'bangumi', aid: current.aid, cid: current.cid, epid: current.ep_id, sid: s.season_id, startAt }} chaptersOut={setPoints} seekTo={seekTo} onEnded={() => eps[idx + 1] && nav(`/bangumi/play/ep${eps[idx + 1].ep_id}`)} />
        <h1>{s.title}<span className="faint" style={{ fontSize: 16, fontWeight: 500 }}> · {current.show_title}</span></h1>
        <div className="stats"><span><Icon name="play" size={14} />{countText(s.stat?.views)}</span><span><Icon name="danmaku" size={15} />{countText(s.stat?.danmakus)}</span><span><Icon name="heart" size={14} />{countText(s.stat?.follow)} {word}</span>{s.new_ep?.desc && <span>{s.new_ep.desc}</span>}</div>
        <div className="bangumi-hero" style={{ marginTop: 20 }}>
          <div className="bg" style={{ backgroundImage: `url("${s.cover}")` }} />
          <img className="cover" src={s.cover} alt="" />
          <div className="grow stack" style={{ gap: 6 }}>
            <h1>{s.title}</h1>
            <div className="meta"><span>{s.areas?.map((a: any) => a.name).join(' ')}</span><span>·</span><span>{s.styles?.join(' / ')}</span><span>·</span><span>{s.new_ep?.desc}</span></div>
            {s.rating?.score > 0 && <div className="row"><span className="score">{s.rating.score}</span><span style={{ opacity: 0.7, fontSize: 13 }}>{countText(s.rating.count)} 人评</span></div>}
            <p className="evaluate clamp-3">{s.evaluate}</p>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="bh-fo" onClick={toggle}><Icon name={follow.follow ? 'check' : 'plus'} size={16} />{follow.follow ? `已${word}` : word}</button>
              {follow.follow && WATCH_STATUS.map((w) => <button type="button" key={w.value} className={`bh-st ${follow.status === w.value ? 'on' : ''}`} onClick={() => setStatus(w.value)}>{w.label}</button>)}
            </div>
          </div>
        </div>
        <Comments oid={current.aid} />
      </div>
      <aside>
        <div className="side-box">
          <div className="head"><span>选集</span><span className="faint" style={{ fontWeight: 400, fontSize: 13 }}>{idx + 1}/{eps.length}{!s.publish?.is_finish && s.new_ep?.desc ? ` · ${s.new_ep.desc}` : ''}</span></div>
          {s.type === 2 ? <div className="body"><div className="ep-item on">正片<span className="dur">{formatDuration(current.duration / 1000)}</span></div></div> : (
            <div className="ep-grid">{eps.map((e) => <Link key={e.ep_id} to={`/bangumi/play/ep${e.ep_id}`} className={e.ep_id === current.ep_id ? 'on' : ''} title={e.show_title}>{e.title}{e.badge && <span className="new">{e.badge}</span>}</Link>)}</div>
          )}
        </div>
        {points.length > 0 && (
          <div className="side-box">
            <div className="head"><span>本话看点</span></div>
            <div className="marks">{points.map((p) => <button type="button" key={p.from} onClick={() => setSeekTo({ at: p.from, n: Date.now() })}><b>{formatDuration(p.from)}</b><span>{p.content}</span></button>)}</div>
          </div>
        )}
        {s.seasons?.length > 0 && <>
          <div className="section-head"><h2 style={{ fontSize: 16 }}>相关推荐</h2></div>
          <div className="grid posters" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>{compact(s.seasons.map(seasonItem)).map((it) => <PosterCard key={it.id} it={it} />)}</div>
        </>}
      </aside>
    </div>
  )
}
