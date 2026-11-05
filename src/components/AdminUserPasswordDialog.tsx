import { type FormEvent, useState } from 'react'
import { admin } from '../api/jumedia'
import { Modal, Spinner, toast, toastError } from './ui'

export function AdminUserPasswordDialog({ user, onClose, onSaved }: { user: { mid: number; uname: string }; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (password.length < 6) return setError('新密码至少 6 位')
    if (password !== confirmation) return setError('两次输入的密码不一致')
    setError(''); setBusy(true)
    try {
      await admin.userPassword(user.mid, password)
      toast('密码已修改，该用户需重新登录', 'success')
      onSaved()
    } catch (err) { toastError(err) } finally { setBusy(false) }
  }
  return (
    <Modal title={`修改密码 · ${user.uname}`} onClose={() => { if (!busy) onClose() }} footer={<>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>取消</button>
      <button type="submit" form="admin-user-password" className="btn primary" disabled={busy}>{busy && <Spinner size={14} />}保存密码</button>
    </>}>
      <form id="admin-user-password" className="stack" onSubmit={save}>
        <label className="field">新密码<input className="input" type="password" autoComplete="new-password" minLength={6} required value={password} disabled={busy} onChange={(event) => { setPassword(event.target.value); setError('') }} /></label>
        <label className="field">确认新密码<input className="input" type="password" autoComplete="new-password" minLength={6} required value={confirmation} disabled={busy} onChange={(event) => { setConfirmation(event.target.value); setError('') }} /></label>
        {error && <div role="alert" className="ds-err">{error}</div>}
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>无需原密码，至少 6 位。保存后，该用户已登录的设备需重新登录。</p>
      </form>
    </Modal>
  )
}
