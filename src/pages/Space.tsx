import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'
import { compact, countText, dateTimeText, seasonItem, type VideoItem, videoItem } from '../api/normalize'
import { Grid, PosterCard, UserCard, VideoCard } from '../components/Cards'
import { Icon } from '../components/Icon'
import { Empty, ErrorState, Level, Loading, Pager, Segmented, toast, toastError } from '../components/ui'
import { useAsync, useTitle } from '../lib/hooks'
import { useSession } from '../lib/session'

/** UP 主空间 — acc/info, card, relation, arc/search, top/arc, masterpiece, seasons_series_list, fav folders, followings, bangumi follows. */
export default function Space() {
  const { mid: midParam = '0' } = useParams()
  const mid = Number(midParam)
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'home'
  const { me } = useSession()
  const profile = useAsync(async () => {
    const [info, card, stat, up] = await Promise.all([juli.accInfo(mid), juli.card(mid), juli.relationStat(mid), jm.upStat(mid).catch(() => null)])
    return { info, card, stat, up: up as { archive: { view: number }; likes: number } | null }
  }, [mid])
  const [following, setFollowing] = useState<boolean>()
  useTitle(profile.data ? `${profile.data.info.name}的个人空间` : undefined)
  if (profile.loading && !profile.data) return <Loading />
  if (profile.error) return <ErrorState error={profile.error} retry={profile.reload} />
  const { info, card, stat, up } = profile.data!
  const isFollowing = following ?? !!info.is_followed
  const mine = me?.mid === mid
  const toggle = async () => {
    if (!me) return nav('/login')
    try { await juli.relationModify(mid, !isFollowing); setFollowing(!isFollowing); toast(isFollowing ? '已取消关注' : '关注成功', 'success') } catch (e) { toastError(e) }
  }
  return (
    <div className="page">
      <section className="sp-card">
        <div className="cover">{info.top_photo && <img src={info.top_photo} alt="" />}<i /></div>
        <div className="who">
          <img className="av" src={info.face} alt="" />
          <div className="stack" style={{ flex: '1 1 320px', minWidth: 0, gap: 6, paddingBottom: 2 }}>
            <span className="row wrap" style={{ gap: 8 }}><span style={{ fontSize: 24, fontWeight: 800 }}>{info.name}</span><Level n={info.level} />{info.vip?.status ? <span className="badge accent">{info.vip.label?.text || '大会员'}</span> : null}{info.official?.title && <span className="badge brand">{info.official.title}</span>}</span>
            <span className="muted" style={{ fontSize: 14 }}>{info.sign || '这个人很神秘，什么都没有写'}</span>
          </div>
          <div className="row" style={{ gap: 8, paddingBottom: 2 }}>
            {mine ? <Link to="/account/settings" className="sp-btn soft">编辑资料</Link> : <button type="button" className={`sp-btn ${isFollowing ? 'soft' : ''}`} onClick={toggle}>{isFollowing ? '已关注' : <><Icon name="plus" size={15} />关注</>}</button>}
          </div>
        </div>
        <div className="sp-tabs">
          {([{ value: 'home', label: '主页' }, { value: 'video', label: '投稿', count: card.archive_count }, { value: 'collection', label: '合集和系列' }, { value: 'favorite', label: '收藏' }, { value: 'bangumi', label: '追番追剧' }, { value: 'following', label: '关注' }]).map((t: { value: string; label: string; count?: number }) => <button type="button" key={t.value} className={tab === t.value ? 'on' : ''} onClick={() => setParams({ tab: t.value })}>{t.label}{t.count !== undefined && <small>{t.count}</small>}</button>)}
          <span className="grow" />
          <span className="row" style={{ gap: 24 }}>
            {[['关注', stat.following], ['粉丝', stat.follower], ['获赞', up?.likes ?? card.like_num], ['播放', up?.archive.view ?? 0]].map(([k, v]) => <span key={k as string} className="stack" style={{ alignItems: 'center', fontSize: 12, color: 'var(--text-2)', gap: 0 }}><b style={{ fontSize: 16, color: 'var(--text)' }}>{countText(v as number)}</b>{k}</span>)}
          </span>
        </div>
      </section>
      {info.live_room?.liveStatus === 1 && tab === 'home' && (
        <Link to={`/live/${info.live_room.roomid}`} className="panel row" style={{ marginBottom: 20, gap: 16 }}>
          <img src={info.live_room.cover} alt="" style={{ width: 160, borderRadius: 10, aspectRatio: '16/10', objectFit: 'cover' }} />
          <div className="grow"><span className="badge accent">直播中</span><div style={{ fontWeight: 700, fontSize: 16, marginTop: 6 }}>{info.live_room.title}</div><div className="faint">{info.live_room.watched_show?.text_large}</div></div>
          <Icon name="chevron-right" />
        </Link>
      )}
      {tab === 'home' && <SpaceHome mid={mid} mine={mine} room={info.live_room} jointime={info.jointime} />}
      {tab === 'video' && <SpaceVideos mid={mid} />}
      {tab === 'collection' && <SpaceCollections mid={mid} />}
      {tab === 'favorite' && <SpaceFavorites mid={mid} />}
      {tab === 'bangumi' && <SpaceBangumi mid={mid} />}
      {tab === 'following' && <SpaceFollowing mid={mid} />}
    </div>
  )
}

function SpaceHome({ mid, mine, room, jointime }: { mid: number; mine: boolean; room?: { roomid: number; liveStatus: number; title: string }; jointime?: number }) {
  const featured = useAsync(async () => {
    const [top, works] = await Promise.all([juli.topArc(mid).catch(() => null), juli.masterpiece(mid).catch(() => [])])
    return compact<VideoItem>([top, ...(works ?? [])].map(videoItem)).slice(0, 3)
  }, [mid])
  const [order, setOrder] = useState('pubdate')
  const recent = useAsync(async () => compact<VideoItem>(((await juli.arcSearch(mid, 1, order, 9)).list?.vlist ?? []).map(videoItem)), [mid, order])
  const notice = useAsync(() => jm.spaceNotice(mid), [mid])
  const reserve = useAsync(async () => (await jm.reservations(mid)) as { sid: number; name: string; subtitle: string }[], [mid])
  const collections = useAsync(async () => { const l = (await juli.seasonsSeriesList(mid, 1)).items_lists; return [...(l?.seasons_list ?? []), ...(l?.series_list ?? [])].map((x: any) => x.meta) as { season_id?: number; series_id?: number; name: string; cover: string; total: number }[] }, [mid])
  const [editing, setEditing] = useState<string | null>(null)
  const save = async () => {
    try { await jm.spaceNoticeSet(editing ?? ''); notice.mutate(() => (editing ?? '').trim()); setEditing(null); toast('公告已更新', 'success') } catch (e) { toastError(e) }
  }
  return (
    <div className="split">
      <div className="main" style={{ gap: 28 }}>
        {!!featured.data?.length && <section><div className="head-b"><h2 style={{ fontSize: 18, alignItems: 'center' }}><Icon name="star" size={18} style={{ color: 'var(--gold)' }} />代表作</h2></div><div className="g3">{featured.data.map((it) => <VideoCard key={it.id} it={it} />)}</div></section>}
        <section>
          <div className="head-b"><h2 style={{ fontSize: 18 }}>最新投稿</h2><span className="pill-seg" style={{ marginBottom: 0 }}>{[['pubdate', '最新发布'], ['click', '最多播放'], ['stow', '最多收藏']].map(([v, label]) => <button type="button" key={v} className={order === v ? 'on' : ''} onClick={() => setOrder(v)}>{label}</button>)}</span></div>
          {recent.loading && !recent.data ? <Loading /> : recent.data?.length ? <div className="g3">{recent.data.map((it) => <VideoCard key={it.id} it={it} />)}</div> : <Empty title="还没有投稿" />}
        </section>
      </div>
      <aside className="aside">
        <div className="box-b">
          <h3>公告{mine && editing === null && <button type="button" className="soft-btn" onClick={() => setEditing(notice.data ?? '')}><Icon name="edit" size={13} />编辑</button>}</h3>
          {editing !== null ? <>
            <textarea className="textarea" rows={4} maxLength={150} value={editing} onChange={(e) => setEditing(e.target.value)} placeholder="写点什么，让访客了解你" />
            <div className="row" style={{ justifyContent: 'flex-end' }}><span className="faint" style={{ fontSize: 12, marginRight: 'auto' }}>{editing.length}/150</span><button type="button" className="btn sm" onClick={() => setEditing(null)}>取消</button><button type="button" className="btn primary sm" onClick={save}>保存</button></div>
          </> : <p className="muted" style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{notice.data || '这个 UP 主还没有写公告'}</p>}
        </div>
        {!!collections.data?.length && (
          <div className="box-b">
            <h3>合集和系列<Link to={`/space/${mid}?tab=collection`}>全部 {collections.data.length}</Link></h3>
            {collections.data.slice(0, 3).map((c) => <Link key={`${c.season_id ?? 0}-${c.series_id ?? 0}`} to={`/space/${mid}?tab=collection`} className="mini"><span className="art"><img src={c.cover} alt="" /></span><span className="t"><b style={{ WebkitLineClamp: 1 }}>{c.name}</b><span>{c.total} 个视频</span></span></Link>)}
          </div>
        )}
        <div className="box-b">
          <h3>个人资料</h3>
          <div className="row between" style={{ fontSize: 13 }}><span className="faint">UID</span><span>{mid}</span></div>
          {!!jointime && <div className="row between" style={{ fontSize: 13 }}><span className="faint">加入时间</span><span>{dateTimeText(jointime).slice(0, 10)}</span></div>}
          <div className="row between" style={{ fontSize: 13 }}><span className="faint">直播间</span>{room?.roomid ? <Link to={`/live/${room.roomid}`}>{room.liveStatus === 1 ? '直播中' : '未开播'}{room.liveStatus !== 1 && reserve.data?.[0] && ` · ${reserve.data[0].subtitle}`}</Link> : <span>未开通</span>}</div>
        </div>
      </aside>
    </div>
  )
}

function SpaceVideos({ mid }: { mid: number }) {
  const [order, setOrder] = useState('pubdate')
  const [pn, setPn] = useState(1)
  const d = useAsync(() => juli.arcSearch(mid, pn, order), [mid, pn, order])
  const items = compact<VideoItem>((d.data?.list?.vlist ?? []).map(videoItem))
  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <div className="row wrap">{Object.values(d.data?.list?.tlist ?? {}).map((t: any) => <span key={t.tid} className="badge">{t.name} {t.count}</span>)}</div>
        <Segmented value={order} onChange={(o) => { setOrder(o); setPn(1) }} items={[{ value: 'pubdate', label: '最新发布' }, { value: 'click', label: '最多播放' }, { value: 'stow', label: '最多收藏' }]} />
      </div>
      {d.loading && !d.data ? <Loading /> : <Grid items={items} empty={<Empty title="还没有投稿" />} />}
      <Pager page={pn} total={d.data?.page?.count ?? 0} size={30} onChange={setPn} />
    </div>
  )
}

function SpaceCollections({ mid }: { mid: number }) {
  const d = useAsync(() => juli.seasonsSeriesList(mid, 1), [mid])
  const [open, setOpen] = useState<{ kind: 'season' | 'series'; id: number; title: string } | null>(null)
  const [reverse, setReverse] = useState(false)
  const videos = useAsync(async () => {
    if (!open) return []
    const r = open.kind === 'season' ? await juli.seasonsArchives(mid, open.id, 1, reverse) : await juli.seriesArchives(mid, open.id, 1, reverse ? 'asc' : 'desc')
    return compact<VideoItem>((r.archives ?? []).map(videoItem))
  }, [open?.id, reverse])
  if (d.loading) return <Loading />
  const lists = d.data?.items_lists
  const all = [...(lists?.seasons_list ?? []).map((x: any) => ({ kind: 'season' as const, id: x.meta.season_id, ...x })), ...(lists?.series_list ?? []).map((x: any) => ({ kind: 'series' as const, id: x.meta.series_id, ...x }))]
  if (open) return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}><button className="btn ghost" onClick={() => setOpen(null)}><Icon name="chevron-left" />{open.title}</button><Segmented value={reverse} onChange={setReverse} items={[{ value: false, label: open.kind === 'season' ? '默认排序' : '最新' }, { value: true, label: open.kind === 'season' ? '倒序' : '最早' }]} /></div>
      {videos.loading ? <Loading /> : <Grid items={videos.data ?? []} />}
    </div>
  )
  if (!all.length) return <Empty title="还没有创建合集或系列" icon="layers" />
  return (
    <div className="grid">
      {all.map((c) => (
        <button key={c.kind + c.id} className="vcard" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0 }} onClick={() => setOpen({ kind: c.kind, id: c.id, title: c.meta.name })}>
          <div className="thumb"><img src={c.meta.cover} alt="" /><div className="meta"><span><Icon name="layers" size={14} />{c.meta.total} 个视频</span></div><span className="tag badge brand">{c.kind === 'season' ? '合集' : '系列'}</span></div>
          <div className="title clamp-2">{c.meta.name}</div>
          <div className="by">{c.meta.description || '—'}</div>
        </button>
      ))}
    </div>
  )
}

function SpaceFavorites({ mid }: { mid: number }) {
  const folders = useAsync(async () => (await juli.favFolders(mid)).list ?? [], [mid])
  const [folder, setFolder] = useState<number>()
  const current = folder ?? folders.data?.[0]?.id
  const list = useAsync(async () => (current ? compact<VideoItem>(((await juli.favResources(current, 1)).medias ?? []).map(videoItem)) : []), [current])
  if (folders.loading) return <Loading />
  if (!folders.data?.length) return <Empty title="没有公开的收藏夹" icon="star" />
  return (
    <div className="shell" style={{ padding: 0, gridTemplateColumns: '200px 1fr' }}>
      <div className="sidenav" style={{ position: 'static' }}>{folders.data.map((f: any) => <a key={f.id} className={f.id === current ? 'active' : ''} onClick={() => setFolder(f.id)} style={{ cursor: 'pointer' }}><Icon name="folder" size={16} /><span className="grow clamp-1">{f.title}</span><span className="faint">{f.media_count}</span></a>)}</div>
      <div>{list.loading ? <Loading /> : <Grid items={list.data ?? []} empty={<Empty title="收藏夹是空的" />} />}</div>
    </div>
  )
}

function SpaceBangumi({ mid }: { mid: number }) {
  const [kind, setKind] = useState<1 | 2>(1)
  const d = useAsync(async () => compact(((await juli.bangumiFollowList(mid, 1, undefined, kind)).list ?? []).map((v: any) => { const it = seasonItem(v); if (it) it.ownerName = v.progress; return it })), [mid, kind])
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Segmented value={kind} onChange={setKind} items={[{ value: 1, label: '追番' }, { value: 2, label: '追剧' }]} />
      {d.loading ? <Loading /> : d.data?.length ? <div className="grid posters">{d.data.map((it) => <PosterCard key={it.id} it={it} />)}</div> : <Empty title={kind === 1 ? '还没有追番' : '还没有追剧'} icon="tv" />}
    </div>
  )
}

function SpaceFollowing({ mid }: { mid: number }) {
  const [pn, setPn] = useState(1)
  const d = useAsync(() => juli.followings(mid, pn, 20), [mid, pn])
  if (d.loading && !d.data) return <Loading />
  return (
    <div>
      {d.data?.list?.length ? <div className="ugrid">{d.data.list.map((u: any) => <UserCard key={u.mid} u={u} right={u.attribute === 6 ? <span className="badge">互相关注</span> : undefined} />)}</div> : <Empty title="还没有关注任何人" icon="users" />}
      <Pager page={pn} total={d.data?.total ?? 0} size={20} onChange={setPn} />
    </div>
  )
}

