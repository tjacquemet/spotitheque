import type { SyncAlbum } from './api'

// Conversion d'un album Spotify vers les champs conservés par Spotithèque,
// partagée entre le navigateur (synchro complète) et le Worker (synchro quotidienne).

export interface SpotifySavedAlbum {
  added_at?: string
  album: {
    id: string
    name: string
    artists?: { id?: string; name: string }[]
    images?: { url: string; width: number | null }[]
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

/** Respecte les règles de validation du serveur : un album mal formé ne doit pas faire échouer tout un lot. */
export function toSyncAlbum(item: SpotifySavedAlbum): SyncAlbum {
  const album = item.album
  const images = [...(album.images ?? [])]
    .filter((i) => i.url?.startsWith('https://') && i.url.length <= 500)
    .sort((x, y) => (x.width ?? 0) - (y.width ?? 0))
  const pick = (minWidth: number) => images.find((i) => (i.width ?? 0) >= minWidth)?.url ?? images.at(-1)?.url ?? null
  const artists = (album.artists ?? [])
    .filter((artist) => artist.name)
    .slice(0, 50)
    .map((artist) => ({ id: (artist.id ?? '').slice(0, 64), name: artist.name.slice(0, 300) }))
  const upc = album.external_ids?.upc
  return {
    id: album.id,
    name: (album.name || 'Sans titre').slice(0, 500),
    artists: artists.length > 0 ? artists : [{ id: '', name: 'Artiste inconnu' }],
    image: pick(300),
    imageLarge: pick(600),
    releaseDate: album.release_date?.slice(0, 10) || null,
    totalTracks: Number.isInteger(album.total_tracks) ? (album.total_tracks as number) : null,
    upc: upc && upc.length <= 32 ? upc : null,
    addedAt: item.added_at?.slice(0, 40) || null,
  }
}
