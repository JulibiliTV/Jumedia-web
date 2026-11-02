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
// Posting uses the same envelope and policy errors as the real server.
db.archives = [{ aid: 1, mid: 1, state: 0, stat: { reply: 3 } } as (typeof db.archives)[number]]
const send = (message: string, root = '0', parent = root) => call('/x/v2/reply/add', { type: '1', oid: '1', message, root, parent }, 2, 'POST')
let posted = await send('contract root')
assert.equal(posted.code, 0)
const postedRoot = posted.data.rpid_str
for (const [key, value] of Object.entries({ success_action: 0, need_captcha: false, url: '', root: 0, root_str: '0', parent: 0, parent_str: '0', dialog: 0, dialog_str: '0' })) assert.equal(posted.data[key], value, key)
assert.deepEqual(posted.data.emote, {})
for (const key of ['root','root_str','parent','parent_str','dialog','dialog_str']) assert.equal(posted.data.reply[key], posted.data[key])
posted = await send('contract child', postedRoot)
assert.equal(posted.data.dialog_str, postedRoot)
const postedChild = posted.data.rpid_str
assert.equal((await send('contract nested', postedRoot, postedChild)).data.parent_str, postedChild)
assert.equal((await send('bad root', postedChild)).code, 12006)
assert.equal((await send('bad parent', postedRoot, '999999')).code, 12006)
assert.equal((await send('missing root', '0', postedRoot)).code, 12006)
assert.equal((await call('/x/v2/reply/add', { type: '2', oid: '1', message: 'bad type' }, 2, 'POST')).code, 12009)
assert.equal((await call('/x/v2/reply/add', { oid: '1', message: 'missing type' }, 2, 'POST')).code, 12009)
db.settings.commentEnabled = false
assert.equal((await send('closed')).code, 12002)
db.settings.commentEnabled = true
db.settings.commentReplyEnabled = false
assert.equal((await send('closed replies', postedRoot)).code, 12003)
db.settings.commentReplyEnabled = true
db.settings.sensitiveWords = 'forbidden'
assert.equal((await send('FORBIDDEN text')).code, 12016)
assert.equal((await call('/x/relation/modify', { fid: '2', act: '5' }, 1, 'POST')).code, 0)
assert.equal((await send('owner blocked me')).code, 12035)
assert.equal((await call('/x/relation/modify', { fid: '2', act: '6' }, 1, 'POST')).code, 0)
db.settings.commentMinInterval = 60
assert.equal((await send('too fast')).code, -509)
db.settings.commentMinInterval = 0
db.settings.commentDuplicateWindow = 60
const before = db.replies.length
assert.equal((await send('contract root')).code, 12051)
assert.equal(db.replies.length, before)
const concurrent = await Promise.all([send('concurrent'), send('concurrent')])
assert.deepEqual(concurrent.map((x) => x.code).sort(), [0, 12051])
for (const key of ['commentMinInterval', 'commentDuplicateWindow']) {
  for (const value of ['-1', '1.5', '86401', 'NaN', '']) assert.equal((await call('/x/admin/settings/save', { [key]: value }, 1, 'POST')).code, -400)
}
db.users[1].status = 1
assert.equal((await send('banned')).code, -102)
db.users[1].status = 0
db.archives[0].state = -100
assert.equal((await send('deleted')).code, -404)
resetDB()
assert.equal(getDB().userBlocks?.length ?? 0, 0)
assert.equal(getDB().commentReports?.length ?? 0, 0)
console.log('PASS: Jumedia moderation Mock contracts, persistence records, viewer isolation and administrator queue')
