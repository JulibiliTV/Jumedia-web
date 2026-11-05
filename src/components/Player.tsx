import { lazy, Suspense, type ComponentProps } from 'react'
import { Spinner } from './ui'

export type { Chapter, Source } from './PlayerCore'

const LazyPlayer = lazy(() => import('./PlayerCore').then((m) => ({ default: m.Player })))

export function Player(props: ComponentProps<typeof LazyPlayer>) {
  return <Suspense fallback={<div className="player-wrap" role="status" aria-label="正在加载播放器"><div className="player"><div className="center"><Spinner /></div></div></div>}><LazyPlayer {...props} /></Suspense>
}
