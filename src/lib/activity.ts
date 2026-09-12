// Journal des actions réelles côté navigateur : recherches dans les bases musicales, synchronisation,
// analyses lancées. Les clics et la navigation ne sont pas journalisés — seul ce qui change des données
// ou interroge un service extérieur mérite une ligne. Les entrées partent par paquets, jamais une par une.

interface Entry {
  at: string
  action: string
  detail?: unknown
}

const FLUSH_DELAY_MS = 3000
const MAX_QUEUED = 50

let queue: Entry[] = []
let timer: ReturnType<typeof setTimeout> | null = null

async function flush(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (queue.length === 0) return
  const entries = queue
  queue = []
  try {
    await fetch('/api/activity', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
      keepalive: true,
    })
  } catch {
    // Le journal ne doit jamais gêner l'appli : une entrée perdue est sans conséquence.
  }
}

export function logAction(action: string, detail?: unknown): void {
  queue.push({ at: new Date().toISOString(), action, detail })
  if (queue.length >= MAX_QUEUED) void flush()
  else if (timer === null) timer = setTimeout(() => void flush(), FLUSH_DELAY_MS)
}

if (typeof window !== 'undefined') {
  // La page peut disparaître sans « unload » sur iPhone : pagehide est le seul moment fiable.
  window.addEventListener('pagehide', () => void flush())
}
