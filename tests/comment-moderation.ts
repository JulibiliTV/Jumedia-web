import assert from 'node:assert/strict'
import { getDB, resetDB, type User } from '../src/mock/db'
import { installMockServer } from '../src/mock/server'

const storage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
  location: { origin: 'https://fixture.test', href: 'https://fixture.test/' },
  document: { cookie: '' },
  window: { fetch: async () => { throw new Error('Unexpected external network request') }, setTimeout, setInterval: () => 0 },
})
await installMockServer()
const db = getDB()
db.users = [1, 2, 3, 4].map((mid): User => ({ mid, username: `fixture${mid}`, password: '', uname: `Fixture ${mid}`, face: '', sign: '', sex: '保密', birthday: '2000-01-01', email: '', level: 1, exp: 0, coins: 0, role: mid === 1 || mid === 4 ? 'admin' : 'user', status: 0, ctime: 1, top_photo: '', vip: 0 }))
db.sessions = db.users.map((u) => ({ mid: u.mid, token: `fixture-${u.mid}`, csrf: `csrf-${u.mid}`, access: `access-${u.mid}`, refresh: '', ctime: 1 }))
db.replies = [
  { rpid: 100, oid: 1, mid: 3, root: 0, parent: 0, message: 'root to hide', ctime: 1, likers: [], haters: [] },
  { rpid: 102, oid: 1, mid: 4, root: 0, parent: 0, message: 'visible root', ctime: 2, likers: [], haters: [] },
  { rpid: 101, oid: 1, mid: 3, root: 102, parent: 102, message: 'preview to hide', ctime: 3, likers: [], haters: [] },
]
async function call(path: string, p: Record<string, string> = {}, mid = 2, method = 'GET') {
  const query = new URLSearchParams({ access_key: `access-${mid}`, ...(method === 'GET' ? p : {}) })
  const response = await window.fetch(`https://fixture.test${path}?${query}`, { method, ...(method === 'POST' ? { body: new URLSearchParams({ csrf: `csrf-${mid}`, ...p }).toString() } : {}) })
  return response.json()
}
const block = { fid: '3', act: '5', re_src: '11' }
assert.equal((await call('/x/relation/modify', block, 2, 'POST')).code, 0)
assert.equal((await call('/x/relation/modify', block, 2, 'POST')).code, 0)
let blacklist = (await call('/x/relation/blacks')).data
assert.equal(blacklist.total, 1)
assert.equal(blacklist.list[0].attribute, 128)
assert.equal((await call('/x/space/wbi/acc/relation', { mid: '3' })).data.relation.attribute, 128)
assert.equal((await call('/x/relation/stat', { vmid: '2' })).data.black, 1)
assert.notEqual((await call('/x/relation/modify', { fid: '3', act: '1' }, 2, 'POST')).code, 0)
let comments = (await call('/x/v2/reply', { oid: '1' })).data.replies
assert.deepEqual(comments.map((x: any) => x.rpid), [102])
assert.equal(comments[0].replies.length, 0)
assert.equal((await call('/x/v2/reply', { oid: '1' }, 1)).data.replies.length, 2)
assert.equal((await call('/x/relation/modify', { fid: '3', act: '6' }, 2, 'POST')).code, 0)
assert.equal((await call('/x/relation/blacks')).data.total, 0)
const report = { type: '1', oid: '1', rpid: '100', reason: '7', add_blacklist: 'false' }
assert.equal((await call('/x/v2/reply/report', { ...report, reason: '人身攻击' }, 2, 'POST')).code, -400)
assert.equal((await call('/x/v2/reply/report', report, 2, 'POST')).code, 0)
assert.equal((await call('/x/v2/reply/report', report, 2, 'POST')).code, 0)
let queue = (await call('/x/admin/replies', { reported: '1' }, 1)).data.list
assert.equal(queue.length, 1)
assert.equal(queue[0].report_count, 1)
assert.deepEqual(queue[0].report_reasons, ['人身攻击'])
assert.equal((await call('/x/admin/reply/report/dismiss', { rpid: '100' }, 1, 'POST')).code, 0)
assert.equal((await call('/x/admin/replies', { reported: '1' }, 1)).data.list.length, 0)
assert.equal((await call('/x/v2/reply', { oid: '1' })).data.replies.length, 1)
assert.equal((await call('/x/relation/modify', { fid: '4', act: '5' }, 1, 'POST')).code, 0)
resetDB()
assert.equal(getDB().userBlocks?.length ?? 0, 0)
assert.equal(getDB().commentReports?.length ?? 0, 0)
console.log('PASS: Jumedia moderation Mock contracts, persistence records, viewer isolation and administrator queue')
