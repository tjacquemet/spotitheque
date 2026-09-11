import type { CSSProperties, ReactNode } from 'react'
import { useLongPress } from '../hooks/useLongPress'

/** partial : tag présent sur une partie seulement des albums sélectionnés. */
export type ChipState = 'off' | 'on' | 'excluded' | 'partial'

interface TagChipProps {
  label: ReactNode
  color?: string
  state?: ChipState
  count?: number
  onClick: () => void
  onLongPress?: () => void
  muted?: boolean
  title?: string
}

export function TagChip({ label, color, state = 'off', count, onClick, onLongPress, muted, title }: TagChipProps) {
  const press = useLongPress(onLongPress ?? onClick, onClick)
  const handlers = onLongPress ? press : { onClick }
  const style = color ? ({ '--tag': color } as CSSProperties) : undefined
  return (
    <button
      type="button"
      className={`chip ${state}${muted ? ' muted' : ''}${color ? '' : ' special'}`}
      style={style}
      aria-pressed={state === 'partial' ? 'mixed' : state !== 'off'}
      title={title}
      {...handlers}
    >
      {color && state !== 'on' && <span className="dot" />}
      <span className="chip-label">{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  )
}
