import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { dataSourceImport, dataSourceItems, dataSources } from '../api/jumedia'
import { useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type { DataSource, Library } from './DataSources'
import { Empty, ErrorState, Loading, Modal, Pager, Spinner, toast, toastError } from './ui'

export function DataSourceImport({ initialID, onClose }: { initialID?: number; onClose: () => void }) {
  const { me } = useSession()
  return <Modal title="从数据源获取视频" onClose={onClose} wide><SourcePicker key={me?.mid} initialID={initialID} onClose={onClose} /></Modal>
}

function SourcePicker({ initialID, onClose }: { initialID?: number; onClose: () => void }) {
  const sources = useAsync(async () => await dataSources() as { list: DataSource[]; enabled: boolean }, [])
  const [id, setID] = useState(initialID)
  const [library, setLibrary] = useState('')
  const [busy, setBusy] = useState(false)
  if (sources.loading && !sources.data) return <Loading />
  if (sources.error) return <ErrorState error={sources.error} retry={sources.reload} />
  if (!sources.data?.enabled) return <Empty title="站点暂未开放个人数据源" />
  const source = sources.data.list.find(s => s.id === id) ?? sources.data.list[0]
  if (!source) return <Empty title="还没有数据源" hint="添加数据源后，可以选择视频导入草稿" action={<Link className="btn primary" to="/creator/datasources" onClick={onClose}>添加数据源</Link>} />
  const libraries = source.libraries.filter(l => l.enabled)
  const lib = libraries.find(l => l.id === library) ?? libraries[0]
  return <div className="stack" style={{ gap: 16 }}>
    <div className="f2" style={{ gap: 12 }}>
      <label className="stack" style={{ gap: 6, minWidth: 0 }}><span className="lbl">数据源</span><span className="inp"><select aria-label="数据源" value={source.id} disabled={busy} onChange={e => { setID(Number(e.target.value)); setLibrary('') }}>{sources.data.list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></span></label>
      <label className="stack" style={{ gap: 6, minWidth: 0 }}><span className="lbl">媒体库</span><span className="inp"><select aria-label="媒体库" value={lib?.id ?? ''} disabled={busy || !lib} onChange={e => setLibrary(e.target.value)}>{libraries.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></span></label>
    </div>
    {!lib ? <Empty title="没有已接入的媒体库" action={<Link className="btn" to="/creator/datasources" onClick={onClose}>管理数据源</Link>} /> : source.status === 'syncing'
      ? <Empty title="数据源正在同步" hint="同步完成后即可选择视频" action={<button type="button" className="btn" onClick={sources.reload}>刷新状态</button>} />
      : <SourceVideos key={`${source.id}/${lib.id}`} source={source} library={lib} onBusy={setBusy} onClose={onClose} />}
  </div>
}

function SourceVideos({ source, library, onBusy, onClose }: { source: DataSource; library: Library; onBusy: (v: boolean) => void; onClose: () => void }) {
  const nav = useNavigate()
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [pn, setPn] = useState(1)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const query = `${pn}/${keyword}`
  const d = useAsync(async () => ({ ...await dataSourceItems({ id: source.id, library: library.id, keyword, pn, ps: 20 }), query }), [source.id, library.id, pn, keyword])
  const result = d.data?.query === query ? d.data : undefined
  const importPicked = async () => {
    setBusy(true); onBusy(true)
    try {
      const r = await dataSourceImport(source.id, library.id, [...picked])
      if (!alive.current) return
      toast(`已导入 ${r.archives.filter(a => a.created).length} 个草稿`, 'success')
      onClose()
      nav(r.archives.length === 1 ? `/creator/upload/${r.archives[0].aid}` : '/creator/archives?status=draft&origin=datasource')
    } catch (e) { if (alive.current) toastError(e) }
    finally { if (alive.current) { setBusy(false); onBusy(false) } }
  }
  return <div className="stack" style={{ gap: 12 }}>
    <form className="row" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); e.stopPropagation(); setKeyword(input.trim()); setPn(1) }}>
      <span className="inp grow" style={{ minWidth: 0 }}><input aria-label="搜索数据源视频" value={input} onChange={e => setInput(e.target.value)} placeholder="搜索视频标题" disabled={busy} /></span>
      <button className="btn" disabled={busy}>搜索</button>
    </form>
    {d.error ? <ErrorState error={d.error} retry={d.reload} /> : !result ? <Loading /> : <>
      {!result.list.length ? <Empty title="没有找到视频" /> : <div className="stack" style={{ gap: 8 }}>
        {result.list.map(item => {
          const existing = item.archive
          const disabled = busy || !!existing || !item.importable || (!picked.has(item.id) && picked.size >= 20)
          return <div key={item.id} className="row" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, minWidth: 0 }}>
            <label className="row grow" style={{ gap: 10, minWidth: 0, cursor: disabled ? 'default' : 'pointer' }}>
              <input type="checkbox" aria-label={`选择 ${item.title}`} checked={picked.has(item.id)} disabled={disabled} onChange={e => setPicked(old => { const next = new Set(old); if (e.target.checked) next.add(item.id); else next.delete(item.id); return next })} />
              <span className="stack grow" style={{ minWidth: 0, gap: 4 }}><b className="clamp-2" style={{ overflowWrap: 'anywhere' }}>{item.title}</b><span className="muted" style={{ fontSize: 12 }}>{item.type === 'Series' ? '剧集 · 导入为多 P 稿件' : '视频'}{!item.importable && ' · 没有可用媒体'}</span></span>
            </label>
            {existing && (existing.state === -100 ? <span className="muted" style={{ flexShrink: 0, fontSize: 12 }}>已删除</span> : <Link className="link-btn" style={{ flexShrink: 0, fontSize: 12 }} to={`/creator/upload/${existing.aid}`} onClick={onClose}>{existing.state === -20 ? '编辑草稿' : '已投稿'}</Link>)}
          </div>
        })}
      </div>}
      <Pager page={pn} total={result.page.total} size={20} onChange={p => { if (!busy) setPn(p) }} />
    </>}
    <div className="row wrap between" style={{ gap: 12 }}><span className="muted" style={{ fontSize: 13 }}>已选 {picked.size} / 20 · 导入后可编辑再投稿</span><button type="button" className="btn primary" disabled={busy || !picked.size} onClick={importPicked}>{busy ? <><Spinner size={14} />正在获取</> : '导入草稿'}</button></div>
  </div>
}
