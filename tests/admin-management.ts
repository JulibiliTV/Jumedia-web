import assert from 'node:assert/strict'
import { getDB, type User } from '../src/mock/db'
import { installMockServer } from '../src/mock/server'
import { setSourceFetcher } from '../src/mock/datasource'

const storage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
  location: { origin: 'https://fixture.test', href: 'https://fixture.test/' },
  document: { cookie: '' },
  window: { fetch: async () => { throw new Error('Unexpected network request') }, setTimeout, setInterval: () => 0 },
})
await installMockServer()
const db = getDB()
db.users = [1, 2, 3].map((mid): User => ({ mid, username: `fixture${mid}`, password: 'fixture-original', uname: `Fixture ${mid}`, face: '', sign: '', sex: '保密', birthday: '', email: '', level: 1, exp: 0, coins: 0, role: mid === 1 ? 'admin' : 'user', status: 0, ctime: 1, top_photo: '', vip: 0 }))
db.sessions = db.users.map((u) => ({ mid: u.mid, token: `fixture-${u.mid}`, csrf: `csrf-${u.mid}`, access: `access-${u.mid}`, refresh: '', ctime: 1 }))
db.settings.officialMid = 1
db.settings.userDataSources = true
setSourceFetcher(async (input, init) => {
  const path = new URL(String(input)).pathname
  let body: unknown
  if (path.endsWith('/AuthenticateByName')) {
    assert.equal(JSON.parse(String(init?.body)).Pw, 'fixture-private-password')
    body = { AccessToken: 'fixture-token', User: { Id: 'viewer' } }
  } else if (path.endsWith('/Info/Public')) body = { ServerName: 'fixture', Id: 'fixture-server', Version: '1' }
  else if (path.endsWith('/Views')) body = { Items: [{ Id: 'movies', Name: '电影', CollectionType: 'movies' }] }
  else if (path.endsWith('/Items')) body = { Items: [], TotalRecordCount: 0 }
  else throw new Error(`Unexpected source endpoint ${path}`)
  return new Response(JSON.stringify(body), { status: 200 })
})
async function call(path: string, p: Record<string, string> = {}, mid = 1, method = 'GET') {
  const query = new URLSearchParams({ access_key: `access-${mid}`, ...(method === 'GET' ? p : {}) })
  const response = await window.fetch(`https://fixture.test${path}?${query}`, { method, ...(method === 'POST' ? { body: new URLSearchParams({ csrf: `csrf-${mid}`, ...p }).toString() } : {}) })
  return response.json()
}
async function waitSource(id: number) {
  for (let i = 0; i < 100; i++) {
    if (db.dataSources.find(s => s.id === id)?.status !== 'syncing') return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Mock sync timeout')
}
const created = await call('/x/web/datasource/save', { url: 'https://source.example.test', username: 'viewer', password: 'fixture-private-password' }, 2, 'POST')
assert.equal(created.code, 0)
const id = created.data.id
await waitSource(id)
const sourceParams = { id: String(id), url: 'https://source.example.test', username: 'viewer', name: '管理员修改', proxy_playback: 'false', auto_sync: 'false', libraries: 'movies' }
assert.equal((await call('/x/admin/datasource/save', sourceParams, 3, 'POST')).code, -403)
assert.equal((await call('/x/web/datasource/save', sourceParams, 3, 'POST')).code, -404)
assert.equal((await call('/x/admin/datasource/test', sourceParams, 1, 'POST')).code, 0)
const saved = await call('/x/admin/datasource/save', sourceParams, 1, 'POST')
assert.equal(saved.code, 0)
await waitSource(id)
assert.equal(saved.data.system, false)
assert.equal(saved.data.mid, 2)
assert.equal(saved.data.proxy_playback, false)
assert.equal(saved.data.has_password, true)
const sources = await call('/x/admin/datasources', { scope: 'user' })
assert.equal(sources.data.list[0].proxy_playback, false)
for (const value of [saved, sources]) {
  assert.ok(!JSON.stringify(value).includes('fixture-private-password'))
  assert.ok(!JSON.stringify(value).includes('fixture-token'))
  assert.ok(!JSON.stringify(value).includes('"password"'))
}
const password = { mid: '2', new_password: 'fixture-new-password' }
assert.equal((await call('/x/admin/user/password', password, 3, 'POST')).code, -403)
assert.equal((await call('/x/admin/user/password', password)).code, -405)
assert.equal((await call('/x/admin/user/password', { ...password, csrf: '' }, 1, 'POST')).code, -111)
assert.equal((await call('/x/admin/user/password', { ...password, new_password: 'short' }, 1, 'POST')).code, -400)
assert.equal((await call('/x/admin/user/password', { ...password, mid: '2.5' }, 1, 'POST')).code, -404)
const result = await call('/x/admin/user/password', password, 1, 'POST')
assert.equal(result.code, 0)
assert.equal((await call('/x/web-interface/nav', {}, 2)).code, -101)
assert.equal((await call('/x/web-interface/nav')).code, 0)
assert.equal((await call('/x/passport-login/web/login', { username: 'fixture2', password: 'fixture-original' }, 2, 'POST')).code, -629)
assert.equal((await call('/x/passport-login/web/login', { username: 'fixture2', password: password.new_password }, 2, 'POST')).code, 0)
for (const response of [result, await call('/x/admin/users'), await call('/x/admin/logs')]) assert.ok(!JSON.stringify(response).includes(password.new_password))
assert.equal((await call('/x/admin/user/password', { mid: '1', new_password: 'fixture-admin-new' }, 1, 'POST')).code, 0)
assert.equal((await call('/x/web-interface/nav')).code, -101)
console.log('PASS: administrator source editing, ownership, password privacy, proxy state, user password permissions and session invalidation')
