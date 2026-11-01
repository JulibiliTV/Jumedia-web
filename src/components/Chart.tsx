import { useState } from 'react'
import { countText } from '../api/normalize'

/** Minimal responsive SVG charts (area line and bars) drawn in the brand color. */
export function AreaChart({ data, x, y, height = 220 }: { data: Record<string, any>[]; x: string; y: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 720, H = height, P = { l: 44, r: 12, t: 12, b: 26 }
  const values = data.map((d) => Number(d[y]) || 0)
  const max = Math.max(1, ...values) * 1.15
  const sx = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, data.length - 1)
  const sy = (v: number) => H - P.b - (v / max) * (H - P.t - P.b)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i)},${sy(v)}`).join('')
  const ticks = [0, 0.5, 1].map((t) => t * max)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }} onMouseLeave={() => setHover(null)}>
      <defs><linearGradient id={`fill-${y}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".28" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient></defs>
      {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={sy(t)} y2={sy(t)} stroke="var(--line)" /><text x={P.l - 8} y={sy(t) + 4} textAnchor="end">{countText(Math.round(t))}</text></g>)}
      {data.length > 1 && <path d={`${line}L${sx(data.length - 1)},${H - P.b}L${sx(0)},${H - P.b}Z`} fill={`url(#fill-${y})`} />}
      <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {data.map((d, i) => (
        <g key={i}>
          <rect x={sx(i) - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          {(i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && <text x={sx(i)} y={H - 6} textAnchor="middle">{d[x]}</text>}
        </g>
      ))}
      {hover !== null && <g><line x1={sx(hover)} x2={sx(hover)} y1={P.t} y2={H - P.b} stroke="var(--line-strong)" strokeDasharray="3 3" /><circle cx={sx(hover)} cy={sy(values[hover])} r={4.5} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} /><text x={Math.min(W - 60, Math.max(60, sx(hover)))} y={sy(values[hover]) - 12} textAnchor="middle" style={{ fill: 'var(--text)', fontWeight: 700 }}>{countText(values[hover])}</text></g>}
    </svg>
  )
}

export function BarList({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="stack" style={{ gap: 10 }}>
      {data.map((d) => (
        <div key={d.label} className="row" style={{ gap: 10, fontSize: 13 }}>
          <span style={{ width: 72, flex: 'none' }} className="muted clamp-1">{d.label}</span>
          <div className="grow" style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: 'var(--brand)', borderRadius: 4 }} /></div>
          <span style={{ width: 32, textAlign: 'right' }} className="mono">{d.value}</span>
        </div>
      ))}
    </div>
  )
}
