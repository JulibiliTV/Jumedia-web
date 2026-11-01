#!/usr/bin/env node
// Builds public/mock/emby/catalog.json from an Emby server. Both the browser mock
// and Jumedia-server seed their demo content from this file.
//
//   EMBY_URL=https://emby.example.test EMBY_USER=test EMBY_PASSWORD= node scripts/import-emby.mjs
//
// Only direct-play items are kept (MP4/M4V/MOV, H.264 video, AAC/MP3 audio), so
// browsers and JulibiliTV can play them without transcoding. Images are referenced
// by Emby's public image URLs; no media is copied and no token is written.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = (process.env.EMBY_URL ?? 'https://emby.example.test').replace(/\/+$/, '')
const server = root.endsWith('/emby') ? root : root + '/emby'
const username = process.env.EMBY_USER ?? 'test'
const password = process.env.EMBY_PASSWORD ?? ''
const MAX_SERIES = Number(process.env.EMBY_MAX_SERIES ?? 36)
const MAX_EPISODES = Number(process.env.EMBY_MAX_EPISODES ?? 16)
const MAX_MOVIES = Number(process.env.EMBY_MAX_MOVIES ?? 24)
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'mock', 'emby', 'catalog.json')

const authHeader = 'MediaBrowser Client="Jumedia Importer", Device="Jumedia", DeviceId="jumedia-importer", Version="0.1.0"'
async function api(path, init = {}) {
  const res = await fetch(server + path, { ...init, headers: { 'X-Emby-Authorization': authHeader, ...(token ? { 'X-Emby-Token': token } : {}), 'Content-Type': 'application/json', ...init.headers } })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}
let token = ''
const auth = await api('/Users/AuthenticateByName', { method: 'POST', body: JSON.stringify({ Username: username, Pw: password }) })
token = auth.AccessToken
const uid = auth.User.Id

const VIDEO = new Set(['h264'])
const AUDIO = new Set(['aac', 'mp3'])
const CONTAINERS = new Set(['mp4', 'm4v', 'mov'])
function playable(item) {
  const src = item.MediaSources?.[0]
  if (!src || !CONTAINERS.has(String(src.Container).toLowerCase()) || src.RequiresOpening || src.IsInfiniteStream) return null
  const video = src.MediaStreams?.find((s) => s.Type === 'Video')
  const audio = src.MediaStreams?.find((s) => s.Type === 'Audio')
  if (!video || !VIDEO.has(String(video.Codec).toLowerCase()) || (audio && !AUDIO.has(String(audio.Codec).toLowerCase()))) return null
  if ((video.Width ?? 0) > 1920) return null
  return { sourceId: src.Id, container: String(src.Container).toLowerCase(), width: video.Width ?? 0, height: video.Height ?? 0, bitrate: src.Bitrate ?? 0, size: src.Size ?? 0 }
}

const img = (id, type, tag, width) => (tag ? `${server}/Items/${id}/Images/${type}${type === 'Backdrop' ? '/0' : ''}?tag=${tag}&maxWidth=${width}&quality=90` : null)
const clip = (text, n) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const runtime = (ticks) => Math.round((ticks ?? 0) / 1e7)
const ts = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) || 0 : 0)
const images = (it, posterWidth = 480) => ({
  primary: img(it.Id, 'Primary', it.ImageTags?.Primary, posterWidth),
  backdrop: img(it.Id, 'Backdrop', it.BackdropImageTags?.[0], 1280),
  thumb: img(it.Id, 'Thumb', it.ImageTags?.Thumb, 960),
})

const views = (await api(`/Users/${uid}/Views`)).Items
const libraryOf = (view) => ({ tvshows: view.Name, movies: view.Name })[view.CollectionType]
const catalog = { server, username, generatedAt: Math.floor(Date.now() / 1000), series: [], movies: [] }

for (const view of views) {
  if (view.CollectionType === 'tvshows') {
    const list = (await api(`/Users/${uid}/Items?ParentId=${view.Id}&Recursive=true&IncludeItemTypes=Series&Fields=Overview,Genres,ProductionLocations,Studios,PremiereDate,EndDate,Status,AirDays,AirTime,CommunityRating&SortBy=SortName`)).Items
    for (const s of list) {
      if (!s.ImageTags?.Primary) continue
      const eps = (await api(`/Shows/${s.Id}/Episodes?UserId=${uid}&Fields=MediaSources,Overview,PremiereDate&SortBy=ParentIndexNumber,IndexNumber`)).Items
      const episodes = []
      for (const e of eps) {
        const p = playable(e)
        if (!p) continue
        episodes.push({
          id: e.Id, ...p, name: clip(e.Name, 60), season: e.ParentIndexNumber ?? 1, index: e.IndexNumber ?? episodes.length + 1, overview: clip(e.Overview, 160),
          runtime: runtime(e.RunTimeTicks), premiere: ts(e.PremiereDate), image: img(e.Id, 'Primary', e.ImageTags?.Primary, 960),
        })
        if (episodes.length >= MAX_EPISODES) break
      }
      if (!episodes.length) continue
      catalog.series.push({
        id: s.Id, library: libraryOf(view), name: clip(s.Name, 40), overview: clip(s.Overview, 240), year: s.ProductionYear ?? 0, genres: s.Genres ?? [],
        countries: s.ProductionLocations ?? [], studios: (s.Studios ?? []).map((x) => x.Name), rating: s.CommunityRating ?? 0, ended: s.Status === 'Ended',
        airDays: s.AirDays ?? [], airTime: s.AirTime ?? '', premiere: ts(s.PremiereDate), images: images(s), episodes,
      })
      process.stdout.write(`\rseries ${catalog.series.length} (${s.Name.slice(0, 20)})          `)
    }
  } else if (view.CollectionType === 'movies') {
    const list = (await api(`/Users/${uid}/Items?ParentId=${view.Id}&Recursive=true&IncludeItemTypes=Movie&Fields=MediaSources,Overview,Genres,ProductionLocations,PremiereDate,CommunityRating&SortBy=SortName`)).Items
    for (const m of list) {
      const p = playable(m)
      if (!p || !m.ImageTags?.Primary) continue
      catalog.movies.push({
        id: m.Id, ...p, library: view.Name, name: clip(m.Name, 40), overview: clip(m.Overview, 240), year: m.ProductionYear ?? 0, genres: m.Genres ?? [],
        countries: m.ProductionLocations ?? [], rating: m.CommunityRating ?? 0, runtime: runtime(m.RunTimeTicks), premiere: ts(m.PremiereDate), images: images(m),
      })
    }
  }
}

// Keep the catalog small and varied: interleave libraries, drop the tail.
const byLibrary = Object.groupBy(catalog.series, (s) => s.library)
const mixed = []
for (let i = 0; mixed.length < catalog.series.length; i++) for (const list of Object.values(byLibrary)) if (list[i]) mixed.push(list[i])
catalog.series = mixed.slice(0, MAX_SERIES)
catalog.movies = catalog.movies.filter((m) => m.images.backdrop || m.images.thumb).slice(0, MAX_MOVIES)

await mkdir(dirname(out), { recursive: true })
await writeFile(out, JSON.stringify(catalog, null, 1) + '\n')
const eps = catalog.series.reduce((n, s) => n + s.episodes.length, 0)
console.log(`\nwrote ${out}\n  ${catalog.series.length} series (${eps} episodes), ${catalog.movies.length} movies; libraries: ${Object.entries(byLibrary).map(([k, v]) => `${k} ${v.length}`).join(', ')}`)
