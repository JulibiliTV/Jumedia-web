import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useSearchParams } from 'react-router-dom'
import * as juli from '../../api/juli'
import * as jm from '../../api/jumedia'
import { compact, countText, dateTimeText, formatDuration, liveItem, timeText, type VideoItem, videoItem } from '../../api/normalize'
import { type DanmakuSettings, defaultDanmakuSettings } from '../../api/protobuf'
import { medalHex } from '../../components/Medal'
import { Grid, RowCard, UserCard, itemLink } from '../../components/Cards'
import { Icon } from '../../components/Icon'
import { Avatar, confirmDialog, Empty, ErrorState, Loading, LoadMore, Modal, Pager, Segmented, Spinner, Switch, toast, toastError } from '../../components/ui'
import { WATCH_STATUS } from '../../lib/categories'
import { useAsync, useInfinite, useSentinel, useTitle } from '../../lib/hooks'
import { useSession } from '../../lib/session'

/** 「我的」页面都在前台侧栏里，这里只承载子页面。 */
export function AccountLayout() {
  return <Outlet />
}

function Head({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  useTitle(title)
  return <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="row">{children}</div></div>
}

/** 历史记录 — `history/cursor` (max + view_at cursor), `history/shadow`, `shadow/set`, `history/clear`. */
export function History() {
  const paused = useAsync(() => juli.historyShadow().then((v) => !!v), [])
  const feed = useInfinite(async (c: { max: number; view_at: number }) => {
    const d = await juli.historyCursor(c.max, c.view_at, 20)
    const rows: any[] = d.list ?? []
    const items = rows.map((v) => ({ it: v.history?.business === 'pgc' ? { ...videoItem(v)!, kind: 'bangumi' as const } : videoItem(v), raw: v })).filter((x) => x.it) as { it: VideoItem; raw: any }[]
    const next = d.cursor?.max || d.cursor?.view_at ? { max: d.cursor.max, view_at: d.cursor.view_at } : null
    return { items, next: rows.length && next && (next.max !== c.max || next.view_at !== c.view_at) ? next : null }
  }, { max: 0, view_at: 0 }, [])
  const sentinel = useSentinel(feed.more, !feed.loading && !feed.done)
  // 搜索在浏览器本地进行：有关键词时把剩余记录全部取回，再按标题 / 分集 / UP 主筛选。
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  useEffect(() => { if (term && !feed.loading && !feed.done) feed.more() }, [term, feed.loading, feed.done]) // eslint-disable-line react-hooks/exhaustive-deps
  const [kind, setKind] = useState<'' | 'archive' | 'pgc'>('')
  const ofKind = kind ? feed.items.filter(({ raw }) => (raw.history?.business === 'pgc' ? 'pgc' : 'archive') === kind) : feed.items
  const shown = term ? ofKind.filter(({ it, raw }) => [it.title, raw.long_title, raw.author_name, raw.history?.part].some((t) => String(t ?? '').toLowerCase().includes(term))) : feed.items
  const removeOne = async (kid: string, key: string) => {
    try { const x = await jm.historyDelete(kid); if (x.code) throw new Error(x.message); feed.setItems((l) => l.filter((y) => y.it.id + y.raw.view_at !== key)) } catch (e) { toastError(e) }
  }
  const clear = async () => {
    if (!(await confirmDialog('确定清空全部历史记录吗？此操作无法撤销。', { danger: true, ok: '清空' }))) return
    try { await juli.historyClear(); feed.setItems([]); toast('已清空', 'success') } catch (e) { toastError(e) }
  }
  const pause = async (v: boolean) => {
    try { await juli.historyShadowSet(v); paused.mutate(() => v); toast(v ? '已暂停记录历史' : '已恢复记录历史', 'success') } catch (e) { toastError(e) }
  }
  const groups = new Map<string, typeof feed.items>()
  for (const x of shown) {
    const d = new Date(x.raw.view_at * 1000), today = new Date()
    const key = d.toDateString() === today.toDateString() ? '今天' : d.toDateString() === new Date(Date.now() - 86400000).toDateString() ? '昨天' : `${d.getMonth() + 1}月${d.getDate()}日`
    groups.set(key, [...(groups.get(key) ?? []), x])
  }
  return (
    <div className="page">
      <div className="chead">
        <h1>历史记录</h1>
        <span className="grow" />
        <label className="bsearch" style={{ width: 240 }}><form onSubmit={(e) => e.preventDefault()} style={{ height: 36, background: 'var(--surface)' }}><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索历史记录" aria-label="搜索历史记录" /></form></label>
        <button type="button" className="pill" onClick={() => pause(!paused.data)}>{paused.data ? '恢复记录' : '暂停记录'}</button>
        <button type="button" className="pill" style={{ color: 'var(--danger)' }} onClick={clear}>清空</button>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="chips-b">{([['', '全部'], ['archive', '视频'], ['pgc', '番剧']] as const).map(([v, label]) => <button type="button" key={v} className={kind === v ? 'on' : ''} onClick={() => setKind(v)}>{label}</button>)}</div>
        <span className="grow" />
        <span className="row muted" style={{ gap: 6, fontSize: 13 }}><Icon name="tv" size={15} />{paused.data ? '已暂停记录，新的观看不会被保存' : '已与 JulibiliTV 同步'}</span>
      </div>
      {feed.error ? <ErrorState error={feed.error} retry={feed.reload} /> : !feed.loading && !shown.length ? (term ? <Empty title={`没有找到“${q.trim()}”相关的记录`} icon="search" /> : <Empty title="还没有观看记录" icon="history" />) : (
        [...groups].map(([day, list]) => (
          <section key={day} className="stack" style={{ gap: 10 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-2)' }}>{day}</h2>
            <div className="hist">
              {list.map(({ it, raw }) => {
                const pgc = raw.history?.business === 'pgc'
                const target = { ...it, kind: pgc ? 'bangumi' as const : 'video' as const, episodeId: raw.history?.epid || undefined, seasonId: raw.kid }
                const pct = raw.progress === -1 ? 100 : raw.duration ? Math.min(100, (raw.progress / raw.duration) * 100) : 0
                const d = new Date(raw.view_at * 1000)
                return (
                  <Link key={it.id + raw.view_at} to={itemLink(target)} className="hist-row" onClick={(e) => { if ((e.target as HTMLElement).closest('.hist-del')) e.preventDefault() }}>
                    <span className="time">{String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}</span>
                    <span className="art"><img src={it.cover} alt="" loading="lazy" /><span className="bar"><i style={{ width: `${pct}%` }} /></span>{raw.badge && <span className="tag">{raw.badge}</span>}</span>
                    <span className="info">
                      <b>{it.title}{raw.long_title && <span className="faint" style={{ fontWeight: 400 }}> · {raw.long_title}</span>}</b>
                      {!pgc && <span className="up">{raw.author_face && <img src={raw.author_face} alt="" />}{raw.author_name}</span>}
                      <span className="prog"><span style={{ color: raw.progress === -1 ? 'var(--success)' : undefined }}>{raw.progress === -1 ? '已看完' : `看到 ${formatDuration(raw.progress)}`}</span>{raw.videos > 1 && <span>P{raw.history.page} {raw.history.part}</span>}</span>
                    </span>
                    <button type="button" className="hist-del" aria-label="删除这条记录" onClick={() => removeOne(pgc ? `pgc_${raw.kid}` : `archive_${raw.history?.oid}`, it.id + raw.view_at)}><Icon name="x" size={16} /></button>
                  </Link>
                )
              })}
            </div>
          </section>
        ))
      )}
      <div ref={sentinel} />
      <LoadMore loading={feed.loading} done={feed.done} onMore={feed.more} empty={!feed.items.length} />
    </div>
  )
}

/** 稍后再看 — `toview/web` (asc), `toview/v2/dels`. */
export function WatchLater() {
  const [asc, setAsc] = useState(false)
  const [pn, setPn] = useState(1)
  const d = useAsync(() => juli.toviewWeb(pn, asc), [pn, asc])
  const items = compact<VideoItem>((d.data?.list ?? []).map(videoItem))
  const remove = async (aid: number) => {
    try { await juli.toviewDel(aid); d.reload(); toast('已移除', 'success') } catch (e) { toastError(e) }
  }
  return (
    <div>
      <Head title="稍后再看" sub={`共 ${d.data?.count ?? 0} 个视频`}><Segmented value={asc} onChange={(v) => { setAsc(v); setPn(1) }} items={[{ value: false, label: '最近添加' }, { value: true, label: '最早添加' }]} /></Head>
      {d.loading && !d.data ? <Loading /> : !items.length ? <Empty title="稍后再看列表是空的" hint="在视频页点击“稍后再看”即可添加" icon="clock" /> : (
        <div className="stack" style={{ gap: 0 }}>
          {items.map((it, i) => <RowCard key={it.id} it={it} sub={<><span>{countText(it.view)} 播放</span><span>添加于 {timeText(d.data.list[i].add_at)}</span></>} actions={<button className="btn ghost sm" onClick={() => remove(it.aid!)}><Icon name="trash" size={14} />移除</button>} />)}
        </div>
      )}
      <Pager page={pn} total={d.data?.count ?? 0} size={20} onChange={setPn} />
    </div>
  )
}

/** 收藏 — `created/list-all`, `resource/list`, `resource/deal`, folder add/edit/del. */
export function Favorites() {
  const { me } = useSession()
  const folders = useAsync(async () => (await juli.favFolders(me!.mid)).list ?? [], [me?.mid])
  const [current, setCurrent] = useState<number>()
  const [order, setOrder] = useState('mtime')
  const [pn, setPn] = useState(1)
  const [edit, setEdit] = useState<{ id?: number; title: string; intro: string; privacy: number } | null>(null)
  const folder = folders.data?.find((f: any) => f.id === current) ?? folders.data?.[0]
  const res = useAsync(() => (folder ? juli.favResources(folder.id, pn, order) : Promise.resolve(null)), [folder?.id, pn, order])
  const items = compact<VideoItem>((res.data?.medias ?? []).map(videoItem))
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!edit) return
    try {
      if (edit.id) await jm.favFolderEdit(edit.id, edit.title, edit.intro, edit.privacy)
      else await jm.favFolderAdd(edit.title, edit.intro, edit.privacy)
      setEdit(null); folders.reload(); toast('已保存', 'success')
    } catch (err) { toastError(err) }
  }
  const del = async () => {
    if (!folder || !(await confirmDialog(`删除收藏夹“${folder.title}”？其中的内容也会一并移除。`, { danger: true, ok: '删除' }))) return
    try { const r = await jm.favFolderDel(folder.id); if (r.code) throw new Error(r.message); setCurrent(undefined); folders.reload() } catch (err) { toastError(err) }
  }
  const unfav = async (aid: number) => {
    try { await juli.favDeal(aid, folder.id, false); res.reload(); folders.reload() } catch (err) { toastError(err) }
  }
  return (
    <div>
      <Head title="我的收藏"><button className="btn primary" onClick={() => setEdit({ title: '', intro: '', privacy: 0 })}><Icon name="plus" size={15} />新建收藏夹</button></Head>
      {folders.loading ? <Loading /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr', gap: 20, alignItems: 'start' }}>
          <div className="sidenav" style={{ position: 'static' }}>
            {folders.data?.map((f: any) => <a key={f.id} className={f.id === folder?.id ? 'active' : ''} onClick={() => { setCurrent(f.id); setPn(1) }} style={{ cursor: 'pointer' }}><Icon name={f.privacy ? 'lock' : 'folder'} size={16} /><span className="grow clamp-1">{f.title}</span><span className="faint">{f.media_count}</span></a>)}
          </div>
          <div style={{ minWidth: 0 }}>
            {folder && (
              <div className="panel row" style={{ marginBottom: 16, gap: 16 }}>
                <div className="thumb" style={{ width: 140 }}>{res.data?.info?.cover && <img src={res.data.info.cover} alt="" />}</div>
                <div className="grow"><h2 style={{ fontSize: 18 }}>{folder.title}</h2><div className="faint" style={{ fontSize: 13, marginTop: 4 }}>{folder.privacy ? '私密' : '公开'} · {folder.media_count} 个内容 · 创建者 {res.data?.info?.upper?.name}</div>{folder.intro && <p className="muted" style={{ marginTop: 6 }}>{folder.intro}</p>}</div>
                <div className="stack" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => setEdit({ id: folder.id, title: folder.title, intro: folder.intro, privacy: folder.privacy })}><Icon name="edit" size={14} />编辑</button>
                  {folder.attr !== 0 && <button className="btn sm danger" onClick={del}><Icon name="trash" size={14} />删除</button>}
                </div>
              </div>
            )}
            <div className="row between" style={{ marginBottom: 14 }}><span className="faint">{res.data?.info?.media_count ?? 0} 个视频</span><Segmented value={order} onChange={(o) => { setOrder(o); setPn(1) }} items={[{ value: 'mtime', label: '最近收藏' }, { value: 'view', label: '最多播放' }, { value: 'pubtime', label: '最新投稿' }]} /></div>
            {res.loading && !res.data ? <Loading /> : <Grid items={items} empty={<Empty title="收藏夹是空的" icon="star" />} />}
            {items.length > 0 && <div className="row wrap" style={{ marginTop: 12 }}>{items.map((it) => <button key={it.id} className="btn ghost sm" onClick={() => unfav(it.aid!)} title={it.title}><Icon name="x" size={12} />取消收藏：<span className="clamp-1" style={{ maxWidth: 120 }}>{it.title}</span></button>)}</div>}
            <Pager page={pn} total={res.data?.info?.media_count ?? 0} size={20} onChange={setPn} />
          </div>
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? '编辑收藏夹' : '新建收藏夹'} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={save}>
            <div className="field"><label>名称</label><input className="input" value={edit.title} maxLength={20} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required /></div>
            <div className="field"><label>简介</label><textarea className="textarea" value={edit.intro} maxLength={200} onChange={(e) => setEdit({ ...edit, intro: e.target.value })} /></div>
            <label className="check"><input type="checkbox" checked={edit.privacy === 1} onChange={(e) => setEdit({ ...edit, privacy: e.target.checked ? 1 : 0 })} />设为私密（仅自己可见）</label>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn primary">保存</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

/** One followed season from `follow/list`, with Jumedia's progress fields. */
interface Follow {
  season_id: number; title: string; cover: string; badge: string; areas: string; styles: string; index_show: string; is_finish: number
  follow_status: number; renewal_time: string; total_count: number; follow_mtime: number; has_update: boolean
  first_ep: { ep_id: number }; new_ep: { id: number; title: string; pub_time: number }
  last_ep: { ep_id: number; index: string; title: string; position: number; time: number; view_at: number } | null
}
const SORTS = [['update', '最近更新'], ['follow', '最近追番'], ['watch', '最近观看']] as const

/** 我的追番 / 追剧 — every page of `follow/list` is loaded, then filtered and sorted here. */
export function MyBangumi() {
  const { me } = useSession()
  const [params, setParams] = useSearchParams()
  const kind: 1 | 2 = params.get('type') === '2' ? 2 : 1
  const word = kind === 1 ? '追番' : '追剧'
  const unit = kind === 1 ? '话' : '集'
  const [status, setStatus] = useState(0)
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('update')
  const d = useAsync(async () => {
    const all: Follow[] = []
    for (let pn = 1; pn <= 10; pn++) {
      const r = await juli.bangumiFollowList(me!.mid, pn, undefined, kind)
      all.push(...(r.list ?? []))
      if (all.length >= r.total || !r.list?.length) break
    }
    return all
  }, [me?.mid, kind])
  const all = d.data ?? []
  const count = (st: number) => all.filter((v) => !st || v.follow_status === st).length
  const key = (v: Follow) => (sort === 'update' ? v.new_ep?.pub_time ?? 0 : sort === 'follow' ? v.follow_mtime : v.last_ep?.view_at ?? 0)
  const list = all.filter((v) => !status || v.follow_status === status).sort((a, b) => key(b) - key(a))
  const hero = [...all].filter((v) => v.last_ep && v.follow_status !== 3).sort((a, b) => b.last_ep!.view_at - a.last_ep!.view_at)[0]
  const update = async (sid: number, st: number) => { try { await juli.pgcFollowStatus(sid, st); d.reload() } catch (e) { toastError(e) } }
  const unfollow = async (v: Follow) => {
    if (!(await confirmDialog(`取消${word}「${v.title}」？`, { ok: `取消${word}` }))) return
    try { await juli.pgcFollow(v.season_id, false); d.reload() } catch (e) { toastError(e) }
  }
  const fresh = all.filter((v) => v.has_update).length
  useTitle(`我的${word}`)
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row wrap" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}><h1 className="mb-h1">我的{word}</h1><span className="muted" style={{ fontSize: 14 }}>共 {all.length} 部{fresh ? ` · ${fresh} 部有更新` : ''} · 进度与 JulibiliTV 同步</span></div>
        <span className="grow" />
        <span className="pill-seg">{([[1, '追番'], [2, '追剧']] as const).map(([k, l]) => <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => { setStatus(0); setParams(k === 2 ? { type: '2' } : {}) }}>{l}</button>)}</span>
      </div>
      {d.loading && !d.data ? <Loading /> : !all.length ? <Empty title={`还没有${word}`} hint={kind === 1 ? '去番剧页看看有没有喜欢的' : '去电视剧、电影频道看看有没有喜欢的'} icon="tv" action={<Link to={kind === 1 ? '/anime' : '/c/tv'} className="btn">去看看</Link>} /> : <>
        {hero && <FollowHero v={hero} unit={unit} />}
        <div className="row wrap" style={{ gap: 8 }}>
          <div className="chips-b">{[{ value: 0, label: '全部' }, ...WATCH_STATUS].map((t) => <button type="button" key={t.value} className={status === t.value ? 'on' : ''} onClick={() => setStatus(t.value)}>{t.label}<small>{count(t.value)}</small></button>)}</div>
          <span className="grow" />
          <span className="mb-sorts">{SORTS.map(([k, l]) => <button type="button" key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>)}</span>
        </div>
        {!list.length ? <Empty title="这个分类里还没有内容" icon="tv" /> : (
          <div className="mb-grid">{list.map((v) => <FollowCard key={v.season_id} v={v} unit={unit} word={word} onStatus={(st) => update(v.season_id, st)} onUnfollow={() => unfollow(v)} />)}</div>
        )}
      </>}
    </div>
  )
}

/** Where to go from a followed season: the new episode, where the viewer stopped, or the start. */
function followNext(v: Follow) {
  const last = v.last_ep
  if (v.has_update) return { to: `/bangumi/play/ep${v.new_ep.id}`, label: '看新一' }
  if (last && (last.position < v.total_count || last.time !== -1)) return { to: `/bangumi/play/ep${last.ep_id}`, label: '继续看' }
  if (last) return { to: `/bangumi/play/ep${v.first_ep.ep_id}`, label: '重温' }
  return { to: `/bangumi/play/ep${v.first_ep.ep_id}`, label: '开始看' }
}
function followSeen(v: Follow, unit: string) {
  const last = v.last_ep
  if (!last) return '尚未观看'
  if (last.position >= v.total_count && last.time === -1) return `已看完 · ${v.total_count} / ${v.total_count}`
  return `看到第 ${last.index} ${unit}${last.time > 0 ? ` ${formatDuration(last.time)}` : ''} · ${last.position} / ${v.total_count}`
}
const followPct = (v: Follow) => (v.last_ep && v.total_count ? Math.round((v.last_ep.position / v.total_count) * 100) : 0)

/** 继续看: the season watched most recently. */
function FollowHero({ v, unit }: { v: Follow; unit: string }) {
  const last = v.last_ep!
  return (
    <section className="mb-hero">
      <Link to={`/bangumi/play/ss${v.season_id}`} className="mb-poster big"><img src={v.cover} alt="" /></Link>
      <div className="mb-hero-main">
        <span className="mb-kicker">继续看{v.has_update && <span className="mb-new">第 {v.new_ep.title} {unit}已更新</span>}</span>
        <Link to={`/bangumi/play/ss${v.season_id}`} className="mb-hero-title">{v.title}</Link>
        <span className="muted" style={{ fontSize: 13 }}>上次看到第 {last.index} {unit}{last.title && `「${last.title}」`}{last.time > 0 && ` ${formatDuration(last.time)}`}{v.renewal_time && ` · ${v.renewal_time} 更新`}</span>
        <span className="mb-bar big"><i style={{ width: `${followPct(v)}%` }} /></span>
        <span className="row between faint" style={{ fontSize: 12 }}><span>已看 {last.position} / {v.total_count} {unit}</span><span>{v.index_show}</span></span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {v.has_update && <Link to={`/bangumi/play/ep${v.new_ep.id}`} className="mb-btn primary"><Icon name="play" size={14} fill />看第 {v.new_ep.title} {unit}</Link>}
        <Link to={`/bangumi/play/ep${last.ep_id}`} className={`mb-btn ${v.has_update ? '' : 'primary'}`}>{v.has_update ? `从第 ${last.index} ${unit}续播` : <><Icon name="play" size={14} fill />继续看第 {last.index} {unit}</>}</Link>
      </div>
    </section>
  )
}

function FollowCard({ v, unit, word, onStatus, onUnfollow }: { v: Follow; unit: string; word: string; onStatus: (st: number) => void; onUnfollow: () => void }) {
  const [menu, setMenu] = useState(false)
  const next = followNext(v)
  const seen = followSeen(v, unit)
  return (
    <div className="mb-card">
      <Link to={`/bangumi/play/ss${v.season_id}`} className="mb-poster">{<img src={v.cover} alt="" />}{v.has_update && <span className="mb-tag">更新</span>}</Link>
      <div className="mb-body">
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          <Link to={`/bangumi/play/ss${v.season_id}`} className="mb-title">{v.title}</Link>
          <span className="mb-more">
            <button type="button" className="btn ghost sm icon" aria-label="更多" onClick={() => setMenu(!menu)} onBlur={() => setTimeout(() => setMenu(false), 150)}><Icon name="more" size={16} /></button>
            {menu && <span className="mb-menu"><button type="button" onClick={onUnfollow}>取消{word}</button></span>}
          </span>
        </span>
        <span className="mb-meta">{[v.areas, v.styles, v.index_show].filter(Boolean).join(' · ')}</span>
        <span className="mb-bar"><i style={{ width: `${followPct(v)}%` }} /></span>
        <span className={`mb-seen ${v.last_ep ? '' : 'faint'}`}>{seen}</span>
        <span className="grow" />
        <span className="row" style={{ gap: 8 }}>
          <span className="seg3">{WATCH_STATUS.map((w) => <button type="button" key={w.value} className={v.follow_status === w.value ? 'on' : ''} onClick={() => v.follow_status !== w.value && onStatus(w.value)}>{w.label}</button>)}</span>
          <span className="grow" />
          <Link to={next.to} className="mb-go">{next.label === '看新一' ? `看新一${unit}` : next.label}</Link>
        </span>
      </div>
    </div>
  )
}

/** 关注 — `/x/relation/followings`, `/x/relation/modify`. */
export function Following() {
  const { me } = useSession()
  const [pn, setPn] = useState(1)
  const d = useAsync(() => juli.followings(me!.mid, pn, 20), [me?.mid, pn])
  const unfollow = async (mid: number) => { try { await juli.relationModify(mid, false); d.reload(); toast('已取消关注', 'success') } catch (e) { toastError(e) } }
  return (
    <div>
      <Head title="我的关注" sub={`共 ${d.data?.total ?? 0} 位 UP 主`} />
      {d.loading && !d.data ? <Loading /> : !d.data?.list?.length ? <Empty title="还没有关注任何人" icon="users" /> : (
        <div className="ugrid">{d.data.list.map((u: any) => <UserCard key={u.mid} u={{ ...u, extra: `关注于 ${dateTimeText(u.mtime).slice(0, 10)}` }} right={<button className="btn sm soft" onClick={() => unfollow(u.mid)}>{u.attribute === 6 ? '已互粉' : '已关注'}</button>} />)}</div>
      )}
      <Pager page={pn} total={d.data?.total ?? 0} size={20} onChange={setPn} />
    </div>
  )
}

/** 关注的直播 — `/xlive/web-ucenter/user/following`. */
export function LiveFollowing() {
  const d = useAsync(() => juli.liveFollowing(1), [])
  const items = compact((d.data?.list ?? []).map((r: any) => ({ ...liveItem(r)!, reason: r.live_status === 1 ? r.area_v2_name : '未开播' })))
  return (
    <div>
      <Head title="关注的直播" sub={`${d.data?.live_count ?? 0} 位主播正在直播`} />
      {d.loading ? <Loading /> : <Grid items={items} empty={<Empty title="关注的主播都没有直播间" icon="live" />} />}
    </div>
  )
}

/** 账号设置 — profile (`/x/member/web/update`), password, danmaku sync, history and TV login. */
export function Settings() {
  const { me, refresh } = useSession()
  const info = useAsync(() => juli.accInfo(me!.mid), [me?.mid])
  const [f, setF] = useState({ uname: '', sign: '', sex: '保密', birthday: '', face: '' })
  const [busy, setBusy] = useState(false)
  const [pwd, setPwd] = useState({ old: '', next: '' })
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { if (info.data) setF({ uname: info.data.name, sign: info.data.sign, sex: info.data.sex, birthday: '', face: info.data.face }) }, [info.data])
  const filters = useAsync(() => juli.dmFilterUser(), [])
  const [dm, setDm] = useState<DanmakuSettings>(defaultDanmakuSettings)
  useEffect(() => { juli.dmWebView(1).then((s) => s && setDm(s)).catch(() => {}) }, [])
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { const r = await jm.updateProfile(f); if (r.code) throw new Error(r.message); await refresh(); toast('资料已更新', 'success') } catch (err) { toastError(err) } finally { setBusy(false) }
  }
  const upload = async (picked?: File) => {
    if (!picked) return
    try { const d = await jm.uploadFile('image', picked); setF((x) => ({ ...x, face: d.url })) } catch (err) { toastError(err) }
  }
  const savePwd = async (e: FormEvent) => {
    e.preventDefault()
    try { const r = await jm.updatePassword(pwd.old, pwd.next); if (r.code) throw new Error(r.message); setPwd({ old: '', next: '' }); toast('密码已修改', 'success') } catch (err) { toastError(err) }
  }
  const saveDm = async (patch: Partial<DanmakuSettings>) => {
    const next = { ...dm, ...patch }
    setDm(next)
    try { await juli.dmSaveConfig(next) } catch (err) { toastError(err) }
  }
  if (info.loading) return <Loading />
  const ruleCount = (filters.data?.rule?.length ?? 0) + (filters.data?.keyword?.length ?? 0) + (filters.data?.regex?.length ?? 0)
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Head title="账号设置" />
      <form className="panel" onSubmit={saveProfile}>
        <div className="panel-title"><h3>基本资料</h3></div>
        <div className="row" style={{ gap: 18, marginBottom: 20 }}>
          <Avatar src={f.face} size={72} />
          <div><button type="button" className="btn sm" onClick={() => file.current?.click()}><Icon name="image" size={14} />更换头像</button><input ref={file} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} /><div className="faint" style={{ fontSize: 12, marginTop: 6 }}>支持 JPG / PNG，自动裁剪压缩</div></div>
        </div>
        <div className="form-grid">
          <div className="field"><label>昵称</label><input className="input" value={f.uname} maxLength={16} onChange={(e) => setF({ ...f, uname: e.target.value })} /></div>
          <div className="field"><label>性别</label><select className="select" value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option>男</option><option>女</option><option>保密</option></select></div>
          <div className="field"><label>生日</label><input className="input" type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></div>
          <div className="field"><label>UID</label><input className="input" value={me?.mid} disabled /></div>
          <div className="field span-2"><label>个性签名</label><textarea className="textarea" value={f.sign} maxLength={70} onChange={(e) => setF({ ...f, sign: e.target.value })} /><span className="hint">{f.sign.length}/70</span></div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn primary" disabled={busy}>{busy ? <Spinner size={14} /> : '保存资料'}</button></div>
      </form>

      <div className="panel">
        <div className="panel-title"><h3>弹幕偏好</h3><span className="faint" style={{ fontSize: 13 }}>在网页与 JulibiliTV 之间同步</span></div>
        <div className="form-grid">
          {([['enabled', '显示弹幕'], ['showScroll', '滚动弹幕'], ['showTop', '顶部弹幕'], ['showBottom', '底部弹幕'], ['showColor', '彩色弹幕'], ['smartFilter', '智能屏蔽'], ['avoidSubtitles', '防挡字幕'], ['avoidPeople', '防挡人像']] as const).map(([k, label]) => (
            <label key={k} className="row between" style={{ height: 36 }}><span>{label}</span><Switch on={dm[k]} onChange={(v) => saveDm({ [k]: v })} /></label>
          ))}
          <div className="field"><label>不透明度 {Math.round(dm.opacity * 100)}%</label><input type="range" min={0.1} max={1} step={0.05} value={dm.opacity} onChange={(e) => setDm({ ...dm, opacity: +e.target.value })} onMouseUp={() => saveDm({})} /></div>
          <div className="field"><label>显示区域 {dm.area}%</label><input type="range" min={25} max={100} step={25} value={dm.area} onChange={(e) => setDm({ ...dm, area: +e.target.value })} onMouseUp={() => saveDm({})} /></div>
        </div>
        <p className="faint" style={{ fontSize: 13, marginTop: 12 }}>云端屏蔽规则：{ruleCount} 条</p>
      </div>

      <form className="panel" onSubmit={savePwd}>
        <div className="panel-title"><h3>修改密码</h3></div>
        <div className="form-grid">
          <div className="field"><label>原密码</label><input className="input" type="password" value={pwd.old} onChange={(e) => setPwd({ ...pwd, old: e.target.value })} autoComplete="current-password" required /></div>
          <div className="field"><label>新密码</label><input className="input" type="password" value={pwd.next} minLength={6} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} autoComplete="new-password" required /></div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn">更新密码</button></div>
      </form>

      <div className="panel row between">
        <div><h3 style={{ fontSize: 16 }}>在电视上登录</h3><p className="faint" style={{ fontSize: 13, marginTop: 4 }}>在 JulibiliTV 选择 Jumedia 数据源，用手机打开电视上的二维码链接即可确认登录。</p></div>
        <Link to="/tv-login" className="btn"><Icon name="qr" size={16} />扫码登录说明</Link>
      </div>
    </div>
  )
}

/** 粉丝勋章 — `/xlive/app-ucenter/v1/fansMedal/panel`, `fansMedal/wear`, `fansMedal/take_off`. */
export function FanMedals() {
  useTitle('我的粉丝勋章')
  const d = useAsync(() => jm.medalPanel(1), [])
  const [sort, setSort] = useState<'level' | 'recent' | 'live'>('level')
  type Row = { medal: { medal_id: number; medal_name: string; level: number; intimacy: number; next_intimacy: number; today_feed: number; day_limit: number; wearing_status: number; total_intimacy: number }; anchor_info: { nick_name: string; avatar: string }; room_info: { room_id: number; living_status: number } }
  const rows: Row[] = [...(d.data?.special_list ?? []), ...(d.data?.list ?? [])]
  const wearing = rows.find((r) => r.medal.wearing_status)
  const others = rows.filter((r) => r !== wearing).sort((a, b) => sort === 'live' ? b.room_info.living_status - a.room_info.living_status || b.medal.level - a.medal.level : sort === 'recent' ? b.medal.medal_id - a.medal.medal_id : b.medal.total_intimacy - a.medal.total_intimacy)
  const act = async (fn: () => Promise<any>, msg: string) => { try { const x = await fn(); if (x.code) throw new Error(x.message); d.reload(); toast(msg, 'success') } catch (e) { toastError(e) } }
  const chip = (r: Row, lg = false) => <span className={`medal ${lg ? 'lg' : ''}`} style={{ borderColor: medalHex(r.medal.level) }}><span style={{ background: medalHex(r.medal.level) }}>{r.medal.medal_name}</span><b style={{ color: medalHex(r.medal.level) }}>{r.medal.level}</b></span>
  const pct = (r: Row) => `${Math.min(100, (r.medal.intimacy / Math.max(1, r.medal.next_intimacy)) * 100)}%`
  return (
    <div className="page" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 4 }}><h1 style={{ fontSize: 26, fontWeight: 800 }}>我的粉丝勋章</h1><span className="muted" style={{ fontSize: 14 }}>共 {rows.length} 枚 · 佩戴的勋章会显示在你发的弹幕前面</span></div>
      {d.loading && !d.data ? <Loading /> : !rows.length ? <Empty title="还没有粉丝勋章" hint="在直播间点「加入粉丝团」就能获得主播的勋章" icon="live" action={<Link to="/live" className="btn">去看直播</Link>} /> : <>
        {wearing && (
          <section className="ds-card" style={{ border: '2px solid var(--accent)', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
            {chip(wearing, true)}
            <div className="stack" style={{ flex: '1 1 280px', minWidth: 0, gap: 6 }}>
              <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 700 }}><img src={wearing.anchor_info.avatar} alt="" style={{ width: 24, height: 24, borderRadius: '50%' }} />{wearing.anchor_info.nick_name}{!!wearing.room_info.living_status && <span className="live-badge">直播中</span>}<span className="log-tag" style={{ background: 'var(--accent-soft)', color: '#e0447a' }}>佩戴中</span></span>
              <span className="up-bar" style={{ height: 6 }}><i style={{ width: pct(wearing), background: medalHex(wearing.medal.level) }} /></span>
              <span className="row between muted" style={{ fontSize: 12 }}><span>亲密度 {wearing.medal.intimacy} / {wearing.medal.next_intimacy} · 今日 +{wearing.medal.today_feed} / {wearing.medal.day_limit}</span><span>距离 {wearing.medal.level + 1} 级还差 {Math.max(0, wearing.medal.next_intimacy - wearing.medal.intimacy)}</span></span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {!!wearing.room_info.room_id && <Link to={`/live/${wearing.room_info.room_id}`} className="pill-accent">进入直播间</Link>}
              <button type="button" className="pill" onClick={() => act(() => jm.medalTakeOff(), '已取消佩戴')}>取消佩戴</button>
            </div>
          </section>
        )}
        <div className="chips-b">{([['level', '按等级'], ['recent', '最近获得'], ['live', '正在直播']] as const).map(([v, l]) => <button type="button" key={v} className={sort === v ? 'on' : ''} onClick={() => setSort(v)}>{l}</button>)}</div>
        <div className="g3">
          {others.map((r) => (
            <div key={r.medal.medal_id} className="ds-card" style={{ padding: 16, gap: 12 }}>
              <div className="row" style={{ gap: 10 }}>
                <img src={r.anchor_info.avatar} alt="" style={{ width: 40, height: 40, borderRadius: '50%' }} />
                <span className="stack grow" style={{ minWidth: 0, gap: 2 }}><b className="clamp-1" style={{ fontSize: 14 }}>{r.anchor_info.nick_name}</b><span style={{ fontSize: 12, color: r.room_info.living_status ? 'var(--accent)' : 'var(--text-3)' }}>{r.room_info.living_status ? '直播中' : '未开播'}</span></span>
                {chip(r)}
              </div>
              <span className="up-bar"><i style={{ width: pct(r), background: medalHex(r.medal.level) }} /></span>
              <span className="row between faint" style={{ fontSize: 12 }}><span>亲密度 {r.medal.intimacy} / {r.medal.next_intimacy}</span><span>今日 +{r.medal.today_feed}</span></span>
              <span className="row" style={{ gap: 8 }}>
                <button type="button" className="soft-btn" style={{ flex: 1, height: 32, justifyContent: 'center', borderRadius: 8 }} onClick={() => act(() => jm.medalWear(r.medal.medal_id), '已佩戴')}>佩戴</button>
                {!!r.room_info.room_id && <Link to={`/live/${r.room_info.room_id}`} className="sm-btn" style={{ flex: 1 }}>进入直播间</Link>}
              </span>
            </div>
          ))}
        </div>
      </>}
      <section className="ds-card muted" style={{ gap: 6, fontSize: 13, lineHeight: 1.7, padding: '16px 20px' }}>
        <b style={{ fontSize: 15, color: 'var(--text)' }}>怎么升级</b>
        <span>· 在直播间点「加入粉丝团」获得这位主播的勋章</span>
        <span>· 在主播的直播间发弹幕，每条 +5 亲密度，每天最多 +100</span>
        <span>· 等级越高，勋章颜色越亮；30 天不互动亲密度会慢慢下降</span>
      </section>
    </div>
  )
}
