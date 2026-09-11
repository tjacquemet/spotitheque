// Petit stockage clé/valeur sur IndexedDB (plus de place que localStorage pour une grosse bibliothèque).

const DB_NAME = 'spotitheque'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** Lecture silencieuse : sans IndexedDB (navigation privée...), l'appli fonctionne simplement sans cache. */
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>('readonly', (s) => s.get(key))
  } catch {
    return undefined
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(value, key))
  } catch {
    // Cache facultatif.
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(key))
  } catch {
    // Cache facultatif.
  }
}
