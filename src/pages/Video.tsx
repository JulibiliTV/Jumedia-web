import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'
import { compact, countText, dateTimeText, formatDuration, type VideoItem, videoItem } from '../api/normalize'
import { itemLink } from '../components/Cards'
import { Comments } from '../components/Comments'
import { Icon } from '../components/Icon'
import { Player } from '../components/Player'
import { Avatar, ErrorState, Loading, Modal, Spinner, Switch, toast, toastError } from '../components/ui'
import { CHANNELS } from '../lib/categories'
import { useAsync, useTitle } from '../lib/hooks'
import { useSession } from '../lib/session'

/** 视频详情 — `/x/web-interface/view/detail` + `/x/player/wbi/v2` + interaction endpoints, as Juli's detail page. */
export default function Video() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const { me } = useSession()
  const target = id.toLowerCase().startsWith('av') ? { aid: Number(id.slice(2)) } : { bvid: id }

  const detail = useAsync(async () => {
    const aid = target.aid ?? (await juli.view({ bvid: target.bvid })).aid
    return juli.viewDetail(aid)
  }, [id])
  const view = detail.data?.View
  const aid: number | undefined = view?.aid
  const pages: { cid: number; part: string; duration: number }[] = view?.pages ?? []
  const p = Math.max(1, Math.min(pages.length || 1, Number(params.get('p') ?? 1)))
  const page = pages[p - 1]
  useTitle(view?.title)

  const watching = useAsync(async () => (aid && page ? ((await jm.onlineTotal(aid, page.cid)) as { total: string }).total : ''), [aid, page?.cid])
  // 自动连播：播完分 P 和合集后接着播相关推荐的第一个（只保存在本机）。
  const [autoplay, setAutoplayState] = useState(() => { try { return localStorage.getItem('jumedia.autoplay') !== '0' } catch { return true } })
  const setAutoplay = (v: boolean) => { setAutoplayState(v); try { localStorage.setItem('jumedia.autoplay', v ? '1' : '0') } catch { /* storage unavailable */ } }
  const [rel, setRel] = useState({ like: false, coin: 0, fav: false, follow: false, toview: false })
  const [stat, setStat] = useState<Record<string, number>>({})
  const [progress, setProgress] = useState<{ cid: number; at: number }>()
  const [modal, setModal] = useState<'' | 'coin' | 'fav'>('')
  useEffect(() => {
    if (!view) return
    setStat(view.stat)
    setRel({ like: false, coin: 0, fav: false, follow: !!detail.data?.Card?.following, toview: false })
    if (!me) return
    juli.hasLike(view.aid).then((v) => setRel((r) => ({ ...r, like: v === 1 }))).catch(() => {})
    juli.favoured(view.aid).then((v) => setRel((r) => ({ ...r, fav: !!v?.favoured }))).catch(() => {})
    juli.toview().then((d) => setRel((r) => ({ ...r, toview: (d.list ?? []).some((x: any) => x.aid === view.aid) }))).catch(() => {})
  }, [view, me?.mid]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!aid || !page) return
    if (!me) { setProgress({ cid: page.cid, at: 0 }); return }
    // Same rule as Juli's fetchPlaybackProgress: only when `last_play_cid` matches the page.
    juli.playerV2(aid, page.cid).then((d) => setProgress({ cid: page.cid, at: d.last_play_cid === page.cid && d.last_play_time > 0 ? Math.floor(d.last_play_time / 1000) : 0 })).catch(() => setProgress({ cid: page.cid, at: 0 }))
  }, [aid, page?.cid, me?.mid]) // eslint-disable-line react-hooks/exhaustive-deps

  if (detail.loading && !view) return <Loading />
  if (detail.error) return <ErrorState error={detail.error} retry={detail.reload} />
  if (!view) return null

  const need = () => { if (!me) { toast('请先登录', 'error'); nav('/login'); return false } return true }
  const toggleLike = async () => {
    if (!need()) return
    try { await juli.like(view.aid, !rel.like); setRel({ ...rel, like: !rel.like }); setStat({ ...stat, like: stat.like + (rel.like ? -1 : 1) }) } catch (e) { toastError(e) }
  }
  const toggleFollow = async () => {
    if (!need()) return
    try { await juli.relationModify(view.owner.mid, !rel.follow); setRel({ ...rel, follow: !rel.follow }); toast(rel.follow ? '已取消关注' : '关注成功', 'success') } catch (e) { toastError(e) }
  }
  const toggleToview = async () => {
    if (!need()) return
    try { if (rel.toview) await juli.toviewDel(view.aid); else await juli.toviewAdd(view.aid); setRel({ ...rel, toview: !rel.toview }); toast(rel.toview ? '已从稍后再看移除' : '已添加到稍后再看', 'success') } catch (e) { toastError(e) }
  }
  const share = async () => {
    try {
      const r = await juli.share(view.aid)
      const link = r.data?.share_url ?? location.href
      await navigator.clipboard?.writeText(link).catch(() => {})
      setStat({ ...stat, share: (stat.share ?? 0) + 1 })
      toast('链接已复制到剪贴板', 'success')
    } catch (e) { toastError(e) }
  }
  const dislike = async () => {
    if (!need()) return
    try { await juli.dislike(view.aid, true); toast('已减少此类内容推荐', 'success') } catch (e) { toastError(e) }
  }
  const season = view.ugc_season
  const seasonEps: VideoItem[] = season ? compact((season.sections?.find((s: any) => s.episodes.some((e: any) => e.aid === view.aid)) ?? season.sections?.[0])?.episodes.map((e: any) => videoItem({ ...e.arc, ...e, title: e.title })) ?? []) : []
  const related = compact<VideoItem>((detail.data?.Related ?? []).map(videoItem))
  const next = () => {
    if (p < pages.length) setParams({ p: String(p + 1) })
    else {
      const i = seasonEps.findIndex((e) => e.aid === view.aid)
      if (i >= 0 && seasonEps[i + 1]) nav(itemLink(seasonEps[i + 1]))
      else if (autoplay && related[0]) nav(itemLink(related[0]))
    }
  }
  const card = detail.data?.Card

  return (
    <div className="watch">
      <div style={{ minWidth: 0 }}>
        <div className="player-wrap">
          {page && progress?.cid === page.cid ? <Player key={page.cid} source={{ kind: 'video', aid: view.aid, cid: page.cid, startAt: progress.at }} onEnded={next} /> : <div className="player" style={{ display: 'grid', placeItems: 'center' }}><Spinner /></div>}
        </div>
        <div className="watching"><span><Icon name="users" size={14} />{watching.data ? `${watching.data} 人正在看` : ' '}</span><span>已装填 {countText(stat.danmaku)} 条弹幕</span></div>
        <h1>{view.title}{pages.length > 1 && <span className="faint" style={{ fontSize: 15, fontWeight: 500 }}> · {page?.part}</span>}</h1>
        <div className="stats">
          <span><Icon name="play" size={14} />{countText(stat.view)}</span>
          <span><Icon name="danmaku" size={15} />{countText(stat.danmaku)}</span>
          <span><Icon name="clock" size={14} />{dateTimeText(view.pubdate)}</span>
          <Link to={`/c/${CHANNELS.find((c) => c.regionIDs?.includes(view.tid))?.kind ?? ''}`} className="badge">{view.tname}</Link>
          {view.copyright === 1 && <span className="faint"><Icon name="ban" size={14} />未经作者授权，禁止转载</span>}
        </div>
        <div className="toolbar">
          <button className={`tool ${rel.like ? 'on' : ''}`} onClick={toggleLike}><Icon name="thumb" size={22} />{countText(stat.like)}</button>
          <button className={`tool ${rel.coin ? 'on' : ''}`} onClick={() => need() && setModal('coin')}><Icon name="coin" size={22} />{countText(stat.coin)}</button>
          <button className={`tool ${rel.fav ? 'on' : ''}`} onClick={() => need() && setModal('fav')}><Icon name="star" size={22} />{countText(stat.favorite)}</button>
          <button className="tool" onClick={share}><Icon name="share" size={22} />{countText(stat.share)}</button>
          <div className="grow" />
          <button className={`tool ${rel.toview ? 'on' : ''}`} onClick={toggleToview}><Icon name="clock" size={20} />{rel.toview ? '已在稍后再看' : '稍后再看'}</button>
          <button className="tool" onClick={dislike} title="不喜欢"><Icon name="thumb-down" size={20} /></button>
        </div>
        <div className="desc-card">
          <div className="desc">{view.desc || '-'}</div>
          {detail.data?.Tags?.length > 0 && <div className="tagcloud">{detail.data.Tags.map((t: any) => <Link key={t.tag_id} to={`/search?keyword=${encodeURIComponent(t.tag_name)}`}>{t.tag_name}</Link>)}</div>}
        </div>
        <Comments oid={view.aid} upMid={view.owner.mid} count={String(stat.reply ?? '')} />
      </div>

      <aside>
        <div className="up-box">
          <div className="row" style={{ gap: 12 }}>
            <Link to={`/space/${view.owner.mid}`} style={{ flex: 'none' }}><Avatar src={view.owner.face} size={48} /></Link>
            <div className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Link to={`/space/${view.owner.mid}`} style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{view.owner.name}</Link>
              <span className="muted clamp-1" style={{ fontSize: 12 }}>{card?.card?.sign || '这个 UP 主很神秘'}</span>
              <span className="faint" style={{ fontSize: 12 }}>{countText(card?.follower)} 粉丝 · {card?.archive_count} 投稿</span>
            </div>
          </div>
          {me?.mid !== view.owner.mid && <button type="button" className={`up-follow ${rel.follow ? 'on' : ''}`} onClick={toggleFollow}>{rel.follow ? '已关注' : <><Icon name="plus" size={15} />关注</>}</button>}
        </div>

        {pages.length > 1 && (
          <div className="side-box">
            <div className="head"><span>视频选集</span><span className="faint" style={{ fontWeight: 400, fontSize: 13 }}>({p}/{pages.length})</span></div>
            <div className="body">{pages.map((pg, i) => <button key={pg.cid} className={`ep-item ${i + 1 === p ? 'on' : ''}`} onClick={() => setParams({ p: String(i + 1) })}><span className="faint">P{i + 1}</span><span className="clamp-1" style={{ textAlign: 'left' }}>{pg.part}</span><span className="dur">{formatDuration(pg.duration)}</span></button>)}</div>
          </div>
        )}

        {season && seasonEps.length > 0 && (
          <div className="side-box">
            <div className="head"><span className="row"><Icon name="layers" size={16} />合集 · {season.title}</span><span className="faint" style={{ fontWeight: 400, fontSize: 13 }}>{seasonEps.length} 个视频</span></div>
            <div className="body">{seasonEps.map((e, i) => <Link key={e.id} to={itemLink(e)} className={`ep-item ${e.aid === view.aid ? 'on' : ''}`}><span className="faint">{i + 1}</span><span className="clamp-1">{e.title}</span><span className="dur">{e.durationText}</span></Link>)}</div>
          </div>
        )}

        <div className="row between" style={{ margin: '4px 0 12px' }}><h2 style={{ fontSize: 16, fontWeight: 800 }}>相关推荐</h2><label className="row muted" style={{ gap: 8, fontSize: 13 }}>自动连播<Switch on={autoplay} onChange={setAutoplay} /></label></div>
        <div className="related">
          {related.map((it) => (
            <Link key={it.id} to={itemLink(it)} className="item">
              <div className="thumb">{it.cover && <img src={it.cover} alt="" loading="lazy" />}<div className="meta"><span className="dur">{it.durationText}</span></div></div>
              <div className="grow"><div className="t clamp-2">{it.title}</div><div className="s">{it.ownerName}</div><div className="s">{countText(it.view)} 播放 · {countText(it.danmaku)} 弹幕</div></div>
            </Link>
          ))}
        </div>
      </aside>

      {modal === 'coin' && <CoinModal aid={view.aid} onClose={() => setModal('')} onDone={(n, liked) => { setRel((r) => ({ ...r, coin: r.coin + n, like: r.like || liked })); setStat((s) => ({ ...s, coin: s.coin + n, like: s.like + (liked && !rel.like ? 1 : 0) })) }} />}
      {modal === 'fav' && me && <FavModal aid={view.aid} mid={me.mid} onClose={() => setModal('')} onDone={(fav, delta) => { setRel((r) => ({ ...r, fav })); setStat((s) => ({ ...s, favorite: s.favorite + delta })) }} />}
    </div>
  )
}

function CoinModal({ aid, onClose, onDone }: { aid: number; onClose: () => void; onDone: (n: number, liked: boolean) => void }) {
  const { me, refresh } = useSession()
  const [n, setN] = useState<1 | 2>(1)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { await juli.coin(aid, n); toast(`投币成功，已同时点赞`, 'success'); onDone(n, true); refresh(); onClose() } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <Modal title="给 UP 主投上硬币" onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={submit}>确定投币</button>}>
      <div className="row" style={{ gap: 16, justifyContent: 'center', padding: '12px 0 16px' }}>
        {([1, 2] as const).map((k) => (
          <button key={k} className={`panel ${n === k ? 'on' : ''}`} onClick={() => setN(k)} style={{ width: 150, textAlign: 'center', cursor: 'pointer', borderColor: n === k ? 'var(--brand)' : undefined, background: n === k ? 'var(--brand-soft)' : undefined }}>
            <div style={{ color: 'var(--gold)' }}>{Array.from({ length: k }, (_, i) => <Icon key={i} name="coin" size={40} />)}</div>
            <div style={{ fontWeight: 700, marginTop: 8 }}>{k} 硬币</div>
          </button>
        ))}
      </div>
      <p className="faint" style={{ textAlign: 'center', fontSize: 13 }}>投币时将同时点赞 · 当前硬币余额 {Math.floor(me?.money ?? 0)}</p>
    </Modal>
  )
}

function FavModal({ aid, mid, onClose, onDone }: { aid: number; mid: number; onClose: () => void; onDone: (fav: boolean, delta: number) => void }) {
  const folders = useAsync<{ id: number; title: string; media_count: number; on: boolean }[]>(async () => {
    const d = await juli.favFolders(mid, aid)
    return (d.list ?? []).map((f: { id: number; title: string; media_count: number; fav_state: number }) => ({ ...f, on: f.fav_state === 1 }))
  }, [mid, aid])
  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const value = (f: { id: number; on: boolean }) => picked[f.id] ?? f.on
  const submit = async () => {
    setBusy(true)
    try {
      let delta = 0
      for (const f of folders.data ?? []) {
        if (value(f) !== f.on) { await juli.favDeal(aid, f.id, value(f)); delta += value(f) ? 1 : -1 }
      }
      onDone((folders.data ?? []).some(value), delta)
      toast('收藏状态已更新', 'success')
      onClose()
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <Modal title="添加到收藏夹" onClose={onClose} footer={<><Link to="/account/favorites" className="btn ghost">管理收藏夹</Link><button className="btn primary" disabled={busy} onClick={submit}>确定</button></>}>
      {folders.loading ? <Loading /> : (
        <div className="stack" style={{ gap: 4 }}>
          {folders.data?.map((f) => (
            <label key={f.id} className="check" style={{ height: 44, padding: '0 8px', borderRadius: 8, justifyContent: 'space-between' }}>
              <span className="row"><input type="checkbox" checked={value(f)} onChange={(e) => setPicked({ ...picked, [f.id]: e.target.checked })} />{f.title}</span>
              <span className="faint" style={{ fontSize: 12 }}>{f.media_count} 个内容</span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}
