import type AVPlayer from '@libmedia/avplayer'
import playerUrl from 'virtual:libmedia-entry'

/**
 * The part of `HTMLVideoElement` the player drives. `<video>` satisfies it for
 * browser-native media; `LibmediaEngine` provides it for files browsers cannot
 * open themselves (MKV, HEVC without MSE support, AC3/DTS audio…), decoding
 * them in the page with libmedia (WebCodecs hardware decoding, WebAssembly
 * fallback) straight from the original file — no server-side transcoding.
 */
export interface MediaLike extends EventTarget {
  currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly ended: boolean
  readonly videoWidth: number
  readonly videoHeight: number
  volume: number
  muted: boolean
  playbackRate: number
  /** End of the buffered range, in seconds. */
  readonly bufferedEnd: number
  play(): Promise<void>
  pause(): void
}

/** Containers the player hands to libmedia instead of `<video>` (playurl `format`). */
export const needsLibmedia = (format?: string) => !!format && !/^(mp4|flv)/.test(format)

/**
 * Decoder wasm files. libmedia fetches them on demand (only the codecs a file uses);
 * `VITE_LIBMEDIA_WASM` points at a self-hosted copy of its `dist` folder, otherwise jsDelivr.
 */
const wasmBaseUrl = (import.meta.env.VITE_LIBMEDIA_WASM as string | undefined) || undefined

let loading: Promise<typeof AVPlayer> | null = null
const loadAVPlayer = () => (loading ??= import(/* @vite-ignore */ playerUrl)
  .then((m) => m.default as typeof AVPlayer)
  .catch((error) => { loading = null; throw error }))

export class LibmediaEngine extends EventTarget implements MediaLike {
  private player?: AVPlayer
  private started = false
  private time = 0
  /** `performance.now()` when `time` was last reported. */
  private at = 0
  private total = 0
  private state: 'idle' | 'playing' | 'paused' | 'ended' = 'idle'
  private vol = 1
  private mute = false
  private rate = 1
  private destroyed = false
  /** Target of the seek in flight; later requests replace it and run once it settles. */
  private seeking: number | null = null
  private nextSeek: number | null = null

  constructor(private container: HTMLDivElement, private url: string, private ext: string, private loop = false) { super() }

  private emit(type: string) { this.dispatchEvent(new Event(type)) }

  async load() {
    const AV = await loadAVPlayer()
    if (this.destroyed) return
    // One AudioContext for all players; resumed on the first user gesture (`play`).
    AV.audioContext ??= new AudioContext()
    const p = new AV({ container: this.container, wasmBaseUrl, enableHardware: true, enableWebCodecs: true, enableWorker: true, enableAudioWorklet: true, loop: this.loop })
    this.player = p
    p.on(AV.Events.TIME, (t: bigint) => { if (this.seeking === null) { this.setTime(Number(t) / 1000); this.emit('timeupdate') } })
    p.on(AV.Events.ENDED, () => { this.state = 'ended'; this.emit('pause'); this.emit('ended') })
    p.on(AV.Events.ERROR, () => this.emit('error'))
    p.on(AV.Events.FIRST_VIDEO_RENDERED, () => this.emit('resize'))
    await p.load(this.url, { ext: this.ext })
    if (this.destroyed) return
    this.total = Number(p.getDuration()) / 1000
    p.setVolume(this.mute ? 0 : this.vol)
    this.emit('durationchange')
    this.emit('loadedmetadata')
  }

  private setTime(t: number) { this.time = t; this.at = performance.now() }
  /**
   * libmedia reports time less often than `<video>` updates `currentTime`; danmaku
   * timing reads this every frame, so between reports it advances with the clock
   * (at most 1.5 s ahead, so a stall does not run away).
   */
  get currentTime() {
    if (this.state !== 'playing' || this.seeking !== null) return this.time
    return Math.min(this.total || Infinity, this.time + Math.min(1.5, ((performance.now() - this.at) / 1000) * this.rate))
  }
  set currentTime(t: number) {
    if (!this.player || !this.started) return
    this.setTime(t)
    if (this.state === 'ended') this.state = 'paused'
    this.emit('timeupdate')
    if (this.seeking !== null) { this.nextSeek = t; return }
    this.seekTo(t)
  }
  private seekTo(t: number) {
    this.seeking = t
    this.player!.seek(BigInt(Math.floor(t * 1000))).catch(() => {}).finally(() => {
      const next = this.nextSeek
      this.nextSeek = null
      this.seeking = null
      if (next !== null && this.player) this.seekTo(next)
    })
  }
  get duration() { return this.total }
  get videoWidth() { return this.player?.getStats().width ?? 0 }
  get videoHeight() { return this.player?.getStats().height ?? 0 }
  get paused() { return this.state !== 'playing' }
  get ended() { return this.state === 'ended' }
  get bufferedEnd() { return this.time }
  get volume() { return this.vol }
  set volume(v: number) { this.vol = v; this.player?.setVolume(this.mute ? 0 : v) }
  get muted() { return this.mute }
  set muted(m: boolean) { this.mute = m; this.player?.setVolume(m ? 0 : this.vol) }
  get playbackRate() { return this.rate }
  set playbackRate(r: number) { this.rate = r; this.player?.setPlaybackRate(r) }

  async play() {
    const p = this.player
    if (!p) return
    const ctx = (p.constructor as typeof AVPlayer).audioContext
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {})
    if (!this.started) { this.started = true; await p.play({ audio: true, video: true }) }
    else if (this.state === 'ended') await p.seek(BigInt(0)).then(() => p.play())
    else await p.play()
    this.state = 'playing'
    this.at = performance.now()
    p.setPlaybackRate(this.rate)
    this.emit('play')
  }
  pause() {
    if (!this.player || this.state !== 'playing') return
    this.setTime(this.currentTime)
    this.state = 'paused'
    this.player.pause().catch(() => {})
    this.emit('pause')
  }

  destroy() {
    this.destroyed = true
    this.player?.destroy().catch(() => {})
    this.player = undefined
  }
}
