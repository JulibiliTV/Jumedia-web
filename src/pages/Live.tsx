import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as juli from '../api/juli'
import * as jm from '../api/jumedia'
import { type ChatEvent, type ChatLine, chatMedal, connectLiveChat } from '../api/livechat'
import { compact, countText, liveItem, type VideoItem } from '../api/normalize'
import { LiveCard, LiveFeature } from '../components/Cards'
import { Icon } from '../components/Icon'
import { Player } from '../components/Player'
import { MedalChip, medalHex } from '../components/Medal'
import { Avatar, Empty, ErrorState, Loading, SkeletonGrid, toast, toastError } from '../components/ui'
import { useAsync, useInfinite, useSentinel, useTitle } from '../lib/hooks'
import { useSession } from '../lib/session'

/** 直播首页 — `getWebAreaList`, `getRoomList`, `getUserRecommend`, `user/following`. */
export function Live() {
  useTitle('直播')
  const { me } = useSession()
  const areas = useAsync(async () => (await juli.liveAreas()).data as { id: number; name: string; list: { id: string; name: string }[] }[], [])
  const [area, setArea] = useState(0)
  const [sort, setSort] = useState('online')
  const following = useAsync(async () => (me ? compact<VideoItem & { live: boolean }>(((await juli.liveFollowing(1)).list ?? []).map((r: any) => { const it = liveItem(r); return it && { ...it, live: r.live_status === 1 } })).sort((x, y) => Number(y.live) - Number(x.live)) : []), [me?.mid])
  const feed = useInfinite(async (page: number) => {
    if (!area) {
      const d = await juli.liveRecommend(page)
      return { items: compact((d.list ?? []).map(liveItem)), next: d.has_more ? page + 1 : null }
    }
    const rows = await juli.liveRoomList(area, page, sort)
    return { items: compact((rows ?? []).map(liveItem)), next: rows?.length === 20 ? page + 1 : null }
  }, 1, [area, sort])
  const sentinel = useSentinel(feed.more, !feed.loading && !feed.done && feed.items.length > 8)
  const top = useAsync(async () => compact(((await juli.liveRecommend(1)).list ?? []).map(liveItem)).slice(0, 5), [])
  const [hero, ...side] = top.data ?? []
  const liveCount = (following.data ?? []).filter((x) => x.live).length
  return (
    <div className="page" style={{ gap: 28 }}>
      <div className="chead">
        <h1>直播</h1><span className="muted" style={{ fontSize: 14 }}>正在发生的精彩</span>
        <span className="grow" />
        <Link to="/creator/live" className="pill-accent"><Icon name="live" size={15} />我要开播</Link>
      </div>
      {!!following.data?.length && (
        <section className="hosts">
          <div className="who"><b style={{ fontSize: 15 }}>我关注的主播</b><span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{liveCount} 人直播中</span></div>
          <div className="list">
            {following.data.map((h) => (
              <Link key={h.id} to={`/live/${h.roomId}`} className="h" style={{ opacity: h.live ? 1 : 0.55 }}>
                <span className={`ring ${h.live ? 'on' : ''}`}><img src={h.avatar} alt="" />{h.live && <span>直播中</span>}</span>
                <span>{h.ownerName}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {hero && <div className="g4"><LiveFeature it={hero} />{side.map((it) => <LiveCard key={it.id} it={it} />)}</div>}
      <section>
        <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
          <div className="chips-b">
            <button type="button" className={!area ? 'on' : ''} onClick={() => setArea(0)}>推荐</button>
            {areas.data?.map((a) => <button type="button" key={a.id} className={area === a.id ? 'on' : ''} onClick={() => setArea(a.id)}>{a.name}</button>)}
          </div>
          <span className="grow" />
          {area > 0 && <span className="pill-seg" style={{ marginBottom: 0 }}><button type="button" className={sort === 'online' ? 'on' : ''} onClick={() => setSort('online')}>最热</button><button type="button" className={sort === 'live_time' ? 'on' : ''} onClick={() => setSort('live_time')}>最新开播</button></span>}
        </div>
        {feed.error ? <ErrorState error={feed.error} retry={feed.reload} /> : feed.items.length ? <div className="g4">{feed.items.map((it) => <LiveCard key={it.id} it={it} />)}</div> : feed.loading ? <SkeletonGrid /> : <Empty title="这个分区暂时没有主播开播" icon="live" />}
      </section>
      <div ref={sentinel} />
      {!feed.done && feed.items.length > 0 && <div className="more-btn"><button type="button" disabled={feed.loading} onClick={feed.more}>{feed.loading ? '加载中…' : '加载更多'}</button></div>}
    </div>
  )
}

/** 直播间 — `room_init`, `get_info`, `Master/info`, `getRoomPlayInfo`, `gethistory`, `SuperChat/getMessageList`, `/msg/send`. */
export function LiveRoom() {
  const { id = '0' } = useParams()
  const roomId = Number(id)
  const nav = useNavigate()
  const { me } = useSession()
  const room = useAsync(async () => {
    const init = await juli.roomInit(roomId)
    const info = await juli.roomInfo(init.room_id)
    const master = await juli.masterInfo(info.uid)
    return { info, master }
  }, [roomId])
  useTitle(room.data?.info.title)
  const [tab, setTab] = useState<'chat' | 'gold' | 'guard' | 'fans'>('chat')
  const uid = room.data?.info.uid as number | undefined
  const reserve = useAsync(async () => (uid ? jm.reservations(uid) : []) as Promise<{ sid: number; name: string; subtitle: string }[]>, [uid])
  const gold = useAsync(async () => (uid ? jm.liveGoldRank(room.data!.info.room_id, uid) : null) as Promise<{ onlineNum: number; OnlineRankItem: { uid: number; name: string; face: string; score: number; userRank: number }[] } | null>, [uid, tab])
  const fans = useAsync(async () => (uid ? jm.medalRank(room.data!.info.room_id, uid) : null) as Promise<{ list: { uid: number; uname: string; face: string; rank: number; level: number; color: number }[]; own: { level: number } | null; medal_name: string; total: number } | null>, [uid, me?.mid])
  const guards = useAsync(async () => (uid ? jm.liveGuards(room.data!.info.room_id, uid) : null) as Promise<{ info: { num: number }; top3: { uid: number; username: string; face: string; rank: number; guard_level: number }[]; list: { uid: number; username: string; face: string; rank: number; guard_level: number }[] } | null>, [uid])
  const [lines, setLines] = useState<ChatLine[]>([])
  const [sc, setSc] = useState<any[]>([])
  const [online, setOnline] = useState<number | null>(null)
  const [socket, setSocket] = useState<'connecting' | 'live' | 'down' | null>(null)
  const [follow, setFollow] = useState(false)
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const pushLine = (line: ChatLine) => setLines((l) => (l.some((x) => x.id === line.id) ? l : [...l, line].slice(-200)))
  useEffect(() => {
    if (!room.data) return
    let alive = true, polling = true
    const poll = async () => {
      if (!polling) return
      try {
        const h = await juli.liveHistory(roomId)
        if (!alive || !polling) return
        setLines((h.room ?? []).map((m: any) => ({ id: m.id_str || `${m.uid}-${m.timeline}`, uid: m.uid, name: m.user?.base?.name ?? m.nickname, text: m.text, face: m.user?.base?.face, medal: chatMedal(m.user) })))
      } catch { /* keep the last snapshot */ }
    }
    poll()
    juli.superChats(roomId).then((d) => alive && setSc(d.list ?? [])).catch(() => {})
    if (me) juli.accRelation(room.data.info.uid).then((r) => alive && setFollow([2, 6].includes(r.relation?.attribute))).catch(() => {})
    const t = setInterval(poll, 4000)
    // Against the real server the room is followed over the `getDanmuInfo` WebSocket, like the TV client;
    // history polling only covers the gaps while that socket is down. The in-browser mock cannot host one.
    const onEvent = (e: ChatEvent) => {
      if (!alive) return
      if (e.type === 'message') pushLine(e.line)
      else if (e.type === 'superchat') setSc((l) => [e.sc, ...l.filter((s) => String(s.id) !== String(e.sc.id))])
      else if (e.type === 'superchat-delete') setSc((l) => l.filter((s) => !e.ids.includes(String(s.id))))
      else if (e.type === 'online') setOnline(e.count)
      else if (e.type === 'preparing') room.reload()
    }
    const disconnect = import.meta.env.VITE_MOCK === '0'
      ? connectLiveChat(room.data.info.room_id, me?.mid ?? 0, onEvent, (state) => { polling = state !== 'live'; if (alive) setSocket(state) })
      : () => {}
    return () => { alive = false; clearInterval(t); disconnect(); setSocket(null); setOnline(null) }
  }, [room.data, me?.mid]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [lines])

  if (room.loading && !room.data) return <Loading />
  if (room.error) return <ErrorState error={room.error} retry={room.reload} />
  const { info, master } = room.data!
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!me) return nav('/login')
    if (!text.trim()) return
    try {
      await jm.liveSend(roomId, text.trim())
      // A live socket echoes our own message back as DANMU_MSG; otherwise show it right away.
      if (socket !== 'live') pushLine({ id: 'me' + Date.now(), uid: me.mid, name: me.uname, text: text.trim() })
      setText('')
    } catch (err) { toastError(err) }
  }
  const joinFans = async () => {
    if (!me) return nav('/login')
    if (fans.data?.own) return nav('/account/medals')
    try { const x = await jm.medalJoin(info.room_id); if (x.code) throw new Error(x.message); fans.reload(); toast(`已加入粉丝团，获得「${fans.data?.medal_name ?? '粉丝'}」勋章`, 'success') } catch (err) { toastError(err) }
  }
  const toggleFollow = async () => {
    if (!me) return nav('/login')
    try { await juli.relationModify(info.uid, !follow); setFollow(!follow); toast(follow ? '已取消关注' : '关注成功', 'success') } catch (err) { toastError(err) }
  }
  return (
    <div className="live-room">
      <div style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 14, marginBottom: 16 }}>
          <Link to={`/space/${info.uid}`} style={{ flex: 'none', padding: 2, borderRadius: '50%', border: `2px solid ${info.live_status === 1 ? 'var(--accent)' : 'var(--line)'}` }}><Avatar src={master.info?.face} size={48} /></Link>
          <div className="stack" style={{ flex: '1 1 320px', minWidth: 0, gap: 2 }}>
            <h1 className="clamp-1" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.35 }}>{info.title}</h1>
            <span className="row wrap muted" style={{ gap: '4px 12px', fontSize: 13 }}>
              <Link to={`/space/${info.uid}`} style={{ color: 'var(--text)', fontWeight: 600 }}>{master.info?.uname}</Link>
              <span style={{ height: 20, padding: '0 7px', borderRadius: 4, background: 'var(--surface-2)', fontSize: 12, display: 'inline-flex', alignItems: 'center' }}>{info.parent_area_name} · {info.area_name}</span>
              <span>房间号 {info.room_id}</span>
              {info.live_status === 1 ? <span>{liveSince(info.live_time)}</span> : <span>未开播</span>}
            </span>
          </div>
          <span className="row muted" style={{ gap: 6, fontSize: 13 }}><Icon name="eye" size={15} />{countText(online ?? info.online)}</span>
          {me?.mid !== info.uid && <button type="button" className={follow ? 'pill' : 'pill-accent'} style={{ border: follow ? undefined : 0 }} onClick={toggleFollow}>{follow ? '已关注' : <><Icon name="plus" size={15} />关注</>} {countText(master.follower_num)}</button>}
          {me?.mid !== info.uid && <button type="button" className="fan-pill" onClick={joinFans}>{fans.data?.own ? <MedalChip m={{ name: fans.data.medal_name, level: fans.data.own.level, color: medalHex(fans.data.own.level) }} /> : <Icon name="plus" size={14} />}{fans.data?.own ? '粉丝团' : '加入粉丝团'} {countText(fans.data?.total ?? 0)}</button>}
        </div>
        {info.live_status === 1 ? <Player source={{ kind: 'live', roomId }} liveFeed={lines.map((l) => ({ id: l.id, text: l.text, mine: l.uid === me?.mid }))} /> : (
          <div className="player" style={{ display: 'grid', placeItems: 'center', color: '#fff' }}>
            <div className="stack" style={{ alignItems: 'center' }}><img src={info.user_cover} alt="" style={{ width: 280, borderRadius: 12, opacity: 0.6 }} /><span>主播暂未开播，关注后第一时间收到开播提醒</span></div>
          </div>
        )}
        <div className="g2" style={{ marginTop: 18 }}>
          <div className="box-b">
            <h3>直播间简介</h3>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>{info.description || '主播很懒，什么都没有写'}</p>
            {!!info.tags && <div className="tagcloud">{String(info.tags).split(/[,，]/).filter(Boolean).map((t: string) => <span key={t} className="chip" style={{ height: 26 }}>{t}</span>)}</div>}
          </div>
          <div className="box-b">
            <h3>直播预告</h3>
            {reserve.data?.length ? reserve.data.slice(0, 3).map((r) => (
              <div key={r.sid} className="mini"><span className="art" style={{ width: 88 }}><img src={info.user_cover} alt="" /></span><span className="t"><b style={{ WebkitLineClamp: 1 }}>{r.name}</b><span>{r.subtitle}</span></span></div>
            )) : <span className="faint" style={{ fontSize: 13 }}>主播暂时没有直播预告</span>}
          </div>
        </div>
      </div>
      <div className="chat">
        <div className="chat-tabs">
          <button type="button" className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>聊天</button>
          <button type="button" className={tab === 'gold' ? 'on' : ''} onClick={() => setTab('gold')}>高能用户{!!gold.data?.onlineNum && <small>{gold.data.onlineNum}</small>}</button>
          <button type="button" className={tab === 'fans' ? 'on' : ''} onClick={() => setTab('fans')}>粉丝团{!!fans.data?.total && <small>{fans.data.total}</small>}</button>
          <button type="button" className={tab === 'guard' ? 'on' : ''} onClick={() => setTab('guard')}>舰长{!!guards.data?.info?.num && <small>{guards.data.info.num}</small>}</button>
        </div>
        {tab === 'fans' && (
          <div className="list rank-users">
            {(fans.data?.list ?? []).map((u) => <Link key={u.uid} to={`/space/${u.uid}`} className="mini"><span className={`rank-n ${u.rank <= 3 ? 'top' : ''}`}>{u.rank}</span><Avatar src={u.face} size={32} /><span className="t"><b style={{ WebkitLineClamp: 1 }}>{u.uname}</b></span><MedalChip m={{ name: fans.data!.medal_name, level: u.level, color: `#${u.color.toString(16).padStart(6, '0')}` }} small /></Link>)}
            {!fans.data?.list?.length && <span className="faint" style={{ fontSize: 13, textAlign: 'center', padding: 20 }}>还没有人加入粉丝团</span>}
          </div>
        )}
        {(tab === 'gold' || tab === 'guard') && (
          <div className="list rank-users">
            {(tab === 'gold' ? (gold.data?.OnlineRankItem ?? []).map((u) => ({ uid: u.uid, name: u.name, face: u.face, n: u.userRank, note: `${u.score} 贡献` }))
              : [...(guards.data?.top3 ?? []), ...(guards.data?.list ?? [])].map((u) => ({ uid: u.uid, name: u.username, face: u.face, n: u.rank, note: u.guard_level === 2 ? '提督' : '舰长' }))).map((u) => (
              <Link key={u.uid} to={`/space/${u.uid}`} className="mini"><span className={`rank-n ${u.n <= 3 ? 'top' : ''}`}>{u.n}</span><Avatar src={u.face} size={32} /><span className="t"><b style={{ WebkitLineClamp: 1 }}>{u.name}</b></span><span className="faint" style={{ fontSize: 12 }}>{u.note}</span></Link>
            ))}
            {(tab === 'gold' ? !gold.data?.OnlineRankItem?.length : !guards.data?.info?.num) && <span className="faint" style={{ fontSize: 13, textAlign: 'center', padding: 20 }}>{tab === 'gold' ? '还没有高能用户' : '还没有舰长'}</span>}
          </div>
        )}
        {tab === 'chat' && <>
        {sc.length > 0 && <div className="sc">{sc.map((s) => <div key={s.id} className="sc-item"><div className="top"><img src={s.user_info?.face} className="avatar" width={22} height={22} alt="" />{s.user_info?.uname}<span style={{ marginLeft: 'auto' }}>￥{s.price}</span></div><div className="msg">{s.message}</div></div>)}</div>}
        <div className="list" ref={list}>
          <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>欢迎来到直播间！请遵守社区规范，文明发言</div>
          {socket === 'down' && <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>聊天连接已断开，正在重连…</div>}
          {lines.map((l) => <div key={l.id} className={`msg-line ${l.uid === me?.mid ? 'mine' : ''}`}>{l.medal && <MedalChip m={l.medal} small />}<span className="n">{l.name}:</span>{l.text}</div>)}
        </div>
        <form onSubmit={send}>
          <input className="input" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder={me ? '发个弹幕呗～' : '登录后发言'} disabled={!me} />
          <button className="btn primary" disabled={!me}>发送</button>
        </form>
        </>}
      </div>
    </div>
  )
}

/** 已开播 1 小时 24 分 — `live_time` is a unix time (Jumedia) or a "YYYY-MM-DD HH:MM:SS" string. */
function liveSince(t: number | string | undefined) {
  const start = typeof t === 'number' ? t : t && !t.startsWith('0000') ? new Date(t.replace(' ', 'T')).getTime() / 1000 : 0
  if (!start) return '直播中'
  const min = Math.max(0, Math.floor((Date.now() / 1000 - start) / 60))
  return min < 60 ? `已开播 ${min} 分钟` : `已开播 ${Math.floor(min / 60)} 小时${min % 60 ? ` ${min % 60} 分` : ''}`
}
