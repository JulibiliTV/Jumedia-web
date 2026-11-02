/** Portable demo package catalog. Legacy refs below are converted before persistence. */
export interface CatalogEpisode { id: string; sourceId: string; container: string; width: number; height: number; name: string; season: number; index: number; overview: string; runtime: number; premiere: number; image: string | null }
export interface CatalogImages { primary: string | null; backdrop: string | null; thumb: string | null }
export interface CatalogSeries { id: string; library: string; name: string; overview: string; year: number; genres: string[]; countries: string[]; studios: string[]; rating: number; ended: boolean; airDays: string[]; airTime: string; premiere: number; images: CatalogImages; episodes: CatalogEpisode[] }
export interface CatalogMovie { id: string; sourceId: string; container: string; width: number; height: number; library: string; name: string; overview: string; year: number; genres: string[]; countries: string[]; rating: number; runtime: number; premiere: number; images: CatalogImages }
export interface Catalog { series: CatalogSeries[]; movies: CatalogMovie[] }

export interface DemoPackage { format: 'jumedia-demo'; version: 1; generatedAt: number; emby: { url: string; username: string; password?: string }; catalog: Catalog }
let catalog: Catalog = { series: [], movies: [] }
export function setDemoPackage(pack?: DemoPackage) {
  catalog = pack?.catalog ?? { series: [], movies: [] }
}
export function parseDemoPackage(text: string): DemoPackage {
  let p: DemoPackage
  try { p = JSON.parse(text) } catch { throw new Error('演示数据包格式无效') }
  if (!p || p.format !== 'jumedia-demo') throw new Error('演示数据包格式无效')
  if (p.version !== 1) throw new Error('不支持的演示数据包版本')
  if (!p.catalog || !Array.isArray(p.catalog.series) || !Array.isArray(p.catalog.movies) || !p.catalog.series.length && !p.catalog.movies.length) throw new Error('演示数据包 catalog 为空或无效')
  let url: URL
  try { url = new URL(p.emby.url) } catch { throw new Error('演示 Emby 连接信息无效') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || typeof p.emby.username !== 'string' || (p.emby.password !== undefined && typeof p.emby.password !== 'string')) throw new Error('演示 Emby 连接信息无效')
  const invalid = (): never => { throw new Error('演示数据包格式无效') }
  const str = (v: unknown) => v == null ? '' : typeof v === 'string' ? v : invalid()
  const num = (v: unknown) => v == null ? 0 : typeof v === 'number' && Number.isFinite(v) ? v : invalid()
  const list = (v: unknown): string[] => v == null ? [] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : invalid()
  const images = (v: CatalogImages): CatalogImages => ({ primary: v?.primary == null ? null : str(v.primary), backdrop: v?.backdrop == null ? null : str(v.backdrop), thumb: v?.thumb == null ? null : str(v.thumb) })
  const metadata = <T extends CatalogMovie | CatalogSeries>(x: T): T => ({ ...x, name: str(x.name), library: str(x.library), overview: str(x.overview), year: num(x.year), premiere: num(x.premiere), rating: num(x.rating), genres: list(x.genres), countries: list(x.countries), images: images(x.images) })
  const item = <T extends CatalogEpisode | CatalogMovie>(x: T): T => {
    if (!x || typeof x.id !== 'string' || typeof x.sourceId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(x.id) || !/^[A-Za-z0-9_-]+$/.test(x.sourceId)) throw new Error('演示数据包 catalog 无效')
    return { ...x, name: str(x.name), overview: str(x.overview), runtime: num(x.runtime), premiere: num(x.premiere), container: str(x.container), width: num(x.width), height: num(x.height) }
  }
  p.generatedAt = num(p.generatedAt)
  p.catalog.movies = p.catalog.movies.map((m) => metadata(item(m)))
  p.catalog.series = p.catalog.series.map((s) => {
    if (!s || !Array.isArray(s.episodes) || !s.episodes.length) throw new Error('演示数据包 catalog 无效')
    if (s.ended != null && typeof s.ended !== 'boolean') invalid()
    return { ...metadata(s), id: str(s.id), ended: s.ended ?? false, studios: list(s.studios), airDays: list(s.airDays), airTime: str(s.airTime), episodes: s.episodes.map((e) => ({ ...item(e), season: num(e.season), index: num(e.index), image: e.image == null ? null : str(e.image) })) }
  })
  return p
}
export const getCatalog = () => catalog
// Used only by the legacy demo generator and the v18 migration.
export const embyRef = (itemId: string, sourceId: string) => `emby:${itemId}:${sourceId}`
export const embyHlsPath = (itemId: string, sourceId: string) => `/media/emby/${itemId}/hls/index.m3u8?source=${encodeURIComponent(sourceId)}`
