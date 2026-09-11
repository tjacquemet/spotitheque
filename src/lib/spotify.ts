import type { SyncAlbum } from '../../shared/api'
import type { Album } from './types'

// Lecture de la bibliothèque Spotify depuis le navigateur, avec un jeton temporaire fourni par le Worker.

interface SpotifyImage {
  url: string
  width: number | null
}

export interface SpotifySavedAlbum {
  added_at?: string
  album: {
    id: string
    name: string
    artists: { id: string; name: string }[]
    images?: SpotifyImage[]
    release_date?: string
    total_tracks?: number
    external_ids?: { upc?: string }
  }
}

export interface SavedAlbumsPage {
  items: SpotifySavedAlbum[]
  next: string | null
  total: number
}

export const SAVED_ALBUMS_URL = 'https://api.spotify.com/v1/me/albums?limit=50'

export class SpotifyTokenRejected extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchSavedAlbumsPage(url: string, accessToken: string): Promise<SavedAlbumsPage> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (res.status === 429) {
      await sleep(Math.min(Number(res.headers.get('Retry-After')) || 2 ** attempt, 30) * 1000)
      continue
    }
    if (res.status === 401) throw new SpotifyTokenRejected()
    if (!res.ok) throw new Error(`Spotify a répondu ${res.status} pendant la synchronisation.`)
    return res.json()
  }
  throw new Error('Spotify limite les requêtes : réessaie dans quelques minutes.')
}

/**
 * Réduit un album Spotify aux champs conservés par Spotithèque, en respectant les règles de validation
 * du serveur : un seul album mal formé ne doit pas faire échouer tout un lot.
 */
export function toSyncAlbum(item: SpotifySavedAlbum): SyncAlbum {
  const a = item.album
  const images = [...(a.images ?? [])]
    .filter((i) => i.url?.startsWith('https://') && i.url.length <= 500)
    .sort((x, y) => (x.width ?? 0) - (y.width ?? 0))
  const pick = (minWidth: number) => images.find((i) => (i.width ?? 0) >= minWidth)?.url ?? images.at(-1)?.url ?? null
  const artists = (a.artists ?? [])
    .filter((artist) => artist.name)
    .slice(0, 50)
    .map((artist) => ({ id: (artist.id ?? '').slice(0, 64), name: artist.name.slice(0, 300) }))
  const upc = a.external_ids?.upc
  return {
    id: a.id,
    name: (a.name || 'Sans titre').slice(0, 500),
    artists: artists.length > 0 ? artists : [{ id: '', name: 'Artiste inconnu' }],
    image: pick(300),
    imageLarge: pick(600),
    releaseDate: a.release_date?.slice(0, 10) || null,
    totalTracks: Number.isInteger(a.total_tracks) ? (a.total_tracks as number) : null,
    upc: upc && upc.length <= 32 ? upc : null,
    addedAt: item.added_at?.slice(0, 40) || null,
  }
}

/** Vrai si l'album connu localement est identique à celui renvoyé par Spotify (rien à envoyer au serveur). */
export function isUnchanged(known: Album, s: SyncAlbum): boolean {
  return (
    known.inLibrary &&
    known.addedAt === s.addedAt &&
    known.name === s.name &&
    known.image === s.image &&
    known.imageLarge === s.imageLarge &&
    known.releaseDate === s.releaseDate &&
    known.totalTracks === s.totalTracks &&
    known.artists.length === s.artists.length &&
    known.artists.every((artist, i) => artist.id === s.artists[i].id && artist.name === s.artists[i].name)
  )
}
