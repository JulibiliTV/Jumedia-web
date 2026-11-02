import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import * as juli from '../../api/juli'
import { UserCard } from '../../components/Cards'
import { Empty, ErrorState, Loading, Pager, Spinner, toast, toastError } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { useSession } from '../../lib/session'
import './Blacklist.css'

const PAGE_SIZE = 20

export function Blacklist() {
  const { me } = useSession()
  return me ? <BlacklistList key={me.mid} /> : null
}

export function BlacklistRedirect() {
  const { me } = useSession()
  return me ? <Navigate to={`/space/${me.mid}?tab=blacklist`} replace /> : null
}

function BlacklistList() {
  const [page, setPage] = useState(1)
  const [removing, setRemoving] = useState<number | null>(null)
  const d = useAsync(() => juli.blacklist(page, PAGE_SIZE), [page])
  const total = d.data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const busy = removing !== null || d.loading

  // A refresh can discover that the last page has disappeared.
  useEffect(() => {
    if (!d.loading && !d.error && d.data && page > lastPage) setPage(lastPage)
  }, [d.loading, d.error, d.data, page, lastPage])

  const unblock = async (user: juli.BlockedUser) => {
    if (busy) return
    setRemoving(user.mid)
    try {
      await juli.unblockUser(user.mid)
      const nextPage = Math.min(page, Math.max(1, Math.ceil((total - 1) / PAGE_SIZE)))
      if (nextPage !== page) setPage(nextPage)
      else d.reload()
      toast(`已解除对「${user.uname}」的拉黑`, 'success')
    } catch (error) {
      toastError(error)
    } finally {
      setRemoving(null)
    }
  }

  if (d.loading && !d.data) return <Loading />

  return (
    <div className="blacklist-page">
      {d.error ? <ErrorState error={d.error} retry={d.reload} /> : !d.data?.list.length ? (
        <Empty title="暂无拉黑用户" icon="ban" />
      ) : (
        <div className="ugrid blacklist-grid" aria-label="已拉黑的用户">
          {d.data.list.map((user) => (
            <UserCard key={user.mid} u={user}
              right={<button type="button" className="btn sm" disabled={busy} onClick={() => unblock(user)} aria-label={`解除对${user.uname}的拉黑`}>
                {removing === user.mid ? <><Spinner size={14} />正在解除…</> : '解除拉黑'}
              </button>} />
          ))}
        </div>
      )}
      {!d.error && <fieldset className="blacklist-pagination" disabled={busy} aria-label="黑名单分页">
        <Pager page={page} total={total} size={PAGE_SIZE} onChange={setPage} />
      </fieldset>}
    </div>
  )
}
