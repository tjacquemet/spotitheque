import type {
  ClientKind,
  Device,
  LibraryPayload,
  MeResponse,
  MutationResult,
  PlayResult,
  SyncAlbum,
  TagDto,
} from '../shared/api'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type Listener = (err: ApiError) => void
const errorListeners = new Set<Listener>()

/** Permet à l'appli de réagir globalement à une session expirée ou à un Spotify à reconnecter. */
export function onApiError(listener: Listener): () => void {
  errorListeners.add(listener)
  return () => errorListeners.delete(listener)
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    })
  } catch {
    throw new ApiError(0, 'network', 'Pas de connexion au serveur.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code ?? `http_${res.status}`, data?.error?.message ?? `Erreur ${res.status}.`)
    errorListeners.forEach((listener) => listener(err))
    throw err
  }
  return data as T
}

export const api = {
  me: () => request<MeResponse>('GET', '/me'),

  /** Renvoie null si la bibliothèque n'a pas changé depuis `version`. */
  async library(version?: number): Promise<LibraryPayload | null> {
    let res: Response
    try {
      res = await fetch('/api/library', {
        credentials: 'same-origin',
        headers: version ? { 'If-None-Match': `"v${version}"` } : undefined,
        cache: 'no-store',
      })
    } catch {
      throw new ApiError(0, 'network', 'Pas de connexion au serveur.')
    }
    if (res.status === 304) return null
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      const err = new ApiError(res.status, data?.error?.code ?? `http_${res.status}`, data?.error?.message ?? `Erreur ${res.status}.`)
      errorListeners.forEach((listener) => listener(err))
      throw err
    }
    return res.json()
  },

  spotifyToken: () => request<{ accessToken: string; expiresAt: number }>('GET', '/spotify/token'),
  syncAlbums: (albums: SyncAlbum[]) => request<{ changes: number; version: number | null }>('POST', '/sync/albums', { albums }),
  syncFinish: (allIds: string[]) => request<{ removed: number; version: number | null }>('POST', '/sync/finish', { allIds }),

  createTag: (name: string) => request<{ tag: TagDto; created: boolean; version: number }>('POST', '/tags', { name }),
  updateTag: (id: number, patch: { name?: string; color?: string; isGenre?: boolean }) =>
    request<{ tag: TagDto; version: number }>('PATCH', `/tags/${id}`, patch),
  deleteTag: (id: number) => request<MutationResult>('DELETE', `/tags/${id}`, {}),
  mergeTag: (id: number, into: number) => request<MutationResult>('POST', `/tags/${id}/merge`, { into }),
  setAlbumTags: (albumIds: string[], add: number[], remove: number[]) =>
    request<MutationResult>('POST', '/album-tags', { albumIds, add, remove }),
  deleteAlbums: (albumIds: string[]) =>
    request<{ deleted: number; version: number }>('POST', '/albums/delete', { albumIds }),

  devices: () => request<{ devices: Device[] }>('GET', '/devices'),
  play: (albumId: string, deviceId: string | null, clientKind: ClientKind) =>
    request<PlayResult>('POST', '/play', { albumId, deviceId, clientKind }),
  /** Envoyé juste avant d'ouvrir Spotify : keepalive garantit l'envoi même si la page passe en arrière-plan. */
  playWhenReady: (albumId: string) =>
    request<{ status: 'waiting' }>('POST', '/play/when-ready', { albumId }, { keepalive: true }),

  importTags: (file: unknown) => request<{ tags: number; albums: number; links: number; version: number }>('POST', '/import', file),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
}
