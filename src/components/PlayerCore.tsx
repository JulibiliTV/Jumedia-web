import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'
import { formatDuration } from '../api/normalize'
import { type DanmakuCue, type DanmakuSettings, defaultDanmakuSettings } from '../api/protobuf'
import { useSession } from '../lib/session'
import { Icon } from './Icon'
import { LibmediaEngine, type MediaLike, needsLibmedia } from './libmediaEngine'
import { Switch, toast, toastError } from './ui'

export type Source =
  | { kind: 'video'; aid: number; cid: number; startAt?: number }
  | { kind: 'bangumi'; aid: number; cid: number; epid: number; sid: number; startAt?: number }
  | { kind: 'live'; roomId: number }

interface Quality { qn: number; label: string }
export interface Chapter { from: number; to: number; content: string }
interface Cue { from: number; to: number; content: string }
interface Active { cue: DanmakuCue; el: HTMLDivElement; lane: number; width: number; mine?: boolean }

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const COLORS = [0xffffff, 0xfe0302, 0xffd302, 0x00cd00, 0x00a0ea, 0xcc0273]
const LOCAL_DM = 'jumedia.dm.settings'

function resolutionLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return ''
  const long = Math.max(width, height), short = Math.min(width, height)
  // The long edge preserves the tier of cropped widescreen films; normalize
  // orientation so portrait video receives the same label as landscape video.
  for (const [w, h, label] of [
    [7680, 4320, '8K'], [3840, 2160, '4K'], [2560, 1440, '1440p'],
    [1920, 1080, '1080p'], [1280, 720, '720p'], [1024, 576, '576p'],
    [854, 480, '480p'], [640, 360, '360p'], [426, 240, '240p'],
  ] as const) {
    if (long >= w || short >= h) return label
  }
  return `${short}p`
}

function loadLocalSettings(): DanmakuSettings {
  try { return { ...defaultDanmakuSettings, ...JSON.parse(localStorage.getItem(LOCAL_DM) ?? '{}') } } catch { return defaultDanmakuSettings }
}

/** `seekTo` jumps when its `n` changes (e.g. a click on a chapter outside the player). */
export function Player({ source, onEnded, liveFeed, chaptersOut, seekTo }: { source: Source; onEnded?: () => void; liveFeed?: { id: string; text: string; mine?: boolean }[]; chaptersOut?: (c: Chapter[]) => void; seekTo?: { at: number; n: number } }) {
  const { me } = useSession()
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const engineBox = useRef<HTMLDivElement>(null)
  const engine = useRef<LibmediaEngine>()
  /** The active media: `<video>`, or libmedia for files browsers cannot play natively. */
  const media = (): Media | null => engine.current ?? video.current
  const layer = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string>()
  const [format, setFormat] = useState<string>()
  const [error, setError] = useState<string>()
  /** Fetching the play url or buffering, until the media can play (first frame / `canplay`). */
  const [loading, setLoading] = useState(true)
  const [qualities, setQualities] = useState<Quality[]>([])
  const [qn, setQn] = useState(80)
  const [resolution, setResolution] = useState('')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('jumedia.volume') ?? 0.8))
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [full, setFull] = useState(false)
  const [idle, setIdle] = useState(false)
  const [pop, setPop] = useState<'' | 'quality' | 'speed' | 'settings' | 'subtitle'>('')
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [notice, setNotice] = useState('')
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [subs, setSubs] = useState<{ lan_doc: string; url: string }[]>([])
  const [sub, setSub] = useState(-1)
  const [cues, setCues] = useState<Cue[]>([])
  const [settings, setSettings] = useState<DanmakuSettings>(loadLocalSettings)
  const [dmText, setDmText] = useState('')
  const [dmColor, setDmColor] = useState(0xffffff)
  const [dmMode, setDmMode] = useState(1)
  const [dmCount, setDmCount] = useState(0)
  const live = source.kind === 'live'

  const danmaku = useRef<DanmakuCue[]>([])
  const loadedSegments = useRef(new Set<number>())
  const segmentRequests = useRef(new Map<number, AbortController>())
  const segmentTimers = useRef(new Map<number, number>())
  const danmakuGeneration = useRef(0)
  const ensureSegmentRef = useRef<(time: number) => void>(() => {})
  const actives = useRef<Active[]>([])
  const cursor = useRef(0)
  const lastT = useRef(0)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const idleTimer = useRef(0)
  const pendingSeek = useRef<number>()
  // The episode's opening (`clip_info_list`, CLIP_TYPE_OP) for 跳过片头.
  const [opening, setOpening] = useState<{ start: number; end: number } | null>(null)
  const key = source.kind === 'live' ? `live-${source.roomId}` : `${source.cid}`

  // ---------- media source ----------
  const resolve = useCallback(async (quality: number) => {
    if (source.kind === 'live') {
      const d = await juli.roomPlayInfo(source.roomId)
      const stream = d.playurl_info?.playurl?.stream ?? []
      for (const s of stream) for (const f of s.format ?? []) for (const c of f.codec ?? []) for (const u of c.url_info ?? []) return u.host + c.base_url + u.extra
      throw new Error('主播暂未开播')
    }
    const d = source.kind === 'bangumi' ? await juli.pgcPlayurl(source.epid, quality) : await juli.playurl(source.aid, source.cid, quality)
    const op = (d.clip_info_list ?? []).find((x: { clipType?: string }) => x.clipType === 'CLIP_TYPE_OP')
    setOpening(op && op.end > op.start ? { start: op.start, end: op.end } : null)
    // Local playback returns the same original file for every protocol quality ID.
    setQualities(d.from === 'local' ? [] : (d.accept_quality ?? []).map((q: number, i: number) => ({ qn: q, label: d.accept_description?.[i] ?? String(q) })))
    setQn(d.quality ?? quality)
    const first = d.durl?.[0]?.url
    if (!first) throw new Error('没有可播放的线路')
    setFormat(d.format)
    return first as string
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    danmakuGeneration.current += 1
    setError(undefined); setUrl(undefined); setFormat(undefined); setTime(0); setDuration(0); setResolution(''); setLoading(true)
    danmaku.current = []; setDmCount(0); loadedSegments.current.clear(); clearDanmaku()
    resolve(qn).then((u) => alive && setUrl(u)).catch((e) => alive && setError(e.message))
    if (source.kind !== 'live') {
      juli.playerV2(source.aid, source.cid).then((d) => {
        if (!alive) return
        const ch = (d.view_points ?? []).filter((p: any) => p.type === 2).map((p: any) => ({ from: p.from, to: p.to, content: p.content }))
        setChapters(ch); chaptersOut?.(ch)
        setSubs((d.subtitle?.subtitles ?? []).map((s: any) => ({ lan_doc: s.lan_doc, url: s.subtitle_url.startsWith('//') ? 'https:' + s.subtitle_url : s.subtitle_url })))
        setSub(-1); setCues([])
      }).catch(() => {})
    }
    return () => {
      alive = false
      danmakuGeneration.current += 1
      segmentRequests.current.forEach((request) => request.abort())
      segmentRequests.current.clear()
      segmentTimers.current.forEach((timer) => window.clearTimeout(timer))
      segmentTimers.current.clear()
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  /** Player state follows whichever media object is active. */
  const listen = (m: Media) => {
    const updateResolution = () => {
      const width = m.videoWidth, height = m.videoHeight
      setResolution(resolutionLabel(width, height))
    }
    const on: Record<string, () => void> = {
      play: () => {
        setPlaying(true); wake()
        const index = Math.floor(Math.max(0, m.currentTime) / 360) + 1
        // Local comments do not indicate whether the external cache is ready.
        // Recheck on resume; the server owns the provider retry interval.
        if (!segmentRequests.current.has(index) && !segmentTimers.current.has(index)) {
          loadedSegments.current.delete(index)
        }
        ensureSegmentRef.current(m.currentTime)
      },
      pause: () => { setPlaying(false); setIdle(false); reportRef.current() },
      timeupdate: () => { setTime(m.currentTime); setBuffered(bufferedEnd(m)); updateResolution() },
      loadedmetadata: updateResolution,
      resize: updateResolution,
      durationchange: () => setDuration(Number.isFinite(m.duration) ? m.duration : 0),
      waiting: () => setLoading(true),
      canplay: () => setLoading(false),
      playing: () => setLoading(false),
      ended: () => { reportRef.current(true); if (live) { if (url?.includes('.m3u8')) setError('直播已结束'); return } onEndedRef.current?.() },
      error: () => { if (url && !url.startsWith('blob:')) setError(engine.current ? '视频解码失败，当前浏览器可能不支持该视频格式' : '视频加载失败') },
    }
    for (const [k, f] of Object.entries(on)) m.addEventListener(k, f)
    return () => { for (const [k, f] of Object.entries(on)) m.removeEventListener(k, f) }
  }

  useEffect(() => {
    setResolution('')
    const v = video.current
    if (!v || !url) return
    const start = source.kind !== 'live' ? source.startAt : undefined
    if (needsLibmedia(format) && engineBox.current) {
      const resume = pendingSeek.current
      pendingSeek.current = undefined
      const e = new LibmediaEngine(engineBox.current, url, format!)
      e.volume = volume; e.muted = muted; e.playbackRate = rate
      engine.current = e
      const unlisten = listen(e)
      let cancelled = false
      e.load().then(async () => {
        if (cancelled) return
        await e.play().catch(() => {})
        if (cancelled) return
        setLoading(false)
        if (resume !== undefined) e.currentTime = resume
        else if (start && start > 0 && start < e.duration - 3) { e.currentTime = start; setNotice(`上次看到 ${formatDuration(start)}，已为你续播`); setTimeout(() => setNotice(''), 3500) }
      }).catch(() => { if (!cancelled) setError('视频加载失败，当前浏览器可能不支持该视频格式') })
      return () => { cancelled = true; unlisten(); e.destroy(); if (engine.current === e) engine.current = undefined; engineBox.current?.replaceChildren() }
    }
    const unlisten = listen(v)
    let hls: { destroy(): void } | undefined
    let cancelled = false
    if (url.includes('.m3u8')) {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return
        // Native HLS only where MSE is missing (iOS Safari); hls.js elsewhere so playlists go through `fetch`.
        if (!Hls.isSupported()) { if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = url; else setError('当前浏览器不支持此直播格式'); return }
        const h = new Hls({ pLoader: FetchPlaylistLoader as any, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8, manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 4 })
        let retries = 0
        h.on(Hls.Events.ERROR, (_e, d) => {
          if (!d.fatal) return
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError()
          else if (d.type === Hls.ErrorTypes.NETWORK_ERROR && retries++ < 5) { setNotice('直播流中断，正在重连…'); setTimeout(() => h.startLoad(), 2000 * retries) }
          else setError(live ? '直播流已中断，主播可能已下播' : '视频加载失败')
        })
        h.on(Hls.Events.FRAG_LOADED, () => { if (retries) { retries = 0; setNotice('') } })
        h.loadSource(url); h.attachMedia(v); hls = h
      }).catch(() => { if (!cancelled) setError('播放器加载失败，请检查网络后刷新页面') })
    } else { v.src = url; v.loop = live } // a non-HLS live stream is a relayed file played from the live position (mock)
    v.volume = volume
    v.playbackRate = rate
    const resume = pendingSeek.current
    const onMeta = () => {
      if (resume !== undefined) { v.currentTime = resume; pendingSeek.current = undefined }
      else if (start && start > 0 && start < v.duration - 3) { v.currentTime = start; setNotice(`上次看到 ${formatDuration(start)}，已为你续播`); setTimeout(() => setNotice(''), 3500) }
      v.play().catch(() => {})
    }
    v.addEventListener('loadedmetadata', onMeta, { once: true })
    return () => { cancelled = true; unlisten(); v.removeEventListener('loadedmetadata', onMeta); hls?.destroy(); v.loop = false; v.removeAttribute('src'); v.load() }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- danmaku settings (synced with /x/v2/dm/web/view & /config when signed in) ----------
  const settingsRevision = useRef(0)
  useEffect(() => {
    if (!me || source.kind === 'live') return
    let alive = true
    const revision = settingsRevision.current
    juli.dmWebView(source.cid).then((s) => {
      if (s && alive && revision === settingsRevision.current) setSettings(s)
    }).catch(() => {})
    return () => { alive = false }
  }, [me?.mid]) // eslint-disable-line react-hooks/exhaustive-deps
  const saveTimer = useRef(0)
  const updateSettings = (patch: Partial<DanmakuSettings>) => {
    settingsRevision.current += 1
    const next = { ...settings, ...patch }
    setSettings(next)
    try { localStorage.setItem(LOCAL_DM, JSON.stringify(next)) } catch { /* ignore */ }
    if (me) { clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(() => juli.dmSaveConfig(next).catch(() => {}), 800) }
    if (patch.enabled === false) clearDanmaku()
  }

  // ---------- danmaku engine ----------
  function clearDanmaku() {
    for (const a of actives.current) a.el.remove()
    actives.current = []
  }
  const ensureSegment = useCallback(function loadSegment(t: number) {
    if (source.kind === 'live' || !settingsRef.current.enabled) return
    const index = Math.floor(Math.max(0, t) / 360) + 1
    if (loadedSegments.current.has(index)) return
    loadedSegments.current.add(index)
    const generation = danmakuGeneration.current
    const request = new AbortController()
    segmentRequests.current.set(index, request)
    const retry = (delay: number) => {
      const timer = window.setTimeout(() => {
        segmentTimers.current.delete(index)
        loadedSegments.current.delete(index)
        loadSegment(t)
      }, delay)
      segmentTimers.current.set(index, timer)
    }
    juli.dmSegmentResult(source.cid, index, request.signal).then(({ cues: list, pending }) => {
      if (request.signal.aborted || generation !== danmakuGeneration.current) return
      segmentRequests.current.delete(index)
      const retained = danmaku.current.filter((d) => Math.floor(d.time / 360) + 1 !== index)
      const seen = new Set<string>()
      danmaku.current = [...retained, ...list].filter((d) => {
        if (seen.has(d.id)) return false
        seen.add(d.id)
        return true
      }).sort((a, b) => a.time - b.time)
      setDmCount(danmaku.current.length)
      cursor.current = lowerBound(danmaku.current, media()?.currentTime ?? 0)
      if (pending) retry(2000)
    }).catch(() => {
      if (request.signal.aborted || generation !== danmakuGeneration.current) return
      segmentRequests.current.delete(index)
      retry(5000)
    })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  ensureSegmentRef.current = ensureSegment
  useEffect(() => {
    if (settings.enabled) ensureSegment(media()?.currentTime || (source.kind !== 'live' ? source.startAt ?? 0 : 0))
    else {
      segmentRequests.current.forEach((request, index) => { request.abort(); loadedSegments.current.delete(index) })
      segmentRequests.current.clear()
      segmentTimers.current.forEach((timer, index) => { window.clearTimeout(timer); loadedSegments.current.delete(index) })
      segmentTimers.current.clear()
    }
  }, [ensureSegment, settings.enabled])

  const spawn = useCallback((cue: DanmakuCue, mine = false) => {
    const host = layer.current
    const s = settingsRef.current
    if (!host || !s.enabled) return
    if ((cue.mode <= 3 && !s.showScroll) || (cue.mode === 5 && !s.showTop) || (cue.mode === 4 && !s.showBottom)) return
    if (!s.showColor && cue.color !== 0xffffff) return
    if (s.smartFilter && cue.weight < (s.blockLevel || 3)) return
    const H = host.clientHeight, W = host.clientWidth
    const size = Math.round((cue.fontSize / 25) * 22 * s.fontScale * Math.min(1.25, Math.max(0.7, W / 960)))
    const lineH = Math.round(size * 1.25)
    const lanes = Math.max(1, Math.floor((H * (s.area || 100)) / 100 / lineH))
    const el = document.createElement('div')
    el.className = `dm${cue.mode === 4 || cue.mode === 5 ? ' fixed' : ''}${mine ? ' mine' : ''}`
    el.textContent = cue.text
    el.style.fontSize = size + 'px'
    el.style.color = '#' + cue.color.toString(16).padStart(6, '0')
    el.style.opacity = String(s.opacity)
    host.appendChild(el)
    const width = el.offsetWidth
    const t = media()?.currentTime ?? 0
    let lane = -1
    const same = actives.current.filter((a) => (cue.mode <= 3 ? a.cue.mode <= 3 : a.cue.mode === cue.mode))
    for (let l = 0; l < lanes && lane < 0; l++) {
      const inLane = same.filter((a) => a.lane === l)
      if (cue.mode <= 3) {
        const free = inLane.every((a) => { const D = 8 / s.speed; const x = W - ((t - a.cue.time) * (W + a.width)) / D; return x + a.width < W - 16 })
        if (free) lane = l
      } else if (!inLane.length) lane = l
    }
    if (lane < 0) { if (!mine) { el.remove(); return } lane = 0 }
    const y = cue.mode === 4 ? H - (lane + 1) * lineH - 6 : lane * lineH + 6
    el.style.top = y + 'px'
    actives.current.push({ cue: { ...cue, time: Math.max(cue.time, t - 0.05) }, el, lane, width, mine })
  }, [])

  useEffect(() => {
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const v = media(), host = layer.current
      if (!v || !host) return
      const t = v.currentTime
      if (Math.abs(t - lastT.current) > 1.2) { clearDanmaku(); cursor.current = lowerBound(danmaku.current, t) }
      ensureSegment(t)
      lastT.current = t
      const s = settingsRef.current
      if (!v.paused && s.enabled && !live) {
        const list = danmaku.current
        while (cursor.current < list.length && list[cursor.current].time <= t) {
          const cue = list[cursor.current++]
          if (t - cue.time < 0.6) spawn(cue)
        }
        if (Math.floor(t / 360) !== Math.floor((t + 20) / 360)) ensureSegment(t + 20)
      }
      const W = host.clientWidth
      const D = 8 / s.speed
      actives.current = actives.current.filter((a) => {
        const age = t - a.cue.time
        if (a.cue.mode <= 3) {
          if (age > D || age < -1) { a.el.remove(); return false }
          a.el.style.transform = `translateX(${W - (age * (W + a.width)) / D}px)`
        } else if (age > 4 || age < -1) { a.el.remove(); return false }
        return true
      })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [ensureSegment, spawn, live])

  // live chat → scroll danmaku
  const seenLive = useRef(new Set<string>())
  useEffect(() => {
    if (!liveFeed) return
    const first = seenLive.current.size === 0
    for (const m of liveFeed) {
      if (seenLive.current.has(m.id)) continue
      seenLive.current.add(m.id)
      if (!first) spawn({ id: m.id, time: media()?.currentTime ?? 0, mode: 1, fontSize: 25, color: 0xffffff, text: m.text, weight: 10 }, m.mine)
    }
  }, [liveFeed, spawn])

  // ---------- subtitles ----------
  useEffect(() => {
    if (sub < 0 || !subs[sub]) { setCues([]); return }
    fetch(subs[sub].url).then((r) => r.json()).then((d) => setCues(d.body ?? [])).catch(() => toast('字幕加载失败', 'error'))
  }, [sub, subs])
  const cue = cues.find((c) => time >= c.from && time <= c.to)

  // ---------- heartbeat (history) ----------
  const report = useCallback((final = false) => {
    const v = media()
    if (!me || !v || source.kind === 'live' || !v.currentTime) return
    const ended = v.ended || (v.duration && v.duration - v.currentTime < 1)
    juli.heartbeat({ aid: source.aid, cid: source.cid, played_time: ended ? -1 : Math.floor(v.currentTime), bangumi: source.kind === 'bangumi' ? { epid: source.epid, sid: source.sid } : undefined }).catch(() => {})
    void final
  }, [me?.mid, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const reportRef = useRef(report)
  reportRef.current = report
  useEffect(() => {
    const t = setInterval(() => { if (media()?.paused === false) report() }, 15000)
    const onHide = () => report(true)
    window.addEventListener('pagehide', onHide)
    return () => { clearInterval(t); window.removeEventListener('pagehide', onHide); report(true) }
  }, [report])

  // ---------- controls ----------
  const toggle = () => { const v = media(); if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause() }
  const seek = (t: number) => { const v = media(); if (v && !live) { v.currentTime = Math.max(0, Math.min(duration, t)) } }
  useEffect(() => { if (seekTo) { seek(seekTo.at); media()?.play().catch(() => {}) } }, [seekTo?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  const flash = (text: string) => { setNotice(text); setTimeout(() => setNotice((n) => (n === text ? '' : n)), 1200) }
  const wake = () => { setIdle(false); clearTimeout(idleTimer.current); idleTimer.current = window.setTimeout(() => { if (media()?.paused === false) { setIdle(true); setPop('') } }, 2600) }
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else box.current?.requestFullscreen() }
  useEffect(() => { const f = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f) }, [])
  useEffect(() => { const m = media(); if (m) { m.volume = volume; m.muted = muted } try { localStorage.setItem('jumedia.volume', String(volume)) } catch { /* ignore */ } }, [volume, muted])
  useEffect(() => { const m = media(); if (m) m.playbackRate = rate }, [rate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      const v = media()
      if (!v) return
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(v.currentTime + 5); flash('快进 5 秒') }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(v.currentTime - 5); flash('快退 5 秒') }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setVolume((x) => Math.min(1, +(x + 0.1).toFixed(2))); flash('音量增加') }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setVolume((x) => Math.max(0, +(x - 0.1).toFixed(2))); flash('音量降低') }
      else if (e.key === 'f') fullscreen()
      else if (e.key === 'm') setMuted((m) => !m)
      else if (e.key === 'd') updateSettings({ enabled: !settingsRef.current.enabled })
      wake()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const sendDanmaku = async (e: FormEvent) => {
    e.preventDefault()
    const text = dmText.trim()
    if (!text) return
    if (!me) { toast('登录后才能发送弹幕', 'error'); return }
    const v = media()
    try {
      if (source.kind === 'live') {
        await jm.liveSend(source.roomId, text, dmColor)
        spawn({ id: 'me' + Date.now(), time: v?.currentTime ?? 0, mode: 1, fontSize: 25, color: dmColor, text, weight: 10 }, true)
      } else {
        const progress = Math.floor((v?.currentTime ?? 0) * 1000)
        const r = await jm.dmPost({ oid: source.cid, aid: source.aid, msg: text, progress, mode: dmMode, color: dmColor, fontsize: 25 })
        const cueObj = { id: String(r.data?.dmid ?? Date.now()), time: progress / 1000, mode: dmMode, fontSize: 25, color: dmColor, text, weight: 10 }
        danmaku.current = [...danmaku.current, cueObj].sort((a, b) => a.time - b.time)
        setDmCount(danmaku.current.length)
        cursor.current = lowerBound(danmaku.current, (v?.currentTime ?? 0) + 0.001)
        spawn(cueObj, true)
      }
      setDmText('')
    } catch (err) { toastError(err) }
  }

  const scrubTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    seek(((e.clientX - rect.left) / rect.width) * duration)
  }
  const hoverChapter = hover && chapters.find((c) => hover.t >= c.from && hover.t < c.to)

  return (
    <div className="player-wrap">
      <div ref={box} className={`player ${idle ? 'idle' : ''}`} onMouseMove={wake} onMouseLeave={() => playing && setIdle(true)}>
        <video ref={video} playsInline onClick={() => { toggle(); setPop('') }} onDoubleClick={fullscreen} loop={live && !url?.includes('.m3u8')} hidden={needsLibmedia(format)} />
        <div ref={engineBox} className="engine" hidden={!needsLibmedia(format)} onClick={() => { toggle(); setPop('') }} onDoubleClick={fullscreen} />
        <div ref={layer} className="dm-layer" style={{ bottom: 0 }} />
        {cue && <div className="subtitle">{cue.content}</div>}
        {!playing && url && !loading && !error && <div className="center"><div className="big-play"><Icon name="play" size={30} fill /></div></div>}
        {(!url || loading) && !error && <div className="center"><div className="spinner" style={{ borderColor: 'rgba(255,255,255,.2)', borderTopColor: '#fff' }} /></div>}
        {error && <div className="error"><div><Icon name="alert-circle" size={36} /><p style={{ marginTop: 10 }}>{error}</p></div></div>}
        {notice && <div className="notice">{notice}</div>}
        <div className="controls" onClick={(e) => e.stopPropagation()}>
          {!live && (
            <div className="scrub" onClick={scrubTo} onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = e.clientX - r.left; setHover({ x, t: (x / r.width) * duration }) }} onMouseLeave={() => setHover(null)}>
              <div className="rail">
                <div className="buffered" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
                <div className="played" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
                {chapters.slice(1).map((c) => <div key={c.from} className="chapter-gap" style={{ left: `${(c.from / duration) * 100}%` }} />)}
                <div className="knob" style={{ left: `${duration ? (time / duration) * 100 : 0}%` }} />
              </div>
              {hover && <div className="tip" style={{ left: hover.x }}>{hoverChapter ? `${hoverChapter.content} · ` : ''}{formatDuration(hover.t)}</div>}
            </div>
          )}
          <div className="ctrl-row">
            <button className="cbtn" onClick={toggle} aria-label={playing ? '暂停' : '播放'}><Icon name={playing ? 'pause' : 'play'} size={20} fill /></button>
            {live ? <button className="cbtn" title="回到直播最新画面" onClick={() => { const v = video.current; if (v && v.seekable.length) v.currentTime = Math.max(0, v.seekable.end(v.seekable.length - 1) - 4) }}><span className="badge accent" style={{ height: 18 }}>LIVE</span></button> : <span className="time">{formatDuration(time)} / {formatDuration(duration)}</span>}
            <div className="grow" />
            {opening && !live && time < opening.end - 1 && <button className="cbtn chip" onClick={() => { seek(opening.end); flash('已跳过片头') }}>跳过片头</button>}
            <button className={`cbtn ${settings.enabled ? 'on' : ''}`} onClick={() => updateSettings({ enabled: !settings.enabled })} title="弹幕开关 (D)"><Icon name="danmaku" size={19} /></button>
            {qualities.length > 1 ? (
              <div style={{ position: 'relative' }}>
                <button className="cbtn" title="视频分辨率" onClick={() => setPop(pop === 'quality' ? '' : 'quality')}>{resolution || '画质'}</button>
                {pop === 'quality' && <div className="cpop">{qualities.map((q) => <button key={q.qn} className={q.qn === qn ? 'on' : ''} onClick={async () => { setPop(''); pendingSeek.current = media()?.currentTime ?? 0; try { const u = await resolve(q.qn); setUrl(undefined); setLoading(true); setTimeout(() => setUrl(u)); flash(`已切换至 ${q.label}`) } catch (e) { toastError(e) } }}>{q.qn === qn && resolution ? resolution : q.label}</button>)}</div>}
              </div>
            ) : resolution && <span className="player-resolution" title="视频分辨率">{resolution}</span>}
            {!live && (
              <div style={{ position: 'relative' }}>
                <button className="cbtn" onClick={() => setPop(pop === 'speed' ? '' : 'speed')}>{rate === 1 ? '倍速' : `${rate}x`}</button>
                {pop === 'speed' && <div className="cpop">{[...SPEEDS].reverse().map((s) => <button key={s} className={s === rate ? 'on' : ''} onClick={() => { setRate(s); setPop('') }}>{s}x</button>)}</div>}
              </div>
            )}
            {subs.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button className={`cbtn ${sub >= 0 ? 'on' : ''}`} onClick={() => setPop(pop === 'subtitle' ? '' : 'subtitle')} title="字幕"><Icon name="subtitles" size={19} /></button>
                {pop === 'subtitle' && <div className="cpop"><button className={sub < 0 ? 'on' : ''} onClick={() => { setSub(-1); setPop('') }}>关闭</button>{subs.map((s, i) => <button key={s.url} className={i === sub ? 'on' : ''} onClick={() => { setSub(i); setPop('') }}>{s.lan_doc}</button>)}</div>}
              </div>
            )}
            <div style={{ position: 'relative' }}>
              <button className="cbtn" onClick={() => setPop(pop === 'settings' ? '' : 'settings')} title="弹幕设置"><Icon name="settings" size={19} /></button>
              {pop === 'settings' && (
                <div className="cpop settings">
                  <b>弹幕设置{me ? '' : '（登录后同步）'}</b>
                  <div className="line"><span>滚动 / 顶部 / 底部</span><span className="row" style={{ gap: 4 }}>
                    {(['showScroll', 'showTop', 'showBottom'] as const).map((k) => <button key={k} className={`cbtn ${settings[k] ? 'on' : ''}`} style={{ height: 26, fontSize: 12, border: '1px solid rgba(255,255,255,.2)' }} onClick={() => updateSettings({ [k]: !settings[k] })}>{{ showScroll: '滚', showTop: '顶', showBottom: '底' }[k]}</button>)}
                  </span></div>
                  <div className="line"><span>彩色弹幕</span><Switch on={settings.showColor} onChange={(v) => updateSettings({ showColor: v })} /></div>
                  <div className="line"><span>智能屏蔽</span><Switch on={settings.smartFilter} onChange={(v) => updateSettings({ smartFilter: v })} /></div>
                  <div className="line"><span>不透明度 {Math.round(settings.opacity * 100)}%</span><input type="range" min={0.1} max={1} step={0.05} value={settings.opacity} onChange={(e) => updateSettings({ opacity: +e.target.value })} /></div>
                  <div className="line"><span>字号 {Math.round(settings.fontScale * 100)}%</span><input type="range" min={0.5} max={1.6} step={0.05} value={settings.fontScale} onChange={(e) => updateSettings({ fontScale: +e.target.value })} /></div>
                  <div className="line"><span>速度 {settings.speed.toFixed(1)}</span><input type="range" min={0.4} max={1.6} step={0.1} value={settings.speed} onChange={(e) => updateSettings({ speed: +e.target.value })} /></div>
                  <div className="line"><span>显示区域 {settings.area}%</span><input type="range" min={25} max={100} step={25} value={settings.area} onChange={(e) => updateSettings({ area: +e.target.value })} /></div>
                </div>
              )}
            </div>
            <span className="vol">
              <button className="cbtn" onClick={() => setMuted(!muted)} aria-label="静音"><Icon name={muted || volume === 0 ? 'mute' : 'volume'} size={19} /></button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => { setVolume(+e.target.value); setMuted(false) }} aria-label="音量" />
            </span>
            {'pictureInPictureEnabled' in document && <button className="cbtn" onClick={() => { (document.pictureInPictureElement ? document.exitPictureInPicture() : video.current?.requestPictureInPicture())?.catch(() => {}) }} title="画中画"><Icon name="pip" size={19} /></button>}
            <button className="cbtn" onClick={fullscreen} title="全屏 (F)"><Icon name={full ? 'exit-fullscreen' : 'fullscreen'} size={19} /></button>
          </div>
        </div>
      </div>
      <div className="dm-bar">
        <span className="nowrap">{live ? '直播弹幕' : `${dmCount} 条弹幕`}</span>
        {!live && <select className="select sm" style={{ width: 84 }} value={dmMode} onChange={(e) => setDmMode(+e.target.value)}><option value={1}>滚动</option><option value={5}>顶部</option><option value={4}>底部</option></select>}
        <div className="colors">{COLORS.map((c) => <button key={c} className={c === dmColor ? 'on' : ''} style={{ background: '#' + c.toString(16).padStart(6, '0') }} onClick={() => setDmColor(c)} aria-label="弹幕颜色" />)}</div>
        <form onSubmit={sendDanmaku}>
          <input value={dmText} maxLength={live ? 40 : 100} onChange={(e) => setDmText(e.target.value)} placeholder={me ? '发个友善的弹幕见证当下' : '登录后发送弹幕'} disabled={!me} />
          <button type="submit" disabled={!me}>发送</button>
        </form>
      </div>
    </div>
  )
}

type Media = HTMLVideoElement | MediaLike
const bufferedEnd = (m: Media) => ('bufferedEnd' in m ? m.bufferedEnd : m.buffered.length ? m.buffered.end(m.buffered.length - 1) : 0)

function lowerBound(list: DanmakuCue[], t: number) {
  let lo = 0, hi = list.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].time < t) lo = mid + 1; else hi = mid }
  return lo
}

/**
 * hls.js playlist loader built on `fetch`. Live playlists are short and
 * re-requested every target duration; using `fetch` lets the in-browser mock
 * serve the m3u8 relay and is equivalent against Jumedia-server.
 */
class FetchPlaylistLoader {
  context: any = null
  stats = { aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0, loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } }
  private controller = new AbortController()
  private timer = 0
  constructor(_config: unknown) {}
  load(context: any, config: any, callbacks: any) {
    this.context = context
    const stats = this.stats
    stats.loading.start = performance.now()
    const timeout = config.loadPolicy?.maxLoadTimeMs ?? config.timeout ?? 10000
    this.timer = window.setTimeout(() => { this.controller.abort(); callbacks.onTimeout(stats, context, null) }, timeout)
    fetch(context.url, { signal: this.controller.signal, cache: 'no-store' })
      .then(async (res) => {
        const text = await res.text()
        clearTimeout(this.timer)
        stats.loading.first = stats.loading.end = performance.now()
        stats.loaded = stats.total = text.length
        if (!res.ok) { callbacks.onError({ code: res.status, text: res.statusText }, context, res, stats); return }
        callbacks.onSuccess({ url: res.url || context.url, data: text, code: res.status }, stats, context, res)
      })
      .catch((e) => { clearTimeout(this.timer); if (!stats.aborted && e.name !== 'AbortError') callbacks.onError({ code: 0, text: String(e) }, context, null, stats) })
  }
  abort() { this.stats.aborted = true; clearTimeout(this.timer); this.controller.abort() }
  destroy() { this.abort() }
}
