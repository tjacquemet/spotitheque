import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/** Déplacement minimum avant de considérer qu'il s'agit d'un rectangle de sélection et non d'un clic. */
const DRAG_THRESHOLD = 6

interface Card {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

interface BandState {
  startX: number
  startY: number
  clientX: number
  clientY: number
  base: Set<string>
  cards: Card[]
  active: boolean
  pointerId: number
}

export interface BandRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Sélection de plusieurs albums en traçant un rectangle à la souris, comme dans un explorateur de fichiers.
 * Maj ou Cmd enfoncés, le rectangle s'ajoute à la sélection en cours.
 */
export function useBandSelect(
  container: RefObject<HTMLDivElement | null>,
  selection: Set<string> | null,
  onChange: (next: Set<string>) => void,
) {
  const band = useRef<BandState | null>(null)
  const [rect, setRect] = useState<BandRect | null>(null)

  // Coordonnées relatives au conteneur : elles restent valables même si la page défile.
  const relative = useCallback(
    (clientX: number, clientY: number) => {
      const box = container.current!.getBoundingClientRect()
      return { x: clientX - box.left, y: clientY - box.top }
    },
    [container],
  )

  const apply = useCallback(
    (x: number, y: number) => {
      const state = band.current
      if (!state) return
      const left = Math.min(state.startX, x)
      const right = Math.max(state.startX, x)
      const top = Math.min(state.startY, y)
      const bottom = Math.max(state.startY, y)
      setRect({ left, top, width: right - left, height: bottom - top })
      const next = new Set(state.base)
      for (const card of state.cards) {
        if (card.left < right && card.right > left && card.top < bottom && card.bottom > top) next.add(card.id)
      }
      onChange(next)
    },
    [onChange],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const grid = container.current
    if (!grid || e.pointerType !== 'mouse' || e.button !== 0) return
    const start = relative(e.clientX, e.clientY)
    band.current = {
      startX: start.x,
      startY: start.y,
      clientX: e.clientX,
      clientY: e.clientY,
      base: e.shiftKey || e.metaKey || e.ctrlKey ? new Set(selection ?? []) : new Set(),
      cards: [...grid.querySelectorAll<HTMLElement>('[data-album]')].map((el) => ({
        id: el.dataset.album!,
        left: el.offsetLeft,
        top: el.offsetTop,
        right: el.offsetLeft + el.offsetWidth,
        bottom: el.offsetTop + el.offsetHeight,
      })),
      active: false,
      pointerId: e.pointerId,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = band.current
    if (!state || e.pointerId !== state.pointerId) return
    const { x, y } = relative(e.clientX, e.clientY)
    state.clientX = e.clientX
    state.clientY = e.clientY
    if (!state.active) {
      if (Math.hypot(x - state.startX, y - state.startY) < DRAG_THRESHOLD) return
      state.active = true
      try {
        container.current?.setPointerCapture(e.pointerId)
      } catch {
        // Le rectangle fonctionne aussi sans capture du pointeur.
      }
    }
    apply(x, y)
  }

  const endBand = () => {
    const state = band.current
    band.current = null
    setRect(null)
    if (!state?.active) return
    // Le clic qui suit le glissement ne doit ni ouvrir ni décocher un album.
    const grid = container.current
    if (!grid) return
    const swallowClick = (e: Event) => {
      e.stopPropagation()
      e.preventDefault()
    }
    grid.addEventListener('click', swallowClick, { capture: true, once: true })
    // Filet de sécurité si aucun clic ne suit : l'écouteur ne doit pas rester en place.
    setTimeout(() => grid.removeEventListener('click', swallowClick, { capture: true }), 400)
  }

  // Molette pendant le glissement : le rectangle suit le défilement de la page.
  useEffect(() => {
    if (!rect) return
    const onScroll = () => {
      const state = band.current
      if (!state?.active) return
      const { x, y } = relative(state.clientX, state.clientY)
      apply(x, y)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [rect, relative, apply])

  return {
    rect,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endBand,
      onPointerCancel: endBand,
    },
  }
}
