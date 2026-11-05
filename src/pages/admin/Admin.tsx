import { type FormEvent, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { post } from '../../api/client'
import { admin } from '../../api/jumedia'
import * as jm from '../../api/jumedia'
import * as juli from '../../api/juli'
import { countText, dateTimeText, formatDuration } from '../../api/normalize'
import { AreaChart } from '../../components/Chart'
import { AuditMedia } from '../../components/AuditMedia'
import { AdminUserPasswordDialog } from '../../components/AdminUserPasswordDialog'
import { Icon } from '../../components/Icon'
import { ConsoleFrame, ConsoleNav, Header } from '../../components/Layout'
import { type DataSource, DataSourceCard, DataSourceEditor, useSyncPolling } from '../../components/DataSources'
import { CacheStatus, cacheBusy, StreamSourceEditor } from '../../components/StreamSource'
import { Avatar, confirmDialog, Empty, ErrorState, Level, Loading, Modal, Pager, Switch, Tabs, toast, toastError } from '../../components/ui'
import { CHANNELS, SEASON_TYPES } from '../../lib/categories'
import { useAsync, useTitle } from '../../lib/hooks'
import { useSession } from '../../lib/session'

const NAV: { group: string; items: { to: string; icon: string; label: string; end?: boolean; badge?: boolean }[] }[] = [
  { group: '概览', items: [{ to: '/admin', icon: 'chart', label: '仪表盘', end: true }] },
  { group: '内容', items: [{ to: '/admin/audit', icon: 'check-circle', label: '稿件审核', badge: true }, { to: '/admin/archives', icon: 'film', label: '稿件管理' }, { to: '/admin/bangumi', icon: 'tv', label: '番剧管理' }, { to: '/admin/live', icon: 'live', label: '直播管理' }, { to: '/admin/datasources', icon: 'box', label: '数据源' }] },
  { group: '社区', items: [{ to: '/admin/users', icon: 'users', label: '用户管理' }, { to: '/admin/moderation', icon: 'comment', label: '评论与弹幕' }] },
  { group: '运营', items: [{ to: '/admin/regions', icon: 'grid', label: '分区设置' }, { to: '/admin/banners', icon: 'image', label: '轮播推荐' }, { to: '/admin/settings', icon: 'settings', label: '站点设置' }, { to: '/admin/logs', icon: 'list', label: '操作日志' }] },
]

let refreshPending = () => {}

/** Puts a page's header actions (search, create buttons) into the title row the layout draws. */
function HeadActions({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => { setSlot(document.getElementById('admin-actions')) }, [])
  return slot ? createPortal(children, slot) : null
}

function SearchPill({ value, onChange, onSubmit, placeholder }: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="row" style={{ width: 240, height: 36, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 14px', gap: 8, color: 'var(--text-3)' }}>
      <Icon name="search" size={15} /><input style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'none', color: 'var(--text)' }} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </form>
  )
}

function ListFoot({ pn, size, total, onChange }: { pn: number; size: number; total: number; onChange: (p: number) => void }) {
  return <div className="list-foot" style={{ borderTop: '1px solid var(--line)' }}><span>{total ? `第 ${(pn - 1) * size + 1}–${Math.min(total, pn * size)} 条，共 ${total} 条` : '共 0 条'}</span><Pager page={pn} total={total} size={size} onChange={onChange} /></div>
}

export function AdminLayout() {
  const { pathname } = useLocation()
  const pending = useAsync(async () => (await admin.archives({ pn: 1, state: '-1' })).page.total as number, [pathname])
  refreshPending = pending.reload
  const title = NAV.flatMap((g) => g.items).find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)))?.label ?? '管理后台'
  useTitle(`${title} · 管理后台`)
  const groups = NAV.map((g) => ({ group: g.group, items: g.items.map((i) => ({ ...i, badge: i.badge ? pending.data : undefined })) }))
  // 每页标题下的说明，数字取自仪表盘汇总。
  const sum = useAsync(() => admin.dashboard(), [pathname])
  const n = sum.data
  const at = new Date()
  const subs: Record<string, string> = {
    '/admin': `数据更新于 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
    '/admin/audit': `${pending.data ?? 0} 个稿件待审核 · 按投稿时间排列`,
    '/admin/archives': n ? `共 ${n.archives} 个已发布稿件 · ${n.pending} 个待审核` : '',
    '/admin/bangumi': n ? `${n.seasons} 部 · ${n.episodes} 集` : '',
    '/admin/live': n ? `${n.rooms} 个直播间 · ${n.live_now} 个直播中` : '',
    '/admin/datasources': '以只读方式接入 Emby，媒体库中的内容成为站内视频',
    '/admin/users': n ? `共 ${n.users} 个用户 · ${n.banned} 个已封禁` : '',
    '/admin/moderation': n ? `今日新增评论 ${countText(n.reply_today ?? 0)} 条 · 弹幕 ${countText(n.danmaku_today ?? 0)} 条` : '',
    '/admin/regions': '分区用于投稿分类、频道页与排行榜；隐藏后不在前台展示。拖动左侧把手调整顺序。',
    '/admin/banners': '首页、番剧页和频道页顶部的大图推荐，按排序号从小到大展示',
    '/admin/settings': '',
    '/admin/logs': '保留最近 500 条操作',
  }
  return (
    <>
      <Header />
      <ConsoleFrame nav={<ConsoleNav area="admin" groups={groups} />}>
        <div className="chead"><h1>{title}</h1>{subs[pathname.replace(/\/$/, '')] && <span className="muted" style={{ fontSize: 14 }}>{subs[pathname.replace(/\/$/, '')]}</span>}<span className="grow" /><div id="admin-actions" className="row wrap" style={{ gap: 8 }} /></div>
        <div className="admin"><Outlet /></div>
      </ConsoleFrame>
    </>
  )
}


export function Dashboard() {
  const d = useAsync(() => admin.dashboard(), [])
  const [metric, setMetric] = useState<'views' | 'uploads' | 'users'>('views')
  if (d.loading) return <Loading />
  if (d.error) return <ErrorState error={d.error} retry={d.reload} />
  const s = d.data
  const stats = [
    { k: '注册用户', icon: 'users', v: countText(s.users), sub: `${s.banned} 个已封禁` },
    { k: '已发布稿件', icon: 'film', v: countText(s.archives), sub: `${s.pending} 个待审核`, warn: s.pending > 0 },
    { k: '番剧 / 剧集', icon: 'tv', v: `${s.seasons} / ${s.episodes}`, sub: '部 / 集' },
    { k: '直播间', icon: 'live', v: countText(s.rooms), sub: `${s.live_now} 个直播中` },
    { k: '总播放', icon: 'play', v: countText(s.views), sub: '全部稿件累计' },
    { k: '评论 / 弹幕', icon: 'comment', v: `${countText(s.replies)} / ${countText(s.danmaku)}`, sub: '用户发表' },
  ]
  const regions = s.regions.filter((r: any) => r.count).sort((a: any, b: any) => b.count - a.count).slice(0, 8)
  const max = Math.max(1, ...regions.map((r: any) => r.count))
  const LOG_TONE: Record<string, [string, string]> = { 审核通过: ['var(--success-soft)', 'var(--success)'], 退回稿件: ['var(--danger-soft)', '#c43f3b'], 封禁用户: ['var(--danger-soft)', '#c43f3b'] }
  return (
    <div className="page" style={{ gap: 20 }}>
      <div className="g6s">
        {stats.map((x) => <div key={x.k} className="kpi"><span className="k"><Icon name={x.icon} size={15} />{x.k}</span><b style={{ fontSize: 24 }}>{x.v}</b><span className="d" style={{ color: x.warn ? '#c27a12' : undefined }}>{x.sub}</span></div>)}
      </div>
      {s.pending > 0 && (
        <Link to="/admin/audit" className="row" style={{ gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--warning-soft)', border: '1px solid rgba(232,150,28,0.5)', color: 'var(--text)' }}>
          <Icon name="alert-circle" size={20} style={{ color: 'var(--warning)' }} />
          <span className="grow">有 <b>{s.pending}</b> 个稿件正在等待审核</span>
          <span className="sm-btn">去审核</span>
        </Link>
      )}
      <div className="cols-32">
        <section className="card-sec" style={{ gap: 14 }}>
          <div className="row wrap" style={{ gap: 12 }}><h2 className="h2">近 14 日趋势</h2><span className="grow" />
            <span className="seg-pill">{([['views', '播放'], ['uploads', '投稿'], ['users', '新用户']] as const).map(([v, l]) => <button type="button" key={v} className={metric === v ? 'on' : ''} onClick={() => setMetric(v)}>{l}</button>)}</span>
          </div>
          <AreaChart data={s.trend} x="date" y={metric} height={220} />
        </section>
        <section className="card-sec">
          <h2 style={{ marginBottom: 4 }}>分区稿件分布</h2>
          {regions.map((r: any) => <div key={r.tid} className="barrow"><span>{r.name}</span><span className="track"><i style={{ width: `${(r.count / max) * 100}%` }} /></span><span>{r.count}</span></div>)}
        </section>
      </div>
      <div className="cols-32">
        <section className="card-sec" style={{ gap: 2 }}>
          <h2 style={{ marginBottom: 10 }}>热门稿件</h2>
          {s.top.map((a: any, i: number) => (
            <Link key={a.aid} to={`/video/${a.bvid}`} className="row" style={{ gap: 12, padding: '8px 0', color: 'var(--text)' }}>
              <span style={{ flex: 'none', width: 20, fontSize: 14, fontWeight: 800, fontStyle: 'italic', color: i < 3 ? 'var(--accent)' : 'var(--text-3)' }}>{i + 1}</span>
              <img src={a.pic} alt="" style={{ width: 80, aspectRatio: '16/10', objectFit: 'cover', borderRadius: 6, flex: 'none' }} />
              <span className="stack grow" style={{ minWidth: 0, gap: 0 }}><b className="clamp-1" style={{ fontSize: 14, fontWeight: 600 }}>{a.title}</b><span className="muted" style={{ fontSize: 12 }}>{a.owner?.name}</span></span>
              <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{countText(a.stat.view)}</span>
            </Link>
          ))}
        </section>
        <section className="card-sec">
          <div className="row between"><h2 className="h2">最近操作</h2><Link to="/admin/logs" className="muted" style={{ fontSize: 13 }}>全部 ›</Link></div>
          {s.recent.map((l: any) => { const t = LOG_TONE[l.action] ?? ['var(--brand-soft)', 'var(--brand)']; return (
            <div key={l.id} className="row" style={{ gap: 10, fontSize: 13 }}>
              <span style={{ flex: 'none', height: 22, padding: '0 8px', borderRadius: 6, background: t[0], color: t[1], fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{l.action}</span>
              <span className="grow clamp-1">{l.target}</span>
              <span className="faint nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>{dateTimeText(l.ctime)}</span>
            </div>
          ) })}
        </section>
      </div>
    </div>
  )
}

export function Users() {
  const [pn, setPn] = useState(1)
  const [kw, setKw] = useState('')
  const [q, setQ] = useState({ keyword: '', role: '', status: '' })
  const d = useAsync(() => admin.users({ pn, ...q }), [pn, q])
  const [edit, setEdit] = useState<any>(null)
  const [passwordUser, setPasswordUser] = useState<{ mid: number; uname: string } | null>(null)
  const { me, refresh } = useSession()
  const update = async (p: { mid: number; role?: string; status?: number; coins?: number }) => {
    try { const r = await admin.userUpdate(p); if (r.code) throw new Error(r.message); d.reload(); toast('已更新', 'success') } catch (e) { toastError(e) }
  }
  const filter = `${q.role}|${q.status}`
  return (
    <div className="stack" style={{ gap: 16 }}>
      <HeadActions><SearchPill value={kw} onChange={setKw} onSubmit={() => { setQ({ ...q, keyword: kw }); setPn(1) }} placeholder="昵称或 UID" /></HeadActions>
      <div className="chips-b">{[['|', '全部'], ['admin|', '管理员'], ['user|', '普通用户'], ['|1', '已封禁']].map(([v, l]) => <button type="button" key={v} className={filter === v ? 'on' : ''} onClick={() => { const [role, status] = v.split('|'); setQ({ ...q, role, status }); setPn(1) }}>{l}</button>)}</div>
      {d.loading && !d.data ? <Loading /> : (
        <section className="list-card"><div className="table-wrap"><table className="table">
          <thead><tr><th>用户</th><th>UID</th><th>角色</th><th>等级</th><th>硬币</th><th>稿件</th><th>粉丝</th><th>注册时间</th><th>状态</th><th /></tr></thead>
          <tbody>{d.data?.list.map((u: any) => (
            <tr key={u.mid}>
              <td><Link to={`/space/${u.mid}`} className="row"><Avatar src={u.face} size={32} /><div><div style={{ fontWeight: 600 }}>{u.uname}</div><div className="faint" style={{ fontSize: 12 }}>@{u.username}</div></div></Link></td>
              <td className="mono">{u.mid}</td>
              <td>{u.role === 'admin' ? <span className="log-tag">管理员</span> : <span className="log-tag" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>用户</span>}</td>
              <td><Level n={u.level} /></td><td className="mono">{Math.floor(u.coins)}</td><td>{u.archives}</td><td>{countText(u.follower)}</td>
              <td className="nowrap faint">{dateTimeText(u.ctime).slice(0, 10)}</td>
              <td><span className="row" style={{ gap: 6, color: u.status ? '#c43f3b' : 'var(--success)' }}><i style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor' }} />{u.status ? '已封禁' : '正常'}</span></td>
              <td><div className="actions">
                <button className="btn sm" onClick={() => setEdit({ ...u })}>编辑</button>
                <button className="btn sm" onClick={() => setPasswordUser({ mid: u.mid, uname: u.uname })}>修改密码</button>
                {u.mid !== me?.mid && <button className={`btn sm ${u.status ? '' : 'danger'}`} onClick={async () => { if (u.status || (await confirmDialog(`封禁用户“${u.uname}”？其登录会话会立即失效。`, { danger: true, ok: '封禁' }))) update({ mid: u.mid, status: u.status ? 0 : 1 }) }}>{u.status ? '解封' : '封禁'}</button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div><ListFoot pn={pn} size={20} total={d.data?.page.total ?? 0} onChange={setPn} /></section>
      )}
      {passwordUser && <AdminUserPasswordDialog key={passwordUser.mid} user={passwordUser} onClose={() => setPasswordUser(null)} onSaved={() => { setPasswordUser(null); if (passwordUser.mid === me?.mid) void refresh() }} />}
      {edit && (
        <Modal title={`编辑用户 · ${edit.uname}`} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn primary" onClick={() => { update({ mid: edit.mid, role: edit.role, coins: edit.coins }); setEdit(null) }}>保存</button></>}>
          <div className="stack">
            <div className="field"><label>角色</label><select className="select" value={edit.role} disabled={edit.mid === me?.mid} onChange={(e) => setEdit({ ...edit, role: e.target.value })}><option value="user">普通用户</option><option value="admin">管理员</option></select></div>
            <div className="field"><label>硬币余额</label><input className="input" type="number" value={Math.floor(edit.coins)} onChange={(e) => setEdit({ ...edit, coins: +e.target.value })} /></div>
            <div className="faint" style={{ fontSize: 13 }}>邮箱：{edit.email || '未填写'} · 签名：{edit.sign || '—'}</div>
          </div>
        </Modal>
      )}
    </div>
  )
}

const STATE: Record<number, [string, string]> = { 0: ['已通过', 'success'], [-1]: ['待审核', 'warning'], [-2]: ['已退回', 'danger'], [-100]: ['已删除', ''] }

export function Audit() {
  const d = useAsync(() => admin.archives({ pn: 1, state: '-1' }), [])
  const [current, setCurrent] = useState<any>()
  const [reason, setReason] = useState('')
  const list: any[] = d.data?.list ?? []
  const item = list.find((a) => a.aid === current?.aid) ?? list[0]
  const decide = async (state: number) => {
    if (!item) return
    if (state === -2 && !reason.trim()) return toast('请填写退回原因', 'error')
    try { await admin.archiveAudit(item.aid, state, reason); toast(state === 0 ? '已通过' : '已退回', 'success'); setReason(''); setCurrent(undefined); d.reload(); refreshPending() } catch (e) { toastError(e) }
  }
  if (d.loading && !d.data) return <Loading />
  if (!list.length) return <div className="panel"><Empty title="审核队列已清空" hint="新投稿会出现在这里" icon="check-circle" /></div>
  return (
    <div className="audit">
      <div className="audit-queue">
        {list.map((a) => (
          <button key={a.aid} className={`audit-item ${item?.aid === a.aid ? 'on' : ''}`} onClick={() => setCurrent(a)}>
            <img src={a.pic} alt="" />
            <div className="grow"><div style={{ fontWeight: 600 }} className="clamp-2">{a.title}</div><div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{a.owner.name} · {a.tname} · {a.videos}P · {formatDuration(a.duration)}</div><div className="faint" style={{ fontSize: 12 }}>{dateTimeText(a.ctime)}</div></div>
          </button>
        ))}
      </div>
      {item && (
        <div className="panel audit-preview stack">
          <AuditMedia key={item.aid} aid={item.aid} pages={item.pages ?? []} emby={item.origin?.type === 'emby'} />
          <h2 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.4 }}>{item.title}</h2>
          <div className="row wrap" style={{ fontSize: 13 }}><span className="badge">{item.tname}</span><span className="badge">{item.copyright === 1 ? '自制' : '转载'}</span>{item.tag.split(',').filter(Boolean).map((t: string) => <span key={t} className="badge brand">{t}</span>)}</div>
          <p className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{item.desc || '（无简介）'}</p>
          <div className="row"><Avatar src={item.owner.face} size={28} /><Link to={`/space/${item.owner.mid}`}>{item.owner.name}</Link><span className="faint">UID {item.owner.mid}</span></div>
          <hr className="divider" style={{ margin: '4px 0' }} />
          <div className="field"><label>退回原因</label><div className="row wrap">{['标题党或封面与内容不符', '画质过低', '内容涉嫌侵权', '分区选择错误'].map((r) => <button key={r} className="chip" onClick={() => setReason(r)}>{r}</button>)}</div><textarea className="textarea" style={{ minHeight: 64 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="退回时必填，将展示给创作者" /></div>
          <div className="row"><button type="button" className="aud-btn no" onClick={() => decide(-2)}><Icon name="x" size={16} />退回</button><button type="button" className="aud-btn ok" onClick={() => decide(0)}><Icon name="check" size={16} />通过并发布</button></div>
        </div>
      )}
    </div>
  )
}

export function ArchivesAdmin() {
  const [pn, setPn] = useState(1)
  const [state, setState] = useState('')
  const [kw, setKw] = useState('')
  const [q, setQ] = useState('')
  const regions = useAsync(() => juli.regionList(), [])
  const [tid, setTid] = useState(0)
  const d = useAsync(() => admin.archives({ pn, state, keyword: q, tid }), [pn, state, q, tid])
  const act = async (a: any, action: 'pass' | 'reject' | 'delete') => {
    try {
      if (action === 'delete') { if (!(await confirmDialog(`删除稿件“${a.title}”？`, { danger: true, ok: '删除' }))) return; await admin.archiveDelete(a.aid) }
      else await admin.archiveAudit(a.aid, action === 'pass' ? 0 : -2, action === 'reject' ? '管理员下架' : '')
      d.reload(); refreshPending(); toast('已处理', 'success')
    } catch (e) { toastError(e) }
  }
  const tabs = [{ value: '', label: '全部' }, { value: '0', label: '已通过' }, { value: '-1', label: '待审核', count: d.data?.counts.pending }, { value: '-2', label: '已退回', count: d.data?.counts.rejected }, { value: '-100', label: '已删除' }]
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="line-tabs">
        {tabs.map((t) => <button type="button" key={t.value} className={state === t.value ? 'on' : ''} onClick={() => { setState(t.value); setPn(1) }}>{t.label}{t.count !== undefined && <small>{t.count}</small>}</button>)}
        <span className="grow" />
        <form className="row" style={{ gap: 8, marginBottom: 6 }} onSubmit={(e) => { e.preventDefault(); setQ(kw); setPn(1) }}>
          <span className="row" style={{ width: 260, height: 34, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line-strong)', padding: '0 12px', gap: 8, color: 'var(--text-3)' }}><Icon name="search" size={15} /><input style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'none', color: 'var(--text)' }} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="标题 / BV 号 / UP 主" /></span>
          <select className="select" style={{ height: 34, width: 'auto' }} value={tid} onChange={(e) => { setTid(+e.target.value); setPn(1) }}><option value={0}>全部分区</option>{(regions.data ?? []).map((r: any) => <option key={r.tid} value={r.tid}>{r.name}</option>)}</select>
          <button className="btn primary" style={{ height: 34 }}>搜索</button>
        </form>
      </div>
      {d.loading && !d.data ? <Loading /> : (
        <section className="list-card"><div className="table-wrap"><table className="table">
          <thead><tr><th>稿件</th><th>UP 主</th><th>分区</th><th>播放</th><th>点赞</th><th>投稿时间</th><th>状态</th><th /></tr></thead>
          <tbody>{d.data?.list.map((a: any) => (
            <tr key={a.aid}>
              <td><Link to={`/video/${a.bvid}`} className="cell-media"><img src={a.pic} alt="" /><div><div className="t clamp-2">{a.title}</div><div className="s mono">{a.bvid}</div></div></Link></td>
              <td className="nowrap">{a.owner.name}</td><td className="nowrap">{a.tname}</td><td className="mono">{countText(a.stat.view)}</td><td className="mono">{countText(a.stat.like)}</td>
              <td className="nowrap faint">{dateTimeText(a.ctime)}</td>
              <td><span className={`badge ${STATE[a.state]?.[1] ?? ''}`}>{STATE[a.state]?.[0]}</span>{a.reason && <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{a.reason}</div>}</td>
              <td><div className="actions">
                {a.state !== 0 && a.state !== -100 && <button className="btn sm" onClick={() => act(a, 'pass')}>通过</button>}
                {a.state === 0 && <button className="btn sm" onClick={() => act(a, 'reject')}>下架</button>}
                {a.state !== -100 && <button className="btn sm danger" onClick={() => act(a, 'delete')}>删除</button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>{d.data?.list.length === 0 && <Empty title="没有符合条件的稿件" />}<ListFoot pn={pn} size={20} total={d.data?.page.total ?? 0} onChange={setPn} /></section>
      )}
    </div>
  )
}

const blankSeason = { title: '', season_type: 1, evaluate: '', areas: ['日本'], styles: [] as string[], score: 9, is_finish: false, weekday: 1, pub_time: '20:00', cover: '', horizontal: '', state: 0, episodes: [] as any[] }

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const secsOf = (v: string) => { const n = v.trim().split(':').map(Number); return n.some((x) => !Number.isFinite(x)) ? NaN : n.reduce((s, x) => s * 60 + x, 0) }
function parseOp(text: string) {
  const [a, b] = text.split(/[-–~]/).map(secsOf)
  return text.trim() && b > a ? [a, b] : null
}
function parsePoints(text: string) {
  return text.split('\n').map((l) => /^\s*([\d:]+)\s+(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m && Number.isFinite(secsOf(m[1]))).map((m) => ({ from: secsOf(m[1]), content: m[2].trim() }))
}

export function BangumiAdmin() {
  const [pn, setPn] = useState(1)
  const [type, setType] = useState(0)
  const d = useAsync(() => admin.seasons({ pn, season_type: type || undefined }), [pn, type])
  const [edit, setEdit] = useState<any>(null)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    // 片头 and 本话看点 are edited as text; parse them back into op / points.
    const episodes = edit.episodes.map(({ opText, pointsText, ...ep }: any) => ({
      ...ep,
      op: opText === undefined ? ep.op : parseOp(opText),
      points: pointsText === undefined ? ep.points : parsePoints(pointsText),
    }))
    const { mode: _mode, ...season } = edit
    try { const r = await admin.seasonSave({ ...season, episodes }); if (r.code) throw new Error(r.message); setEdit(null); d.reload(); toast('已保存', 'success') } catch (err) { toastError(err) }
  }
  const del = async (s: any) => {
    if (!(await confirmDialog(`删除番剧“${s.title}”及其全部剧集？`, { danger: true, ok: '删除' }))) return
    try { await admin.seasonDelete(s.season_id); d.reload() } catch (err) { toastError(err) }
  }
  const upload = async (field: 'cover' | 'horizontal', file?: File) => { if (file) try { const r = await jm.uploadFile('image', file); setEdit((x: any) => ({ ...x, [field]: r.url })) } catch (err) { toastError(err) } }
  const uploadEpisode = async (i: number, file?: File) => {
    if (!file) return
    try {
      const r = await jm.uploadFile('video', file)
      const v = document.createElement('video'); v.preload = 'metadata'; v.src = URL.createObjectURL(file)
      v.onloadedmetadata = () => setEdit((x: any) => ({ ...x, episodes: x.episodes.map((ep: any, k: number) => (k === i ? { ...ep, media: r.filename, duration: Math.round(v.duration) } : ep)) }))
      toast('剧集视频已上传', 'success')
    } catch (err) { toastError(err) }
  }
  const setEp = (i: number, patch: any) => setEdit((x: any) => ({ ...x, episodes: x.episodes.map((ep: any, k: number) => (k === i ? { ...ep, ...patch } : ep)) }))
  const [extra, setExtra] = useState<number | null>(null)
  return (
    <div className="stack" style={{ gap: 16 }}>
      <HeadActions><button className="btn primary" style={{ height: 36, borderRadius: 18 }} onClick={() => setEdit({ ...blankSeason, episodes: [], mode: 'info' })}><Icon name="plus" size={15} />新建番剧</button></HeadActions>
      <div className="chips-b">{[{ value: 0, label: '全部' }, ...SEASON_TYPES].filter((t) => !t.value || d.data?.counts?.[t.value]).map((t) => <button type="button" key={t.value} className={type === t.value ? 'on' : ''} onClick={() => { setType(t.value); setPn(1) }}>{t.label}<small>{d.data?.counts?.[t.value] ?? 0}</small></button>)}</div>
      {d.loading && !d.data ? <Loading /> : (
        <section className="list-card"><div className="table-wrap"><table className="table">
          <thead><tr><th>番剧</th><th>类型</th><th>剧集</th><th>评分</th><th>播放</th><th>追番</th><th>更新</th><th>状态</th><th /></tr></thead>
          <tbody>{d.data?.list.map((s: any) => (
            <tr key={s.season_id}>
              <td><Link to={`/bangumi/play/ss${s.season_id}`} className="cell-media poster"><img src={s.cover} alt="" /><div><div className="t">{s.title}</div><div className="s">{s.styles.join(' / ')} · ss{s.season_id}</div></div></Link></td>
              <td className="muted">{SEASON_TYPES.find((t) => t.value === s.season_type)?.label}</td><td className="mono">{s.is_finish ? `${s.episodes.length} / ${s.episodes.length}` : s.episodes.length}</td><td style={{ color: 'var(--gold)', fontWeight: 700 }}>{s.score}</td>
              <td className="mono">{countText(s.views)}</td><td className="mono">{countText(s.follow)}</td>
              <td className="nowrap muted">{s.is_finish ? '已完结' : `周${'一二三四五六日'[s.weekday - 1]} ${s.pub_time}`}</td>
              <td>{s.state === 0 ? <span className="badge success">上架</span> : <span className="badge">下架</span>}</td>
              <td><div className="actions"><button className="btn sm" onClick={() => setEdit({ ...JSON.parse(JSON.stringify(s)), mode: 'info' })}>编辑</button><button className="btn sm" onClick={() => setEdit({ ...JSON.parse(JSON.stringify(s)), mode: 'eps' })}>剧集</button><button className="btn sm danger" onClick={() => del(s)}>删除</button></div></td>
            </tr>
          ))}</tbody>
        </table></div><ListFoot pn={pn} size={20} total={d.data?.page.total ?? 0} onChange={setPn} /></section>
      )}
      {edit && (
        <Modal title={edit.mode === 'eps' ? `剧集 · ${edit.title}` : edit.season_id ? `编辑 · ${edit.title}` : '新建番剧'} onClose={() => setEdit(null)} wide>
          <form className="stack" onSubmit={save}>
            {edit.mode !== 'eps' && <div className="form-grid">
              <div className="field span-2"><label>标题</label><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required /></div>
              <div className="field"><label>类型</label><select className="select" value={edit.season_type} onChange={(e) => setEdit({ ...edit, season_type: +e.target.value })}>{SEASON_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
              <div className="field"><label>评分</label><input className="input" type="number" step={0.1} min={0} max={10} value={edit.score} onChange={(e) => setEdit({ ...edit, score: +e.target.value })} /></div>
              <div className="field"><label>地区（逗号分隔）</label><input className="input" value={edit.areas.join(',')} onChange={(e) => setEdit({ ...edit, areas: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></div>
              <div className="field"><label>风格（逗号分隔）</label><input className="input" value={edit.styles.join(',')} onChange={(e) => setEdit({ ...edit, styles: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></div>
              <div className="field"><label>更新日</label><select className="select" value={edit.weekday} onChange={(e) => setEdit({ ...edit, weekday: +e.target.value })}>{[1, 2, 3, 4, 5, 6, 7].map((w) => <option key={w} value={w}>周{'一二三四五六日'[w - 1]}</option>)}</select></div>
              <div className="field"><label>更新时间</label><input className="input" type="time" value={edit.pub_time} onChange={(e) => setEdit({ ...edit, pub_time: e.target.value })} /></div>
              <div className="field span-2"><label>简介</label><textarea className="textarea" value={edit.evaluate} onChange={(e) => setEdit({ ...edit, evaluate: e.target.value })} /></div>
              <div className="field"><label>竖版封面</label><label className="cover-pick" style={{ width: 120, aspectRatio: '3/4' }}>{edit.cover && <img src={edit.cover} alt="" />}<div className="over">上传</div><input type="file" accept="image/*" hidden onChange={(e) => upload('cover', e.target.files?.[0])} /></label></div>
              <div className="field"><label>横版海报（轮播）</label><label className="cover-pick" style={{ width: '100%', aspectRatio: '21/9' }}>{edit.horizontal && <img src={edit.horizontal} alt="" />}<div className="over">上传</div><input type="file" accept="image/*" hidden onChange={(e) => upload('horizontal', e.target.files?.[0])} /></label></div>
              <label className="row between"><span>已完结</span><Switch on={edit.is_finish} onChange={(v) => setEdit({ ...edit, is_finish: v })} /></label>
              <label className="row between"><span>上架</span><Switch on={edit.state === 0} onChange={(v) => setEdit({ ...edit, state: v ? 0 : 1 })} /></label>
            </div>}
            {edit.mode === 'eps' && <div className="field">
              <div className="row between"><span className="label">剧集（{edit.episodes.length}）</span><button type="button" className="btn sm" onClick={() => setEdit({ ...edit, episodes: [...edit.episodes, { title: String(edit.episodes.length + 1), long_title: '', duration: 1440, badge: '' }] })}><Icon name="plus" size={14} />添加剧集</button></div>
              {edit.episodes.map((ep: any, i: number) => (
                <div key={ep.ep_id ?? 'new' + i} className="ep-editor">
                  <input className="input sm" value={ep.title} onChange={(e) => setEp(i, { title: e.target.value })} placeholder="集数" />
                  <input className="input sm" value={ep.long_title} onChange={(e) => setEp(i, { long_title: e.target.value })} placeholder="单集标题" />
                  <span className="faint clamp-1" style={{ fontSize: 12 }}>{ep.media ? (ep.media.startsWith('idb:') ? '已上传视频' : ep.media) : '未上传视频'}</span>
                  <span className="faint mono" style={{ fontSize: 12 }}>{formatDuration(ep.duration ?? 0)}</span>
                  <label className="btn sm"><Icon name="upload" size={14} />{ep.media ? '替换视频' : '上传视频'}<input type="file" accept="video/*" hidden onChange={(e) => uploadEpisode(i, e.target.files?.[0])} /></label>
                  <button type="button" className={`btn ghost sm icon ${extra === i ? 'on' : ''}`} title="片头与本话看点" onClick={() => setExtra(extra === i ? null : i)}><Icon name="list" size={14} /></button>
                  <button type="button" className="btn ghost sm icon" onClick={() => setEdit({ ...edit, episodes: edit.episodes.filter((_: any, k: number) => k !== i) })}><Icon name="trash" size={14} /></button>
                  {extra === i && <div className="ep-extra">
                    <div className="field"><label>片头</label><input className="input sm mono" placeholder="01:30-03:00" value={ep.opText ?? (ep.op ? `${mmss(ep.op[0])}-${mmss(ep.op[1])}` : '')} onChange={(e) => setEp(i, { opText: e.target.value })} /><span className="hint">播放器显示「跳过片头」，留空则不显示</span></div>
                    <div className="field"><label>本话看点</label><textarea className="textarea mono" rows={4} placeholder={'03:40 重新开始的早晨\n11:25 影子第一次出现'} value={ep.pointsText ?? (ep.points ?? []).map((p: any) => `${mmss(p.from)} ${p.content}`).join('\n')} onChange={(e) => setEp(i, { pointsText: e.target.value })} /><span className="hint">每行一个：时间 + 内容；也会作为进度条上的分段</span></div>
                  </div>}
                </div>
              ))}
            </div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn primary">保存</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

export function LiveAdmin() {
  const [params] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') ?? 'rooms')
  const [pn, setPn] = useState(1)
  const [kw, setKw] = useState('')
  const [q, setQ] = useState('')
  const rooms = useAsync(() => admin.liveRooms({ pn, keyword: q }), [pn, q])
  const areas = useAsync(() => admin.liveAreas(), [])
  const ban = async (r: any) => {
    if (!r.banned && !(await confirmDialog(`封禁直播间“${r.title}”？将立即中断直播。`, { danger: true, ok: '封禁' }))) return
    try { await admin.liveRoomBan(r.room_id, !r.banned); rooms.reload() } catch (e) { toastError(e) }
  }
  const saveArea = async (id: number | undefined, name: string) => { if (!name.trim()) return; try { await admin.liveAreaSave({ id, name }); areas.reload() } catch (e) { toastError(e) } }
  const [sourceRoom, setSourceRoom] = useState<any>(null)
  const [startNow, setStartNow] = useState(true)
  const transcoding = !!rooms.data?.list.some((r: any) => cacheBusy(r.source?.cache))
  useEffect(() => {
    if (!transcoding || tab !== 'rooms') return
    const t = setInterval(rooms.reload, 3000)
    return () => clearInterval(t)
  }, [transcoding, tab, rooms.reload])
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'rooms', label: '直播间' }, { value: 'caches', label: '转码缓存' }, { value: 'areas', label: '直播分区' }]} />
      {tab === 'rooms' ? <>
        <HeadActions><SearchPill value={kw} onChange={setKw} onSubmit={() => { setQ(kw); setPn(1) }} placeholder="标题 / 主播 / 房间号" /></HeadActions>
        {rooms.loading && !rooms.data ? <Loading /> : (
          <section className="list-card"><div className="table-wrap"><table className="table">
            <thead><tr><th>直播间</th><th>主播</th><th>分区</th><th>直播源</th><th>人气</th><th>状态</th><th /></tr></thead>
            <tbody>{rooms.data?.list.map((r: any) => (
              <tr key={r.room_id}>
                <td><Link to={`/live/${r.room_id}`} className="cell-media"><img src={r.cover} alt="" /><div><div className="t clamp-1">{r.title}</div><div className="s">房间号 {r.room_id}</div></div></Link></td>
                <td className="nowrap">{r.uname}</td><td className="nowrap">{r.area_v2_parent_name} · {r.area_v2_name}</td>
                <td>{r.source?.type === 'video' ? <div><span className="badge brand">转播视频{r.source.loop ? ' · 循环' : ''}</span><div className="faint clamp-1" style={{ fontSize: 11.5, maxWidth: 220, marginTop: 4 }}>{r.source.video ? `${r.source.video.title}${r.source.video.part !== r.source.video.title ? ` · ${r.source.video.part}` : ''}` : '视频已不可用'}</div><div style={{ marginTop: 6, maxWidth: 240 }}><CacheStatus cache={r.source.cache} pendingStart={r.pending_start} /></div></div> : r.source?.type === 'm3u8' ? <div><span className="badge brand">m3u8{r.source.kind === 'vod' ? (r.source.loop ? ' · 循环转播' : ' · 单次转播') : ' · 直播转播'}</span><div className="faint mono clamp-1" style={{ fontSize: 11.5, maxWidth: 220, marginTop: 4 }}>{r.source.url}</div></div> : <span className="badge">RTMP 推流</span>}</td>
                <td className="mono">{countText(r.online)}</td>
                <td>{r.banned ? <span className="badge danger">已封禁</span> : r.live_status === 1 ? <span className="badge accent">直播中</span> : r.pending_start ? <span className="badge brand">等待转码</span> : <span className="badge">未开播</span>}</td>
                <td><div className="actions"><button className="btn sm" onClick={() => { setStartNow(r.live_status !== 1); setSourceRoom(r) }}>直播源</button><button className={`btn sm ${r.banned ? '' : 'danger'}`} onClick={() => ban(r)}>{r.banned ? '解封' : '封禁'}</button></div></td>
              </tr>
            ))}</tbody>
          </table></div><ListFoot pn={pn} size={20} total={rooms.data?.page.total ?? 0} onChange={setPn} /></section>
        )}
        {sourceRoom && (
          <Modal title={`直播源 · ${sourceRoom.title}`} onClose={() => setSourceRoom(null)} wide>
            <StreamSourceEditor value={{ source_type: sourceRoom.source?.type ?? 'push', source_url: sourceRoom.source?.type === 'm3u8' ? sourceRoom.source.url : '', loop: sourceRoom.source?.loop ?? true, aid: sourceRoom.source?.aid, cid: sourceRoom.source?.cid }}
              current={sourceRoom.source?.video} videos={(p) => admin.liveRoomVideos(sourceRoom.room_id, p)}
              extra={sourceRoom.live_status !== 1 && !sourceRoom.banned && <label className="check" style={{ marginRight: 'auto', fontSize: 13 }}><input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />保存后立即开播（转播视频在转码完成后开播）</label>}
              onSave={async (f) => { const x = await admin.liveRoomSource(sourceRoom.room_id, { ...f, start: startNow && sourceRoom.live_status !== 1 }); setSourceRoom(null); rooms.reload(); toast(x.data?.pending_start ? '直播源已更新，转码完成后自动开播' : '直播源已更新', 'success') }} />
          </Modal>
        )}
      </> : tab === 'caches' ? <LiveCaches /> : (
        <div className="stack" style={{ marginTop: 16, maxWidth: 560 }}>
          {areas.data?.list.map((a: any) => <AreaRow key={a.id} area={a} onSave={(n) => saveArea(a.id, n)} />)}
          <AreaRow area={{ name: '', rooms: 0, children: [] }} onSave={(n) => saveArea(undefined, n)} />
        </div>
      )}
    </div>
  )
}

/** Transcode caches of relayed videos: one per video and resolution, shared by the rooms relaying it. */
function LiveCaches() {
  const [pn, setPn] = useState(1)
  const d = useAsync(() => admin.liveCaches({ pn }), [pn])
  const busy = !!d.data?.list.some((x: any) => cacheBusy(x))
  useEffect(() => {
    if (!busy) return
    const t = setInterval(d.reload, 3000)
    return () => clearInterval(t)
  }, [busy, d.reload])
  const retry = async (key: string) => { try { await admin.liveCacheRetry(key); d.reload() } catch (e) { toastError(e) } }
  const remove = async (x: any) => {
    if (!(await confirmDialog(`删除「${x.title}」的转码缓存（${(x.size / 1024 ** 3).toFixed(2)} GB）？之后再转播该视频需要重新转码。`, { danger: true, ok: '删除' }))) return
    try { await admin.liveCacheDelete(x.key); d.reload() } catch (e) { toastError(e) }
  }
  if (d.loading && !d.data) return <Loading />
  if (d.error) return <ErrorState error={d.error} retry={d.reload} />
  return (
    <div style={{ marginTop: 16 }}>
      <p className="faint" style={{ fontSize: 13, marginTop: 0 }}>缓存目录 <span className="mono">{d.data.dir}</span> · 转码到 {d.data.height}p · 没有直播间使用的缓存保留 {d.data.keep_hours} 小时后自动删除。目录与分辨率在<Link to="/admin/settings">站点设置</Link>中修改。</p>
      {!d.data.list.length ? <Empty title="还没有转码缓存" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>视频</th><th>状态</th><th>使用中</th><th>位置</th><th /></tr></thead>
          <tbody>{d.data.list.map((x: any) => (
            <tr key={x.key}>
              <td><div className="cell-media"><img src={x.pic} alt="" /><div><div className="t clamp-1">{x.title || `av${x.aid}`}</div><div className="s">{x.part && x.part !== x.title ? `${x.part} · ` : ''}{formatDuration(x.duration)}</div></div></div></td>
              <td style={{ minWidth: 200 }}><CacheStatus cache={x} onRetry={() => retry(x.key)} /></td>
              <td>{x.rooms.length ? x.rooms.map((r: any) => <div key={r.room_id}><Link to={`/live/${r.room_id}`} className="clamp-1" style={{ fontSize: 13 }}>{r.title}</Link></div>) : <span className="faint" style={{ fontSize: 13 }}>未使用{x.unused_since ? ` · ${dateTimeText(x.unused_since + d.data.keep_hours * 3600)} 删除` : ''}</span>}</td>
              <td className="mono faint clamp-1" style={{ fontSize: 11.5, maxWidth: 240 }} title={x.dir}>{x.dir}</td>
              <td><div className="actions"><button className="btn sm danger" disabled={x.rooms.length > 0 || x.status === 'running'} title={x.rooms.length ? '仍有直播间在使用' : undefined} onClick={() => remove(x)}>删除</button></div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager page={pn} total={d.data.page.total} size={20} onChange={setPn} />
    </div>
  )
}

function AreaRow({ area, onSave }: { area: { id?: number; name: string; rooms: number; children: { name: string }[] }; onSave: (name: string) => void }) {
  const [name, setName] = useState(area.name)
  return (
    <div className="row">
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="新分区名称" />
      <span className="faint nowrap" style={{ fontSize: 12, width: 160 }}>{area.id ? `${area.children.map((c) => c.name).join('、')} · ${area.rooms} 间` : ''}</span>
      <button className="btn" onClick={() => { onSave(name); if (!area.id) setName('') }}>{area.id ? '保存' : '添加'}</button>
    </div>
  )
}

export function Moderation() {
  const [tab, setTab] = useState<'replies' | 'danmaku'>('replies')
  const [pn, setPn] = useState(1)
  const [kw, setKw] = useState('')
  const [q, setQ] = useState('')
  const [flagged, setFlagged] = useState(false)
  const [reported, setReported] = useState(false)
  const d = useAsync(() => (tab === 'replies' ? admin.replies({ pn, keyword: q, flagged: flagged ? 1 : undefined, reported: reported ? 1 : undefined }) : admin.danmaku({ pn, keyword: q, flagged: flagged ? 1 : undefined })), [tab, pn, q, flagged, reported])
  const dismissReport = async (id: number) => {
    try { const r = await admin.replyReportDismiss(id); if (r.code) throw new Error(r.message); d.reload(); toast('举报已驳回', 'success') } catch (e) { toastError(e) }
  }
  const ban = async (mid: number, name: string) => {
    if (!(await confirmDialog(`封禁用户“${name}”？封禁后该用户会被退出登录，不能再登录。`, { danger: true, ok: '封禁' }))) return
    try { const r = await admin.userUpdate({ mid, status: 1 }); if (r.code) throw new Error(r.message); toast('已封禁', 'success') } catch (e) { toastError(e) }
  }
  const flag = (f: string) => f ? <span className="flag-pill">{f}</span> : null
  const del = async (id: number) => {
    try { if (tab === 'replies') await admin.replyDelete(id); else await admin.danmakuDelete(id); d.reload(); toast('已删除', 'success') } catch (e) { toastError(e) }
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Tabs value={tab} onChange={(t) => { setTab(t); setPn(1) }} items={[{ value: 'replies', label: '评论' }, { value: 'danmaku', label: '用户弹幕' }]} />
      <HeadActions><label className="row" style={{ gap: 8, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}><input type="checkbox" checked={flagged} onChange={(e) => { setFlagged(e.target.checked); setPn(1) }} />只看疑似违规</label>{tab === 'replies' && <label className="row" style={{ gap: 8, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}><input type="checkbox" checked={reported} onChange={(e) => { setReported(e.target.checked); setPn(1) }} />待处理举报</label>}<SearchPill value={kw} onChange={setKw} onSubmit={() => { setQ(kw); setPn(1) }} placeholder="内容关键词 / 用户" /></HeadActions>
      {d.loading && !d.data ? <Loading /> : !d.data?.list.length ? <Empty title="没有内容" /> : (
        <section className="list-card"><div className="table-wrap"><table className="table">
          <thead><tr><th>用户</th><th>内容</th><th>{tab === 'replies' ? '所在稿件' : '所在视频'}</th><th>{tab === 'replies' ? '点赞' : '时间点'}</th><th>发布时间</th><th /></tr></thead>
          <tbody>{d.data.list.map((x: any) => tab === 'replies' ? (
            <tr key={x.rpid} className={x.flag || x.report_count ? 'flagged' : ''}><td className="nowrap"><div className="row"><Avatar src={x.member.avatar} size={26} />{x.member.uname}</div></td><td style={{ maxWidth: 420 }}>{flag(x.flag)}{x.content.message}{x.report_count > 0 && <div className="flag-pill">{x.report_count} 条举报 · {(x.report_reasons ?? []).join('、')}</div>}</td><td>{x.archive ? <Link to={`/video/${x.archive.bvid}`} className="clamp-1" style={{ color: 'var(--brand)' }}>{x.archive.title}</Link> : <span className="faint">番剧剧集</span>}</td><td>{x.like}</td><td className="nowrap faint">{dateTimeText(x.ctime)}</td><td><div className="actions"><button className="btn sm danger" onClick={() => del(x.rpid)}>删除</button>{x.report_count > 0 && <button className="btn sm" onClick={() => dismissReport(x.rpid)}>驳回举报</button>}<button className="btn sm" onClick={() => ban(x.mid, x.member.uname)}>封禁用户</button></div></td></tr>
          ) : (
            <tr key={x.id} className={x.flag ? 'flagged' : ''}><td className="nowrap"><div className="row"><Avatar src={x.member.face} size={26} />{x.member.name}</div></td><td>{flag(x.flag)}<span style={{ color: '#' + x.color.toString(16).padStart(6, '0'), textShadow: '0 0 2px #000', fontWeight: 600 }}>{x.content}</span></td><td className="clamp-1">{x.target}</td><td className="mono">{formatDuration(x.progress / 1000)}</td><td className="nowrap faint">{dateTimeText(x.ctime)}</td><td><div className="actions"><button className="btn sm danger" onClick={() => del(x.id)}>删除</button><button className="btn sm" onClick={() => ban(x.mid, x.member.name)}>封禁用户</button></div></td></tr>
          ))}</tbody>
        </table></div><ListFoot pn={pn} size={20} total={d.data?.page.total ?? 0} onChange={setPn} /></section>
      )}
    </div>
  )
}

export function Regions() {
  const d = useAsync(() => admin.regions(), [])
  const [edit, setEdit] = useState<any>(null)
  const save = async (e: FormEvent) => { e.preventDefault(); try { const r = await admin.regionSave(edit.tid ? { tid: edit.tid, name: edit.name, sort: edit.sort, visible: edit.visible } : edit); if (r.code) throw new Error(r.message); setEdit(null); d.reload() } catch (err) { toastError(err) } }
  const del = async (r: any) => { if (!(await confirmDialog(r.parent ? `删除子分区“${r.name}”？该子分区下的稿件会回到“全部”。` : `删除分区“${r.name}”及其子分区？`, { danger: true }))) return; try { const x = await admin.regionDelete(r.tid); if (x.code) throw new Error(x.message); d.reload() } catch (err) { toastError(err) } }
  const toggle = async (r: any) => { try { await admin.regionSave({ ...r, visible: !r.visible }); d.reload() } catch (err) { toastError(err) } }
  // Drag-to-reorder within one level: top-level regions, or one region's sub-regions.
  const [drag, setDrag] = useState<any>(null)
  const [over, setOver] = useState<number | null>(null)
  const drop = async (target: any) => {
    setOver(null)
    if (!drag || drag.tid === target.tid || (drag.parent ?? 0) !== (target.parent ?? 0)) return setDrag(null)
    const level = (d.data?.list ?? []).filter((x: any) => (x.parent ?? 0) === (drag.parent ?? 0) && x.tid !== drag.tid)
    level.splice(level.findIndex((x: any) => x.tid === target.tid), 0, drag)
    setDrag(null)
    try { const r = await admin.regionSort(level.map((x: any) => x.tid)); if (r.code) throw new Error(r.message); d.reload() } catch (err) { toastError(err) }
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <HeadActions><button className="btn primary" style={{ height: 36, borderRadius: 18 }} onClick={() => setEdit({ name: '', sort: (d.data?.list.length ?? 0), visible: true })}><Icon name="plus" size={15} />新建分区</button></HeadActions>
      {d.loading ? <Loading /> : (
        <section className="list-card"><div className="table-wrap"><table className="table"><thead><tr><th>TID</th><th>名称</th><th>排序</th><th>稿件数</th><th>前台显示</th><th /></tr></thead>
          <tbody>{(d.data?.list ?? []).filter((r: any) => !r.parent).flatMap((r: any) => [r, ...(d.data?.list ?? []).filter((x: any) => x.parent === r.tid)]).map((r: any) => (
            <tr key={r.tid} draggable onDragStart={() => setDrag(r)} onDragEnd={() => { setDrag(null); setOver(null) }} onDragOver={(e) => { if (drag && (drag.parent ?? 0) === (r.parent ?? 0)) { e.preventDefault(); setOver(r.tid) } }} onDragLeave={() => setOver((t) => (t === r.tid ? null : t))} onDrop={() => drop(r)} className={over === r.tid && drag?.tid !== r.tid ? 'drag-over' : ''}>
              <td className="mono"><span className="grip" title="拖动调整顺序"><Icon name="grip" size={16} /></span>{r.tid}</td>
              <td style={{ fontWeight: r.parent ? 400 : 600, paddingLeft: r.parent ? 36 : undefined }}>{r.parent ? <span className="faint">└ </span> : null}{r.name}{!r.parent && <span className="faint" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>{(d.data?.list ?? []).filter((x: any) => x.parent === r.tid).length} 个子分区</span>}</td>
              <td>{r.sort}</td><td>{r.count}</td><td><Switch on={r.visible} onChange={() => toggle(r)} /></td>
              <td><div className="actions">{!r.parent && <button className="btn sm" onClick={() => setEdit({ name: '', sort: (d.data?.list ?? []).filter((x: any) => x.parent === r.tid).length, visible: true, parent: r.tid })}><Icon name="plus" size={13} />子分区</button>}<button className="btn sm" onClick={() => setEdit({ ...r })}>编辑</button><button className="btn sm danger" onClick={() => del(r)}>删除</button></div></td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
      {edit && (
        <Modal title={edit.tid ? '编辑分区' : edit.parent ? `新建「${d.data?.list.find((x: any) => x.tid === edit.parent)?.name}」的子分区` : '新建分区'} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={save}>
            <div className="field"><label>名称</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></div>
            <div className="field"><label>排序</label><input className="input" type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: +e.target.value })} /></div>
            <label className="row between"><span>前台显示</span><Switch on={edit.visible} onChange={(v) => setEdit({ ...edit, visible: v })} /></label>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn primary">保存</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

export function Banners() {
  const d = useAsync(() => admin.banners(), [])
  const [edit, setEdit] = useState<any>(null)
  const save = async (e: FormEvent) => { e.preventDefault(); try { const url = edit.url.startsWith(location.origin) ? edit.url.slice(location.origin.length) : edit.url; await admin.bannerSave({ ...edit, url }); setEdit(null); d.reload(); toast('已保存', 'success') } catch (err) { toastError(err) } }
  const del = async (b: any) => { if (!(await confirmDialog(`删除轮播“${b.title}”？`, { danger: true }))) return; try { await admin.bannerDelete(b.id); d.reload() } catch (err) { toastError(err) } }
  const upload = async (file?: File) => { if (file) try { const r = await jm.uploadFile('image', file); setEdit((x: any) => ({ ...x, img: r.url })) } catch (err) { toastError(err) } }
  const seasons = useAsync(async () => ((await admin.seasons({ pn: 1 })).list ?? []) as { season_id: number; title: string; horizontal: string }[], [])
  const target = (b: any) => {
    const ss = /\/bangumi\/play\/ss(\d+)/.exec(b.url)?.[1]
    if (ss) return `番剧 · ${seasons.data?.find((s) => s.season_id === Number(ss))?.title ?? '已下架'}`
    if (b.url.startsWith('/video/')) return '视频稿件'
    if (b.url.startsWith('/live/')) return '直播间'
    return /^https?:/.test(b.url) ? '外部链接' : '站内页面'
  }
  const list: any[] = d.data?.list ?? []
  // 频道页轮播的位置编号：分区频道用分区 tid，片库频道用 10 + season_type（与 /x/web-show/res/locs 一致）。
  const locs = CHANNELS.filter((c) => c.pgc !== 'anime').map((c) => ({ id: c.seasonType ? 10 + c.seasonType : c.regionIDs![0], name: c.title }))
  const locName = (id?: number) => locs.find((l) => l.id === id)?.name ?? '未指定频道'
  return (
    <div className="stack" style={{ gap: 20 }}>
      {(['home', 'anime', 'channel'] as const).map((pos) => {
        const items = list.filter((b) => b.position === pos)
        const note = pos === 'home' ? '建议 2560×1100' : pos === 'anime' ? '关联番剧后自动显示更新进度' : '按频道分组，显示在各频道页顶部'
        return (
          <section key={pos} className="card-sec" style={{ gap: 16 }}>
            <div className="row" style={{ gap: 10 }}>
              <h2 className="h2">{pos === 'home' ? '首页轮播' : pos === 'anime' ? '番剧页轮播' : '频道页轮播'}</h2>
              <span className="faint" style={{ fontSize: 13 }}>{items.length} 张 · {note}</span>
              <span className="grow" />
              <button type="button" className="btn primary" style={{ height: 32, padding: '0 12px', fontSize: 13 }} onClick={() => setEdit({ title: '', img: '', url: '', position: pos, sort: items.length })}><Icon name="plus" size={14} />添加</button>
            </div>
            {items.length ? <div className="g3">
              {items.map((b) => (
                <div key={b.id} className="stack" style={{ gap: 8, minWidth: 0 }}>
                  <div className="bn-art"><img src={b.img} alt="" /><span className="no">{pos === 'channel' ? `${locName(b.loc)} · ` : ''}#{b.sort}</span><div className="t">{b.title}</div></div>
                  <div className="row" style={{ gap: 8 }}><span className="muted grow clamp-1" style={{ fontSize: 12 }}>跳转：{target(b)}</span><button type="button" className="sm-btn" onClick={() => setEdit({ ...b })}>编辑</button><button type="button" className="sm-btn" style={{ color: '#c43f3b', borderColor: 'rgba(240,82,78,0.4)' }} onClick={() => del(b)}>删除</button></div>
                </div>
              ))}
            </div> : <span className="faint" style={{ fontSize: 13 }}>还没有轮播图</span>}
          </section>
        )
      })}
      {edit && (
        <Modal title={edit.id ? '编辑轮播' : '添加轮播'} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={save}>
            <label className="cover-pick" style={{ width: '100%', aspectRatio: '21/9' }}>{edit.img ? <img src={edit.img} alt="" /> : <span>点击上传图片（不上传则自动生成）</span>}<div className="over">上传图片</div><input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
            <div className="field"><label>标题</label><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required /></div>
            {edit.position === 'anime' ? (
              <div className="field"><label>关联番剧</label>
                <select className="select" value={/ss(\d+)/.exec(edit.url)?.[1] ?? ''} required onChange={(e) => { const s = seasons.data?.find((x) => x.season_id === +e.target.value); setEdit({ ...edit, url: s ? `/bangumi/play/ss${s.season_id}` : '', title: edit.title || s?.title || '', img: edit.img || s?.horizontal || '' }) }}>
                  <option value="">请选择番剧</option>{seasons.data?.map((s) => <option key={s.season_id} value={s.season_id}>{s.title}</option>)}
                </select><span className="hint">点击轮播图将打开该番剧</span></div>
            ) : (
              <div className="field"><label>跳转链接</label><input className="input" value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="粘贴视频、直播间或活动页面的链接" required /><span className="hint">站内链接可直接粘贴浏览器地址栏中的地址</span></div>
            )}
            {edit.position === 'channel' && <div className="field"><label>频道</label><select className="select" value={edit.loc ?? ''} required onChange={(e) => setEdit({ ...edit, loc: +e.target.value })}><option value="">请选择频道</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>}
            <div className="form-grid">
              <div className="field"><label>位置</label><select className="select" value={edit.position} onChange={(e) => setEdit({ ...edit, position: e.target.value })}><option value="home">首页</option><option value="anime">番剧页</option><option value="channel">频道页</option></select></div>
              <div className="field"><label>排序</label><input className="input" type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: +e.target.value })} /></div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn primary">保存</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

export function SiteSettings() {
  const d = useAsync(() => admin.settings(), [])
  const caches = useAsync(() => admin.liveCaches({ pn: 1 }), [])
  const [f, setF] = useState<Record<string, any> | null>(null)
  const [saved, setSaved] = useState<Record<string, any> | null>(null)
  const nav = useNavigate()
  useEffect(() => { if (d.data) { setF(d.data); setSaved(d.data) } }, [d.data])
  if (!f) return <Loading />
  // Fields the page adds (password, clear flag) start out absent: empty and false count as unchanged.
  const norm = (v: unknown) => (v == null || v === false ? '' : String(v))
  const dirty = Object.keys(f).filter((k) => norm(f[k]) !== norm(saved?.[k])).length
  const save = async () => { try { const r = await admin.settingsSave(f); if (r.code) throw new Error(r.message); setSaved(f); d.reload(); toast('设置已保存', 'success') } catch (e) { toastError(e) } }
  const importPackage = async (file?: File) => {
    if (!file) return
    try {
      const body = new FormData(); body.append('file', file)
      body.append('csrf', decodeURIComponent(document.cookie.split('; ').find((x) => x.startsWith('bili_jct='))?.slice(9) ?? ''))
      const result = await post('api', '/x/admin/demo/import', {}, { body })
      if (result.code) throw new Error(result.message)
      toast('演示数据包导入成功', 'success'); d.reload(); caches.reload()
    } catch (e) { toastError(e) }
  }
  const reset = async () => {
    if (!(await confirmDialog('将删除所有内容、保留全部管理员账号，并恢复初始状态。上传文件不删除，确定吗？', { danger: true, ok: '重置' }))) return
    const result = await admin.settingsSave({ reset: true }); if (result.code) { toast(result.message, 'error'); return } for (const k of ['SESSDATA', 'bili_jct', 'DedeUserID']) document.cookie = `${k}=; path=/; max-age=0`; nav('/'); location.reload()
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="panel set-sec">
        <div className="panel-title"><h3>基础设置</h3></div>
        <div className="stack">
          <div className="field"><label>站点名称</label><input className="input" value={f.siteName} onChange={(e) => setF({ ...f, siteName: e.target.value })} /></div>
          <div className="field"><label>首页公告</label><textarea className="textarea" value={f.announcement} onChange={(e) => setF({ ...f, announcement: e.target.value })} /><span className="hint">留空则不显示</span></div>
        </div>
      </div>
      <div className="panel set-sec">
        <div className="panel-title"><h3>内容与账号</h3></div>
        <div className="stack">
          <label className="row between"><div><b>开放注册</b><div className="faint" style={{ fontSize: 13 }}>关闭后新用户无法注册</div></div><Switch on={f.allowRegister} onChange={(v) => setF({ ...f, allowRegister: v })} /></label>
          <label className="row between"><div><b>投稿先审后发</b><div className="faint" style={{ fontSize: 13 }}>开启后普通用户的投稿与编辑需管理员审核</div></div><Switch on={f.auditRequired} onChange={(v) => setF({ ...f, auditRequired: v })} /></label>
          <label className="row between"><div><b>允许游客播放</b><div className="faint" style={{ fontSize: 13 }}>关闭后未登录用户需先登录才能观看视频</div></div><Switch on={f.allowGuestPlay} onChange={(v) => setF({ ...f, allowGuestPlay: v })} /></label>
          <div className="form-grid">
            <div className="field"><label>单文件上传上限（MB）</label><input className="input" type="number" value={f.maxUploadMB} onChange={(e) => setF({ ...f, maxUploadMB: +e.target.value })} /></div>
            <div className="field"><label>默认清晰度</label><select className="select" value={f.defaultQuality} onChange={(e) => setF({ ...f, defaultQuality: +e.target.value })}><option value={80}>1080P 高清</option><option value={64}>720P 准高清</option><option value={32}>480P 标清</option></select></div>
          </div>
          <div className="field"><label>敏感词</label><textarea className="textarea mono" rows={3} value={f.sensitiveWords ?? ''} onChange={(e) => setF({ ...f, sensitiveWords: e.target.value })} /><span className="hint">每行一个。命中的评论会被拒绝；弹幕命中、外部链接或长串数字会在「评论与弹幕」中标为疑似违规</span></div>
        </div>
      </div>
      <div className="panel set-sec">
        <div className="panel-title"><h3>评论</h3></div>
        <div className="stack">
          <label className="row between"><b>允许发表评论</b><Switch on={f.commentEnabled ?? true} onChange={(v) => setF({ ...f, commentEnabled: v })} /></label>
          <label className="row between"><b>允许楼中楼回复</b><Switch on={f.commentReplyEnabled ?? true} onChange={(v) => setF({ ...f, commentReplyEnabled: v })} /></label>
          <div className="form-grid">
            <div className="field"><label>两次评论最小间隔（秒）</label><input className="input" type="number" min={0} max={86400} step={1} value={f.commentMinInterval ?? 0} onChange={(e) => setF({ ...f, commentMinInterval: e.target.value })} /><span className="hint">按账号限制，0 表示不限制</span></div>
            <div className="field"><label>重复评论拦截时间（秒）</label><input className="input" type="number" min={0} max={86400} step={1} value={f.commentDuplicateWindow ?? 0} onChange={(e) => setF({ ...f, commentDuplicateWindow: e.target.value })} /><span className="hint">同一账号在同一位置重复发表相同内容时拦截，0 表示不限制</span></div>
          </div>
        </div>
      </div>
      <div className="panel set-sec">
        <div className="panel-title"><h3>数据源</h3></div>
        <div className="stack">
          <label className="row between"><div><b>允许用户接入数据源</b><div className="faint" style={{ fontSize: 13 }}>用户可在创作中心以只读方式接入自己的 Emby，内容归属该用户</div></div><Switch on={f.userDataSources} onChange={(v) => setF({ ...f, userDataSources: v })} /></label>
          <label className="row between"><div><b>允许内网地址</b><div className="faint" style={{ fontSize: 13 }}>允许用户填写 localhost、192.168.x.x 等内网 Emby 地址（服务端会代为访问）；系统数据源不受限制</div></div><Switch on={f.dataSourcePrivateNetwork} onChange={(v) => setF({ ...f, dataSourcePrivateNetwork: v })} /></label>
          <div className="form-grid">
            <div className="field"><label>自动同步间隔（小时）</label><input className="input" type="number" min={0} value={f.dataSourceSyncHours} onChange={(e) => setF({ ...f, dataSourceSyncHours: +e.target.value })} /><span className="hint">0 表示只手动同步</span></div>
            <div className="field"><label>官方账号 UID</label><input className="input" type="number" min={1} value={f.officialMid} onChange={(e) => setF({ ...f, officialMid: +e.target.value })} /><span className="hint">系统数据源的内容显示在该账号下</span></div>
            <div className="field"><label>同步时每秒请求数</label><input className="input" type="number" min={1} max={50} value={f.dataSourceSyncRate} onChange={(e) => setF({ ...f, dataSourceSyncRate: +e.target.value })} /><span className="hint">每个数据源单独计算，避免同步时请求过多压垮 Emby；播放不受限制</span></div>
            <div className="field"><label>同步并发请求数</label><input className="input" type="number" min={1} max={8} value={f.dataSourceSyncConcurrency} onChange={(e) => setF({ ...f, dataSourceSyncConcurrency: +e.target.value })} /><span className="hint">每个数据源同时进行的请求上限</span></div>
          </div>
        </div>
      </div>
      <div className="panel set-sec">
        <div className="panel-title"><h3>弹弹play 弹幕</h3></div>
        <div className="stack">
          <label className="row between"><div><b>同步 Emby 视频弹幕</b><div className="faint" style={{ fontSize: 13 }}>媒体资源同步后，后台按分集匹配并获取弹幕，可在稿件审核中预览</div></div><Switch label="同步 Emby 视频弹幕" on={f.dandanplayEnabled ?? false} onChange={(v) => setF({ ...f, dandanplayEnabled: v })} /></label>
          <div className="form-grid">
            <label className="field span-2">接口地址<input className="input mono" type="url" value={f.dandanplayApi ?? 'https://api.dandanplay.net'} onChange={(e) => setF({ ...f, dandanplayApi: e.target.value })} /><span className="hint">支持自部署服务，可包含 token 路径或以 /api/v2 结尾</span></label>
            <label className="field">App ID（可选）<input className="input mono" value={f.dandanplayAppId ?? ''} autoComplete="off" onChange={(e) => setF({ ...f, dandanplayAppId: e.target.value })} /></label>
            <label className="field">App Secret（可选）<input className="input mono" type="password" value={f.dandanplayAppSecret ?? ''} autoComplete="new-password" placeholder={f.dandanplayHasSecret ? '已设置，留空保持不变' : '无需签名的服务可留空'} onChange={(e) => setF({ ...f, dandanplayAppSecret: e.target.value })} /></label>
          </div>
          {f.dandanplayHasSecret && <label className="row"><input type="checkbox" checked={f.dandanplaySecretClear ?? false} onChange={(e) => setF({ ...f, dandanplaySecretClear: e.target.checked })} />清除已保存的 App Secret</label>}
          <p className="faint" style={{ fontSize: 13 }}>无需签名的服务只需填写地址；需要签名时同时填写 App ID 和 App Secret。启用后，播放 Emby 视频时会自动获取并合并弹幕。</p>
        </div>
      </div>
      <div className="panel set-sec">
        <div className="panel-title"><h3>直播转码缓存</h3></div>
        <p className="faint" style={{ fontSize: 13, marginTop: 0 }}>直播间转播视频前，服务器用 ffmpeg 把原始文件转码为 H.264 直播流并缓存，转码完成后才能开播。</p>
        <div className="form-grid">
          <div className="field span-2"><label>缓存目录</label><input className="input mono" value={f.liveCacheDir} placeholder="留空使用数据目录下的 live-cache" onChange={(e) => setF({ ...f, liveCacheDir: e.target.value })} /><span className="hint">服务器上的绝对路径，需可写。修改后只影响新的转码任务，已有缓存留在原位置直到被删除。</span></div>
          <div className="field"><label>转码分辨率上限</label><select className="select" value={f.liveTranscodeHeight} onChange={(e) => setF({ ...f, liveTranscodeHeight: +e.target.value })}><option value={720}>720p</option><option value={1080}>1080p</option><option value={1440}>1440p</option><option value={2160}>2160p（4K）</option></select><span className="hint">低于上限的视频保持原分辨率；修改后只影响新的转码任务</span></div>
          <div className="field"><label>已用空间</label><span className="row" style={{ height: 38, gap: 10, fontSize: 14 }}>{caches.data ? `${(caches.data.bytes / 1024 ** 3).toFixed(1)} GB / ${caches.data.page.total} 个视频` : '—'}<Link to="/admin/live?tab=caches" style={{ color: 'var(--brand)', fontSize: 13 }}>管理</Link></span></div>
        </div>
      </div>
      <div className="panel set-sec">
        <div className="panel-title"><h3>图片缓存</h3></div>
        <div className="stack">
          <label className="row between"><div><b>本地缓存数据源图片</b><div className="faint" style={{ fontSize: 13 }}>数据源的封面、背景图第一次取自 Emby 后保存在服务器上，之后直接读本地文件，减少对 Emby 的请求；关闭后每次回源</div></div><Switch on={f.imageCacheEnabled} onChange={(v) => setF({ ...f, imageCacheEnabled: v })} /></label>
          <div className="form-grid">
            <div className="field span-2"><label>缓存目录</label><input className="input mono" value={f.imageCacheDir} placeholder="留空使用数据目录下的 image-cache" onChange={(e) => setF({ ...f, imageCacheDir: e.target.value })} /><span className="hint">服务器上的绝对路径，需可写。修改后新的图片写入新目录，旧目录中的文件不会自动删除。</span></div>
            <div className="field"><label>容量上限（MB）</label><input className="input" type="number" min={64} value={f.imageCacheMaxMB} onChange={(e) => setF({ ...f, imageCacheMaxMB: +e.target.value })} /><span className="hint">超出后优先删除最久未访问的图片</span></div>
          </div>
          <ImageCacheUsage />
        </div>
      </div>
      <ServiceSettings f={f} setF={setF} />
      <ServerSettings f={f} setF={setF} />
      <div className="row" style={{ gap: 12, paddingTop: 4 }}><button type="button" className="aud-btn no" style={{ flex: 'none', height: 40, padding: '0 16px', fontWeight: 500 }} onClick={reset}><Icon name="refresh" size={15} />重置为初始状态</button><label className="btn">导入演示数据包<input type="file" accept=".json,application/json" hidden onChange={(e) => { void importPackage(e.target.files?.[0]); e.target.value = '' }} /></label><span className="grow" />{dirty > 0 && <span className="muted" style={{ fontSize: 13 }}>有 {dirty} 项未保存的修改</span>}<button type="button" className="aud-btn ok" style={{ flex: 'none', padding: '0 24px' }} onClick={save}>保存设置</button></div>
    </div>
  )
}

const SERVICE_FIELDS = [['serviceApi', '主站接口', '视频、番剧、用户等'], ['serviceLive', '直播接口', '直播间与弹幕'], ['serviceApp', '客户端接口', '电视端推荐'], ['servicePassport', '登录接口', '扫码登录与令牌']] as const

const ENCODERS = [['auto', '自动（优先 VAAPI 硬件编码）'], ['libx264', 'libx264（软件编码）'], ['h264_vaapi', 'h264_vaapi（Linux 硬件编码）'], ['h264_videotoolbox', 'h264_videotoolbox（macOS 硬件编码）'], ['h264_nvenc', 'h264_nvenc（NVIDIA）'], ['h264_qsv', 'h264_qsv（Intel QSV）']]

/**
 * 服务器配置: runtime overrides of the start-up parameters (saved with the other settings and
 * applied at once; empty uses the start-up value, shown as the placeholder), plus the
 * start-up-only parameters, read-only.
 */
function ServerSettings({ f, setF }: { f: Record<string, any>; setF: (f: Record<string, any>) => void }) {
  const d = useAsync(() => admin.server(), [])
  const st = d.data?.startup
  const text = (k: string, label: string, env: string, current?: string, hint?: string) => (
    <div className="field"><label>{label} <span className="faint mono" style={{ fontWeight: 400 }}>{env}</span></label>
      <input className="input mono" value={f[k] ?? ''} placeholder={current || '未设置'} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
  return (
    <div className="panel set-sec">
      <div className="panel-title"><h3>服务器配置</h3></div>
      <p className="faint" style={{ fontSize: 13, marginTop: 0 }}>这里的值保存后立即生效，并覆盖启动参数；留空则使用启动参数（输入框里灰字为当前生效值）。</p>
      <div className="stack">
        {text('serverPublicOrigin', '公开地址', 'JUMEDIA_PUBLIC_ORIGIN', st?.publicOrigin || '按请求地址推导', '生成登录二维码、直播流、图片等对外地址时使用，需是电视和手机都能访问的地址；留空按请求地址推导。')}
        <div className="form-grid">
          {text('serverFfmpeg', 'ffmpeg 路径', 'JUMEDIA_FFMPEG', st?.ffmpeg)}
          {text('serverFfprobe', 'ffprobe 路径', 'JUMEDIA_FFPROBE', st?.ffprobe)}
          <div className="field"><label htmlFor="server-video-encoder">视频编码器 <span className="faint mono" style={{ fontWeight: 400 }}>JUMEDIA_FFMPEG_VIDEO_ENCODER</span></label>
            <select id="server-video-encoder" className="select" value={f.serverVideoEncoder ?? ''} onChange={(e) => setF({ ...f, serverVideoEncoder: e.target.value })}>
              <option value="">使用启动参数（{st?.videoEncoder || 'auto'}）</option>
              {ENCODERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="boot-list">
          <div className="row between"><b style={{ fontSize: 14 }}>启动参数</b><span className="hint">只读，修改需更改启动参数并重启服务</span></div>
          {(d.data?.boot ?? []).map((b) => <div key={b.key} className="boot-row"><span className="muted">{b.label}</span><span className="mono clamp-1">{b.value || '—'}</span><span className="faint mono">{b.key}</span></div>)}
        </div>
      </div>
    </div>
  )
}

type Cdn = { name: string; url: string }

/**
 * CDNs from an imported file: a JSON array of `{name, url}` (or `{cdn: [...]}`, as
 * `/x/jumedia/service` returns), or text with one CDN per line — `名称,地址`, `名称 地址`
 * or just the address (named after its host). Invalid and repeated addresses are skipped;
 * at most 20 are kept, matching what the server accepts.
 */
function parseCdnList(text: string): { list: Cdn[]; skipped: number } {
  let rows: { name?: unknown; url?: unknown }[] | null = null
  try { const v = JSON.parse(text); rows = Array.isArray(v) ? v : Array.isArray(v?.cdn) ? v.cdn : null } catch { /* not JSON: read as lines */ }
  rows ??= text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const m = /^(.*?)[,，\t ]+(\S+)$/.exec(l); return m ? { name: m[1], url: m[2] } : { name: '', url: l } })
  const list: Cdn[] = []
  let skipped = 0
  for (const r of rows) {
    const url = String(r?.url ?? '').trim().replace(/\/+$/, '')
    let host = ''
    try { const u = new URL(url); if (['http:', 'https:'].includes(u.protocol) && !u.search && !u.hash && !u.username && !u.password) host = u.hostname } catch { /* invalid address */ }
    if (!host || list.some((x) => x.url === url) || list.length >= 20) { skipped++; continue }
    list.push({ name: [...(String(r?.name ?? '').trim() || host)].slice(0, 20).join(''), url })
  }
  return { list, skipped }
}

/** 服务分布: the API addresses and CDNs clients read from `/x/jumedia/service`. */
function ServiceSettings({ f, setF }: { f: Record<string, any>; setF: (f: Record<string, any>) => void }) {
  let cdns: Cdn[] = []
  try { cdns = JSON.parse(f.serviceCdns || '[]') } catch { /* edited elsewhere; start empty */ }
  const setCdns = (list: Cdn[]) => setF({ ...f, serviceCdns: JSON.stringify(list) })
  const file = useRef<HTMLInputElement>(null)
  // Import only fills the form; nothing changes on the server until 保存设置.
  const importFile = async (picked?: File) => {
    if (!picked) return
    const { list, skipped } = parseCdnList(await picked.text())
    if (!list.length) return toast('文件里没有可导入的 CDN', 'error')
    if (cdns.length && !(await confirmDialog(`用导入的 ${list.length} 个 CDN 替换现有的 ${cdns.length} 个？`, { ok: '替换' }))) return
    setCdns(list)
    toast(`已导入 ${list.length} 个 CDN${skipped ? `，跳过 ${skipped} 条` : ''}，点「保存设置」后生效`, 'success')
  }
  return (
    <div className="panel set-sec">
      <div className="panel-title"><h3>服务分布</h3></div>
      <p className="faint" style={{ fontSize: 13, marginTop: 0 }}>客户端（如 JulibiliTV）启动时从 <span className="mono" style={{ color: 'var(--text)' }}>/x/jumedia/service</span> 读取这些地址，按用途访问对应的服务。留空表示使用本站地址。</p>
      <div className="stack">
        <div className="form-grid">
          {SERVICE_FIELDS.map(([k, label, hint]) => (
            <div key={k} className="field"><label>{label} <span className="faint" style={{ fontWeight: 400 }}>{hint}</span></label><input className="input mono" value={f[k] ?? ''} placeholder="留空使用本站地址" onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
          ))}
        </div>
        <div className="field">
          <div className="row between"><label>CDN 集合</label><span className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" onClick={() => file.current?.click()}><Icon name="upload" size={14} />导入</button>
            <input ref={file} type="file" accept=".json,.txt,.csv,application/json,text/plain,text/csv" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = '' }} />
            <button type="button" className="btn sm" disabled={cdns.length >= 20} onClick={() => setCdns([...cdns, { name: '', url: '' }])}><Icon name="plus" size={14} />添加 CDN</button>
          </span></div>
          {cdns.map((x, i) => (
            <div key={i} className="cdn-row">
              <input className="input" value={x.name} placeholder="名称，如 上海电信" maxLength={20} onChange={(e) => setCdns(cdns.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))} />
              <input className="input mono" value={x.url} placeholder="https://cdn.example.com" onChange={(e) => setCdns(cdns.map((y, k) => (k === i ? { ...y, url: e.target.value } : y)))} />
              <button type="button" className="btn ghost sm icon" aria-label="删除" onClick={() => setCdns(cdns.filter((_, k) => k !== i))}><Icon name="trash" size={14} /></button>
            </div>
          ))}
          {!cdns.length && <span className="faint" style={{ fontSize: 13 }}>还没有配置 CDN</span>}
          <span className="hint">按顺序下发给客户端，由客户端让用户选择线路；服务端返回的播放地址不受影响。导入支持 JSON（<span className="mono">[{'{'}name, url{'}'}]</span>）或每行「名称,地址」的文本，导入后点「保存设置」才生效。</span>
        </div>
      </div>
    </div>
  )
}

/** Usage of the image cache as the server last saw it, with a button to empty it. */
function ImageCacheUsage() {
  const d = useAsync(() => admin.imageCache(), [])
  const [busy, setBusy] = useState(false)
  if (!d.data) return null
  const mb = (n: number) => (n / 1024 ** 2).toFixed(1)
  const clear = async () => {
    if (!(await confirmDialog('清空图片缓存？之后的图片会重新从 Emby 获取。', { danger: true, ok: '清空' }))) return
    setBusy(true)
    try { const r = await admin.imageCacheClear(); toast(`已清空 ${r.files} 个文件（${mb(r.bytes)} MB）`, 'success'); d.reload() } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <div className="row between wrap" style={{ gap: 8 }}>
      <span className="faint" style={{ fontSize: 13 }}>当前目录 <span className="mono">{d.data.dir}</span>：{d.data.files} 个文件，{mb(d.data.bytes)} / {d.data.max_mb} MB</span>
      <button className="btn sm danger" disabled={busy || !d.data.files} onClick={clear}><Icon name="trash" size={14} />清空缓存</button>
    </div>
  )
}

export function Logs() {
  const [pn, setPn] = useState(1)
  const [kind, setKind] = useState('')
  const [days, setDays] = useState(7)
  const [mid, setMid] = useState(0)
  const d = useAsync(() => admin.logs({ pn, kind, days, mid }), [pn, kind, days, mid])
  const KINDS = [['', '全部'], ['archive', '稿件'], ['user', '用户'], ['live', '直播'], ['datasource', '数据源'], ['settings', '设置']]
  return (
    <div className="stack" style={{ gap: 16 }}>
      <HeadActions>
        <select className="select" style={{ height: 36, width: 'auto', borderRadius: 18 }} value={days} onChange={(e) => { setDays(+e.target.value); setPn(1) }}><option value={1}>最近 1 天</option><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={0}>全部时间</option></select>
        <select className="select" style={{ height: 36, width: 'auto', borderRadius: 18 }} value={mid} onChange={(e) => { setMid(+e.target.value); setPn(1) }}><option value={0}>全部操作人</option>{(d.data?.operators ?? []).map((o: any) => <option key={o.mid} value={o.mid}>{o.name}</option>)}</select>
      </HeadActions>
      <div className="chips-b">{KINDS.map(([v, l]) => <button type="button" key={v} className={kind === v ? 'on' : ''} onClick={() => { setKind(v); setPn(1) }}>{l}</button>)}</div>
      {d.loading && !d.data ? <Loading /> : (
        <section className="list-card"><div className="table-wrap"><table className="table"><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象</th></tr></thead>
          <tbody>{d.data?.list.map((l: any) => <tr key={l.id}><td className="nowrap faint">{dateTimeText(l.ctime)}</td><td className="nowrap"><div className="row"><Avatar src={l.member.face} size={24} />{l.member.name}</div></td><td><span className="log-tag">{l.action}</span></td><td style={{ whiteSpace: 'normal' }}>{l.target}</td></tr>)}</tbody>
        </table></div>{!d.data?.list.length && <Empty title="没有符合条件的操作" />}<ListFoot pn={pn} size={30} total={d.data?.page.total ?? 0} onChange={setPn} /></section>
      )}
    </div>
  )
}

/** 数据源 — system sources (shown under the official account) and every user's sources. */
export function DataSourcesAdmin() {
  const [scope, setScope] = useState('system')
  const [pn, setPn] = useState(1)
  const [kw, setKw] = useState('')
  const [q, setQ] = useState('')
  const d = useAsync(() => admin.dataSources({ pn, scope, keyword: q }), [pn, scope, q])
  const [edit, setEdit] = useState<DataSource | 'new' | null>(null)
  const list: DataSource[] | undefined = d.data?.list
  useSyncPolling(list, d.reload)
  return (
    <div className="stack" style={{ gap: 20 }}>
      <HeadActions>{scope === 'system' && <button type="button" className="btn primary" style={{ height: 36, borderRadius: 18 }} onClick={() => setEdit('new')}><Icon name="plus" size={15} />添加数据源</button>}</HeadActions>
      <div className="line-tabs">
        {([['system', '系统数据源'], ['user', '用户数据源']] as const).map(([v, l]) => <button type="button" key={v} className={scope === v ? 'on' : ''} onClick={() => { setScope(v); setPn(1) }}>{l}{scope === v && d.data?.page?.total !== undefined && <small>{d.data.page.total}</small>}</button>)}
        <span className="grow" />
        {scope === 'system' ? <span className="row muted" style={{ gap: 8, marginBottom: 8, fontSize: 13 }}>{d.data?.official?.face && <img src={d.data.official.face} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />}内容显示在官方账号「{d.data?.official?.name ?? '…'}」下</span>
          : <form className="row" style={{ marginBottom: 6 }} onSubmit={(e) => { e.preventDefault(); setQ(kw); setPn(1) }}><span className="row" style={{ width: 240, height: 34, borderRadius: 17, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 12px', gap: 8, color: 'var(--text-3)' }}><Icon name="search" size={15} /><input style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'none', color: 'var(--text)' }} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="名称 / 地址 / 用户" /></span></form>}
      </div>
      {d.loading && !d.data ? <Loading /> : !list?.length ? <div className="ds-card"><Empty icon="box" title={scope === 'system' ? '还没有系统数据源' : '没有用户数据源'} hint={scope === 'system' ? '系统数据源的媒体库会作为官方账号的视频与合集展示' : undefined} /></div>
        : <div className="g2">{list.map((ds) => <DataSourceCard key={ds.id} ds={ds} scope="admin" showOwner={scope === 'user'} onChanged={d.reload} onEdit={() => setEdit(ds)} />)}</div>}
      <Pager page={pn} total={d.data?.page.total ?? 0} size={20} onChange={setPn} />
      {edit && <DataSourceEditor scope="admin" value={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); d.reload() }} />}
    </div>
  )
}
