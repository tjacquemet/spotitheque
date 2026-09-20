import { useEffect, useState } from 'react'
import type { SpotifyStatus, TrackRow } from '../../shared/api'
import { api } from '../api'

export interface AlbumTracks {
  /** null tant que les titres ne sont pas arrivés. */
  tracks: TrackRow[] | null
  failed: boolean
}

/**
 * Titres de l'album, demandés à Spotify à l'ouverture de la fiche et gardés le temps de la session.
 * Un seul chargement par fiche : la liste et la durée totale lisent le même résultat.
 */
export function useAlbumTracks(albumId: string, spotify: SpotifyStatus | null): AlbumTracks {
  const [tracks, setTracks] = useState<TrackRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (spotify !== 'connected') return
    let alive = true
    setTracks(null)
    setFailed(false)
    api
      .albumTracks(albumId)
      .then((r) => alive && setTracks(r.tracks))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [albumId, spotify])

  return { tracks, failed }
}
