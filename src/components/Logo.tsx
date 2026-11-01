/**
 * Jumedia mark「三点成播」: three dots — creators, viewers and content gathering
 * (聚) — arranged as a play symbol. Monochrome only: it takes `currentColor`
 * (black on light surfaces, white on dark) and is never tinted.
 */
export const MARK_DOTS = [{ cx: 20.5, cy: 16.5 }, { cx: 20.5, cy: 47.5 }, { cx: 47.5, cy: 32 }]
export const MARK_RADIUS = 12

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ flex: 'none', display: 'block' }}>
      <g fill="currentColor">{MARK_DOTS.map((d) => <circle key={d.cy} cx={d.cx} cy={d.cy} r={MARK_RADIUS} />)}</g>
    </svg>
  )
}

export function LogoWordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="logo-lockup" style={{ fontSize: size * 0.72 }}>
      <LogoMark size={size} />
      <span className="logo-type">jumedia</span>
    </span>
  )
}
