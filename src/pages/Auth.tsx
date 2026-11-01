import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, cookie } from '../api/client'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'
import { compact, type VideoItem, videoItem } from '../api/normalize'
import { Icon } from '../components/Icon'
import { Avatar, Spinner, toast } from '../components/ui'
import { useAsync, useTitle } from '../lib/hooks'
import { useSession } from '../lib/session'

function Art() {
  const pics = useAsync(async () => compact<VideoItem>(((await juli.popular(1)).list ?? []).map(videoItem)).slice(0, 16), [])
  return (
    <div className="auth-art">
      <div className="mosaic">{pics.data?.map((it) => <img key={it.id} src={it.cover} alt="" />)}</div>
      <div><h2>记录、分享，<br />发现有趣的视频世界</h2><p>注册 Jumedia 账号，投稿你的作品、追番、看直播、与创作者互动。同一账号可在 JulibiliTV 上扫码登录。</p></div>
    </div>
  )
}

export function Login() {
  useTitle('登录')
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { refresh } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = await jm.login(username, password)
      if (r.code !== 0) throw new ApiError(r.code, r.message)
      await refresh()
      toast('登录成功', 'success')
      nav(params.get('redirect') || '/', { replace: true })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="auth">
      <Art />
      <div className="auth-form">
        <form className="box" onSubmit={submit}>
          <h1>登录 Jumedia</h1>
          {error && <div className="error">{error}</div>}
          <div className="field"><label htmlFor="u">用户名 / 邮箱</label><input id="u" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></div>
          <div className="field"><label htmlFor="p">密码</label><input id="p" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
          <button className="btn primary lg block" disabled={busy}>{busy ? <Spinner size={16} /> : '登录'}</button>
          <div className="switch-line">还没有账号？<Link to="/register">立即注册</Link></div>
          {import.meta.env.VITE_MOCK !== '0' && <div className="demo">演示环境：管理员 <b>jumedia</b> / admin123，普通用户 <b>lumen</b> / demo123</div>}
        </form>
      </div>
    </div>
  )
}

export function Register() {
  useTitle('注册')
  const nav = useNavigate()
  const { refresh, site } = useSession()
  const [f, setF] = useState({ username: '', uname: '', email: '', password: '', confirm: '' })
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (f.password !== f.confirm) return setError('两次输入的密码不一致')
    if (!agree) return setError('请阅读并同意用户协议')
    setBusy(true); setError('')
    try {
      const r = await jm.register({ username: f.username, password: f.password, uname: f.uname, email: f.email })
      if (r.code !== 0) throw new ApiError(r.code, r.message)
      await refresh()
      toast('注册成功，欢迎加入 Jumedia', 'success')
      nav('/account/settings', { replace: true })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="auth">
      <Art />
      <div className="auth-form">
        <form className="box" onSubmit={submit}>
          <h1>注册账号</h1>
          {site && !site.allowRegister && <div className="error">平台当前暂停开放注册</div>}
          {error && <div className="error">{error}</div>}
          <div className="field"><label>用户名</label><input className="input" value={f.username} onChange={set('username')} placeholder="4–20 位字母、数字或下划线" autoComplete="username" required /></div>
          <div className="field"><label>昵称</label><input className="input" value={f.uname} onChange={set('uname')} maxLength={16} required /></div>
          <div className="field"><label>邮箱<span className="faint">（选填）</span></label><input className="input" type="email" value={f.email} onChange={set('email')} autoComplete="email" /></div>
          <div className="form-grid">
            <div className="field"><label>密码</label><input className="input" type="password" value={f.password} onChange={set('password')} minLength={6} autoComplete="new-password" required /></div>
            <div className="field"><label>确认密码</label><input className="input" type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required /></div>
          </div>
          <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />我已阅读并同意《用户协议》和《隐私政策》</label>
          <button className="btn primary lg block" disabled={busy || (site ? !site.allowRegister : false)}>{busy ? <Spinner size={16} /> : '注册'}</button>
          <div className="switch-line">已有账号？<Link to="/login">去登录</Link></div>
        </form>
      </div>
    </div>
  )
}

/**
 * Phone/web side of Juli's TV QR login: `/x/passport-tv-login/qrcode/auth_code`
 * returns a URL pointing here; confirming lets the TV's `qrcode/poll` succeed.
 */
export function TvLogin() {
  useTitle('TV 扫码登录')
  const [params] = useSearchParams()
  const code = params.get('auth_code') ?? ''
  const { me, ready } = useSession()
  const nav = useNavigate()
  const [state, setState] = useState<'idle' | 'scanned' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!ready) return
    if (!me) { nav(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); return }
    if (!code) return
    jm.qrScan(code).then((r) => { if (r.code === 0) setState('scanned'); else { setState('error'); setMsg(r.message) } }).catch((e) => { setState('error'); setMsg(e.message) })
  }, [ready, me, code, nav])
  const confirm = async () => {
    try { const r = await jm.qrConfirm(code); if (r.code !== 0) throw new Error(r.message); setState('done') } catch (e) { setState('error'); setMsg((e as Error).message) }
  }
  if (!me) return null
  return (
    <div className="page narrow" style={{ maxWidth: 480 }}>
      <div className="panel qr-box">
        <div className="tv"><Icon name="tv" size={44} /></div>
        {!code ? (
          <><h2>在电视上登录</h2><p className="muted">打开 JulibiliTV，选择 Jumedia 数据源并扫描屏幕上的二维码即可登录。</p></>
        ) : state === 'done' ? (
          <><h2 style={{ color: 'var(--success)' }}>登录成功</h2><p className="muted">电视端将自动完成登录，可以关闭此页面了。</p><Link to="/" className="btn">返回首页</Link></>
        ) : state === 'error' ? (
          <><h2 style={{ color: 'var(--danger)' }}>无法完成登录</h2><p className="muted">{msg || '二维码已失效，请在电视上刷新后重新扫描。'}</p></>
        ) : (
          <>
            <h2>确认在电视上登录？</h2>
            <div className="row" style={{ gap: 12 }}><Avatar src={me.face} size={44} /><div style={{ textAlign: 'left' }}><b>{me.uname}</b><div className="faint" style={{ fontSize: 12 }}>UID {me.mid}</div></div></div>
            <p className="muted" style={{ fontSize: 13 }}>设备：JulibiliTV（Apple TV）· 会话 {code.slice(0, 8)}…<br />如果不是你本人操作，请勿确认。</p>
            <div className="row" style={{ width: '100%' }}><Link to="/" className="btn lg grow">取消</Link><button className="btn primary lg grow" onClick={confirm} disabled={state !== 'scanned' || !cookie('bili_jct')}>确认登录</button></div>
          </>
        )}
      </div>
    </div>
  )
}
