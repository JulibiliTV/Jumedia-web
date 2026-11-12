import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { getDB, type Archive, type User } from '../src/mock/db'
import { installMockServer } from '../src/mock/server'

const storage = new Map<string, string>()
const reloadSnapshot = process.env.JUMEDIA_FEEDBACK_RELOAD_SNAPSHOT
if (reloadSnapshot) storage.set('jumedia.mock.db', reloadSnapshot)
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
  location: { origin: 'https://fixture.test', href: 'https://fixture.test/' },
  document: { cookie: '' },
  window: { fetch: async () => { throw new Error('Unexpected external network request') }, setTimeout, setInterval: () => 0 },
})
await installMockServer()
const db = getDB()
if (!reloadSnapshot) {
db.users = [1, 2, 3].map((mid): User => ({ mid, username: `fixture${mid}`, password: '', uname: `Fixture ${mid}`, face: '', sign: '', sex: '保密', birthday: '2000-01-01', email: '', level: 1, exp: 0, coins: 0, role: 'user', status: 0, ctime: 1, top_photo: '', vip: 0 }))
db.sessions = db.users.map((u) => ({ mid: u.mid, token: `fixture-${u.mid}`, csrf: `csrf-${u.mid}`, access: `access-${u.mid}`, refresh: '', ctime: 1 }))
db.archives = [101, 102, 103].map((aid): Archive => ({ aid, bvid: `fixture${aid}`, mid: aid === 103 ? 3 : 2, tid: 1, title: `Video ${aid}`, pic: '', desc: '', tag: '', state: 0, reason: '', source: '', chapters: [], copyright: 1, pubdate: 100, ctime: 100, pages: [{ cid: aid, part: 'Video', duration: 60, media: '' }], stat: { view: 0, danmaku: 0, reply: 0, favorite: 0, coin: 0, share: 0, like: 0 }, subtitles: [] }))
}
const path = '/x/web-interface/feedback/dislike'
async function call(path: string, p: Record<string, string> = {}, mid = 1, method = 'GET') {
  document.cookie = mid ? `SESSDATA=fixture-${mid}` : ''
  const query = method === 'GET' ? `?${new URLSearchParams(p)}` : ''
  const response = await window.fetch(`https://fixture.test${path}${query}`, { method, ...(method === 'POST' ? { body: new URLSearchParams({ csrf: `csrf-${mid}`, ...p }).toString() } : {}) })
  return response.json()
}
const video = { goto: 'av', id: '101', mid: '2', reason_id: '1' }
const author = { goto: 'av', id: '102', mid: '2', reason_id: '4' }
async function check(want: number[], mid = 1) {
  for (const endpoint of ['/x/web-interface/wbi/index/top/feed/rcmd?ps=12&fresh_idx=1', '/x/web-interface/wbi/index/top/feed/rcmd?ps=12&fresh_idx=2', '/x/v2/feed/index?idx=0', '/x/v2/feed/index?idx=20']) {
    const [pathname, query] = endpoint.split('?')
    const result = await call(pathname, Object.fromEntries(new URLSearchParams(query)), mid)
    assert.equal(result.code, 0)
    const rows = result.data.item ?? result.data.items
    for (const row of rows) {
      if (result.data.item) { assert.equal(row.dislike_switch, !!mid); assert.ok(row.pubdate > 0) }
      else assert.deepEqual(row.three_point.dislike_reasons.map((r: { id: number }) => r.id), [1, 4])
    }
    assert.deepEqual([...new Set(rows.map((x: { aid?: number; player_args: { aid: number } }) => x.aid ?? x.player_args.aid))].sort(), want)
  }
}
if (reloadSnapshot) {
  await check([103])
  await check([101, 102, 103], 2)
  console.log('Reloaded Mock database preserves per-user feedback')
  process.exit(0)
}
await check([101, 102, 103])
for (let i = 0; i < 2; i++) assert.equal((await call(path, video, 1, 'POST')).code, 0)
await check([102, 103])
for (let i = 0; i < 2; i++) assert.equal((await call(path, author, 1, 'POST')).code, 0)
await check([103])
await check([101, 102, 103], 0)
await check([101, 102, 103], 2)
await new Promise((resolve) => setTimeout(resolve, 60))
const persisted = JSON.parse(storage.get('jumedia.mock.db')!)
assert.equal(persisted.recommendationFeedback.length, 2)
// A fresh process loads the saved browser database through getDB().
const reload = spawnSync(process.execPath, [process.argv[1]], { env: { ...process.env, JUMEDIA_FEEDBACK_RELOAD_SNAPSHOT: JSON.stringify(persisted) }, stdio: 'inherit' })
assert.equal(reload.status, 0)
await check([103])
for (let i = 0; i < 2; i++) assert.equal((await call(`${path}/cancel`, author, 1, 'POST')).code, 0)
await check([102, 103])
for (let i = 0; i < 2; i++) assert.equal((await call(`${path}/cancel`, video, 1, 'POST')).code, 0)
await check([101, 102, 103])
assert.equal((await call(path, author, 1, 'POST')).code, 0)
assert.equal((await call(path, video, 1, 'POST')).code, 0)
assert.equal((await call(`${path}/cancel`, video, 1, 'POST')).code, 0)
await check([103])
assert.equal((await call(path, { goto: 'av', id: '103', reason_id: '4' }, 1, 'POST')).code, 0)
await check([])
assert.equal((await call('/x/web-interface/popular')).data.list.length, 3)
assert.equal((await call('/x/web-interface/view', { aid: '101' })).code, 0)
for (const endpoint of [path, `${path}/cancel`]) {
  assert.equal((await call(endpoint, video, 0, 'POST')).code, -101)
  assert.equal((await call(endpoint, { ...video, csrf: '' }, 1, 'POST')).code, -111)
  assert.equal((await call(endpoint, { ...video, csrf: 'csrf-1' })).code, -405)
  for (const override of [{ id: '0' }, { id: '1.5' }, { goto: 'live' }, { reason_id: '3' }, { mid: '3' }, { mid: 'bad' }]) {
    assert.equal((await call(endpoint, { ...video, ...override }, 1, 'POST')).code, -400)
  }
  assert.equal((await call(endpoint, { ...video, id: '99999' }, 1, 'POST')).code, -404)
}
db.sessions.push({ ...db.sessions[0], token: 'other-session', csrf: 'other-csrf', access: 'other-access' })
assert.equal((await call(path, { ...video, csrf: 'other-csrf' }, 1, 'POST')).code, -111)
assert.equal((await call(path, { ...video, csrf: '', biliCSRF: 'csrf-1' }, 1, 'POST')).code, 0)
assert.equal((await call('/x/feed/dislike', video)).code, -111)
assert.equal((await call('/x/feed/dislike', { goto: 'av', id: '101', reason_id: '4', access_key: 'access-1' }, 0)).code, 0)
assert.equal((await call(path, { goto: 'ad' }, 1, 'POST')).code, 0)
db.users[0].status = 1
assert.equal((await call(path, video, 1, 'POST')).code, -403)
console.log('Recommendation feedback contracts passed')
