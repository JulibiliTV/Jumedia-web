import { type DragEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as juli from '../../api/juli'
import * as jm from '../../api/jumedia'
import { countText, dateTimeText, formatDuration, timeText } from '../../api/normalize'
import { AreaChart } from '../../components/Chart'
import { type DataSource, DataSourceCard, DataSourceEditor, useSyncPolling } from '../../components/DataSources'
import { DataSourceImport } from '../../components/DataSourceImport'
import { CacheStatus, cacheBusy, StreamSourceEditor } from '../../components/StreamSource'
import { Icon } from '../../components/Icon'
import { ConsoleFrame, ConsoleNav } from '../../components/Layout'
import { confirmDialog, Empty, ErrorState, Loading, Modal, Pager, Spinner, Switch, toast, toastError } from '../../components/ui'
import { useAsync, useTitle } from '../../lib/hooks'
import { useSession } from '../../lib/session'

const CREATOR_NAV = [
  { group: '创作中心', items: [{ to: '/creator', icon: 'home', label: '首页', end: true }, { to: '/creator/archives', icon: 'film', label: '稿件管理' }, { to: '/creator/collections', icon: 'layers', label: '合集管理' }, { to: '/creator/datasources', icon: 'box', label: '数据源' }, { to: '/creator/live', icon: 'live', label: '直播设置' }] },
  { group: '互动', items: [{ to: '/account/following', icon: 'users', label: '我的关注' }] },
]

export function CreatorLayout() {
  return <ConsoleFrame nav={<ConsoleNav area="creator" groups={CREATOR_NAV} />}><Outlet /></ConsoleFrame>
}

export function CreatorHome() {
  useTitle('创作中心')
  const { me } = useSession()
  const d = useAsync(() => jm.creatorStat(), [])
  const audit = useAsync(async () => (await jm.creatorArchives({ pn: 1, ps: 1 })).class as { is_pubing: number; not_pubed: number; missing: number }, [])
  // Data-source videos waiting for review, per source (they also count in is_pubing).
  const fromSources = useAsync(async () => {
    const rows: any[] = (await jm.creatorArchives({ pn: 1, ps: 50, status: 'is_pubing', origin: 'datasource' })).arc_audits ?? []
    const by = new Map<string, number>()
    for (const r of rows) by.set(r.origin?.datasource_name ?? '', (by.get(r.origin?.datasource_name ?? '') ?? 0) + 1)
    return [...by]
  }, [])
  // 最新评论：取热门稿件的评论，按时间合并。
  const comments = useAsync(async () => {
    const top: { aid: number; title: string }[] = (d.data?.top ?? []).slice(0, 4)
    const lists = await Promise.all(top.map(async (a) => ((await juli.replies(a.aid, 1, 20, 0)).replies ?? []).map((r: any) => ({ ...r, on: a.title }))))
    return lists.flat().sort((a: any, b: any) => b.ctime - a.ctime).slice(0, 4) as { rpid: number; ctime: number; member: { uname: string; avatar: string }; content: { message: string }; on: string }[]
  }, [d.data])
  const [metric, setMetric] = useState<'view' | 'fans'>('view')
  if (d.loading) return <Loading />
  if (d.error) return <ErrorState error={d.error} retry={d.reload} />
  const s = d.data
  const cards = [
    { k: '粉丝', icon: 'users', v: s.total_fans, d: `昨日 +${s.incr_fans}`, up: true }, { k: '播放', icon: 'play', v: s.total_click, d: `昨日 +${countText(s.incr_click)}`, up: true },
    { k: '点赞', icon: 'thumb', v: s.total_like }, { k: '投币', icon: 'coin', v: s.total_coin }, { k: '收藏', icon: 'star', v: s.total_fav },
    { k: '评论', icon: 'comment', v: s.total_reply }, { k: '弹幕', icon: 'danmaku', v: s.total_dm }, { k: '分享', icon: 'share', v: s.total_share },
  ]
  const series: { date: string; view: number; fans: number }[] = s.series ?? []
  const total = series.reduce((n, x) => n + x[metric], 0)
  const growth = metric === 'view' && s.prev_view > 0 ? Math.round(((total - s.prev_view) / s.prev_view) * 100) : null
  const sourcePending = (fromSources.data ?? []).reduce((n, [, k]) => n + k, 0)
  const uploadPending = (audit.data?.is_pubing ?? 0) - sourcePending
  const todos = [
    uploadPending > 0 ? { text: `${uploadPending} 个稿件审核中`, to: '/creator/archives?status=is_pubing', color: 'var(--warning)', bg: 'var(--warning-soft)', go: '查看' } : null,
    audit.data?.not_pubed ? { text: `${audit.data.not_pubed} 个稿件被退回`, to: '/creator/archives?status=not_pubed', color: 'var(--danger)', bg: 'var(--danger-soft)', go: '修改' } : null,
    ...(fromSources.data ?? []).map(([name, n]) => ({ text: `数据源「${name}」有 ${n} 个新视频待审核`, to: '/creator/archives?status=is_pubing&origin=datasource', color: 'var(--brand)', bg: 'var(--bg)', go: '查看' })),
    audit.data?.missing ? { text: `${audit.data.missing} 个稿件的源文件已从数据源移除`, to: '/creator/archives?status=missing', color: 'var(--brand)', bg: 'var(--bg)', go: '查看' } : null,
  ].filter(Boolean) as { text: string; to: string; color: string; bg: string; go: string }[]
  return (
    <div className="page">
      <div className="chead">
        <div><h1>你好，{me?.uname}</h1><p>已发布 {s.archive_count} 个稿件 · 硬币余额 {Math.floor(s.coins)}</p></div>
        <span className="grow" />
        <Link to="/creator/upload" className="btn primary" style={{ height: 38, borderRadius: 19, padding: '0 18px' }}><Icon name="upload" size={16} />发布新视频</Link>
      </div>
      <div className="g4" style={{ gap: 16 }}>
        {cards.map((c) => <div key={c.k} className="kpi"><span className="k"><Icon name={c.icon} size={15} />{c.k}</span><b>{countText(c.v)}</b><span className="d" style={{ color: c.up ? 'var(--success)' : undefined }}>{c.d ?? '累计'}</span></div>)}
      </div>
      <section className="card-sec" style={{ gap: 14 }}>
        <div className="row wrap" style={{ gap: 12 }}>
          <h2 className="h2">近 14 日{metric === 'view' ? '播放' : '涨粉'}趋势</h2>
          <span className="muted" style={{ fontSize: 13 }}>共 {countText(total)} {metric === 'view' ? '次播放' : '位新粉丝'}{growth !== null && <>，比前 14 日 <b style={{ color: growth >= 0 ? 'var(--success)' : 'var(--danger)' }}>{growth >= 0 ? '+' : ''}{growth}%</b></>}</span>
          <span className="grow" />
          <span className="seg-pill"><button type="button" className={metric === 'view' ? 'on' : ''} onClick={() => setMetric('view')}>播放</button><button type="button" className={metric === 'fans' ? 'on' : ''} onClick={() => setMetric('fans')}>涨粉</button></span>
        </div>
        <AreaChart data={series} x="date" y={metric} height={200} />
      </section>
      <div className="cols-21">
        <section className="card-sec" style={{ gap: 4 }}>
          <div className="row between" style={{ marginBottom: 8 }}><h2 style={{ fontSize: 17, fontWeight: 800 }}>热门稿件</h2><Link to="/creator/archives" className="muted" style={{ fontSize: 13 }}>全部稿件 ›</Link></div>
          {s.top.length ? s.top.map((a: any, i: number) => (
            <Link key={a.aid} to={`/video/${a.bvid}`} className="row" style={{ gap: 14, padding: '10px 0', borderTop: i ? '1px solid var(--line)' : 0, color: 'var(--text)' }}>
              <img src={a.pic} alt="" style={{ width: 128, aspectRatio: '16/10', objectFit: 'cover', borderRadius: 8, flex: 'none' }} />
              <span className="stack grow" style={{ gap: 6, minWidth: 0 }}>
                <b className="clamp-1" style={{ fontSize: 14 }}>{a.title}</b>
                <span className="row wrap muted" style={{ gap: '4px 16px', fontSize: 12 }}><span>播放 {countText(a.stat.view)}</span><span>点赞 {countText(a.stat.like)}</span><span>投币 {countText(a.stat.coin)}</span><span>收藏 {countText(a.stat.favorite)}</span><span>评论 {countText(a.stat.reply)}</span></span>
              </span>
            </Link>
          )) : <Empty title="还没有发布稿件" action={<Link to="/creator/upload" className="btn">去投稿</Link>} />}
        </section>
        <div className="stack" style={{ gap: 16 }}>
          <section className="card-sec" style={{ gap: 10 }}>
            <h2>待处理</h2>
            {todos.length ? todos.map((t) => <Link key={t.text} to={t.to} className="row" style={{ gap: 10, padding: '10px 12px', borderRadius: 10, background: t.bg, color: 'var(--text)', fontSize: 13 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: t.color, flex: 'none' }} /><span className="grow">{t.text}</span><span className="muted" style={{ fontSize: 12 }}>{t.go} ›</span></Link>)
              : <span className="faint" style={{ fontSize: 13 }}>没有待处理的事项</span>}
          </section>
          <section className="card-sec" style={{ gap: 14 }}>
            <div className="row between"><h2>最新评论</h2><span className="muted" style={{ fontSize: 12 }}>今天 {s.reply_today ?? 0} 条</span></div>
            {comments.data?.length ? comments.data.map((c) => (
              <div key={c.rpid} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <img src={c.member?.avatar} alt="" style={{ width: 32, height: 32, borderRadius: '50%', flex: 'none' }} />
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{c.member?.uname} <span className="faint" style={{ fontWeight: 400 }}>· {timeText(c.ctime)}</span></span>
                  <span style={{ fontSize: 13, lineHeight: 1.6 }}>{c.content?.message}</span>
                  <span className="muted clamp-1" style={{ fontSize: 12 }}>在 {c.on}</span>
                </span>
              </div>
            )) : <span className="faint" style={{ fontSize: 13 }}>还没有评论</span>}
          </section>
        </div>
      </div>
    </div>
  )
}

interface Part { key: string; name: string; filename?: string; title: string; duration: number; progress: number; error?: string; preview?: string }

/** Duration plus a frame one third in, as a JPEG blob (uploaded as the default cover). */
/** Local date (YYYY-MM-DD) and time (HH:MM) inputs for a unix time. */
function splitTime(t: number) {
  const d = new Date(t * 1000), p = (n: number) => String(n).padStart(2, '0')
  return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, clock: `${p(d.getHours())}:${p(d.getMinutes())}` }
}

function probeDuration(file: File): Promise<{ duration: number; poster?: Blob }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'; v.muted = true
    v.src = URL.createObjectURL(file)
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, v.duration / 3) }
    v.onseeked = () => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 400
      try { c.getContext('2d')!.drawImage(v, 0, 0, 640, 400); c.toBlob((b) => resolve({ duration: v.duration, poster: b ?? undefined }), 'image/jpeg', 0.85) } catch { resolve({ duration: v.duration }) }
      URL.revokeObjectURL(v.src)
    }
    v.onerror = () => resolve({ duration: 0 })
  })
}

/** 投稿 / 编辑 — upload files, then `/x/vu/web/add/v3` or `/x/vu/web/edit`. */
export function Upload() {
  const { aid } = useParams()
  const { me } = useSession()
  return <UploadForm key={`${me?.mid ?? ''}/${aid ?? 'new'}`} />
}

function UploadForm() {
  const { aid } = useParams()
  const editing = !!aid
  useTitle(editing ? '编辑稿件' : '投稿')
  const nav = useNavigate()
  const regions = useAsync(() => juli.regionList(), [])
  const seasons = useAsync(async () => ((await jm.creatorSeasons()).seasons ?? []).filter((s: any) => s.kind === 'season'), [])
  const [parts, setParts] = useState<Part[]>([])
  const [query] = useSearchParams()
  const [form, setForm] = useState({ title: '', tid: Number(query.get('tid') ?? 0), sub_tid: 0, tag: '', desc: '', cover: '', copyright: 1, source: '', season_id: 0, no_disturbance: 0, no_tv: 0 })
  // 定时发布: off by default; turning it on proposes three hours from now on the half hour.
  const [schedule, setSchedule] = useState<{ on: boolean; day: string; clock: string }>(() => ({ on: false, ...splitTime(Math.ceil((Date.now() / 1000 + 3 * 3600) / 1800) * 1800) }))
  const [archState, setArchState] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const { me } = useSession()
  const tags = form.tag.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
  const setTags = (list: string[]) => setForm((f) => ({ ...f, tag: list.join(',') }))
  const [tagDraft, setTagDraft] = useState('')
  const addTag = (t: string) => { const v = t.trim(); setTagDraft(''); if (v && !tags.includes(v) && tags.length < 10) setTags([...tags, v]) }
  const [chapters, setChapters] = useState<{ from: number; to: number; content: string }[]>([])
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [over, setOver] = useState(false)
  const [frames, setFrames] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const subs: { tid: number; name: string }[] = (regions.data ?? []).find((r: any) => r.tid === form.tid)?.children ?? []
  const fileInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!aid) return
    let live = true
    jm.creatorArchive(Number(aid)).then((d) => {
      if (!live) return
      const a = d.Archive
      setForm({ title: a.title, tid: a.tid, sub_tid: a.sub_tid ?? 0, tag: a.tag, desc: a.desc, cover: a.cover, copyright: a.copyright, source: a.source ?? '', season_id: d.season_id, no_disturbance: a.no_disturbance ?? 0, no_tv: a.no_tv ?? 0 })
      setArchState(a.state)
      if (a.dtime) setSchedule({ on: true, ...splitTime(a.dtime) })
      setParts(d.Videos.map((v: any) => ({ key: String(v.cid), name: v.title, filename: v.filename, title: v.title, duration: v.duration, progress: 1 })))
      setChapters(d.chapters ?? [])
      setOrigin(d.origin ?? null)
    }).catch(e => { if (live) toastError(e) })
    return () => { live = false }
  }, [aid, me?.mid])
  const resetOrigin = async () => {
    if (!origin || !(await confirmDialog(`将${origin.locked.map((f) => FIELD_LABEL[f]).join('、')}恢复为源媒体库中的信息？`, { ok: '恢复' }))) return
    try {
      const d = await jm.archiveOriginReset(Number(aid))
      const a = d.data.Archive
      setForm((f) => ({ ...f, title: a.title, tid: a.tid, tag: a.tag, desc: a.desc, cover: a.cover }))
      setOrigin(d.data.origin)
      toast('已恢复媒体库元信息', 'success')
    } catch (e) { toastError(e) }
  }

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('video/')) { toast(`${file.name} 不是视频文件`, 'error'); continue }
      const key = Math.random().toString(36).slice(2)
      const name = file.name.replace(/\.[^.]+$/, '')
      setParts((l) => [...l, { key, name: file.name, title: name, duration: 0, progress: 0 }])
      setForm((f) => (f.title ? f : { ...f, title: name.slice(0, 80) }))
      const meta = await probeDuration(file)
      // The captured frame is uploaded straight away, so the form only ever holds a server URL.
      if (meta.poster) jm.uploadFile('image', new File([meta.poster], 'cover.jpg', { type: 'image/jpeg' })).then((d) => { setFrames((l) => [...l, d.url]); setForm((f) => (f.cover ? f : { ...f, cover: d.url })) }).catch(() => {})
      try {
        let ratio = 0
        const tick = setInterval(() => { ratio = Math.min(0.92, ratio + 0.08); setParts((l) => l.map((p) => (p.key === key ? { ...p, progress: ratio } : p))) }, 120)
        const d = await jm.uploadFile('video', file).finally(() => clearInterval(tick))
        setParts((l) => l.map((p) => (p.key === key ? { ...p, filename: d.filename, duration: Math.round(meta.duration), progress: 1 } : p)))
      } catch (e) {
        setParts((l) => l.map((p) => (p.key === key ? { ...p, error: (e as Error).message } : p)))
      }
    }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }
  const pickCover = async (file?: File) => {
    if (!file) return
    try { const d = await jm.uploadFile('image', file); setForm((f) => ({ ...f, cover: d.url })) } catch (e) { toastError(e) }
  }
  const move = (i: number, d: number) => setParts((l) => { const n = [...l]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n })
  const dtime = schedule.on ? Math.floor(new Date(`${schedule.day}T${schedule.clock}`).getTime() / 1000) : 0
  // A published archive keeps its publish time, so scheduling only applies before that.
  const canSchedule = archState === null || archState !== 0
  const canDraft = archState === null || archState === -20
  const submit = async (e: FormEvent | null, draft = false) => {
    e?.preventDefault()
    if (parts.some((p) => !p.filename && !p.error)) return toast('请等待视频上传完成', 'error')
    if (!draft && !form.tid) return toast('请选择分区', 'error')
    if (!draft && schedule.on && canSchedule && !(dtime >= Date.now() / 1000 + 2 * 3600 - 60 && dtime <= Date.now() / 1000 + 15 * 86400)) return toast('定时发布时间需在 2 小时后、15 天内', 'error')
    setBusy(true)
    try {
      const cover = form.cover
      const r = await jm.archiveSubmit({ aid: aid ? Number(aid) : undefined, ...form, cover, sub_tid: form.sub_tid || undefined, season_id: form.season_id || undefined, dtime: schedule.on && canSchedule ? dtime : 0, draft: draft ? 1 : undefined, videos: parts.filter((p) => p.filename).map((p) => ({ filename: p.filename!, title: p.title, duration: p.duration })), chapters })
      if (r.code) throw new Error(r.message)
      toast(r.data.state === -20 ? '草稿已保存' : r.data.state === 0 ? '发布成功' : r.data.state === -40 ? `已定时，将于 ${dateTimeText(dtime)} 发布` : '已提交，等待审核', 'success')
      if (draft && !aid) nav(`/creator/upload/${r.data.aid}`, { replace: true })
      else if (draft) setArchState(-20)
      else nav('/creator/archives')
    } catch (err) { toastError(err) } finally { setBusy(false) }
  }


  const total = parts.reduce((n, p) => n + (p.duration || 0), 0)
  const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  const secs = (v: string) => { const [m, x] = v.split(':').map(Number); return Number.isFinite(m) ? m * 60 + (Number.isFinite(x) ? x : 0) : 0 }
  const regionLabel = (tid: number) => (regions.data ?? []).find((r: any) => r.tid === tid)?.name ?? ''
  const suggest = [regionLabel(form.tid), ...subs.map((x) => x.name)].filter((t) => t && !tags.includes(t)).slice(0, 3)
  return (
    <>
    {importing && <DataSourceImport onClose={() => setImporting(false)} />}
    <form onSubmit={submit} className="up-layout">
        <div className="up-heading stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>{editing ? '编辑稿件' : '填写稿件信息'}</h1>
          {(!editing || !origin) && <span className="muted" style={{ fontSize: 14 }}>{editing ? '修改后将重新进入审核' : '支持 MP4 / MOV / MKV / WebM，可一次上传多个分 P'}</span>}
        </div>
        {!editing && !parts.length && <button type="button" className="up-source-action btn" onClick={() => setImporting(true)}><Icon name="box" size={16} />从数据源获取视频</button>}

      <div className="up-main stack" style={{ minWidth: 0, gap: 16 }}>
        <section className="sec" style={{ gap: 12 }}>
          <div className="row between">
            <h2>视频文件（{parts.length} P）</h2>
            {origin ? <span className="log-tag">数据源：<strong>{origin.datasource_name}{origin.library && ` > ${origin.library}`}</strong></span>
              : <button type="button" className="sm-btn" onClick={() => fileInput.current?.click()}><Icon name="plus" size={14} />添加分 P</button>}
          </div>
          {origin?.missing && <div className="ds-err">该视频已不在源媒体库中（或所在媒体库已停用），当前不会对外显示。</div>}
          {!parts.length && !origin && (
            <div className={`up-drop ${over ? 'over' : ''}`} onClick={() => fileInput.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
              <Icon name="upload" size={32} style={{ color: 'var(--brand)' }} /><b>拖拽视频到这里，或点击选择文件</b><span>可一次选择多个文件，每个文件是一个分 P</span>
            </div>
          )}
          {parts.map((p, i) => {
            const done = p.progress >= 1 && !p.error
            const color = p.error ? '#c43f3b' : done ? 'var(--success)' : 'var(--brand)'
            return (
              <div key={p.key} className="up-part" onDragOver={(e) => e.preventDefault()}>
                <span className="pn">P{i + 1}</span>
                <span className="stack grow" style={{ minWidth: 0, gap: 6 }}>
                  <span className="row" style={{ gap: 10, alignItems: 'baseline', minWidth: 0 }}>
                    {origin ? <b style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</b> : <input className="up-title" value={p.title} onChange={(ev) => setParts((l) => l.map((x) => (x.key === p.key ? { ...x, title: ev.target.value } : x)))} />}
                    <span className="faint clamp-1" style={{ fontSize: 12 }}>{p.name}{p.duration ? ` · ${formatDuration(p.duration)}` : ''}</span>
                  </span>
                  <span className="up-bar"><i style={{ width: `${(p.error ? 1 : p.progress) * 100}%`, background: color }} /></span>
                </span>
                <span className="st" style={{ color }}>{p.error ? p.error : done ? '上传完成' : `${Math.round(p.progress * 100)}% · 上传中`}</span>
                {!origin && <span className="row" style={{ gap: 2 }}>
                  <button type="button" className="icon-b" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移"><Icon name="arrow-up" size={14} /></button>
                  <button type="button" className="icon-b" disabled={i === parts.length - 1} onClick={() => move(i, 1)} aria-label="下移"><Icon name="arrow-down" size={14} /></button>
                  <button type="button" className="icon-b" onClick={() => setParts((l) => l.filter((x) => x.key !== p.key))} aria-label="移除"><Icon name="x" size={14} /></button>
                </span>}
              </div>
            )
          })}
          {origin && origin.locked.length > 0 && <div className="row between wrap" style={{ fontSize: 13 }}><span>已在 Jumedia 中修改：{origin.locked.map((f) => FIELD_LABEL[f]).join('、')}</span><button type="button" className="sm-btn" onClick={resetOrigin}><Icon name="refresh" size={14} />恢复媒体库元信息</button></div>}
          <input ref={fileInput} type="file" accept="video/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </section>

        <section className="sec" style={{ gap: 18 }}>
          <h2>基本信息</h2>
          <div className="stack" style={{ gap: 8 }}>
            <span className="lbl">封面</span>
            <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
              <span className="up-cover">{form.cover ? <img src={form.cover} alt="" /> : <span className="faint" style={{ fontSize: 12 }}>上传视频后自动截取</span>}<span className="cap">当前封面</span></span>
              <span className="stack" style={{ gap: 6 }}>
                {frames.length > 0 && <span className="muted" style={{ fontSize: 12 }}>从视频中截取</span>}
                <span className="row" style={{ gap: 8 }}>
                  {frames.filter((f) => f !== form.cover).slice(0, 2).map((f) => <button type="button" key={f} className="up-frame" onClick={() => setForm({ ...form, cover: f })}><img src={f} alt="" /></button>)}
                  <button type="button" className="up-frame add" onClick={() => coverInput.current?.click()}>上传图片</button>
                </span>
              </span>
            </div>
            <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => pickCover(e.target.files?.[0])} />
          </div>
          <div className="f2" style={{ gap: '18px 20px' }}>
            <label className="stack" style={{ gridColumn: '1 / -1', gap: 6 }}><span className="lbl">标题</span><span className="inp"><input value={form.title} maxLength={80} onChange={(e) => setForm({ ...form, title: e.target.value })} required /><small>{form.title.length}/80</small></span></label>
            <label className="stack" style={{ gap: 6 }}><span className="lbl">分区</span>
              <span className="inp"><select value={`${form.tid}:${form.sub_tid}`} onChange={(e) => { const [tid, sub] = e.target.value.split(':').map(Number); setForm({ ...form, tid, sub_tid: sub }) }} required>
                <option value="0:0">请选择分区</option>
                {(regions.data ?? []).map((r: any) => <optgroup key={r.tid} label={r.name}><option value={`${r.tid}:0`}>{r.name}</option>{(r.children ?? []).map((c: any) => <option key={c.tid} value={`${r.tid}:${c.tid}`}>{r.name} · {c.name}</option>)}</optgroup>)}
              </select></span>
            </label>
            {!origin && <div className="stack" style={{ gap: 6 }}><span className="lbl">类型</span>
              <span className="row" style={{ height: 40, gap: 20 }}>{[{ v: 1, l: '自制' }, { v: 2, l: '转载' }].map((o) => <label key={o.v} className="up-radio" style={{ color: form.copyright === o.v ? 'var(--text)' : 'var(--text-2)' }}><input type="radio" name="copyright" checked={form.copyright === o.v} onChange={() => setForm({ ...form, copyright: o.v })} /><i />{o.l}</label>)}</span>
            </div>}
            {form.copyright === 2 && !origin && <label className="stack" style={{ gridColumn: '1 / -1', gap: 6 }}><span className="lbl">转载来源</span><span className="inp"><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="请注明原作者与出处链接" required /></span></label>}
            <div className="stack" style={{ gridColumn: '1 / -1', gap: 6 }}>
              <span className="lbl">标签 <span className="faint" style={{ fontWeight: 400 }}>{tags.length}/10</span></span>
              <div className="tag-input">
                {tags.map((t) => <span key={t} className="up-tag">{t}<button type="button" aria-label={`删除标签 ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}><Icon name="x" size={12} /></button></span>)}
                {tags.length < 10 && <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="按回车添加标签" onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); addTag(tagDraft) } }} onBlur={() => addTag(tagDraft)} />}
              </div>
              {suggest.length > 0 && tags.length < 10 && <span className="row wrap muted" style={{ gap: 6, fontSize: 12 }}>推荐：{suggest.map((t) => <button type="button" key={t} className="link-btn" style={{ fontSize: 12 }} onClick={() => addTag(t)}>{t}</button>)}</span>}
            </div>
            <label className="stack" style={{ gridColumn: '1 / -1', gap: 6 }}><span className="lbl">简介</span>
              <span className="inp up-desc"><textarea value={form.desc} maxLength={2000} onChange={(e) => setForm({ ...form, desc: e.target.value })} placeholder="填写更全面的相关信息，让更多人找到你的视频吧" /><small>{form.desc.length}/2000</small></span>
            </label>
          </div>
        </section>

        {!origin && <section className="sec" style={{ gap: 12 }}>
          <div className="row between"><h2>分段章节 <span className="faint" style={{ fontSize: 13, fontWeight: 400 }}>选填</span></h2><button type="button" className="sm-btn" onClick={() => setChapters((c) => [...c, { from: c.at(-1)?.to ?? 0, to: Math.min(total || 600, (c.at(-1)?.to ?? 0) + 60), content: '' }])}>添加章节</button></div>
          {chapters.length ? chapters.map((c, i) => (
            <div key={i} className="row" style={{ gap: 10 }}>
              <input className="up-time" value={mmss(c.from)} onChange={(e) => setChapters((l) => l.map((x, k) => (k === i ? { ...x, from: secs(e.target.value) } : x)))} aria-label="开始时间" />
              <span className="faint">–</span>
              <input className="up-time" value={mmss(c.to)} onChange={(e) => setChapters((l) => l.map((x, k) => (k === i ? { ...x, to: secs(e.target.value) } : x)))} aria-label="结束时间" />
              <input className="up-time grow" style={{ textAlign: 'left', padding: '0 12px' }} value={c.content} placeholder="章节标题" onChange={(e) => setChapters((l) => l.map((x, k) => (k === i ? { ...x, content: e.target.value } : x)))} />
              <button type="button" className="icon-b" aria-label="删除章节" onClick={() => setChapters((l) => l.filter((_, k) => k !== i))}><Icon name="trash" size={15} /></button>
            </div>
          )) : <span className="faint" style={{ fontSize: 13 }}>章节会显示在播放器进度条上，方便观众快速跳转</span>}
        </section>}
      </div>

      <aside className="up-sidebar stack" style={{ minWidth: 0, gap: 16 }}>
        <section className="sec" style={{ padding: 16, gap: 10 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>首页预览</span>
          <div className="up-prev">{form.cover && <img src={form.cover} alt="" />}<div className="shade"><span>0</span><span>0 弹幕</span><span style={{ marginLeft: 'auto' }}>{formatDuration(total)}</span></div></div>
          <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.45 }}>{form.title || '稿件标题'}</span>
          <span className="row muted" style={{ gap: 6, fontSize: 13 }}>{me?.face && <img src={me.face} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />}{me?.uname} · 刚刚</span>
        </section>
        {!origin && <section className="sec" style={{ padding: 16, gap: 14 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>发布设置</span>
          {canSchedule && <span className="row" style={{ gap: 12 }}><span className="stack grow"><span style={{ fontSize: 14 }}>定时发布</span><span className="faint" style={{ fontSize: 12 }}>最早 2 小时后，最晚 15 天内</span></span><Switch label="定时发布" on={schedule.on} onChange={(on) => setSchedule((x) => ({ ...x, on }))} /></span>}
          {canSchedule && schedule.on && <span className="stack" style={{ gap: 6, marginTop: -4 }}><span style={{ fontSize: 14 }}>发布时间</span>
            <span className="up-when"><span className="inp"><input type="date" value={schedule.day} min={splitTime(Date.now() / 1000).day} max={splitTime(Date.now() / 1000 + 15 * 86400).day} onChange={(e) => setSchedule((x) => ({ ...x, day: e.target.value }))} /></span><span className="inp"><input type="time" step={300} value={schedule.clock} onChange={(e) => setSchedule((x) => ({ ...x, clock: e.target.value }))} /></span></span>
            <span className="faint" style={{ fontSize: 12 }}>{Number.isFinite(dtime) && dtime ? `审核通过后，将在 ${new Date(dtime * 1000).getMonth() + 1} 月 ${new Date(dtime * 1000).getDate()} 日 ${schedule.clock} 自动发布` : '请选择发布时间'}</span>
          </span>}
          <span className="row" style={{ gap: 12 }}><span className="stack grow"><span style={{ fontSize: 14 }}>同步到动态</span><span className="faint" style={{ fontSize: 12 }}>粉丝会在动态里看到</span></span><Switch label="同步到动态" on={!form.no_disturbance} onChange={(v) => setForm({ ...form, no_disturbance: v ? 0 : 1 })} /></span>
          <span className="row" style={{ gap: 12 }}><span className="stack grow"><span style={{ fontSize: 14 }}>推荐到电视端</span><span className="faint" style={{ fontSize: 12 }}>JulibiliTV 首页可推荐</span></span><Switch label="推荐到电视端" on={!form.no_tv} onChange={(v) => setForm({ ...form, no_tv: v ? 0 : 1 })} /></span>
          <span className="stack" style={{ gap: 6 }}><span style={{ fontSize: 14 }}>加入合集</span>
            <span className="inp" style={{ height: 36, fontSize: 13 }}><select value={form.season_id} onChange={(e) => setForm({ ...form, season_id: +e.target.value })}><option value={0}>不加入合集</option>{(seasons.data ?? []).filter((x: any) => !x.origin).map((x: any) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></span>
          </span>
        </section>}
        <button className="up-submit" disabled={busy || parts.some((p) => !p.filename) || (!parts.length && !editing)}>{busy ? <Spinner size={16} /> : editing && archState !== -20 ? '保存修改' : schedule.on && canSchedule ? '定时投稿' : '立即投稿'}</button>
        {canDraft ? <button type="button" className="up-cancel" disabled={busy || parts.some((p) => !p.filename && !p.error)} onClick={() => submit(null, true)}>存草稿</button> : <Link to="/creator/archives" className="up-cancel">取消</Link>}
        <span className="faint" style={{ fontSize: 12, lineHeight: 1.6, textAlign: 'center' }}>{editing && origin ? '修改只保存在 Jumedia' : '投稿后进入审核，通过后对所有人可见'}</span>
      </aside>
    </form>
    </>
  )
}

interface Origin { datasource_id: number; datasource_name: string; library: string; locked: ('title' | 'desc' | 'tid' | 'tag' | 'pic')[]; missing: boolean }
const FIELD_LABEL: Record<string, string> = { title: '标题', desc: '简介', tid: '分区', tag: '标签', pic: '封面', intro: '简介', cover: '封面' }

/** 稿件管理 — `/x/web/archives`, `/x/web/archive/delete`. */
export function Archives() {
  useTitle('稿件管理')
  const [params, setParams] = useSearchParams()
  const origin = (params.get('origin') ?? '') as '' | 'upload' | 'datasource'
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [pn, setPn] = useState(1)
  const [kw, setKw] = useState('')
  const [q, setQ] = useState('')
  const d = useAsync(() => jm.creatorArchives({ pn, status, keyword: q, origin }), [pn, status, q, origin])
  const del = async (aid: number, title: string) => {
    if (!(await confirmDialog(`确定删除稿件“${title}”？删除后不可恢复。`, { danger: true, ok: '删除' }))) return
    try { const r = await jm.archiveDelete(aid); if (r.code) throw new Error(r.message); d.reload(); toast('已删除', 'success') } catch (e) { toastError(e) }
  }
  const cls = d.data?.class ?? {}
  const total = d.data?.page?.count ?? 0
  const tabs = [{ value: '', label: '全部稿件', count: (cls.pubed ?? 0) + (cls.is_pubing ?? 0) + (cls.not_pubed ?? 0) + (cls.missing ?? 0) + (cls.timer ?? 0) + (cls.draft ?? 0) }, { value: 'pubed', label: '已通过', count: cls.pubed }, { value: 'is_pubing', label: '审核中', count: cls.is_pubing }, { value: 'timer', label: '定时发布', count: cls.timer }, { value: 'not_pubed', label: '未通过', count: cls.not_pubed }, { value: 'draft', label: '草稿', count: cls.draft }, ...(cls.missing ? [{ value: 'missing', label: '源已移除', count: cls.missing }] : [])]
  const STATE_TONE: Record<number, [string, string]> = { 0: ['var(--success-soft)', 'var(--success)'], [-1]: ['var(--warning-soft)', '#c27a12'], [-2]: ['var(--danger-soft)', '#c43f3b'], [-6]: ['var(--danger-soft)', '#c43f3b'], [-40]: ['var(--brand-soft)', 'var(--brand)'] }
  return (
    <div className="page">
      <div className="chead">
        <h1>稿件管理</h1>
        <span className="grow" />
        <form className="bsearch" style={{ width: 240 }} onSubmit={(e) => { e.preventDefault(); setQ(kw); setPn(1) }}><span className="row" style={{ height: 36, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 14px', gap: 8 }}><Icon name="search" size={15} /><input style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'none' }} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索稿件标题" /></span></form>
        <Link to="/creator/upload" className="btn primary" style={{ height: 36, borderRadius: 18 }}><Icon name="upload" size={15} />发布新视频</Link>
      </div>
      <div className="line-tabs">
        {tabs.map((t) => <button type="button" key={t.value} className={status === t.value ? 'on' : ''} onClick={() => { setStatus(t.value); setPn(1) }}>{t.label}<small>{t.count ?? 0}</small></button>)}
        <span className="grow" />
        <span className="pill-seg">{([['', '全部'], ['upload', '上传'], ['datasource', '数据源']] as const).map(([v, l]) => <button type="button" key={v} className={origin === v ? 'on' : ''} onClick={() => { setParams(v ? { origin: v } : {}); setPn(1) }}>{l}</button>)}</span>
      </div>
      {d.loading && !d.data ? <Loading /> : !d.data?.arc_audits?.length ? <Empty title="没有稿件" action={origin === 'datasource' ? <Link to="/creator/datasources" className="btn">管理数据源</Link> : <Link to="/creator/upload" className="btn">去投稿</Link>} /> : (
        <section className="list-card">
          {d.data.arc_audits.map(({ Archive: a, stat, origin: o }: any) => {
            const tone = STATE_TONE[a.state] ?? ['var(--surface-2)', 'var(--text-2)']
            return (
              <div key={a.aid} className="arc2">
                <Link to={a.state === 0 ? `/video/${a.bvid}` : `/creator/upload/${a.aid}`} className="art"><img src={a.cover} alt="" /><span>{formatDuration(a.duration)}</span></Link>
                <div className="info">
                  <span className="row" style={{ gap: 8, minWidth: 0 }}><span className="st" style={{ background: tone[0], color: tone[1] }}>{a.state_desc}</span><Link to={a.state === 0 ? `/video/${a.bvid}` : `/creator/upload/${a.aid}`} className="t">{a.title}</Link></span>
                  <span className="meta">{a.tname} · {o ? <>{o.datasource_name}{o.library && ` · ${o.library}`}{o.locked.length > 0 && ` · 已修改${o.locked.map((f: string) => FIELD_LABEL[f]).join('、')}`}</> : <>{a.copyright === 1 ? '自制' : '转载'} · {a.state === -20 ? `草稿 · ${dateTimeText(a.ctime)} 创建` : a.state === -40 || (a.state === -1 && a.dtime) ? `将于 ${dateTimeText(a.dtime)} 发布` : `投稿于 ${dateTimeText(a.ctime)}`}</>}</span>
                  {a.state === -2 && <span style={{ fontSize: 12, color: '#c43f3b' }}>退回原因：{a.reject_reason}</span>}
                  <span className="nums"><span>播放 {countText(stat.view)}</span><span>弹幕 {countText(stat.danmaku)}</span><span>点赞 {countText(stat.like)}</span><span>收藏 {countText(stat.favorite)}</span><span>评论 {countText(stat.reply)}</span></span>
                </div>
                <div className="ops">
                  <Link to={`/creator/upload/${a.aid}`} className="sm-btn">{a.state === -20 ? '继续编辑' : '编辑'}</Link>
                  {a.state === 0 && <Link to={`/video/${a.bvid}`} className="sm-btn">查看</Link>}
                  <button type="button" className="sm-btn icon" aria-label="删除" title={o ? '只从 Jumedia 删除，之后的同步不会再导入' : '删除'} onClick={() => del(a.aid, a.title)}><Icon name="trash" size={15} /></button>
                </div>
              </div>
            )
          })}
          <div className="list-foot"><span>共 {total} 个稿件</span><Pager page={pn} total={total} size={10} onChange={setPn} /></div>
        </section>
      )}
    </div>
  )
}

/** 合集 / 系列 — the records behind `seasons_series_list` and `ugc_season`. */
export function Collections() {
  useTitle('合集管理')
  const d = useAsync(() => jm.creatorSeasons(), [])
  const mine = useAsync(() => jm.creatorArchives({ pn: 1, ps: 100, status: 'pubed' }), [])
  const [edit, setEdit] = useState<{ season_id?: number; kind: 'season' | 'series'; title: string; intro: string; cover: string; aids: number[]; library?: string } | null>(null)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!edit) return
    try { const r = await jm.seasonSave({ ...edit, aids: edit.aids.join(',') }); if (r.code) throw new Error(r.message); setEdit(null); d.reload(); toast('已保存', 'success') } catch (err) { toastError(err) }
  }
  const reset = async (s: any) => { try { await jm.seasonOriginReset(s.id); d.reload(); toast('已恢复为媒体库信息', 'success') } catch (err) { toastError(err) } }
  const del = async (s: any) => {
    if (!(await confirmDialog(`删除“${s.title}”？其中的视频不会被删除。`, { danger: true, ok: '删除' }))) return
    try { await jm.seasonDelete(s.id, s.kind); d.reload() } catch (err) { toastError(err) }
  }
  // Data-source videos belong to their library's 合集; only 系列 can also list them.
  const arcs: any[] = (mine.data?.arc_audits ?? []).filter((x: any) => edit?.kind === 'series' || !x.origin).map((x: any) => x.Archive)
  const [kind, setKind] = useState<'' | 'season' | 'series'>('')
  const all: any[] = d.data?.seasons ?? []
  const shown = kind ? all.filter((x) => x.kind === kind) : all
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="chead"><div><h1>合集管理</h1><p>合集中的视频会在播放页以选集形式展示；系列用于在空间页归类</p></div><span className="grow" /><div className="row"><button className="pill" onClick={() => setEdit({ kind: 'series', title: '', intro: '', cover: '', aids: [] })}>新建系列</button><button className="btn primary" style={{ height: 36, borderRadius: 18 }} onClick={() => setEdit({ kind: 'season', title: '', intro: '', cover: '', aids: [] })}><Icon name="plus" size={15} />新建合集</button></div></div>
      <div className="chips-b">{([['', '全部'], ['season', '合集'], ['series', '系列']] as const).map(([v, l]) => <button type="button" key={v} className={kind === v ? 'on' : ''} onClick={() => setKind(v)}>{l}<small style={{ opacity: 0.75, fontSize: 12 }}>{v ? all.filter((x) => x.kind === v).length : all.length}</small></button>)}</div>
      {d.loading ? <Loading /> : !shown.length ? <Empty title="还没有合集" icon="layers" /> : (
        <div className="g3">
          {shown.map((s: any) => (
            <div key={s.id} className="set-card">
              <div className="art"><img src={s.cover} alt="" /><span className="kind" style={{ background: s.origin ? '#19a865' : s.kind === 'season' ? 'var(--brand)' : '#8b6cf6' }}>{s.origin ? '媒体库' : s.kind === 'season' ? '合集' : '系列'}</span><span className="n"><b>{s.ep_count}</b><span>个视频</span></span></div>
              <span className="stack" style={{ padding: '0 4px', gap: 2 }}>
                <b className="clamp-1" style={{ fontSize: 15 }}>{s.title}</b>
                <span className="muted clamp-1" style={{ fontSize: 13 }}>{s.intro || (s.origin ? `${s.origin.datasource_name} · ${s.origin.library}` : '暂无简介')}</span>
                <span className="faint" style={{ fontSize: 12 }}>{s.origin ? '随数据源同步' : s.kind === 'season' ? '播放页显示选集' : '空间页归类'}{s.ctime ? ` · 创建于 ${dateTimeText(s.ctime)}` : ''}</span>
              </span>
              <span className="row" style={{ padding: '0 4px', gap: 6 }}>
                <button type="button" className="btn" onClick={() => setEdit({ season_id: s.id, kind: s.kind, title: s.title, intro: s.intro, cover: s.cover, aids: s.aids, library: s.origin ? s.origin.library : undefined })}><Icon name="edit" size={14} />编辑</button>
                {s.origin ? s.origin.locked.length > 0 && <button type="button" className="btn" onClick={() => reset(s)}>恢复媒体库信息</button> : <button type="button" className="btn" style={{ color: '#c43f3b', borderColor: 'rgba(240,82,78,0.4)' }} onClick={() => del(s)}>删除</button>}
              </span>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal title={edit.season_id ? '编辑' : edit.kind === 'season' ? '新建合集' : '新建系列'} onClose={() => setEdit(null)} wide>
          <form className="stack" onSubmit={save}>
            <div className="field"><label>名称</label><input className="input" value={edit.title} maxLength={40} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required /></div>
            <div className="field"><label>简介</label><textarea className="textarea" value={edit.intro} onChange={(e) => setEdit({ ...edit, intro: e.target.value })} /></div>
            {edit.library !== undefined ? <p className="faint" style={{ fontSize: 13, margin: 0 }}>这个合集对应媒体库「{edit.library}」，其中的视频随数据源同步。名称与简介的修改只保存在 Jumedia。</p> : <div className="field"><label>包含视频（按勾选顺序排列）</label>
              <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 6 }}>
                {arcs.map((a) => <label key={a.aid} className="check" style={{ display: 'flex', padding: '6px 8px' }}><input type="checkbox" checked={edit.aids.includes(a.aid)} onChange={(e) => setEdit({ ...edit, aids: e.target.checked ? [...edit.aids, a.aid] : edit.aids.filter((x) => x !== a.aid) })} /><img src={a.cover} alt="" style={{ width: 64, borderRadius: 6, aspectRatio: '16/10', objectFit: 'cover' }} /><span className="clamp-1">{a.title}</span>{edit.aids.includes(a.aid) && <span className="badge brand" style={{ marginLeft: 'auto' }}>{edit.aids.indexOf(a.aid) + 1}</span>}</label>)}
                {!arcs.length && <p className="faint" style={{ padding: 12 }}>还没有已通过的稿件</p>}
              </div>
              {edit.kind === 'season' && <span className="hint">一个视频只能属于一个合集，加入后会从原合集移出；数据源中的视频属于其媒体库合集</span>}
            </div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn primary">保存</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

/** 直播设置 — room info, title/area/cover, start/stop and push address. */
export function LiveSettings() {
  useTitle('直播设置')
  const [showKey, setShowKey] = useState(false)
  const room = useAsync(() => jm.liveRoomMine(), [])
  const areas = useAsync(async () => (await juli.liveAreas()).data ?? [], [])
  const [f, setF] = useState({ title: '', area_id: 0, cover: '' })
  const coverInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (room.data) setF({ title: room.data.title, area_id: room.data.area_v2_id, cover: room.data.cover }) }, [room.data?.room_id])
  const transcoding = cacheBusy(room.data?.source?.cache)
  useEffect(() => {
    if (!transcoding) return
    const t = setInterval(room.reload, 3000)
    return () => clearInterval(t)
  }, [transcoding, room.reload])
  if (room.loading && !room.data) return <Loading />
  if (room.error) return <ErrorState error={room.error} retry={room.reload} />
  const r = room.data
  const save = async () => { try { const x = await jm.liveRoomUpdate(f); if (x.code) throw new Error(x.message); room.reload(); toast('已保存', 'success') } catch (e) { toastError(e) } }
  const toggle = async () => {
    try { const x = r.live_status === 1 ? await jm.liveStop() : await jm.liveStart(f.area_id); if (x.code) throw new Error(x.message); room.reload(); toast(r.live_status === 1 ? '已下播' : '已开播', 'success') } catch (e) { toastError(e) }
  }
  const cache = r.source?.type === 'video' ? r.source.cache : undefined
  const waiting = r.live_status !== 1 && r.source?.type === 'video' && cache?.status !== 'ready'
  const retry = async () => { try { const x = await jm.streamSourceRetry(); if (x.code) throw new Error(x.message); room.reload() } catch (e) { toastError(e) } }
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('已复制', 'success'))
  const resetKey = async () => {
    if (!(await confirmDialog('重置后旧的串流密钥立即失效，正在使用它推流的软件需要换成新密钥。', { danger: true, ok: '重置' }))) return
    try { const x = await jm.streamKeyReset(); if (x.code) throw new Error(x.message); room.reload(); setShowKey(true); toast('已重置串流密钥', 'success') } catch (e) { toastError(e) }
  }
  return (
    <div className="page" style={{ gap: 16 }}>
      <div className="chead">
        <div><h1>直播设置</h1><p>房间号 {r.room_id} · {r.live_status === 1 ? '直播中' : '未开播'}{r.live_status !== 1 && r.live_time > 0 && ` · 上次开播 ${dateTimeText(r.live_time)}`}</p></div>
        <span className="grow" />
        <Link to={`/live/${r.room_id}`} className="pill" style={{ height: 38, borderRadius: 19, padding: '0 16px' }}>进入直播间</Link>
        <button type="button" className={`go-live ${r.live_status === 1 ? 'stop' : ''}`} onClick={toggle} disabled={r.banned || waiting} title={waiting ? '转码完成后才能开播' : undefined}><Icon name="live" size={16} />{r.live_status === 1 ? '结束直播' : '开始直播'}</button>
      </div>
      {r.banned && <div className="sec" style={{ color: 'var(--danger)' }}>直播间已被管理员封禁，暂时无法开播。</div>}
      <section className="sec">
        <h2>房间信息</h2>
        <div className="row wrap" style={{ gap: 20, alignItems: 'flex-start' }}>
          <div className="stack" style={{ flex: '1 1 360px', minWidth: 0, gap: 16 }}>
            <label className="stack" style={{ gap: 6 }}><span className="lbl">直播标题</span><span className="inp"><input value={f.title} maxLength={40} onChange={(e) => setF({ ...f, title: e.target.value })} /><small>{f.title.length}/40</small></span></label>
            <label className="stack" style={{ gap: 6 }}><span className="lbl">分区</span>
              <span className="inp"><select value={f.area_id} onChange={(e) => setF({ ...f, area_id: +e.target.value })}>{(areas.data ?? []).map((a: any) => <optgroup key={a.id} label={a.name}>{a.list.map((c: any) => <option key={c.id} value={c.id}>{a.name} · {c.name}</option>)}</optgroup>)}</select></span>
            </label>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="lbl">封面</span>
            <button type="button" className="cover-240" onClick={() => coverInput.current?.click()}>{f.cover && <img src={f.cover} alt="" />}<span>更换封面</span></button>
            <input ref={coverInput} type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) { try { setF({ ...f, cover: (await jm.uploadFile('image', file)).url }) } catch (err) { toastError(err) } } }} />
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn primary" onClick={save}>保存</button></div>
      </section>
      <section className="sec">
        <div className="row wrap" style={{ gap: 10 }}><h2>直播源</h2><span className="muted" style={{ fontSize: 13 }}>当前：{r.source?.type === 'm3u8' ? 'm3u8 拉流' : r.source?.type === 'video' ? `转播视频${r.source.video ? `「${r.source.video.title}」` : ''}` : '推流'}</span></div>
        <StreamSourceEditor key={`${r.source?.type}:${r.source?.url}:${r.source?.loop}:${r.pending_start}`} value={{ source_type: r.source?.type ?? 'push', source_url: r.source?.type === 'm3u8' ? r.source.url : '', loop: r.source?.loop ?? true, aid: r.source?.aid, cid: r.source?.cid, auto_start: !!r.pending_start }} current={r.source?.video} videos={jm.streamSourceVideos} autoStart={r.live_status !== 1}
          cache={r.source?.type === 'video' ? <CacheStatus cache={cache} pendingStart={r.pending_start} onRetry={retry} /> : undefined}
          onSave={async (src) => {
            const x = await jm.streamSourceUpdate(src); if (x.code) throw new Error(x.message); room.reload()
            const c = x.data?.source?.cache
            toast(src.source_type === 'video' && c?.status !== 'ready' ? (x.data.pending_start ? '已开始转码，完成后自动开播' : '已开始转码，完成后即可开播') : r.live_status === 1 ? '直播源已切换，观众将自动重新拉流' : '直播源已保存，开播后生效', 'success')
          }} />
      </section>
      <section className="sec">
        <div className="row wrap" style={{ gap: 10 }}><h2>推流设置</h2><span className="muted" style={{ fontSize: 13 }}>选择「推流」时，在 OBS 等推流软件中填写</span></div>
        <label className="stack" style={{ gap: 6 }}><span className="lbl">服务器地址</span><span className="row" style={{ gap: 8 }}><span className="inp mono grow" style={{ fontSize: 13 }}>{r.rtmp?.addr}</span><button type="button" className="btn" onClick={() => copy(r.rtmp?.addr)}>复制</button></span></label>
        <label className="stack" style={{ gap: 6 }}><span className="lbl">串流密钥</span>
          <span className="row" style={{ gap: 8 }}><span className="inp mono grow" style={{ fontSize: 13, letterSpacing: showKey ? 0 : 3, color: 'var(--text-2)', overflow: 'hidden' }}>{showKey ? r.rtmp?.code : '••••••••••••••••••••'}</span><button type="button" className="btn" onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button><button type="button" className="btn" onClick={() => copy(r.rtmp?.code)}>复制</button><button type="button" className="btn" onClick={resetKey}>重置</button></span>
          <span className="faint" style={{ fontSize: 12 }}>不要把密钥告诉别人；泄露后请立即重置</span>
        </label>
      </section>
      <Reservations />
    </div>
  )
}

/** 直播预告 — `/x/space/reservation` (read) and Jumedia's `/x/web/reservation/add|delete`. */
function Reservations() {
  const { me } = useSession()
  const list = useAsync(async () => (me ? (await jm.reservations(me.mid)) as { sid: number; name: string; stime: number; subtitle: string }[] : []), [me?.mid])
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState('')
  const add = async (e: FormEvent) => {
    e.preventDefault()
    const stime = Math.floor(new Date(when).getTime() / 1000)
    if (!title.trim() || !stime) return toast('请填写标题和开播时间', 'error')
    try { const x = await jm.reservationAdd(title.trim(), stime); if (x.code) throw new Error(x.message); setTitle(''); setWhen(''); list.reload(); toast('已添加直播预告', 'success') } catch (err) { toastError(err) }
  }
  const del = async (sid: number) => { try { const x = await jm.reservationDelete(sid); if (x.code) throw new Error(x.message); list.reload() } catch (err) { toastError(err) } }
  return (
    <section className="sec">
      <div className="row wrap" style={{ gap: 10 }}><h2>直播预告</h2><span className="muted" style={{ fontSize: 13 }}>显示在直播间和个人空间，开播时间过后自动隐藏</span></div>
      <div className="stack" style={{ gap: 8 }}>
        {(list.data ?? []).map((r) => <div key={r.sid} className="row between" style={{ padding: '8px 4px', borderBottom: '1px solid var(--line)' }}><span><b>{r.name}</b><span className="faint" style={{ marginLeft: 10, fontSize: 13 }}>{r.subtitle}</span></span><button className="btn sm danger" onClick={() => del(r.sid)}>删除</button></div>)}
        {!list.loading && !list.data?.length && <span className="faint" style={{ fontSize: 13 }}>还没有直播预告</span>}
      </div>
      <form className="row wrap" style={{ marginTop: 14, gap: 8 }} onSubmit={add}>
        <input className="input grow" style={{ minWidth: 200 }} value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="预告标题，例如：周六电影夜" />
        <input className="input" style={{ width: 220 }} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="开播时间" />
        <button className="btn primary"><Icon name="plus" size={15} />添加预告</button>
      </form>
    </section>
  )
}

/** 数据源 — the creator's media sources; each enabled library becomes a 合集 in their space. */
export function DataSources() {
  useTitle('数据源')
  const d = useAsync(() => jm.dataSources(), [])
  const [edit, setEdit] = useState<DataSource | 'new' | null>(null)
  const list: DataSource[] | undefined = d.data?.list
  useSyncPolling(list, d.reload)
  if (d.loading && !d.data) return <Loading />
  if (d.error) return <ErrorState error={d.error} retry={d.reload} />
  const full = (list?.length ?? 0) >= d.data.max
  const usage = `已用 ${list?.length ?? 0} / ${d.data.max}`
  return (
    <div className="row wrap" style={{ gap: 20, alignItems: 'flex-start' }}>
      <div className="stack" style={{ flex: '999 1 480px', minWidth: 0, gap: 16 }}>
        <div className="chead">
          <div><h1>数据源</h1><p>以只读方式接入 Emby、Jellyfin、飞牛影视或 Plex，手动选择电影、剧集导入草稿，也可自动同步整个媒体库</p></div>
        </div>
        {!d.data.enabled && <div className="ds-card muted">站点暂未开放个人数据源，已添加的数据源仍会显示，但无法新增或同步。</div>}
        {list?.map((ds) => edit !== 'new' && edit?.id === ds.id
          ? <DataSourceEditor key={ds.id} inline scope="web" value={ds} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); d.reload() }} />
          : <DataSourceCard key={ds.id} ds={ds} scope="web" onChanged={d.reload} onEdit={d.data.enabled ? () => setEdit(ds) : undefined} />)}
        {edit === 'new' || (!list?.length && d.data.enabled)
          ? <DataSourceEditor inline scope="web" usage={usage} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); d.reload() }} />
          : d.data.enabled && <button type="button" className="ds-add" disabled={full} onClick={() => setEdit('new')}><Icon name="plus" size={16} />{full ? `最多 ${d.data.max} 个数据源` : `添加数据源 ${usage}`}</button>}
      </div>
      <aside style={{ flex: '1 1 260px', maxWidth: 320, minWidth: 0, paddingTop: 70 }}>
        <section className="ds-card muted" style={{ gap: 12, padding: 16, fontSize: 13, lineHeight: 1.7 }}>
          <b style={{ fontSize: 15, color: 'var(--text)' }}>接入后会怎样</b>
          <span>手动获取创建草稿，整库同步会创建合集</span>
          <span>片名、简介、海报取自源媒体库</span>
          <span>草稿由你投稿，整库同步按站点规则审核</span>
          <span>标题修改仅保存在 Jumedia</span>
          <span>只接入登录用户能看到的媒体库</span>
          <span>移除数据源会同时下架它的全部视频</span>
          {d.data.sync_hours > 0 && <span>开启自动同步时每 {d.data.sync_hours} 小时同步一次</span>}
        </section>
      </aside>
    </div>
  )
}
