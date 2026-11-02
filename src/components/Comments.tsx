import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as juli from '../api/juli'
import { type Comment, compact, countText, dateTimeText, timeText, videoComment } from '../api/normalize'
import { useInfinite } from '../lib/hooks'
import { useSession } from '../lib/session'
import { Icon } from './Icon'
import { Avatar, confirmDialog, Level, LoadMore, Segmented, Spinner, toast, toastError } from './ui'

function Composer({ oid, root, parent, placeholder, onSent, autoFocus }: { oid: number; root?: number; parent?: number; placeholder?: string; onSent: (c: Comment) => void; autoFocus?: boolean }) {
  const { me } = useSession()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (!me) return <div className="composer"><Avatar size={44} /><div className="box"><Link to="/login" className="textarea" style={{ display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>登录后参与讨论</Link></div></div>
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const r = await juli.replyAdd(oid, text.trim(), root, parent)
      const c = videoComment(r.data?.reply)
      if (c) onSent(c)
      toast(r.data?.success_toast || (c ? '发送成功' : '评论已提交，请稍后查看'), 'success')
      setText('')
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <div className="composer">
      {!root && <Avatar src={me.face} size={44} />}
      <div className="box">
        <textarea className="textarea" value={text} autoFocus={autoFocus} maxLength={1000} placeholder={placeholder ?? '友善发言，理性讨论'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }} />
        <div className="row between"><span className="faint" style={{ fontSize: 12 }}>{text.length}/1000 · ⌘/Ctrl + Enter 发送</span><button className="btn primary sm" disabled={busy || !text.trim()} onClick={send}>{busy ? <Spinner size={14} /> : '发布'}</button></div>
      </div>
    </div>
  )
}

function ReplyItem({ c, oid, upMid, root, onDelete }: { c: Comment; oid: number; upMid?: number; root?: Comment; onDelete: (id: number) => void }) {
  const { me } = useSession()
  const [state, setState] = useState({ action: c.action, like: c.like })
  const [replying, setReplying] = useState(false)
  const [children, setChildren] = useState(c.replies)
  const [expanded, setExpanded] = useState<{ page: number; more: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const react = async (hate: boolean) => {
    if (!me) return toastError(new Error('请先登录'))
    const on = hate ? state.action !== 2 : state.action !== 1
    const prev = state
    setState({ action: on ? (hate ? 2 : 1) : 0, like: state.like + (!hate && on ? 1 : 0) - (state.action === 1 && (hate || !on) ? 1 : 0) })
    try { await juli.replyReact(oid, c.id, hate, on) } catch (e) { setState(prev); toastError(e) }
  }
  const loadThread = async (page: number) => {
    setLoading(true)
    try {
      const d = await juli.replyThread(oid, c.id, page)
      const list = compact<Comment>((d.replies ?? []).map(videoComment))
      setChildren((old) => (page === 1 ? list : [...old, ...list]))
      setExpanded({ page, more: page * 20 < (d.page?.count ?? 0) })
    } catch (e) { toastError(e) } finally { setLoading(false) }
  }
  const remove = async () => {
    if (!(await confirmDialog('删除后评论将无法恢复，确定删除吗？', { danger: true, ok: '删除' }))) return
    try { await juli.replyDel(oid, c.id); onDelete(c.id) } catch (e) { toastError(e) }
  }
  const small = !!root
  return (
    <div className="reply">
      <Link to={`/space/${c.authorId}`}><Avatar src={c.avatar} size={small ? 28 : 44} /></Link>
      <div className="main">
        <div className="who"><Link to={`/space/${c.authorId}`}>{c.authorName}</Link><Level n={c.level} />{c.authorId === upMid && <span className="up">UP</span>}</div>
        <div className="text">{c.message}</div>
        <div className="acts">
          <span title={dateTimeText(c.ctime)}>{timeText(c.ctime)}</span>
          <button className={state.action === 1 ? 'on' : ''} onClick={() => react(false)}><Icon name="thumb" size={14} fill={state.action === 1} />{state.like || ''}</button>
          <button className={state.action === 2 ? 'on' : ''} onClick={() => react(true)}><Icon name="thumb-down" size={14} fill={state.action === 2} /></button>
          <button onClick={() => setReplying(!replying)}>回复</button>
          {me && (me.mid === c.authorId || me.mid === upMid || me.role === 'admin') && <button onClick={remove}>删除</button>}
        </div>
        {replying && <div className="inline-composer"><Composer oid={oid} root={root?.id ?? c.id} parent={c.id} autoFocus placeholder={`回复 @${c.authorName}：`} onSent={(n) => { setReplying(false); if (root) onDelete(-1); else setChildren((l) => [...l, n]) }} /></div>}
        {!small && children.length > 0 && (
          <div className="children">
            {children.map((r) => <ReplyItem key={r.id} c={r} oid={oid} upMid={upMid} root={c} onDelete={(id) => setChildren((l) => (id < 0 ? l : l.filter((x) => x.id !== id)))} />)}
            {!expanded && c.replyCount > children.length && <button className="more-replies" onClick={() => loadThread(1)}>共 {c.replyCount} 条回复，点击查看 {loading && '…'}</button>}
            {expanded?.more && <button className="more-replies" onClick={() => loadThread(expanded.page + 1)}>查看更多回复 {loading && '…'}</button>}
          </div>
        )}
      </div>
    </div>
  )
}

export function Comments({ oid, upMid, count }: { oid: number; upMid?: number; count?: string }) {
  const [sort, setSort] = useState(1)
  const feed = useInfinite(async (pn: number) => {
    const d = await juli.replies(oid, pn, 20, sort)
    const list = compact<Comment>((d.replies ?? []).map(videoComment))
    return { items: list, next: pn * 20 < (d.page?.count ?? 0) ? pn + 1 : null }
  }, 1, [oid, sort])
  return (
    <section className="comments">
      <div className="row between">
        <h2>评论 <small>{countText(count)}</small></h2>
        <Segmented value={sort} onChange={setSort} items={[{ value: 1, label: '最热' }, { value: 0, label: '最新' }]} />
      </div>
      <Composer oid={oid} onSent={(c) => feed.setItems((l) => [c, ...l])} />
      {feed.items.map((c) => <ReplyItem key={c.id} c={c} oid={oid} upMid={upMid} onDelete={(id) => feed.setItems((l) => l.filter((x) => x.id !== id))} />)}
      <LoadMore loading={feed.loading} done={feed.done} onMore={feed.more} empty={!feed.loading && !feed.items.length} />
      {!feed.loading && !feed.items.length && <div className="state" style={{ padding: 40 }}>还没有评论，快来抢沙发吧</div>}
    </section>
  )
}
