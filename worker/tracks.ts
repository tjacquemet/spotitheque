import { spotifyError, spotifyFetch } from './spotify'

export interface SpotifyTrack {
  id: string | null
  name: string
  duration_ms: number
  track_number: number
  disc_number: number
  artists?: { name: string }[]
}

const PAGE = 50
/** 200 titres suffisent aux plus gros coffrets, et bornent le nombre de sous-requêtes. */
const MAX_PAGES = 4

/** Titres d'un album, dans l'ordre des disques et des pistes. Rien n'est conservé en base. */
export async function fetchAlbumTracks(env: Env, token: string, albumId: string): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await spotifyFetch(env, `/albums/${albumId}/tracks?limit=${PAGE}&offset=${page * PAGE}`, {}, token)
    if (!res.ok) throw await spotifyError(res)
    const { items = [] } = await res.json<{ items?: SpotifyTrack[] }>()
    tracks.push(...items)
    if (items.length < PAGE) break
  }
  return tracks
}
