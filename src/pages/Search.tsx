import { Link, useSearchParams } from 'react-router-dom'
import * as juli from '../api/juli'
import { cleanTitle, compact, countText, liveItem, seasonItem, type VideoItem, videoItem } from '../api/normalize'
import { Grid, LiveCard, UserCard, VideoCard } from '../components/Cards'
import { Icon } from '../components/Icon'
import { Empty, ErrorState, Loading } from '../components/ui'
import { useAsync, useInfinite, useTitle } from '../lib/hooks'

const TYPES = [
  { value: 'all', label: '综合' }, { value: 'video', label: '视频' }, { value: 'media_bangumi', label: '番剧' },
  { value: 'media_ft', label: '影视' }, { value: 'live_room', label: '直播' }, { value: 'bili_user', label: '用户' },
]

interface SearchUser { mid: number; uname: string; face: string; sign: string; extra: string }
const userOf = (v: any): SearchUser => ({ mid: v.mid, uname: cleanTitle(v.uname), face: v.upic, sign: cleanTitle(v.usign), extra: `${countText(v.fans)} 粉丝 · ${v.videos ?? 0} 个视频` })

function parse(type: string, values: any[]): VideoItem[] {
  if (type === 'live_room') return compact(values.map(liveItem))
  if (type === 'media_bangumi' || type === 'media_ft') return compact(values.map(seasonItem))
  return compact(values.map(videoItem))
}

/** 搜索 — `/x/web-interface/search/all/v2` (综合) and `/x/web-interface/wbi/search/type` (分类). */
export default function Search() {
  const [params, setParams] = useSearchParams()
  const keyword = params.get('keyword') ?? ''
  const type = params.get('type') ?? 'all'
  const order = params.get('order') ?? ''
  const duration = Number(params.get('duration') ?? 0)
  const tids = Number(params.get('tids') ?? 0)
  useTitle(`${keyword} - 搜索`)
  const all = useAsync(async () => (keyword && type === 'all' ? juli.searchAll(keyword) : null), [keyword, type])
  const paged = useInfinite(async (page: number) => {
    if (!keyword || type === 'all') return { items: [] as (VideoItem | SearchUser)[], next: null }
    const d = await juli.searchType(keyword, type, page, type === 'video' ? { order, duration, tids } : {})
    const raw = type === 'live_room' && !Array.isArray(d.result) ? d.result?.live_room ?? [] : d.result ?? []
    const pages = Math.max(d.numPages ?? 0, d.pageinfo?.live_room?.numPages ?? 0)
    const items = type === 'bili_user' ? raw.map(userOf) : parse(type, raw)
    return { items, next: raw.length && page < pages ? page + 1 : null }
  }, 1, [keyword, type, order, duration, tids])
  const sections: Record<string, any[]> = Object.fromEntries((all.data?.result ?? []).map((s: any) => [s.result_type, s.data ?? []]))
  const top = all.data?.top_tlist ?? {}
  const topMatch = [...(sections.media_bangumi ?? []), ...(sections.media_ft ?? [])][0] as any

  const season = useAsync(async () => (topMatch ? juli.pgcSeason({ season_id: topMatch.season_id }) : null), [topMatch?.season_id])
  // 继续看: where the viewer left off in the top-hit season (`user_status.progress`).
  const resume = season.data?.user_status?.progress?.last_ep_id ? season.data.user_status.progress as { last_ep_id: number; last_ep_index: string } : null
  const up = (sections.bili_user ?? [])[0] as any
  const upVids = useAsync(async () => (up ? compact<VideoItem>(((await juli.arcSearch(up.mid, 1, 'pubdate', 3)).list?.vlist ?? []).map(videoItem)) : []), [up?.mid])
  const showFilters = type === 'all' || type === 'video'
  const pick = (k: string, v: string | number) => { const next = new URLSearchParams(params); if (v) next.set(k, String(v)); else next.delete(k); if (type === 'all') next.set('type', 'video'); setParams(next) }
  const videos = type === 'all' ? parse('video', sections.video ?? []) : []
  const eps: any[] = season.data?.episodes ?? []
  return (
    <div className="page">
      <div className="stack" style={{ gap: 14 }}>
        <div className="line-tabs" style={{ gap: 0 }}>{TYPES.map((t) => <button type="button" key={t.value} className={type === t.value ? 'on' : ''} style={{ marginRight: 28 }} onClick={() => setParams({ keyword, type: t.value })}>{t.label}{t.value !== 'all' && top[t.value] !== undefined && <small>{top[t.value]}</small>}</button>)}</div>
        {showFilters && keyword && (
          <div className="row wrap" style={{ gap: 8 }}>
            {[['', '综合排序'], ['click', '最多播放'], ['pubdate', '最新发布'], ['dm', '最多弹幕'], ['stow', '最多收藏']].map(([v, label]) => <button type="button" key={v} className={`flt ${order === v && type === 'video' || (!v && !order) ? 'on' : ''}`} onClick={() => pick('order', v)}>{label}</button>)}
            <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }} />
            {['全部时长', '10 分钟以下', '10–30 分钟', '30–60 分钟', '60 分钟以上'].map((d, i) => <button type="button" key={d} className={`flt ${duration === i ? 'on' : ''}`} onClick={() => pick('duration', i)}>{d}</button>)}
          </div>
        )}
      </div>
      {!keyword ? <Empty title="输入关键词开始搜索" icon="search" /> : type === 'all' ? (
        all.loading ? <Loading /> : all.error ? <ErrorState error={all.error} retry={all.reload} /> : <>
          {topMatch && (
            <section className="top-hit">
              <Link to={`/bangumi/play/ss${topMatch.season_id}`}><img src={topMatch.cover} alt="" /></Link>
              <div className="stack" style={{ flex: '1 1 360px', minWidth: 0, gap: 8 }}>
                <span className="row" style={{ gap: 8 }}><span className="hit-badge">{[1, 4].includes(topMatch.season_type) ? '番剧' : topMatch.badge || '影视'}</span><Link to={`/bangumi/play/ss${topMatch.season_id}`} className="hit-t" dangerouslySetInnerHTML={{ __html: topMatch.title }} /></span>
                <span className="muted" style={{ fontSize: 13 }}>{[topMatch.year, topMatch.areas, topMatch.styles, topMatch.index_show].filter(Boolean).join(' · ')}</span>
                {parseFloat(topMatch.score) > 0 && <span className="row" style={{ gap: 8, alignItems: 'baseline' }}><b style={{ fontSize: 22, color: '#e8a400' }}>{topMatch.score}</b><span className="muted" style={{ fontSize: 13 }}>{countText(topMatch.stat?.follow ?? 0)}追番 · {countText(topMatch.stat?.view ?? 0)}播放</span></span>}
                <p className="muted clamp-2" style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>{topMatch.evaluate}</p>
                {eps.length > 1 && <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>{eps.slice(0, 12).map((e) => <Link key={e.ep_id} to={`/bangumi/play/ep${e.ep_id}`} className="ep-btn">{e.title}</Link>)}{eps.length > 12 && <Link to={`/bangumi/play/ss${topMatch.season_id}`} className="ep-btn">…</Link>}</div>}
                <div className="row" style={{ gap: 8, marginTop: 6 }}><Link to={resume ? `/bangumi/play/ep${resume.last_ep_id}` : `/bangumi/play/ss${topMatch.season_id}`} className="btn primary" style={{ height: 38, borderRadius: 19, padding: '0 20px' }}><Icon name="play" size={14} fill />{resume ? `继续看第 ${resume.last_ep_index} ${[1, 4].includes(topMatch.season_type) ? '话' : '集'}` : '立即观看'}</Link></div>
              </div>
            </section>
          )}
          {up && (
            <section className="up-hit">
              <Link to={`/space/${up.mid}`}><img src={up.upic} alt="" style={{ width: 64, height: 64, borderRadius: '50%' }} /></Link>
              <div className="stack" style={{ flex: '1 1 240px', minWidth: 0, gap: 2 }}>
                <Link to={`/space/${up.mid}`} style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }} dangerouslySetInnerHTML={{ __html: up.uname }} />
                <span className="muted clamp-1" style={{ fontSize: 13 }}>{cleanTitle(up.usign) || '这个人很神秘，什么都没有写'}</span>
                <span className="faint" style={{ fontSize: 12 }}>{countText(up.fans)} 粉丝 · {up.videos ?? 0} 投稿</span>
              </div>
              <div className="row" style={{ gap: 8 }}>{(upVids.data ?? []).map((v) => <Link key={v.id} to={`/video/${v.bvid}`} className="stack" style={{ width: 128, gap: 4, fontSize: 12, color: 'var(--text)' }}><img src={v.cover} alt="" style={{ width: 128, aspectRatio: '16/10', objectFit: 'cover', borderRadius: 6 }} /><span className="clamp-1">{v.title}</span></Link>)}</div>
              <Link to={`/space/${up.mid}`} className="soft-btn" style={{ height: 36, padding: '0 18px', borderRadius: 8 }}>进入空间</Link>
            </section>
          )}
          {sections.live_room?.length > 0 && <section><div className="row between" style={{ marginBottom: 14 }}><h2 style={{ fontSize: 20, fontWeight: 800 }}>直播间</h2><Link to={`/search?keyword=${encodeURIComponent(keyword)}&type=live_room`} className="muted" style={{ fontSize: 13 }}>更多 ›</Link></div><div className="g4">{parse('live_room', sections.live_room).slice(0, 4).map((it) => <LiveCard key={it.id} it={it} />)}</div></section>}
          <section>
            <div className="row between" style={{ marginBottom: 14 }}><h2 style={{ fontSize: 20, fontWeight: 800 }}>视频</h2><span className="muted" style={{ fontSize: 13 }}>共 {top.video ?? videos.length} 个结果</span></div>
            {videos.length ? <div className="g4">{videos.map((it) => <VideoCard key={it.id} it={it} />)}</div> : <Empty title={`没有找到与“${keyword}”相关的视频`} icon="search" />}
          </section>
          {(top.video ?? 0) > videos.length && <div className="more-btn"><button type="button" onClick={() => setParams({ keyword, type: 'video' })}>查看全部视频</button></div>}
        </>
      ) : paged.error ? <ErrorState error={paged.error} retry={paged.reload} /> : <>
        {type === 'bili_user' ? <div className="ugrid">{(paged.items as SearchUser[]).map((u) => <UserCard key={u.mid} u={u} />)}</div>
          : type === 'live_room' ? <div className="g4">{(paged.items as VideoItem[]).map((it) => <LiveCard key={it.id} it={it} />)}</div>
          : <Grid items={paged.items as VideoItem[]} poster={type.startsWith('media')} />}
        {!paged.loading && !paged.items.length && <Empty title="没有找到相关内容" icon="search" />}
        {!paged.done && paged.items.length > 0 && <div className="more-btn"><button type="button" disabled={paged.loading} onClick={paged.more}>{paged.loading ? '加载中…' : '加载更多'}</button></div>}
      </>}
    </div>
  )
}
