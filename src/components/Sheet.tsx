import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './Icons'

/** Distance de glissement vers le bas au-delà de laquelle le panneau se ferme. */
const DISMISS_DISTANCE = 90

/**
 * Panneau qui monte du bas de l'écran (centré sur grand écran).
 * Se ferme par la croix, la poignée, un glissement vers le bas, un toucher à côté ou Échap.
 */
export function Sheet({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const drag = useRef<{ startY: number; dy: number } | null>(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.documentElement.classList.add('no-scroll')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('no-scroll')
    }
  }, [onClose])

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    drag.current = { startY: e.clientY, dy: 0 }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Le glissement fonctionne aussi sans capture du pointeur.
    }
  }

  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current.dy = Math.max(0, e.clientY - drag.current.startY)
    setOffset(drag.current.dy)
  }

  const endDrag = () => {
    const dy = drag.current?.dy ?? 0
    drag.current = null
    setOffset(0)
    if (dy > DISMISS_DISTANCE) onClose()
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        style={offset > 0 ? { transform: `translateY(${offset}px)`, transition: 'none' } : undefined}
      >
        <div className="sheet-top" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <button type="button" className="sheet-handle" onClick={onClose} aria-label="Fermer">
            <span />
          </button>
          <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Fermer">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
