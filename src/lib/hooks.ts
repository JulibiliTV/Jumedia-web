import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react'

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setState((s) => ({ data: s.data, loading: true }))
    fn().then((data) => live && setState({ data, loading: false }), (error) => live && setState({ error, loading: false }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const mutate = useCallback((update: (d: T | undefined) => T) => setState((s) => ({ ...s, data: update(s.data) })), [])
  return { ...state, reload, mutate }
}

/** Cursor-agnostic infinite list: `load(cursor)` returns items and the next cursor (null at the end). */
export function useInfinite<T, C>(load: (cursor: C) => Promise<{ items: T[]; next: C | null }>, first: C, deps: DependencyList) {
  const [items, setItems] = useState<T[]>([])
  const [next, setNext] = useState<C | null>(first)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>()
  const generation = useRef(0)
  const busy = useRef(false)

  const fetchPage = useCallback(async (cursor: C, reset: boolean) => {
    const gen = generation.current
    busy.current = true
    setLoading(true)
    try {
      const page = await load(cursor)
      if (gen !== generation.current) return
      setItems((list) => (reset ? page.items : [...list, ...page.items]))
      setNext(page.next)
      setError(undefined)
    } catch (e) {
      if (gen === generation.current) setError(e)
    } finally {
      if (gen === generation.current) { busy.current = false; setLoading(false) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    generation.current += 1
    busy.current = false
    setItems([])
    setNext(first)
    fetchPage(first, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const more = useCallback(() => {
    if (!busy.current && next !== null) fetchPage(next, false)
  }, [fetchPage, next])

  return { items, setItems, loading, error, done: next === null, more, reload: () => { generation.current += 1; fetchPage(first, true) } }
}

/** Calls `onVisible` when the sentinel scrolls into view. */
export function useSentinel(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onVisible)
  cb.current = onVisible
  useEffect(() => {
    if (!enabled || !ref.current) return
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && cb.current(), { rootMargin: '600px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [enabled])
  return ref
}

export function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

export function useTitle(title?: string) {
  useEffect(() => { document.title = title ? `${title} - Jumedia` : 'Jumedia - 发现与分享' }, [title])
}
