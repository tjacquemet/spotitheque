import { useRef, type MouseEvent, type PointerEvent } from 'react'

const LONG_PRESS_MS = 450
const MOVE_TOLERANCE = 10

/** Distingue un appui long d'un simple toucher ; un défilement annule l'appui long. */
export function useLongPress(onLongPress: () => void, onClick: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }

  return {
    onPointerDown: (e: PointerEvent) => {
      // À la souris, la sélection multiple se fait par rectangle : pas d'appui long.
      if (e.button !== 0 || e.pointerType === 'mouse') return
      fired.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(() => {
        fired.current = true
        navigator.vibrate?.(12)
        onLongPress()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: PointerEvent) => {
      const o = origin.current
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_TOLERANCE) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClick: (e: MouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        fired.current = false
        return
      }
      onClick()
    },
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  }
}
