import { useEffect, useState } from 'react'
import { admin } from '../api/jumedia'
import { dateTimeText, formatDuration } from '../api/normalize'
import { useAsync } from '../lib/hooks'
import { Player } from './Player'
import { Empty, ErrorState, Loading, Pager } from './ui'

const STATUS = { idle: '尚未同步', pending: '等待同步', fetching: '正在获取', ready: '同步完成', unmatched: '未匹配', error: '同步失败' }

/** Remounted per archive so page choices and responses stay with the current review. */
export function AuditMedia({ aid, pages, emby }: { aid: number; pages: { cid: number; part: string }[]; emby: boolean }) {
  const [cid, setCid] = useState(pages[0]?.cid ?? 0)
  return <div className="stack">
    {pages.length > 1 && <label className="field">预览分集<select className="select" value={cid} onChange={(e) => setCid(Number(e.target.value))}>{pages.map((p) => <option key={p.cid} value={p.cid}>{p.part}</option>)}</select></label>}
    {emby ? <SyncedPreview key={cid} aid={aid} cid={cid} /> : <Player key={cid} source={{ kind: 'video', aid, cid }} />}
  </div>
}

function SyncedPreview({ aid, cid }: { aid: number; cid: number }) {
  const [pn, setPn] = useState(1)
  const [seek, setSeek] = useState({ at: 0, n: 0 })
  const d = useAsync(() => admin.archiveDanmaku(aid, cid, pn), [aid, cid, pn])
  const busy = d.data?.pages.some((p) => ['pending', 'fetching'].includes(p.sync.status))
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(d.reload, 3000)
    return () => clearInterval(timer)
  }, [busy, d.reload])
  const sync = d.data?.sync
  return <>
    <Player key={cid} source={{ kind: 'video', aid, cid }} seekTo={seek} />
    <div className="row wrap between"><h3>弹弹play 弹幕</h3><button type="button" className="sm-btn" disabled={d.loading} onClick={d.reload}>刷新</button></div>
    {d.error ? <ErrorState error={d.error} retry={d.reload} /> : !sync ? <Loading /> : <>
      <div className="row wrap" aria-live="polite"><span className={`badge ${sync.status === 'error' ? 'danger' : sync.status === 'ready' ? 'success' : ''}`}>{STATUS[sync.status]}</span><span>{sync.count} 条已同步弹幕</span>{sync.updated_at > 0 && <span className="faint">更新于 {dateTimeText(sync.updated_at)}</span>}</div>
      {sync.episode_id > 0 && <div className="muted">{sync.anime_title} · {sync.episode_title} <span className="faint">#{sync.episode_id}</span></div>}
      {sync.message && <p className="muted">{sync.message}{sync.count > 0 ? '；保留上次同步的数据' : ''}</p>}
      {sync.status === 'idle' && <p className="faint">在站点设置中启用弹弹play 后，播放时会自动获取弹幕，也可重新同步此 Emby 数据源预取弹幕。</p>}
      {d.data && d.data.list.length > 0 ? <>
        <div className="table-wrap"><table className="table"><thead><tr><th>时间</th><th>弹幕内容</th><th>位置</th></tr></thead><tbody>{d.data.list.map((dm) => <tr key={dm.id}><td><button type="button" className="sm-btn" aria-label={`从 ${formatDuration(dm.progress / 1000)} 预览弹幕`} onClick={() => setSeek((s) => ({ at: dm.progress / 1000, n: s.n + 1 }))}>{formatDuration(dm.progress / 1000)}</button></td><td style={{ overflowWrap: 'anywhere' }}>{dm.content}</td><td>{dm.mode === 5 ? '顶部' : dm.mode === 4 ? '底部' : '滚动'}</td></tr>)}</tbody></table></div>
        {d.data.page.total > 20 && <Pager page={pn} size={20} total={d.data.page.total} onChange={setPn} />}
      </> : <Empty title="暂无已同步弹幕" icon="comment" />}
    </>}
  </>
}
