// Minimal protobuf wire codec for danmaku payloads, matching Juli's
// `DanmakuProtobuf`: `/x/v2/dm/list/seg.so` (DmSegMobileReply, field 1 =
// DanmakuElem) and `/x/v2/dm/web/view` (field 10 = DanmuWebPlayerConfig).

export interface Field { number: number; wire: number; int: number; bytes?: Uint8Array }

export function fields(buf: Uint8Array): Field[] {
  let i = 0
  const varint = () => {
    let result = 0, shift = 0, b = 0
    do {
      if (i >= buf.length) throw new Error('malformed protobuf')
      b = buf[i++]
      result += (b & 0x7f) * 2 ** shift
      shift += 7
    } while (b & 0x80)
    return result
  }
  const out: Field[] = []
  while (i < buf.length) {
    const key = varint()
    const f: Field = { number: Math.floor(key / 8), wire: key & 7, int: 0 }
    if (f.wire === 0) f.int = varint()
    else if (f.wire === 1 || f.wire === 5) {
      const n = f.wire === 1 ? 8 : 4
      f.bytes = buf.slice(i, i + n); i += n
    } else if (f.wire === 2) {
      const n = varint(); f.bytes = buf.slice(i, i + n); i += n
    } else throw new Error('unsupported wire type')
    out.push(f)
  }
  return out
}

const text = new TextDecoder()

export interface DanmakuCue { id: string; time: number; mode: number; fontSize: number; color: number; text: string; weight: number }

export function decodeSegment(data: ArrayBuffer): DanmakuCue[] {
  const ids = new Set<string>()
  const cues: DanmakuCue[] = []
  for (const f of fields(new Uint8Array(data))) {
    if (f.number !== 1 || f.wire !== 2 || !f.bytes) continue
    const v = fields(f.bytes)
    const num = (k: number) => v.filter((x) => x.number === k && x.wire === 0).pop()?.int ?? 0
    const str = (k: number) => { const b = v.filter((x) => x.number === k && x.wire === 2).pop()?.bytes; return b ? text.decode(b) : '' }
    const content = str(7), mode = num(3)
    if (mode < 1 || mode > 5 || !content) continue
    const id = str(12) || String(num(1))
    if (ids.has(id)) continue
    ids.add(id)
    cues.push({ id, time: num(2) / 1000, mode, fontSize: Math.min(64, Math.max(12, num(4) || 25)), color: num(5) & 0xffffff, text: content.replace(/\n/g, ' '), weight: Math.min(10, num(9)) })
  }
  return cues.sort((a, b) => a.time - b.time)
}

export interface DanmakuSettings {
  enabled: boolean; smartFilter: boolean; blockLevel: number
  reduced?: boolean
  showTop: boolean; showScroll: boolean; showBottom: boolean; showColor: boolean
  avoidSubtitles: boolean; avoidPeople: boolean; opacity: number; area: number; speed: number; fontScale: number
}

export const defaultDanmakuSettings: DanmakuSettings = {
  enabled: true, smartFilter: false, blockLevel: 1, showTop: true, showScroll: true, showBottom: true, showColor: true,
  avoidSubtitles: true, avoidPeople: true, opacity: 0.8, area: 50, speed: 1, fontScale: 1,
}

export function updateDanmakuSettings(current: DanmakuSettings, patch: Partial<DanmakuSettings>): DanmakuSettings {
  const next = { ...current, ...patch }
  if (patch.enabled !== undefined || patch.area !== undefined) next.reduced = false
  return next
}

export function displayArea(s: DanmakuSettings): number {
  return s.reduced ? 10 : s.area || 100
}

export const areaPresets = [10, 25, 50, 75, 100] as const
export function areaPresetIndex(s: DanmakuSettings): number {
  return Math.round(displayArea(s) / 25)
}

const float32 = (b?: Uint8Array) => (b && b.length === 4 ? new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true) : 0)

export function decodeWebView(data: ArrayBuffer): DanmakuSettings | null {
  const config = fields(new Uint8Array(data)).filter((f) => f.number === 10 && f.wire === 2).pop()
  if (!config?.bytes) return null
  const v = fields(config.bytes)
  const scalar = (k: number) => v.filter((x) => x.number === k && x.wire === 0).pop()?.int
  const num = (k: number) => scalar(k) ?? 0
  const flt = (k: number) => float32(v.filter((x) => x.number === k && x.wire === 5).pop()?.bytes)
  const state = num(28)
  const modern = v.some(f => f.wire === 0 && f.number >= 24 && f.number <= 28)
  const fixed = num(24) !== 0
  // Older settings may allow only one fixed position; keep both individual controls editable.
  const split = scalar(4) !== undefined && scalar(6) !== undefined && num(4) !== num(6)
  return {
    enabled: state >= 1 && state <= 3 ? state !== 3 : num(1) !== 0, reduced: state === 2,
    smartFilter: num(2) !== 0, blockLevel: Math.min(10, num(3)),
    showTop: modern && !split ? fixed : num(4) !== 0, showScroll: num(5) !== 0,
    showBottom: modern && !split ? fixed : num(6) !== 0, showColor: num(7) !== 0,
    avoidSubtitles: num(9) !== 0, avoidPeople: num(10) !== 0, opacity: v.some(f => f.number === 11 && f.wire === 5) ? flt(11) : 0.8,
    area: Math.min(100, num(modern ? 25 : 12)), speed: flt(13) || 1, fontScale: flt(14) || 1,
  }
}

/** Field names `PlayerDanmakuSettings.remoteParameters` posts to `/x/v2/dm/web/config`. */
export function remoteParameters(s: DanmakuSettings): Record<string, string> {
  return {
    dm_switch_state: s.enabled ? (s.reduced ? '2' : '1') : '3', dm_area_v2: String(s.area),
    ...(s.showTop === s.showBottom ? { blocktop_bottom: String(s.showTop) } : {}),
    dm_switch: String(s.enabled), blockscroll: String(s.showScroll), blocktop: String(s.showTop), blockbottom: String(s.showBottom),
    blockcolor: String(s.showColor), opacity: String(s.opacity), fontsize: String(s.fontScale), speedplus: String(s.speed),
    dmarea: String(s.area), preventshade: String(s.avoidSubtitles), ai_switch: String(s.smartFilter), ai_level: String(s.blockLevel),
    dmask: String(s.avoidPeople),
  }
}

// ---- Encoder (used by the in-browser mock server) ----

export class Writer {
  private parts: number[] = []
  private varint(n: number) {
    let v = Math.max(0, Math.floor(n))
    while (v >= 0x80) { this.parts.push((v % 128) | 0x80); v = Math.floor(v / 128) }
    this.parts.push(v)
  }
  uint(num: number, value: number) { if (value) { this.varint(num * 8); this.varint(value) } return this }
  bool(num: number, value: boolean) { this.varint(num * 8); this.varint(value ? 1 : 0); return this }
  float(num: number, value: number) {
    this.varint(num * 8 + 5)
    const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, value, true)
    this.parts.push(...b); return this
  }
  bytes(num: number, value: Uint8Array) { this.varint(num * 8 + 2); this.varint(value.length); for (const b of value) this.parts.push(b); return this }
  string(num: number, value: string) { return value ? this.bytes(num, new TextEncoder().encode(value)) : this }
  finish() { return new Uint8Array(this.parts) }
}
