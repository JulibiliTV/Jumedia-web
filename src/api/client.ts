import { md5 } from '../lib/md5'

/**
 * Transport shared by every Jumedia request.
 *
 * Mirrors Juli's `BiliAPIClient.rawRequest/envelope`: GET sends sorted query
 * items, other methods send an `application/x-www-form-urlencoded` body, and a
 * non-zero `code` is raised as an `ApiError`. Juli talks to four hosts; Jumedia
 * serves all of them from one origin unless a host-specific base is configured.
 */
export type Host = 'api' | 'app' | 'passport' | 'live'
type Params = Record<string, string | number | boolean | undefined | null>

const env = import.meta.env
const base = (env.VITE_API_BASE as string | undefined) ?? ''
const hosts: Record<Host, string> = {
  api: (env.VITE_API_HOST as string | undefined) ?? base,
  app: (env.VITE_APP_HOST as string | undefined) ?? base,
  passport: (env.VITE_PASSPORT_HOST as string | undefined) ?? base,
  live: (env.VITE_LIVE_HOST as string | undefined) ?? base,
}

export class ApiError extends Error {
  constructor(public code: number, message: string) {
    super(message || `请求失败（${code}）`)
  }
}

export type Envelope<T = any> = { code: number; message: string; ttl?: number; data?: T; result?: T; status?: boolean }

/** Same escaping as Juli's `percentEncoded`: RFC 3986 unreserved characters only. */
export const percentEncoded = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

const encode = (params: Record<string, string>) =>
  Object.keys(params).sort().map((k) => `${percentEncoded(k)}=${percentEncoded(params[k])}`).join('&')

function clean(params: Params): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) out[k] = String(v)
  return out
}

export function cookie(name: string): string {
  const match = document.cookie.split('; ').find((c) => c.startsWith(name + '='))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

/** `csrf` and `biliCSRF` carry the same `bili_jct` value, as Juli sends both. */
export function csrf(): Record<string, string> {
  const token = cookie('bili_jct')
  if (!token) throw new ApiError(-101, '账号未登录')
  return { csrf: token, biliCSRF: token }
}

export function accessKey(): string {
  try { return localStorage.getItem('jumedia.access_key') ?? '' } catch { return '' }
}

// Public TV/iPad key pair already embedded in the Juli client.
const APP_KEY = '5ae412b53418aac5'
const APP_SEC = '5b9cf6c9786efd204dcf0c1ce2d08436'

export function appSign(params: Record<string, string>): Record<string, string> {
  const p = { ...params, appkey: APP_KEY, ts: String(Math.floor(Date.now() / 1000)), local_id: '0', mobi_app: 'iphone', device: 'pad', device_name: 'iPad' }
  const raw = Object.keys(p).sort().map((k) => `${k}=${(p as Record<string, string>)[k]}`).join('&') + APP_SEC
  return { ...p, sign: md5(raw) }
}

const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]
let mixinKey: Promise<string> | null = null

function keyFromURL(url: string) {
  const name = url.split('/').pop() ?? ''
  return name.replace(/\.[^.]+$/, '')
}

async function wbiKey(): Promise<string> {
  mixinKey ??= raw<Envelope>('api', '/x/web-interface/nav', 'GET', {}).then((root) => {
    const img = root.data?.wbi_img ?? {}
    const source = keyFromURL(img.img_url ?? '') + keyFromURL(img.sub_url ?? '')
    const key = MIXIN.filter((i) => i < source.length).map((i) => source[i]).join('').slice(0, 32)
    if (key.length !== 32) { mixinKey = null; throw new ApiError(-1, 'WBI 签名密钥获取失败') }
    return key
  })
  return mixinKey
}

export function resetSigning() { mixinKey = null }

async function wbiSign(params: Record<string, string>) {
  const key = await wbiKey()
  const p = { ...params, wts: String(Math.floor(Date.now() / 1000)) }
  const query = Object.keys(p).sort().map((k) => `${percentEncoded(k)}=${percentEncoded((p as Record<string, string>)[k].replace(/[!'()*]/g, ''))}`).join('&')
  return { ...p, w_rid: md5(query + key) }
}

async function raw<T>(host: Host, path: string, method: string, params: Record<string, string>, body?: FormData): Promise<T> {
  let url = hosts[host] + path
  const init: RequestInit = { method, credentials: 'include' }
  if (method === 'GET') {
    const q = encode(params)
    if (q) url += (url.includes('?') ? '&' : '?') + q
  } else if (body) {
    for (const [k, v] of Object.entries(params)) body.append(k, v)
    init.body = body
  } else {
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
    init.body = encode(params)
  }
  const response = await fetch(url, init)
  if (!response.ok) throw new ApiError(response.status, `服务器错误（HTTP ${response.status}）`)
  return response.json() as Promise<T>
}

export type RequestOptions = { method?: 'GET' | 'POST'; app?: boolean; wbi?: boolean; validates?: boolean; body?: FormData }

export async function envelope<T = any>(host: Host, path: string, params: Params = {}, options: RequestOptions = {}): Promise<Envelope<T>> {
  let p = clean(params)
  if (options.app) p = appSign(p)
  if (options.wbi) p = await wbiSign(p)
  const root = await raw<Envelope<T>>(host, path, options.method ?? 'GET', p, options.body)
  if (options.validates !== false && root.code !== 0) throw new ApiError(root.code, root.message)
  return root
}

/** Returns `data` (or `result` for PGC endpoints) like Juli's `data(_:dataKey:)`. */
export async function data<T = any>(host: Host, path: string, params: Params = {}, options: RequestOptions & { key?: 'data' | 'result' } = {}): Promise<T> {
  const root = await envelope<T>(host, path, params, options)
  return (options.key === 'result' ? root.result : root.data) as T
}

export const post = <T = any>(host: Host, path: string, params: Params = {}, options: RequestOptions = {}) =>
  envelope<T>(host, path, params, { ...options, method: 'POST' })

export async function bytes(host: Host, path: string, params: Params): Promise<ArrayBuffer> {
  return (await bytesResponse(host, path, params)).arrayBuffer()
}

export async function bytesResponse(host: Host, path: string, params: Params, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(hosts[host] + path + '?' + encode(clean(params)), { credentials: 'include', cache: 'no-store', signal })
  if (!response.ok) throw new ApiError(response.status, '弹幕加载失败')
  return response
}
