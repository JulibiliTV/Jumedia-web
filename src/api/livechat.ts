import * as juli from './juli'

/**
 * Live chat over the WebSocket that `getDanmuInfo` describes — the same protocol
 * JulibiliTV speaks (`LiveChatProtocol.swift`). Each binary message holds packets
 * with a 16-byte big-endian header: size u32, header length u16 (16), version u16
 * (0 plain JSON, 2 zlib-compressed packets), operation u32, sequence u32.
 * Operations: 7 auth → 8 result, 2 heartbeat → 3 popularity, 5 commands.
 */

export interface ChatMedal { name: string; level: number; color: string }
export interface ChatLine { id: string; uid: number; name: string; text: string; face?: string; medal?: ChatMedal }

/** Fan medal from `user.medal` (gethistory / DANMU_MSG content.user) or the legacy `info[3]` array `[level, name, anchor, roomid, color]`. */
export function chatMedal(user: any, legacy?: any[]): ChatMedal | undefined {
  const m = user?.medal
  if (m?.name) return { name: m.name, level: Number(m.level ?? 0), color: m.v2_medal_color_start ? String(m.v2_medal_color_start).slice(0, 7) : `#${Number(m.color_start ?? 0x5c968e).toString(16).padStart(6, '0')}` }
  if (legacy?.length && legacy[1]) return { name: String(legacy[1]), level: Number(legacy[0] ?? 0), color: `#${Number(legacy[4] ?? 0x5c968e).toString(16).padStart(6, '0')}` }
  return undefined
}
export interface SuperChat { id: number | string; uid: number; message: string; price: number; background_bottom_color?: string; end_time?: number; user_info?: { uname: string; face: string } }
export type ChatEvent =
  | { type: 'message'; line: ChatLine }
  | { type: 'superchat'; sc: SuperChat }
  | { type: 'superchat-delete'; ids: string[] }
  | { type: 'online'; count: number }
  | { type: 'preparing' }

const HEADER = 16
const text = new TextEncoder()

export function packet(operation: number, body: unknown = null): ArrayBuffer {
  const payload = body == null ? new Uint8Array() : text.encode(JSON.stringify(body))
  const buf = new ArrayBuffer(HEADER + payload.length)
  const view = new DataView(buf)
  view.setUint32(0, HEADER + payload.length)
  view.setUint16(4, HEADER)
  view.setUint16(6, 1)
  view.setUint32(8, operation)
  view.setUint32(12, 1)
  new Uint8Array(buf, HEADER).set(payload)
  return buf
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // "deflate" in DecompressionStream is the zlib-wrapped format the server sends for version 2.
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const dec = new TextDecoder()
interface Raw { operation: number; body: Uint8Array }

export async function unpack(buf: ArrayBuffer | Uint8Array, depth = 0): Promise<Raw[]> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: Raw[] = []
  for (let offset = 0; offset + HEADER <= bytes.length;) {
    const size = view.getUint32(offset), header = view.getUint16(offset + 4), version = view.getUint16(offset + 6), operation = view.getUint32(offset + 8)
    if (header < HEADER || size < header || offset + size > bytes.length) throw new Error('invalid live chat packet')
    const body = bytes.subarray(offset + header, offset + size)
    offset += size
    if (version === 2 && depth < 3) out.push(...(await unpack(await inflate(body), depth + 1)))
    else out.push({ operation, body })
  }
  return out
}

/** Same reading paths as Juli's `LiveChatParser.event`. */
export function parseCommand(value: any): ChatEvent | null {
  const cmd = String(value?.cmd ?? '').split(':')[0]
  if (cmd === 'DANMU_MSG') {
    const info = value.info ?? []
    const meta = info[0] ?? [], user = info[2] ?? []
    const content = meta[15] ?? {}
    let extra: any = {}
    try { extra = JSON.parse(content.extra ?? '{}') } catch { /* legacy payloads carry no extra */ }
    const uid = Number(content.user?.uid ?? user[0] ?? 0)
    const body = String(info[1] ?? '')
    if (!body) return null
    return { type: 'message', line: { id: extra.id_str ? `dm:${extra.id_str}` : `dm:${uid}:${meta[4]}:${body}`, uid, name: content.user?.base?.name ?? user[1] ?? '观众', text: body, face: content.user?.base?.face, medal: chatMedal(content.user, info[3]) } }
  }
  if (cmd === 'SUPER_CHAT_MESSAGE' || cmd === 'SUPER_CHAT_MESSAGE_JPN') return value.data ? { type: 'superchat', sc: value.data } : null
  if (cmd === 'SUPER_CHAT_MESSAGE_DELETE') return { type: 'superchat-delete', ids: (value.data?.ids ?? []).map(String) }
  if (cmd === 'PREPARING') return { type: 'preparing' }
  return null
}

function buvid(): string {
  try {
    const saved = localStorage.getItem('jumedia.buvid')
    if (saved) return saved
    const id = 'XY' + Array.from({ length: 35 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('') + 'infoc'
    localStorage.setItem('jumedia.buvid', id)
    return id
  } catch { return 'XY' + Date.now() + 'infoc' }
}

/**
 * Keeps a chat connection for `roomId` until the returned function is called.
 * `onState('live')` once authenticated; `onState('down')` while reconnecting.
 */
export function connectLiveChat(roomId: number, uid: number, onEvent: (e: ChatEvent) => void, onState: (s: 'connecting' | 'live' | 'down') => void): () => void {
  let closed = false, socket: WebSocket | null = null, beat = 0, retry = 0, attempt = 0
  const open = async () => {
    if (closed) return
    onState(attempt ? 'down' : 'connecting')
    try {
      const real = (await juli.roomInit(roomId)).room_id ?? roomId
      const info = await juli.danmuInfo(real)
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sub`)
      ws.binaryType = 'arraybuffer'
      socket = ws
      ws.onopen = () => ws.send(packet(7, { uid, roomid: real, protover: 2, platform: 'web', type: 2, key: info.token, buvid: buvid() }))
      ws.onmessage = async (msg) => {
        if (!(msg.data instanceof ArrayBuffer)) return
        for (const p of await unpack(msg.data).catch(() => [])) {
          if (p.operation === 8) {
            const ok = JSON.parse(dec.decode(p.body) || '{}').code === 0
            if (!ok) { ws.close(); return }
            attempt = 0
            onState('live')
            ws.send(packet(2))
            clearInterval(beat)
            beat = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(packet(2)), 30000)
          } else if (p.operation === 3) {
            onEvent({ type: 'online', count: p.body.length >= 4 ? new DataView(p.body.buffer, p.body.byteOffset, 4).getUint32(0) : 0 })
          } else if (p.operation === 5) {
            try { const e = parseCommand(JSON.parse(dec.decode(p.body))); if (e) onEvent(e) } catch { /* skip malformed command */ }
          }
        }
      }
      ws.onclose = () => { clearInterval(beat); if (!closed) schedule() }
    } catch { schedule() }
  }
  const schedule = () => { attempt += 1; onState('down'); clearTimeout(retry); retry = window.setTimeout(open, Math.min(30, 2 * attempt) * 1000) }
  open()
  return () => { closed = true; clearInterval(beat); clearTimeout(retry); socket?.close() }
}
