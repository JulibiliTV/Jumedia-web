import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'
import { compact, countText, dynamicItem, seasonItem, type VideoItem, videoItem } from '../api/normalize'
import { Grid, itemLink } from '../components/Cards'
import { Icon } from '../components/Icon'
import { Empty, ErrorState, Loading, LoadMore, SkeletonGrid } from '../components/ui'
import { RANKINGS } from '../lib/categories'
import { useAsync, useInfinite, useSentinel, useTitle } from '../lib/hooks'
import { useSession } from '../lib/session'

/** 热门 — `/x/web-interface/popular`. */
export function Popular() {
  useTitle('热门')
  const feed = useInfinite(async (pn: number) => {
    const d = await juli.popular(pn)
    return { items: compact<VideoItem>((d.list ?? []).map(videoItem)), next: d.no_more ? null : pn + 1 }
  }, 1, [])
  const sentinel = useSentinel(feed.more, !feed.loading && !feed.done)
  return (
    <div className="page">
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}><div className="stack" style={{ gap: 4 }}><h1 style={{ fontSize: 26, fontWeight: 800 }}>热门</h1><span className="muted" style={{ fontSize: 14 }}>各个分区正在流行的视频</span></div><span className="grow" /><PopularTabs on="popular" /></div>
      {feed.error ? <ErrorState error={feed.error} retry={feed.reload} /> : feed.items.length ? <Grid items={feed.items} /> : <SkeletonGrid />}
      <div ref={sentinel} />
      <LoadMore loading={feed.loading && feed.items.length > 0} done={feed.done} onMore={feed.more} />
    </div>
  )
}

/** 排行榜 — `/x/web-interface/ranking/v2` and `/pgc/web/rank/list`, same partitions as Juli. 不显示名次变化。 */
export function Ranking() {
  const [params, setParams] = useSearchParams()
  const id = params.get('c') ?? 'all'
  const cat = RANKINGS.find((r) => r.id === id) ?? RANKINGS[0]
  useTitle(`${cat.title}排行榜`)
  const { data, error, loading, reload } = useAsync(async () => {
    if (cat.seasonType) return ((await juli.pgcRank(cat.seasonType)).list ?? []).map((v: any) => ({ it: seasonItem(v), score: v.stat?.view as number, unit: '播放' }))
    return ((await juli.ranking(cat.rid ?? 0)).list ?? []).map((v: any) => ({ it: videoItem(v), score: v.score as number, unit: '综合得分' }))
  }, [cat.id])
  const rows = (data ?? []).filter((x: { it: VideoItem | null }) => x.it) as { it: VideoItem; score: number; unit: string }[]
  const poster = !!cat.seasonType
  const [all, setAll] = useState(false)
  const rest = rows.slice(3, all ? rows.length : 12)
  return (
    <div className="page">
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 4 }}><h1 style={{ fontSize: 26, fontWeight: 800 }}>排行榜</h1><span className="muted" style={{ fontSize: 14 }}>根据稿件内容质量、近期数据综合展示，动态更新</span></div>
        <span className="grow" />
        <PopularTabs on="ranking" />
      </div>
      <nav className="chips-b">{RANKINGS.map((r) => <button type="button" key={r.id} className={r.id === cat.id ? 'on' : ''} onClick={() => { setParams({ c: r.id }); setAll(false) }}>{r.title}</button>)}</nav>
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : !rows.length ? <Empty /> : <>
        <div className="g3">
          {rows.slice(0, 3).map(({ it, score }, i) => (
            <Link key={it.id} to={itemLink(it)} className="podium2">
              <img src={it.cover} alt="" loading="lazy" />
              <span className="n">{i + 1}</span>
              <div className="txt">
                <span className="t">{it.title}</span>
                <span className="m">{it.avatar && <img src={it.avatar} alt="" />}{it.kind === 'video' ? it.ownerName : it.ownerName}<span style={{ marginLeft: 'auto' }}>{poster ? `${countText(score)} 播放` : `${countText(it.view)} 播放 · 综合 ${countText(score)}`}</span></span>
              </div>
            </Link>
          ))}
        </div>
        {rest.length > 0 && (
          <section className="list-card">
            {rest.map(({ it, score, unit }, i) => (
              <Link key={it.id} to={itemLink(it)} className="rank-row">
                <span className="no">{i + 4}</span>
                <div className="art" style={poster ? { width: 96, aspectRatio: '3/4' } : undefined}>{it.cover && <img src={it.cover} alt="" loading="lazy" />}{it.durationText && <span>{it.durationText}</span>}</div>
                <div className="info">
                  <b>{it.title}</b>
                  <span className="m">{it.kind === 'video' ? <><span className="row" style={{ gap: 6 }}>{it.avatar && <img src={it.avatar} alt="" />}{it.ownerName}</span><span>{countText(it.view)} 播放</span><span>{countText(it.danmaku)} 弹幕</span></> : <><span>{it.ownerName}</span>{it.rating && <span style={{ color: '#e8a400', fontWeight: 700 }}>{it.rating}</span>}</>}</span>
                </div>
                <div className="sc"><b>{countText(score)}</b><span>{unit}</span></div>
              </Link>
            ))}
            {rows.length > 12 && <button type="button" className="list-more" onClick={() => setAll(!all)}>{all ? '收起' : `查看第 13 – ${rows.length} 名`}</button>}
          </section>
        )}
      </>}
    </div>
  )
}

export function PopularTabs({ on }: { on: 'popular' | 'ranking' | 'weekly' }) {
  return <span className="seg-blue">{([['popular', '热门', '/popular'], ['ranking', '排行榜', '/ranking'], ['weekly', '每周必看', '/popular/weekly']] as const).map(([k, l, to]) => <Link key={k} to={to}><button type="button" className={on === k ? 'on' : ''}>{l}</button></Link>)}</span>
}

/** 每周必看 — `/x/web-interface/popular/series/list` and `/x/web-interface/popular/series/one`. */
export function Weekly() {
  useTitle('每周必看')
  const [params, setParams] = useSearchParams()
  const series = useAsync(async () => ((await jm.weeklyList()).list ?? []) as { number: number; subject: string; name: string }[], [])
  const number = Number(params.get('n') ?? 0) || series.data?.[0]?.number || 0
  const one = useAsync(async () => (number ? jm.weeklyOne(number) : null), [number])
  const cfg = one.data?.config
  const items = compact<VideoItem>((one.data?.list ?? []).map(videoItem))
  const reasons: string[] = (one.data?.list ?? []).map((v: any) => v.rcmd_reason ?? '')
  const total = (one.data?.list ?? []).reduce((n: number, v: any) => n + (v.stat?.view ?? 0), 0)
  const day = (t: number) => { const d = new Date(t * 1000); return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}` }
  const all = series.data ?? []
  const idx = all.findIndex((x) => x.number === number)
  const shown = all.slice(Math.max(0, idx - 3), Math.max(0, idx - 3) + 7)
  return (
    <div className="page">
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 4 }}><h1 style={{ fontSize: 26, fontWeight: 800 }}>每周必看</h1><span className="muted" style={{ fontSize: 14 }}>{one.data?.reminder ?? '每周五 18:00 更新'}，编辑从本周的投稿里挑出最值得看的视频</span></div>
        <span className="grow" />
        <PopularTabs on="weekly" />
      </div>
      <div className="row" style={{ gap: 8, overflow: 'hidden' }}>
        <button type="button" className="wk-nav" disabled={idx >= all.length - 1} onClick={() => setParams({ n: String(all[idx + 1].number) })} aria-label="更早一期"><Icon name="chevron-left" size={14} /></button>
        {shown.map((x) => <button type="button" key={x.number} className={`wk-pill ${x.number === number ? 'on' : ''}`} onClick={() => setParams({ n: String(x.number) })}>第 {x.number} 期<small>{all[0]?.number === x.number ? '本周' : ''}</small></button>)}
        <button type="button" className="wk-nav" disabled={idx <= 0} onClick={() => setParams({ n: String(all[idx - 1].number) })} aria-label="更新一期"><Icon name="chevron-right" size={14} /></button>
      </div>
      {cfg && (
        <section className="wk-hero">
          <div className="stack" style={{ flex: '1 1 360px', minWidth: 0, gap: 6 }}>
            <span style={{ fontSize: 13, opacity: 0.85 }}>第 {cfg.number} 期 · {day(cfg.stime)} – {day(cfg.etime)}</span>
            <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.3 }}>{cfg.subject}</span>
            <span style={{ fontSize: 14, opacity: 0.86 }}>本期共 {items.length} 个视频入选</span>
          </div>
          <div className="row" style={{ gap: 24 }}>
            <span className="stack" style={{ alignItems: 'center', gap: 0 }}><b style={{ fontSize: 24 }}>{items.length}</b><span style={{ fontSize: 12, opacity: 0.8 }}>入选视频</span></span>
            <span className="stack" style={{ alignItems: 'center', gap: 0 }}><b style={{ fontSize: 24 }}>{countText(total)}</b><span style={{ fontSize: 12, opacity: 0.8 }}>本期播放</span></span>
          </div>
        </section>
      )}
      {one.loading && !one.data ? <Loading /> : one.error ? <ErrorState error={one.error} retry={one.reload} /> : !items.length ? <Empty /> : (
        <section className="list-card">
          {items.map((it, i) => (
            <Link key={it.id} to={itemLink(it)} className="rank-row">
              <span className="no" style={{ color: i < 3 ? 'var(--brand)' : undefined }}>{i + 1}</span>
              <div className="art">{it.cover && <img src={it.cover} alt="" loading="lazy" />}{it.durationText && <span>{it.durationText}</span>}</div>
              <div className="info">
                <b>{it.title}</b>
                {reasons[i] && <span className="wk-reason">{reasons[i]}</span>}
                <span className="m"><span className="row" style={{ gap: 6 }}>{it.avatar && <img src={it.avatar} alt="" />}{it.ownerName}</span><span>{countText(it.view)} 播放</span><span>{countText(it.danmaku)} 弹幕</span></span>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  )
}

/** 动态 — `/x/polymer/web-dynamic/v1/feed/all`. */
export function Dynamic() {
  useTitle('动态')
  const { me } = useSession()
  const following = useAsync(async () => (me ? (await juli.followings(me.mid, 1)).list : []), [me?.mid])
  const list = useInfinite(async (offset: string) => {
    const d = await juli.dynamicFeed(offset)
    return { items: compact<VideoItem>((d.items ?? []).map(dynamicItem)), next: d.has_more ? d.offset : null }
  }, '', [me?.mid])
  const sentinel = useSentinel(list.more, !list.loading && !list.done)
  return (
    <div className="page">
      <div className="page-head"><div><h1>动态</h1><p>关注的 UP 主最新投稿</p></div></div>
      {following.data && following.data.length > 0 && (
        <div className="channels" style={{ marginBottom: 24, gap: 18 }}>
          {following.data.map((u: any) => (
            <Link key={u.mid} to={`/space/${u.mid}`} className="stack" style={{ alignItems: 'center', gap: 6, width: 64, flex: 'none' }}>
              <img className="avatar" src={u.face} width={48} height={48} alt="" />
              <span className="clamp-1" style={{ fontSize: 12, color: 'var(--text-2)', maxWidth: 64 }}>{u.uname}</span>
            </Link>
          ))}
        </div>
      )}
      {list.error ? <ErrorState error={list.error} retry={list.reload} /> : list.items.length ? <Grid items={list.items} /> : list.loading ? <SkeletonGrid count={6} /> : <Empty title="还没有动态" hint="关注感兴趣的 UP 主，他们的新投稿会出现在这里" icon="bell" />}
      <div ref={sentinel} />
      <LoadMore loading={list.loading && list.items.length > 0} done={list.done} onMore={list.more} empty={!list.items.length} />
    </div>
  )
}
