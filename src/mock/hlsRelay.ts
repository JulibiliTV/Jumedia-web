/**
 * m3u8 → live relay. A room configured with an m3u8 source is played through
 * `/live-relay/{room}/index.m3u8`, which Jumedia advertises as an `http_hls`
 * route in `getRoomPlayInfo`:
 *
 * - A source that is already live (no `#EXT-X-ENDLIST`) is passed through with
 *   its URIs made absolute.
 * - A VOD source is replayed on the wall clock from the moment the room went
 *   live: each request returns a sliding window of the segments "on air", with
 *   `EXT-X-MEDIA-SEQUENCE` advancing and an `EXT-X-DISCONTINUITY` at every loop,
 *   so every client (web or JumediaTV) sees the same live edge.
 *
 * Jumedia-server should implement the same rules; this module has no browser
 * dependencies so it can be ported directly.
 */

export interface Variant { uri: string; info: string; bandwidth: number; resolution: string }
export interface Segment { uri: string; duration: number; key?: string; map?: string }
export type Playlist =
  | { kind: 'master'; variants: Variant[]; extra: string[] }
  | { kind: 'media'; ended: boolean; targetDuration: number; version: number; segments: Segment[]; format: 'ts' | 'fmp4'; duration: number }

const abs = (uri: string, base: string) => { try { return new URL(uri, base).href } catch { return uri } }
const absAttr = (line: string, base: string) => line.replace(/URI="([^"]+)"/, (_, u) => `URI="${abs(u, base)}"`)

export function parsePlaylist(text: string, base: string): Playlist {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines[0] !== '#EXTM3U') throw new Error('不是有效的 m3u8 播放列表')
  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) {
    const variants: Variant[] = []
    const extra: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.startsWith('#EXT-X-STREAM-INF')) {
        const uri = lines[++i]
        if (!uri || uri.startsWith('#')) continue
        variants.push({ uri: abs(uri, base), info: l, bandwidth: Number(/BANDWIDTH=(\d+)/.exec(l)?.[1] ?? 0), resolution: /RESOLUTION=([\dx]+)/.exec(l)?.[1] ?? '' })
      } else if (l.startsWith('#EXT-X-MEDIA')) extra.push(absAttr(l, base))
    }
    if (!variants.length) throw new Error('主播放列表中没有可用的码率')
    return { kind: 'master', variants, extra }
  }
  const segments: Segment[] = []
  let duration = 0, key: string | undefined, map: string | undefined, target = 0, version = 3, ended = false
  for (const l of lines) {
    if (l.startsWith('#EXTINF:')) duration = parseFloat(l.slice(8))
    else if (l.startsWith('#EXT-X-TARGETDURATION:')) target = Number(l.split(':')[1])
    else if (l.startsWith('#EXT-X-VERSION:')) version = Number(l.split(':')[1])
    else if (l.startsWith('#EXT-X-KEY')) key = /METHOD=NONE/.test(l) ? undefined : absAttr(l, base)
    else if (l.startsWith('#EXT-X-MAP')) map = absAttr(l, base)
    else if (l === '#EXT-X-ENDLIST' || l === '#EXT-X-PLAYLIST-TYPE:VOD') ended = true
    else if (!l.startsWith('#')) { segments.push({ uri: abs(l, base), duration: duration || target || 6, key, map }); duration = 0 }
  }
  if (!segments.length) throw new Error('播放列表中没有分片')
  const total = segments.reduce((s, x) => s + x.duration, 0)
  return { kind: 'media', ended, version, segments, format: map ? 'fmp4' : 'ts', duration: total, targetDuration: Math.ceil(Math.max(target, ...segments.map((s) => s.duration))) }
}

/** Master playlist whose variants point at the relay's own variant playlists. */
export function relayMaster(p: Extract<Playlist, { kind: 'master' }>, variantURL: (index: number) => string): string {
  return ['#EXTM3U', '#EXT-X-VERSION:3', ...p.extra, ...p.variants.flatMap((v, i) => [v.info, variantURL(i)])].join('\n') + '\n'
}

/** A live source is forwarded as-is apart from absolute URIs. */
export function passthrough(text: string, base: string): string {
  return text.split(/\r?\n/).map((l) => {
    const t = l.trim()
    if (!t) return l
    if (t.startsWith('#')) return /URI="/.test(t) ? absAttr(t, base) : t
    return abs(t, base)
  }).join('\n')
}

export interface Window { text: string; ended: boolean; position: number }

/**
 * Sliding window over a VOD playlist replayed from `startedAt` (seconds).
 * With `loop` false the stream ends after one pass and the window gains
 * `#EXT-X-ENDLIST`.
 */
export function liveWindow(p: Extract<Playlist, { kind: 'media' }>, startedAt: number, now: number, opts: { loop: boolean; size?: number } = { loop: true }): Window {
  const n = p.segments.length, size = Math.min(opts.size ?? 6, n)
  const elapsed = Math.max(0, now - startedAt)
  const ended = !opts.loop && elapsed >= p.duration
  // The first window is "pre-aired" so the live edge starts moving at once
  // instead of waiting for a full window of wall-clock time.
  const preroll = p.segments.slice(0, size).reduce((s, x) => s + x.duration, 0)
  const t = elapsed + preroll
  // Global index of the newest segment that has fully "aired".
  const cycle = Math.floor(t / p.duration)
  let within = t - cycle * p.duration, j = 0
  while (j < n && within >= p.segments[j].duration) { within -= p.segments[j].duration; j++ }
  let newest = cycle * n + j - 1
  if (ended || (!opts.loop && newest > n - 1)) newest = n - 1
  newest = Math.max(newest, size - 1)
  const first = newest - size + 1
  const lines = ['#EXTM3U', `#EXT-X-VERSION:${Math.max(3, p.version)}`, `#EXT-X-TARGETDURATION:${p.targetDuration}`, `#EXT-X-MEDIA-SEQUENCE:${first}`, `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(first / n)}`]
  let key: string | undefined, map: string | undefined
  for (let g = first; g <= newest; g++) {
    const s = p.segments[g % n]
    if (g > first && g % n === 0) lines.push('#EXT-X-DISCONTINUITY')
    if (s.map && (s.map !== map || g % n === 0)) { lines.push(s.map); map = s.map }
    if (s.key !== key || (g === first && s.key)) { lines.push(s.key ?? '#EXT-X-KEY:METHOD=NONE'); key = s.key }
    lines.push(`#EXTINF:${s.duration.toFixed(3)},`, s.uri)
  }
  if (ended) lines.push('#EXT-X-ENDLIST')
  return { text: lines.join('\n') + '\n', ended, position: elapsed % p.duration }
}
