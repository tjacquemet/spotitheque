import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
  action?: { label: string; run: () => void }
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(next: Toast[]) {
  toasts = next
  listeners.forEach((listener) => listener())
}

export function dismissToast(id: number) {
  emit(toasts.filter((t) => t.id !== id))
}

export function toast(message: string, opts: { tone?: Toast['tone']; action?: Toast['action']; duration?: number } = {}) {
  const t: Toast = { id: nextId++, message, tone: opts.tone ?? 'info', action: opts.action }
  emit([...toasts.slice(-2), t])
  setTimeout(() => dismissToast(t.id), opts.duration ?? (opts.action ? 6000 : 3500))
}

export function toastError(err: unknown) {
  toast(err instanceof Error ? err.message : 'Une erreur est survenue.', { tone: 'error' })
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => toasts,
  )
}
