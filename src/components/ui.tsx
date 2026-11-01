import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

// ---------- toast ----------
type ToastKind = 'info' | 'success' | 'error'
type ToastItem = { id: number; text: string; kind: ToastKind }
let push: ((t: ToastItem) => void) | null = null
let seq = 0
export function toast(text: string, kind: ToastKind = 'info') { push?.({ id: ++seq, text, kind }) }
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error')

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    push = (t) => {
      setItems((list) => [...list.slice(-2), t])
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), 2600)
    }
    return () => { push = null }
  }, [])
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind !== 'info' && <Icon name={t.kind === 'success' ? 'check-circle' : 'alert-circle'} />}
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ---------- states ----------
export function Spinner({ size = 22 }: { size?: number }) {
  return <div className="spinner" style={{ width: size, height: size }} />
}
export function Loading({ text = '加载中…' }: { text?: string }) {
  return <div className="state"><Spinner /><span>{text}</span></div>
}
export function Empty({ title = '这里什么都没有', hint, icon = 'box', action }: { title?: string; hint?: string; icon?: string; action?: ReactNode }) {
  return <div className="state"><Icon name={icon} size={44} /><div className="title">{title}</div>{hint && <div>{hint}</div>}{action}</div>
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error)
  return <div className="state"><Icon name="alert-circle" size={44} /><div className="title">加载失败</div><div>{message}</div>{retry && <button className="btn sm" onClick={retry}>重试</button>}</div>
}
export function SkeletonGrid({ count = 10, poster = false }: { count?: number; poster?: boolean }) {
  return (
    <div className={`grid ${poster ? 'posters' : ''}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="vcard">
          <div className="skeleton" style={{ aspectRatio: poster ? '3/4' : '16/10' }} />
          <div className="skeleton" style={{ height: 14, width: '90%' }} />
          <div className="skeleton" style={{ height: 12, width: '50%' }} />
        </div>
      ))}
    </div>
  )
}

// ---------- modal ----------
export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><h3>{title}</h3><button className="btn ghost icon sm" onClick={onClose} aria-label="关闭"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

let confirmImpl: ((text: string, opts?: { danger?: boolean; ok?: string }) => Promise<boolean>) | null = null
export const confirmDialog = (text: string, opts?: { danger?: boolean; ok?: string }) => confirmImpl?.(text, opts) ?? Promise.resolve(window.confirm(text))
export function ConfirmHost() {
  const [state, setState] = useState<{ text: string; danger?: boolean; ok?: string; resolve: (v: boolean) => void } | null>(null)
  useEffect(() => {
    confirmImpl = (text, opts) => new Promise((resolve) => setState({ text, ...opts, resolve }))
    return () => { confirmImpl = null }
  }, [])
  if (!state) return null
  const done = (v: boolean) => { state.resolve(v); setState(null) }
  return (
    <Modal title="请确认" onClose={() => done(false)} footer={<><button className="btn" onClick={() => done(false)}>取消</button><button className={`btn ${state.danger ? 'danger solid' : 'primary'}`} onClick={() => done(true)}>{state.ok ?? '确定'}</button></>}>
      <p className="muted" style={{ lineHeight: 1.7 }}>{state.text}</p>
    </Modal>
  )
}

// ---------- misc ----------
export function Tabs<T extends string | number>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={String(it.value)} role="tab" aria-selected={it.value === value} className={it.value === value ? 'on' : ''} onClick={() => onChange(it.value)}>
          {it.label}{it.count !== undefined && <span className="count">{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string | number | boolean>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return <div className="segmented">{items.map((it) => <button key={String(it.value)} className={it.value === value ? 'on' : ''} onClick={() => onChange(it.value)}>{it.label}</button>)}</div>
}

export function Pager({ page, total, size, onChange }: { page: number; total: number; size: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (pages <= 1) return null
  const around = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= pages))
  const list = [...around].sort((a, b) => a - b)
  return (
    <div className="pager">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页"><Icon name="chevron-left" size={16} /></button>
      {list.map((p, i) => (
        <span key={p} style={{ display: 'contents' }}>
          {i > 0 && p - list[i - 1] > 1 && <span className="faint">…</span>}
          <button className={p === page ? 'on' : ''} onClick={() => onChange(p)}>{p}</button>
        </span>
      ))}
      <button disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="下一页"><Icon name="chevron-right" size={16} /></button>
      <span className="faint" style={{ marginLeft: 8, fontSize: 13 }}>共 {total} 条</span>
    </div>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
}

export function Avatar({ src, size = 36, alt = '' }: { src?: string; size?: number; alt?: string }) {
  return src ? <img className="avatar" src={src} width={size} height={size} alt={alt} style={{ width: size, height: size }} loading="lazy" /> : <div className="avatar" style={{ width: size, height: size }} />
}

export function Level({ n }: { n?: number }) {
  if (!n && n !== 0) return null
  return <span className={`level l${n}`}>LV{n}</span>
}

export function LoadMore({ loading, done, onMore, empty }: { loading: boolean; done: boolean; onMore: () => void; empty?: boolean }) {
  if (empty) return null
  return (
    <div className="state" style={{ padding: '28px 0' }}>
      {loading ? <Spinner /> : done ? <span>没有更多了</span> : <button className="btn" onClick={onMore}>加载更多</button>}
    </div>
  )
}
