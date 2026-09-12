import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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

  // Le glissement est suivi au niveau de la fenêtre plutôt que par capture du pointeur :
  // une capture détournerait le clic suivant, et la croix ne répondrait plus.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return
      drag.current.dy = Math.max(0, e.clientY - drag.current.startY)
      setOffset(drag.current.dy)
    }
    const onUp = () => {
      const dy = drag.current?.dy ?? 0
      drag.current = null
      setOffset(0)
      if (dy > DISMISS_DISTANCE) onClose()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [onClose])

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 0) drag.current = { startY: e.clientY, dy: 0 }
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
        <div className="sheet-top" onPointerDown={startDrag}>
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
