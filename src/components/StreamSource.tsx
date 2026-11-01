import { useState } from 'react'
import { useAsync } from '../lib/hooks'
import type { LiveCacheState, SourceForm } from '../api/jumedia'
import * as jm from '../api/jumedia'
import { formatDuration } from '../api/normalize'
import { Icon } from './Icon'
import { Pager, Spinner, Switch, toastError } from './ui'

export interface Probe { url: string; master: boolean; kind: 'vod' | 'live'; format: 'ts' | 'fmp4'; duration: number; segments: number; target_duration: number; encrypted: boolean; variants: { bandwidth: number; resolution: string }[] }

export interface RelayVideo { aid: number; cid: number; title: string; part: string; pic: string; duration: number }
type VideoList = (p: { pn: number; keyword?: string }) => Promise<{ list: { aid: number; title: string; pic: string; datasource: string; pages: { cid: number; part: string; duration: number }[] }[]; page: { total: number } }>

const SOURCES = [
  { v: 'video' as const, label: '转播视频', icon: 'film', hint: '选一个已发布的稿件，按直播方式播出' },
  { v: 'push' as const, label: '推流', icon: 'cast', hint: '用 OBS 等软件把画面推到直播间' },
  { v: 'm3u8' as const, label: 'm3u8 拉流', icon: 'link', hint: '转播一个现有的 HLS 直播地址' },
]

/** Live source editor: RTMP push, an m3u8 pull source, or one of the streamer's data-source videos, relayed as the room's live stream. */
export function StreamSourceEditor({ value, onSave, saveLabel = '保存直播源', extra, videos, current, autoStart, cache }: { value: SourceForm; onSave: (f: SourceForm) => Promise<void>; saveLabel?: string; cache?: React.ReactNode; extra?: React.ReactNode; videos: VideoList; current?: RelayVideo | null; autoStart?: boolean }) {
  const [f, setF] = useState<SourceForm>(value)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const check = async (url = f.source_url) => {
    setChecking(true); setError(''); setProbe(null)
    try { setProbe(await jm.streamSourceProbe(url)) } catch (e) { setError((e as Error).message) } finally { setChecking(false) }
  }
  const save = async () => {
    setBusy(true)
    try { await onSave(f) } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <div className="stack">
      <div className="src-cards">
        {SOURCES.map((o) => <button type="button" key={o.v} className={f.source_type === o.v ? 'on' : ''} onClick={() => setF({ ...f, source_type: o.v })}><b><Icon name={o.icon} size={16} />{o.label}</b><span>{o.hint}</span></button>)}
      </div>
      {f.source_type === 'video' ? (
        <>
          <VideoPicker videos={videos} current={current} value={f} onPick={(aid, cid) => setF({ ...f, aid, cid })} />
          <p className="hint" style={{ margin: 0 }}>保存后服务器会先把视频转码缓存为直播流（H.264），转码完成后才能开播。同一个视频只转码一次。</p>
          {autoStart && (
            <label className="row between">
              <div><b>转码完成后自动开播</b><div className="faint" style={{ fontSize: 13 }}>关闭则转码完成后需要手动开始直播</div></div>
              <Switch on={!!f.auto_start} onChange={(auto_start) => setF({ ...f, auto_start })} />
            </label>
          )}
          <div className="f2">
            <label className="row" style={{ gap: 12 }}><span className="grow"><b style={{ fontSize: 14, fontWeight: 600 }}>循环播放</b><div className="muted" style={{ fontSize: 13 }}>播完后从头开始</div></span><Switch on={f.loop} onChange={(loop) => setF({ ...f, loop })} /></label>
            {cache && <div className="row" style={{ gap: 12 }}><span className="grow"><b style={{ fontSize: 14, fontWeight: 600 }}>提前转码</b><div style={{ marginTop: 2 }}>{cache}</div></span></div>}
          </div>
        </>
      ) : f.source_type === 'm3u8' ? (
        <>
          <div className="field">
            <label>m3u8 地址</label>
            <div className="row"><input className="input mono" value={f.source_url} placeholder="https://example.com/stream/index.m3u8" onChange={(e) => { setF({ ...f, source_url: e.target.value }); setProbe(null) }} /><button type="button" className="btn" disabled={!f.source_url.trim() || checking} onClick={() => check()}>{checking ? <Spinner size={14} /> : '检测'}</button></div>
            <span className="hint">支持主播放列表（多码率）与媒体播放列表；源站需允许跨域访问。点播列表会按时间轴循环转播为直播，直播列表直接转播。</span>
          </div>
          {error && <div className="reject">{error}</div>}
          {probe && (
            <div className="panel" style={{ background: 'var(--surface-2)', borderColor: 'transparent', padding: 14 }}>
              <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                <span className={`badge ${probe.kind === 'vod' ? 'brand' : 'accent'}`}>{probe.kind === 'vod' ? '点播列表 · 将转为直播' : '直播列表 · 直接转播'}</span>
                <span className="badge">{probe.format === 'fmp4' ? 'fMP4' : 'MPEG-TS'}</span>
                {probe.master && <span className="badge">{probe.variants.length} 个码率</span>}
                {probe.encrypted && <span className="badge warning">AES 加密</span>}
              </div>
              <div className="faint" style={{ fontSize: 13, lineHeight: 1.8 }}>
                {probe.kind === 'vod' && <>时长 {formatDuration(probe.duration)} · </>}{probe.segments} 个分片 · 目标分片时长 {probe.target_duration}s
                {probe.variants.length > 0 && <div>{probe.variants.map((v) => `${v.resolution || '未知分辨率'} @ ${Math.round(v.bandwidth / 1000)}kbps`).join('，')}</div>}
              </div>
            </div>
          )}
          <label className="row between" style={{ opacity: probe?.kind === 'live' ? 0.5 : 1 }}>
            <div><b>循环播放</b><div className="faint" style={{ fontSize: 13 }}>点播源播完后从头继续；关闭则播完自动下播</div></div>
            <Switch on={f.loop} onChange={(loop) => setF({ ...f, loop })} />
          </label>
        </>
      ) : <p className="muted" style={{ fontSize: 13, margin: 0 }}>保存后，在下方「推流设置」里的服务器地址和串流密钥推流即可开播。</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>{extra}<button type="button" className="btn primary" disabled={busy || (f.source_type === 'm3u8' && !f.source_url.trim()) || (f.source_type === 'video' && !f.cid)} onClick={save}>{busy ? <Spinner size={14} /> : <><Icon name="save" size={15} />{saveLabel}</>}</button></div>
    </div>
  )
}

/** Picks one page of a data-source video; series are multi-page, so each page is listed. */
function VideoPicker({ videos, current, value, onPick }: { videos: VideoList; current?: RelayVideo | null; value: SourceForm; onPick: (aid: number, cid: number) => void }) {
  const [pn, setPn] = useState(1)
  const [kw, setKw] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(value.aid ?? null)
  const [picking, setPicking] = useState(!current)
  const d = useAsync(() => videos({ pn, keyword: q }), [pn, q])
  const picked = d.data?.list.find((a) => a.aid === value.aid)
  const chosen = picked ? { title: picked.title, pic: picked.pic, duration: picked.pages.find((p) => p.cid === value.cid)?.duration ?? 0 } : current ? { title: current.title, pic: current.pic, duration: current.duration } : null
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="lbl">转播的视频</span>
      <span className="inp">
        <span className="row" style={{ gap: 10, minWidth: 0 }}>{chosen ? <><img src={chosen.pic} alt="" style={{ width: 48, height: 30, borderRadius: 4, objectFit: 'cover' }} /><span className="clamp-1">{chosen.title} · {formatDuration(chosen.duration)}</span></> : <span className="faint">还没有选择视频</span>}</span>
        <button type="button" className="link-btn" onClick={() => setPicking(!picking)}>{picking ? '收起' : '从我的稿件中选择'}</button>
      </span>
      {picking && <>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQ(kw); setPn(1) }}><input className="input sm grow" value={kw} placeholder="搜索视频" onChange={(e) => setKw(e.target.value)} /><button className="btn sm">搜索</button></form>
      <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 6, marginTop: 6 }}>
        {d.loading && !d.data ? <div style={{ padding: 16, textAlign: 'center' }}><Spinner size={18} /></div> : !d.data?.list.length ? (
          <p className="faint" style={{ padding: 12, margin: 0, fontSize: 13 }}>没有可转播的视频。在创作中心的「数据源」中接入 Emby 后，媒体库中的视频可在这里选择。</p>
        ) : d.data.list.map((a) => (
          <div key={a.aid}>
            <button type="button" className="row" style={{ width: '100%', padding: '6px 8px', gap: 10, background: value.aid === a.aid ? 'var(--brand-soft)' : 'transparent', border: 0, borderRadius: 8, textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
              onClick={() => (a.pages.length === 1 ? onPick(a.aid, a.pages[0].cid) : setOpen(open === a.aid ? null : a.aid))}>
              <img src={a.pic} alt="" style={{ width: 72, borderRadius: 6, aspectRatio: '16/10', objectFit: 'cover', flex: 'none' }} />
              <span className="grow" style={{ minWidth: 0 }}><span className="clamp-1">{a.title}</span><span className="faint" style={{ fontSize: 12 }}>{a.datasource || '演示媒体'}{a.pages.length > 1 ? ` · ${a.pages.length} 集` : ` · ${formatDuration(a.pages[0].duration)}`}</span></span>
              {a.pages.length > 1 ? <Icon name="chevron-down" size={14} /> : value.cid === a.pages[0].cid && <Icon name="check" size={16} style={{ color: 'var(--brand)' }} />}
            </button>
            {a.pages.length > 1 && open === a.aid && (
              <div style={{ padding: '2px 8px 6px 90px' }}>
                {a.pages.map((p) => (
                  <label key={p.cid} className="check" style={{ display: 'flex', padding: '4px 0', fontSize: 13 }}>
                    <input type="radio" name="relay-page" checked={value.cid === p.cid} onChange={() => onPick(a.aid, p.cid)} />
                    <span className="clamp-1 grow">{p.part}</span><span className="faint">{formatDuration(p.duration)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <Pager page={pn} total={d.data?.page.total ?? 0} size={12} onChange={setPn} />
      </>}
    </div>
  )
}

const CACHE_LABEL = { pending: '排队等待转码', running: '正在转码', ready: '转码完成', failed: '转码失败' } as const

/** Transcode state of a `video` source, with a retry action for failed jobs. */
export function CacheStatus({ cache, pendingStart, onRetry }: { cache: LiveCacheState | null | undefined; pendingStart?: boolean; onRetry?: () => void }) {
  if (!cache) return <div className="reject">转码缓存不存在，请重新选择转播视频。</div>
  const tone = cache.status === 'ready' ? 'success' : cache.status === 'failed' ? 'danger' : 'brand'
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`badge ${tone}`}>{CACHE_LABEL[cache.status]}{cache.status === 'running' && ` ${cache.progress}%`}</span>
        <span className="faint" style={{ fontSize: 13 }}>
          {cache.status === 'ready' ? `${cache.height}p · ${(cache.size / 1024 ** 3).toFixed(2)} GB` : cache.status === 'failed' ? cache.message : pendingStart ? '完成后自动开播' : '完成后即可开播'}
        </span>
        {cache.status === 'failed' && onRetry && <button type="button" className="btn sm" onClick={onRetry}><Icon name="refresh" size={13} />重试</button>}
      </div>
      {(cache.status === 'running' || cache.status === 'pending') && <div className="meter"><i style={{ width: `${cache.progress}%` }} /></div>}
    </div>
  )
}

/** True while a transcode the page shows may still change (poll the room until it settles). */
export const cacheBusy = (cache: LiveCacheState | null | undefined) => cache?.status === 'pending' || cache?.status === 'running'
