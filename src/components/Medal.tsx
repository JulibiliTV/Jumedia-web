import type { ChatMedal } from '../api/livechat'

/** Medal colour by level band. */
export const medalHex = (lv: number) => (lv >= 17 ? '#c79d24' : lv >= 13 ? '#be6686' : lv >= 9 ? '#8d7ca6' : lv >= 5 ? '#5d7b9e' : '#5c968e')

/** 粉丝勋章：左边勋章名（底色）+ 右边等级。 */
export function MedalChip({ m, small = false }: { m: ChatMedal; small?: boolean }) {
  return (
    <span className={`medal ${small ? 'sm' : ''}`} style={{ borderColor: m.color }}>
      <span style={{ background: m.color }}>{m.name}</span><b style={{ color: m.color }}>{m.level}</b>
    </span>
  )
}
