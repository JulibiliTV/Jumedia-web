import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'
import { compact, liveItem, type VideoItem, videoItem } from '../api/normalize'
import { type Season, SeasonPoster, VideoCard } from '../components/Cards'
import { Icon } from '../components/Icon'
import { ErrorState, LoadMore, SkeletonGrid, toast } from '../components/ui'
import { useAsync, useInfinite, useSentinel, useTitle } from '../lib/hooks'
import { useSession } from '../lib/session'

/** `below` 把标题放到图片下方（首页大图），图片底部与右侧卡片的封面底部对齐。 */
export function Carousel({ slides, wide = false, cta, below = false }: { slides: { id: string | number; title: string; img: string; url: string; sub?: string; tag?: string }[]; wide?: boolean; cta?: string; below?: boolean }) {
  const [i, setI] = useState(0)
  const nav = useNavigate()
  useEffect(() => {
    if (slides.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), 5000)
    return () => clearInterval(t)
  }, [slides.length])
  if (!slides.length) return <div className={`carousel skeleton ${wide ? 'wide' : ''}`} />
  const dots = <div className="dots">{slides.map((s, k) => <button key={s.id} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={`第 ${k + 1} 张`} />)}</div>
  const box = (
    <div className={`carousel ${wide ? 'wide' : ''}`}>
      {slides.map((s, k) => (
        <div key={s.id} className={`slide ${k === i ? 'on' : ''}`} onClick={() => nav(s.url)} style={{ cursor: 'pointer' }}>
          <img src={s.img} alt="" />
          {!below && <div className={`caption ${cta ? 'hero' : ''}`}>{s.tag && <span className="badge accent" style={{ marginBottom: 10 }}>{s.tag}</span>}<h3 className="clamp-1">{s.title}</h3>{s.sub && <p className={cta ? 'clamp-2' : 'clamp-1'}>{s.sub}</p>}{cta && <span className="btn accent" style={{ marginTop: 16, borderRadius: 20 }}><Icon name="play" size={14} fill />{cta}</span>}</div>}
        </div>
      ))}
      <button className="arrow prev" onClick={() => setI((i - 1 + slides.length) % slides.length)} aria-label="上一张"><Icon name="chevron-left" /></button>
      <button className="arrow next" onClick={() => setI((i + 1) % slides.length)} aria-label="下一张"><Icon name="chevron-right" /></button>
      {!below && dots}
    </div>
  )
  if (!below) return box
  const cur = slides[Math.min(i, slides.length - 1)]
  return (
    <>
      {box}
      <Link to={cur.url} className="title clamp-2" title={cur.title}>{cur.title}</Link>
      <div className="by">{dots}<span className="nowrap">{i + 1} / {slides.length}</span></div>
    </>
  )
}

/** 番剧页 / 频道页的大图轮播（设计稿 hero）：左侧渐变上的角标、大标题、简介和两个按钮，右下角是指示条。 */
export function HeroCarousel({ slides, minHeight = 380, follow }: { slides: { id: string | number; title: string; img: string; url: string; sub?: string; tag?: string }[]; minHeight?: number; follow?: { label: string; on: (id: string | number) => void } }) {
  const [i, setI] = useState(0)
  const nav = useNavigate()
  useEffect(() => {
    if (slides.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), 6000)
    return () => clearInterval(t)
  }, [slides.length])
  const s = slides[i % Math.max(1, slides.length)]
  if (!s) return <div className="hero-b skeleton" style={{ minHeight }} />
  return (
    <div className="hero-b" style={{ minHeight }} onClick={() => nav(s.url)}>
      <img src={s.img} alt="" />
      <div className="fade" />
      <div className="txt">
        {s.tag && <span className="tag">{s.tag}</span>}
        <span className="t">{s.title}</span>
        {s.sub && <span className="d">{s.sub}</span>}
        <span className="row" style={{ gap: 10, marginTop: 4 }}>
          <span className="go"><Icon name="play" size={14} fill />立即观看</span>
          {follow && <button type="button" className="fo" onClick={(e) => { e.stopPropagation(); follow.on(s.id) }}><Icon name="plus" size={16} />{follow.label}</button>}
        </span>
      </div>
      {slides.length > 1 && <div className="dots-b">{slides.map((x, k) => <button type="button" key={x.id} className={k === i ? 'on' : ''} aria-label={`第 ${k + 1} 张`} onClick={(e) => { e.stopPropagation(); setI(k) }} />)}</div>}
    </div>
  )
}

function DislikeButton({ it, onDone }: { it: VideoItem; onDone: () => void }) {
  const { me } = useSession()
  if (!me) return null
  return (
    <button className="btn ghost sm icon" title="不感兴趣" onClick={async () => {
      try { await juli.feedDislike({ goto: 'av', id: it.aid!, reason_id: 1 }); toast('将减少此类推荐', 'success'); onDone() } catch (e) { toast(String((e as Error).message), 'error') }
    }}><Icon name="x" size={14} /></button>
  )
}

const HOME_CHIPS = [['推荐', '/'], ['关注', '/dynamic'], ['番剧', '/anime'], ['电视剧', '/c/tv'], ['电影', '/c/film'], ['综艺', '/c/variety'], ['游戏', '/c/gaming'], ['知识', '/c/knowledge'], ['音乐', '/c/music'], ['生活', '/c/life']]

export default function Home() {
  useTitle()
  const { site } = useSession()
  const feed = useInfinite(async (page: number) => {
    // The web home uses the web feed; `/x/v2/feed/index` is the TV (JulibiliTV) feed.
    const d = await jm.homeRcmd(page)
    return { items: compact<VideoItem>((d.item ?? []).map(videoItem)), next: page < 8 ? page + 1 : null }
  }, 1, [])
  const sentinel = useSentinel(feed.more, !feed.loading && !feed.done && feed.items.length > 16)
  const live = useAsync(async () => compact((await juli.liveRecommend(1)).list.map(liveItem)).slice(0, 4), [])
  const anime = useAsync(async () => {
    const [jp, cn] = await Promise.all([juli.pgcRank(1), juli.pgcRank(4)])
    return [...new Map(([...(jp.list ?? []), ...(cn.list ?? [])] as Season[]).map((x) => [x.season_id, x])).values()].sort((a, b) => (b.stat?.view ?? 0) - (a.stat?.view ?? 0)).slice(0, 6)
  }, [])

  const slides = (site?.banners ?? []).map((b) => ({ id: b.id, title: b.title, img: b.img, url: b.url }))
  // Recommendation pages can repeat a video that an earlier page already showed.
  const unique = [...new Map(feed.items.map((it) => [it.id, it])).values()]
  const [top, rest] = [unique.slice(0, 4), unique.slice(4)]
  const dislike = (it: VideoItem) => <DislikeButton it={it} onDone={() => feed.setItems((l) => l.filter((x) => x.id !== it.id))} />

  return (
    <div className="page">
      <nav className="chips-b" aria-label="频道">
        {HOME_CHIPS.map(([label, to], i) => <Link key={label} to={to} className={i === 0 ? 'on' : ''}>{label}</Link>)}
      </nav>

      <div className="g4">
        <div className="feature">{slides.length > 0 && <span className="pick">编辑推荐</span>}<Carousel slides={slides} below /></div>
        {top.length ? top.map((it) => <VideoCard key={it.id} it={it} actions={dislike(it)} />)
          : Array.from({ length: 4 }, (_, k) => <div key={k} className="vcard"><div className="skeleton" style={{ aspectRatio: '16/10' }} /><div className="skeleton" style={{ height: 14 }} /><div className="skeleton" style={{ height: 12, width: '50%' }} /></div>)}
      </div>

      {!!anime.data?.length && (
        <section className="panel-b">
          <div className="head-b"><h2>番剧热播</h2><Link to="/anime" className="pill-link">番剧首页</Link></div>
          <div className="g6">{anime.data.map((s) => <SeasonPoster key={s.season_id} s={s} />)}</div>
        </section>
      )}

      {!!live.data?.length && (
        <section>
          <div className="head-b"><h2>正在直播</h2><Link to="/live" className="pill-link">更多直播</Link></div>
          <div className="g4">{live.data.map((it) => <VideoCard key={it.id} it={it} />)}</div>
        </section>
      )}

      <section>
        <div className="head-b"><h2>为你推荐</h2><button type="button" className="soft-btn" onClick={feed.reload}><Icon name="refresh" size={14} />换一换</button></div>
        {feed.error && !feed.items.length ? <ErrorState error={feed.error} retry={feed.reload} /> : feed.items.length ? (
          <div className="g4">{rest.map((it) => <VideoCard key={it.id} it={it} actions={dislike(it)} />)}</div>
        ) : <SkeletonGrid count={8} />}
        <div ref={sentinel} />
        <LoadMore loading={feed.loading && feed.items.length > 0} done={feed.done} onMore={feed.more} />
      </section>
    </div>
  )
}
