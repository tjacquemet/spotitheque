import { Fragment, useEffect, useState } from 'react'
import type { SpotifyStatus, TrackRow } from '../../shared/api'
import { api } from '../api'
import { formatDuration } from '../lib/text'
import { PlayIcon } from './Icons'

interface TrackListProps {
  albumId: string
  spotify: SpotifyStatus | null
  /** Artistes de l'album : ceux d'un morceau ne sont affichés que s'ils en diffèrent (compilations). */
  albumArtists: string
  onPlay: (trackPosition: number) => void
}

/**
 * Titres de l'album, demandés à Spotify à l'ouverture de la fiche et gardés le temps de la session.
 * Rien n'est conservé hors ligne : les tags portent sur les albums, pas sur les morceaux.
 */
export function TrackList({ albumId, spotify, albumArtists, onPlay }: TrackListProps) {
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

  if (spotify !== 'connected') {
    return <p className="hint">Les titres demandent une connexion à Spotify.</p>
  }
  if (failed) return <p className="hint">Titres indisponibles pour le moment.</p>
  if (!tracks) return <p className="hint">Chargement des titres…</p>
  if (tracks.length === 0) return <p className="hint">Aucun titre.</p>

  const multiDisc = tracks.some(([, disc]) => disc > 1)

  return (
    <ol className="track-list">
      {tracks.map(([n, disc, name, durationMs, artists], index) => {
        const previousDisc = index > 0 ? tracks[index - 1][1] : 0
        return (
          <Fragment key={`${disc}-${n}-${name}`}>
            {multiDisc && disc !== previousDisc && <li className="track-disc">Disque {disc}</li>}
            <li>
              {/* Toute la ligne est cliquable : l'album démarre à ce morceau, puis continue dans l'ordre. */}
              <button type="button" className="track" onClick={() => onPlay(index)} title={`Écouter à partir de « ${name} »`}>
                {/* Le numéro laisse place au triangle de lecture au survol, sans décaler la ligne. */}
                <span className="track-mark" aria-hidden="true">
                  <span className="track-n">{n}</span>
                  <PlayIcon size={13} className="track-play" />
                </span>
                <span className="track-name">
                  {name}
                  {artists && artists !== albumArtists && <em className="track-artists">{artists}</em>}
                </span>
                <span className="track-time">{formatDuration(durationMs)}</span>
              </button>
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
