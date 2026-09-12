import type { SyncAlbum } from '../../shared/api'
import type { SavedAlbumsPage } from '../../shared/spotify'
import type { Album } from './types'

export { toSyncAlbum } from '../../shared/spotify'
export type { SavedAlbumsPage, SpotifySavedAlbum } from '../../shared/spotify'

// Lecture de la bibliothèque Spotify depuis le navigateur, avec un jeton temporaire fourni par le Worker.

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
