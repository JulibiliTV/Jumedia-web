import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { type DataSourceForm, dataSourceAPI } from '../api/jumedia'
import { sourceNames, type SourceType } from '../lib/dataSource'
import { dateTimeText } from '../api/normalize'
import { DataSourceImport } from './DataSourceImport'
import { Icon } from './Icon'
import { Avatar, confirmDialog, Empty, Modal, Spinner, Switch, toast, toastError } from './ui'

export interface Library { id: string; name: string; type: string; enabled: boolean; items: number; collection_id: number }
export interface DataSource {
  id: number; mid: number; system: boolean; type: SourceType; name: string; url: string; username: string; has_password: boolean; server_name: string
  libraries: Library[]; auto_sync: boolean; proxy_playback: boolean; status: 'idle' | 'syncing' | 'ok' | 'error'; message: string; last_sync: number; ctime: number; archives: number
  owner: { mid: number; name: string; face: string }
}

const LIBRARY_TYPES: Record<string, string> = { movies: '电影', tvshows: '剧集', homevideos: '家庭视频', musicvideos: '音乐视频', mixed: '混合' }
const STATUS: Record<DataSource['status'], [string, string]> = { idle: ['', '未同步'], syncing: ['brand', '同步中'], ok: ['success', '已同步'], error: ['danger', '同步失败'] }

/** Polls while any source is syncing, so the list follows the background sync. */
export function useSyncPolling(list: DataSource[] | undefined, reload: () => void) {
  const syncing = !!list?.some((x) => x.status === 'syncing')
  useEffect(() => {
    if (!syncing) return
    const t = setInterval(reload, 2000)
    return () => clearInterval(t)
  }, [syncing, reload])
}

/** One data source: status, libraries (each mirrored as a 合集) and actions. */
export function DataSourceCard({ ds, scope, onChanged, onEdit, showOwner }: { ds: DataSource; scope: 'web' | 'admin'; onChanged: () => void; onEdit?: () => void; showOwner?: boolean }) {
  const api = dataSourceAPI(scope)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const sync = async () => { setBusy(true); try { await api.sync(ds.id); onChanged() } catch (e) { toastError(e) } finally { setBusy(false) } }
  const remove = async () => {
    if (!(await confirmDialog(`删除数据源“${ds.name}”？从它导入的 ${ds.archives} 个视频与媒体库合集会一并从 Jumedia 移除（源媒体库将保留）。`, { danger: true, ok: '删除' }))) return
    try { await api.remove(ds.id); toast('已删除', 'success'); onChanged() } catch (e) { toastError(e) }
  }
  const [kind, label] = STATUS[ds.status]
  const enabled = ds.libraries.filter((l) => l.enabled)
  const tone = kind === 'success' ? ['var(--success-soft)', 'var(--success)'] : kind === 'danger' ? ['var(--danger-soft)', '#c43f3b'] : kind === 'brand' ? ['var(--brand-soft)', 'var(--brand)'] : ['var(--surface-2)', 'var(--text-2)']
  return (
    <section className="ds-card" style={ds.status === 'error' ? { borderColor: 'rgba(240,82,78,0.4)' } : undefined}>
      {importing && <DataSourceImport initialID={ds.id} onClose={() => { setImporting(false); onChanged() }} />}
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="ds-ic"><Icon name="box" size={20} /></span>
        <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
          <span className="row wrap" style={{ gap: 8, fontSize: 16, fontWeight: 700 }}>
            <span className="clamp-1" title={ds.name} style={{ minWidth: 0, maxWidth: '100%' }}>{ds.name}</span>
            <span className="row wrap" style={{ gap: 8 }}>
              <span className="ds-state" style={{ background: tone[0], color: tone[1], whiteSpace: 'nowrap' }}>{ds.status === 'syncing' && <Spinner size={10} />}{label}</span>
              <span className="ds-state" style={{ background: ds.proxy_playback !== false ? 'var(--success-soft)' : 'var(--surface-2)', color: ds.proxy_playback !== false ? 'var(--success)' : 'var(--text-2)', whiteSpace: 'nowrap' }}>{ds.proxy_playback !== false ? '代理已开启' : `代理已关闭 ${sourceNames[ds.type]} 直连`}</span>
              {ds.system && <span className="ds-state" style={{ background: 'var(--brand-soft)', color: 'var(--brand)', whiteSpace: 'nowrap' }}>系统</span>}
            </span>
          </span>
          <span className="mono faint clamp-1" style={{ fontSize: 12 }}>{ds.url}{ds.server_name && ` ${ds.server_name}`}</span>
          <span className="row muted" style={{ gap: 6, fontSize: 12 }}><Icon name="user" size={13} />{sourceNames[ds.type]} {ds.username}</span>
        </span>
      </div>
      {showOwner && <div className="row muted" style={{ fontSize: 13 }}><Avatar src={ds.owner.face} size={20} />{ds.system ? '内容显示在官方账号' : '归属'}「<Link to={`/space/${ds.owner.mid}`}>{ds.owner.name}</Link>」下</div>}
      <div className="row wrap" style={{ gap: 6 }}>
        {ds.libraries.map((l) => l.enabled
          ? <span key={l.id} className="ds-lib">{l.name}<b>{l.items}</b></span>
          : <span key={l.id} className="ds-lib off">{l.name}（未接入）</span>)}
        {!ds.libraries.length && <span className="faint" style={{ fontSize: 13 }}>没有可同步的视频媒体库</span>}
      </div>
      {ds.status === 'error' && <span className="ds-err">{ds.message}</span>}
      <div className="ds-foot">
        <dl className="ds-summary">
          <div><dt>已导入稿件</dt><dd>{ds.archives} 个</dd></div>
          <div><dt>已接入媒体库</dt><dd>{enabled.length} 个</dd></div>
          <div><dt>上次整库同步</dt><dd>{ds.last_sync > 0 ? dateTimeText(ds.last_sync) : '尚未同步'}</dd></div>
          {ds.auto_sync && <div><dt>自动同步</dt><dd>已开启</dd></div>}
        </dl>
        <button type="button" className="btn" disabled={busy || ds.status === 'syncing'} onClick={sync}><Icon name="refresh" size={14} />立即同步</button>
        {scope === 'web' && onEdit && <button type="button" className="btn primary" disabled={ds.status === 'syncing'} onClick={() => setImporting(true)}>获取视频</button>}
        {onEdit && <button type="button" className="btn" disabled={ds.status === 'syncing'} onClick={onEdit}>编辑</button>}
        <button type="button" className="btn" style={{ color: '#c43f3b', borderColor: 'rgba(240,82,78,0.4)' }} disabled={ds.status === 'syncing'} onClick={remove}>移除</button>
      </div>
    </section>
  )
}

type Probe = { server_name: string; version: string; libraries: { id: string; name: string; type: string }[] }

/** Add / edit form: connect first (lists libraries), then pick which libraries to mirror. */
export function DataSourceEditor({ scope, value, onClose, onSaved, inline, usage }: { scope: 'web' | 'admin'; value?: DataSource; onClose: () => void; onSaved: () => void; inline?: boolean; usage?: string }) {
  const api = dataSourceAPI(scope)
  const [f, setF] = useState<DataSourceForm>({ type: value?.type ?? 'emby', id: value?.id, name: value?.name ?? '', url: value?.url ?? '', username: value?.username ?? '', password: '', auto_sync: value?.auto_sync ?? true, proxy_playback: value?.proxy_playback ?? true })
  const [clear, setClear] = useState(false)
  const [probe, setProbe] = useState<Probe | null>(value ? { server_name: value.server_name, version: '', libraries: value.libraries } : null)
  const [picked, setPicked] = useState<Set<string>>(new Set(value ? value.libraries.filter((l) => l.enabled).map((l) => l.id) : []))
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const edit = (patch: Partial<DataSourceForm>) => { setF({ ...f, ...patch }); if ('url' in patch || 'username' in patch || 'password' in patch) setError('') }
  const form = (): DataSourceForm => ({ ...f, clear_password: clear && !f.password })
  const connect = async () => {
    setChecking(true); setError('')
    try {
      const p: Probe = await api.test(form())
      setProbe(p)
      // New libraries start enabled; ones the source already knows keep their choice.
      setPicked((old) => new Set(p.libraries.filter((l) => old.has(l.id) || !value?.libraries.some((x) => x.id === l.id)).map((l) => l.id)))
      if (!f.name) setF((x) => ({ ...x, name: p.server_name }))
    } catch (e) { setProbe(null); setError((e as Error).message) } finally { setChecking(false) }
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!probe) return connect()
    setBusy(true)
    try { await api.save({ ...form(), libraries: [...picked].join(','), sync_now: f.auto_sync }); toast(f.auto_sync ? '已保存，开始同步媒体库' : scope === 'web' ? '已保存，可手动获取视频' : '已保存，可手动同步媒体库', 'success'); onSaved() } catch (err) { toastError(err) } finally { setBusy(false) }
  }
  const body = (
    <form className="stack" style={{ gap: 16 }} onSubmit={save}>
      <label className="stack" style={{ gap: 6 }}><span className="lbl">数据源类型</span><select className="select" value={f.type} disabled={!!value || checking || busy} onChange={(e) => { const type = e.target.value as SourceType; edit({ type, password: '', username: '', ...(type === 'fntv' ? { proxy_playback: true } : {}) }); setProbe(null); setPicked(new Set()); setError('') }}>{Object.entries(sourceNames).map(([type, name]) => <option key={type} value={type}>{name}</option>)}</select></label>
      <label className="stack" style={{ gap: 6 }}><span className="lbl">名称</span><span className="inp"><input value={f.name} maxLength={30} placeholder="默认使用服务器名称" onChange={(e) => edit({ name: e.target.value })} /></span></label>
      <label className="stack" style={{ gap: 6 }}><span className="lbl">服务器地址</span><span className="inp"><input className="mono" style={{ fontSize: 13 }} value={f.url} placeholder={`https://${f.type}.example.com`} onChange={(e) => { edit({ url: e.target.value }); setProbe(null) }} required /></span></label>
      <div className="f2" style={{ gap: 16 }}>
        <label className="stack" style={{ gap: 6 }}><span className="lbl">用户名</span><span className="inp"><input value={f.username} autoComplete="off" onChange={(e) => { edit({ username: e.target.value }); setProbe(null) }} required /></span></label>
        <label className="stack" style={{ gap: 6 }}><span className="lbl">密码</span><span className="inp"><input type="password" value={f.password} autoComplete="new-password" placeholder={value?.has_password ? '已保存，留空则不修改' : f.type === 'plex' ? '填写 Plex 账号密码' : '没有密码可留空'} onChange={(e) => { edit({ password: e.target.value }); setProbe(null) }} /></span>
          {value?.has_password && !f.password && <label className="check" style={{ fontSize: 12.5 }}><input type="checkbox" checked={clear} onChange={(e) => { setClear(e.target.checked); setProbe(null) }} />清除已保存的密码</label>}
        </label>
      </div>
      <span className="faint" style={{ marginTop: -6, fontSize: 12 }}>{f.type === 'plex' ? '使用 Plex 用户名或邮箱和密码登录，以只读方式接入该账号可访问的媒体库。' : `使用 ${sourceNames[f.type]} 账号登录，以只读方式接入该账号可访问的媒体库。`}</span>
      {error && <div className="ds-err">{error}</div>}
      {probe && !error && <div className="ds-ok"><Icon name="check" size={16} />连接成功，发现 {probe.libraries.length} 个媒体库{probe.server_name && ` ${probe.server_name}${probe.version ? ` ${probe.version}` : ''}`}</div>}
      {probe && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="lbl">选择要接入的媒体库</span>
          {probe.libraries.map((l) => {
            const on = picked.has(l.id)
            return (
              <label key={l.id} className={`ds-pick ${on ? 'on' : ''}`}>
                <input type="checkbox" checked={on} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n })} />
                <span className="grow">{l.name}</span><span className="muted" style={{ fontSize: 12 }}>{LIBRARY_TYPES[l.type] ?? l.type}</span>
              </label>
            )
          })}
          {!probe.libraries.length && <span className="faint" style={{ fontSize: 13 }}>该账号下没有电影、剧集等视频媒体库</span>}
        </div>
      )}
      <div className="stack" style={{ gap: 6 }}>
        <label className="check"><input type="checkbox" checked={f.proxy_playback} disabled={f.type === 'fntv'} onChange={(e) => edit({ proxy_playback: e.target.checked })} />通过 Jumedia 代理播放</label>
        <div className="muted" style={{ fontSize: 13 }}>{f.proxy_playback ? '视频流量经过 Jumedia 服务端。' : `播放器直接访问 ${sourceNames[f.type]}。播放链接会包含该账号的访问令牌。`}</div>
        {f.type === 'fntv' && <div className="muted" style={{ fontSize: 13 }}>飞牛影视由 Jumedia 代为认证并读取原文件，需要开启代理播放。</div>}
        {import.meta.env.VITE_MOCK !== '0' && <div className="muted" style={{ fontSize: 13 }}>{['fntv', 'plex'].includes(f.type) ? `${sourceNames[f.type]} 接入请使用连接 Jumedia 服务端的网页。` : `浏览器演示模式始终直连 ${sourceNames[f.type]}，代理播放需要使用 Jumedia 服务端。`}</div>}
      </div>
      <label className="row" style={{ gap: 16 }}><span className="grow"><b style={{ fontSize: 14, fontWeight: 600 }}>自动同步</b><div className="muted" style={{ fontSize: 13 }}>{f.auto_sync ? '保存后同步整库，之后定时同步新增和修改' : scope === 'web' ? '只保存连接，之后手动获取视频或同步整库' : '只保存连接，之后手动同步整库'}</div></span><Switch on={f.auto_sync} onChange={(auto_sync) => edit({ auto_sync })} /></label>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn lg" onClick={onClose}>取消</button>
        {!probe ? <button type="button" className="btn primary lg" disabled={checking || !f.url.trim() || !f.username.trim()} onClick={connect}>{checking ? <Spinner size={14} /> : '连接'}</button>
          : <><button type="button" className="btn lg" disabled={checking} onClick={connect}>重新连接</button><button className="btn primary lg" disabled={busy}>{busy ? <Spinner size={14} /> : !f.auto_sync ? '保存数据源' : value ? '保存并同步' : '接入并同步'}</button></>}
      </div>
    </form>
  )
  if (inline) return <section className="ds-card" style={{ border: '2px solid var(--brand)', gap: 16 }}><div className="row between"><h2 style={{ fontSize: 16, fontWeight: 800 }}>{value ? `编辑数据源 ${value.name}` : '添加数据源'}</h2>{usage && <span className="faint" style={{ fontSize: 12 }}>{usage}</span>}</div>{body}</section>
  return <Modal title={value ? `数据源设置 ${value.name}` : '添加数据源'} onClose={onClose} wide>{body}</Modal>
}

export function DataSourceEmpty({ onAdd, disabled }: { onAdd: () => void; disabled?: boolean }) {
  return <Empty icon="box" title="还没有数据源" hint="连接你的 Emby、Jellyfin、飞牛影视或 Plex 服务器，手动选片投稿或自动同步媒体库" action={!disabled && <button className="btn primary" onClick={onAdd}><Icon name="plus" size={15} />添加数据源</button>} />
}
