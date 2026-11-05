import { Component, Suspense, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Empty, Loading } from './ui'

class RouteErrorBoundary extends Component<{ children: ReactNode; pathname: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidUpdate(previous: Readonly<{ children: ReactNode; pathname: string }>) {
    if (this.state.failed && previous.pathname !== this.props.pathname) this.setState({ failed: false })
  }

  render() {
    if (this.state.failed) return <Empty icon="alert-circle" title="页面加载失败" hint="请检查网络后刷新页面。" action={<button className="btn" onClick={() => window.location.reload()}>刷新页面</button>} />
    return this.props.children
  }
}

/** Keep the surrounding navigation available while a page module loads. */
export function RouteContent({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <RouteErrorBoundary pathname={pathname}><Suspense fallback={<div role="status" aria-live="polite"><Loading /></div>}>{children}</Suspense></RouteErrorBoundary>
}
