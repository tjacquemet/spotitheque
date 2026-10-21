import { useState } from 'react'
import type { SpotifyStatus } from '../../shared/api'
import { ApiError } from '../api'
import { type AlbumPlayback, useAlbumPlayback } from '../hooks/useAlbumPlayback'
import { useAlbumTracks } from '../hooks/useAlbumTracks'
import { isPhone, spotifyAlbumUrl } from '../lib/device'
import { formatDayPhrase, formatTotalDuration, plural } from '../lib/text'
import type { Album, Tag } from '../lib/types'
import { applyTags, deleteAlbums, removeFromSpotify, setAlbumsHidden, useLibrary } from '../store'
import { toast, toastError } from '../toast'
import { AlbumCover } from './AlbumCover'
import { DiceIcon, ExternalIcon, EyeIcon, EyeOffIcon, QueueIcon, SpeakerIcon, TrashIcon } from './Icons'
import { Sheet } from './Sheet'
import { TagChip } from './TagChip'
import { TagPicker } from './TagPicker'
import { TrackList } from './TrackList'

const EMPTY = new Set<number>()

function PlayControls({ album, playback }: { album: Album; playback: AlbumPlayback }) {
  const { connected, devices, target, choice, setChoice, busy, mustOpen, queue, openSpotify } = playback

  return (
    <div className="play-block">
      {mustOpen ? (
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => openSpotify()}>
          <ExternalIcon /> Ouvrir Spotify pour écouter
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => void queue()} disabled={busy}>
          <QueueIcon /> {busy ? 'Ajout…' : 'Ajouter à la file'}
        </button>
      )}
      {connected && (
        <label className="device-line">
          <SpeakerIcon size={16} />
          <span className="sr-only">Appareil</span>
          <select value={choice ?? ''} onChange={(e) => setChoice(e.target.value || null)}>
            <option value="">
              {devices === null
                ? 'Recherche des appareils…'
                : target
                  ? `Automatique : ${target.name}`
                  : isPhone
                    ? 'Automatique : Spotify va s’ouvrir'
                    : 'Aucun appareil disponible'}
            </option>
            {devices
              ?.filter((d) => !d.isRestricted)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isActive ? ' (en cours)' : ''}
                </option>
              ))}
          </select>
        </label>
      )}
      <a className="link-subtle" href={spotifyAlbumUrl(album.id)} target={isPhone ? undefined : '_blank'} rel="noreferrer">
        <ExternalIcon size={15} /> Ouvrir dans Spotify
      </a>
    </div>
  )
}

interface AlbumSheetProps {
  album: Album
  spotify: SpotifyStatus | null
  onClose: () => void
  /** Présent si la fiche a été ouverte par « Surprends-moi ». */
  onAnother?: () => void
}

export function AlbumSheet({ album, spotify, onClose, onAnother }: AlbumSheetProps) {
  const data = useLibrary((s) => s.data)
  const playback = useAlbumPlayback(album.id, spotify)
  const { tracks, failed: tracksFailed } = useAlbumTracks(album.id, spotify)
  const albumTags = data?.links.get(album.id) ?? EMPTY
  // Les tags posés d'un côté, ceux qui restent à poser de l'autre : la liste des tags est déjà classée.
  const assigned = data?.tags.filter((t) => albumTags.has(t.id)) ?? []
  const available = data?.tags.filter((t) => !albumTags.has(t.id)) ?? []
  const added = formatDayPhrase(album.addedAt)
  const played = formatDayPhrase(album.lastPlayedAt)
  // La durée n'apparaît qu'une fois les titres arrivés : elle se calcule à partir d'eux.
  const totalMs = tracks?.reduce((sum, [, , , durationMs]) => sum + durationMs, 0) ?? 0
  const meta = [
    album.year,
    album.totalTracks ? plural(album.totalTracks, 'titre', 'titres') : null,
    totalMs > 0 ? formatTotalDuration(totalMs) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const toggle = (tag: Tag) => {
    const has = albumTags.has(tag.id)
    applyTags([album.id], has ? [] : [tag.id], has ? [tag.id] : []).catch(toastError)
  }

  const remove = () => {
    const ok = window.confirm(
      `Supprimer « ${album.name} » de Spotithèque ? Ses tags seront perdus. L'album n'est plus dans ta bibliothèque Spotify, rien n'y sera modifié.`,
    )
    if (!ok) return
    deleteAlbums([album.id]).catch(toastError)
    toast(`« ${album.name} » supprimé de Spotithèque`)
    onClose()
  }

  // Masquer fait disparaître l'album de la grille : on referme la fiche, l'annulation reste à portée.
  const hide = () => {
    setAlbumsHidden([album.id], true).catch(toastError)
    toast(`« ${album.name} » masqué`, {
      action: { label: 'Annuler', run: () => void setAlbumsHidden([album.id], false).catch(toastError) },
    })
    onClose()
  }

  const unhide = () => {
    setAlbumsHidden([album.id], false).catch(toastError)
    toast(`« ${album.name} » de nouveau affiché`)
  }

  const [removing, setRemoving] = useState(false)
  const removeSpotify = () => {
    const ok = window.confirm(
      `Retirer « ${album.name} » de ta bibliothèque Spotify ? Il sera aussi supprimé de Spotithèque, avec ses tags. Tu pourras le resauvegarder dans Spotify, mais ses tags seront perdus.`,
    )
    if (!ok) return
    setRemoving(true)
    removeFromSpotify(album.id)
      .then(() => {
        toast(`« ${album.name} » retiré de Spotify`)
        onClose()
      })
      .catch((err) => {
        setRemoving(false)
        if (err instanceof ApiError && err.code === 'spotify_scope') {
          // Autorisation ajoutée après la connexion initiale : un passage par Spotify suffit.
          toast(err.message, {
            tone: 'error',
            duration: 12_000,
            action: { label: 'Autoriser', run: () => window.location.assign('/api/auth/login') },
          })
        } else {
          toastError(err)
        }
      })
  }

  return (
    <Sheet onClose={onClose} label={album.name}>
      <div className="album-head">
        <div className="cover cover-large">
          <AlbumCover album={album} large />
        </div>
        <div>
          <h2 className="album-title">{album.name}</h2>
          <p className="album-artist">{album.artistNames}</p>
          {meta && <p className="album-meta">{meta}</p>}
          {added && <p className="album-meta">Ajouté {added}</p>}
          {played && <p className="album-meta">Écouté {played}</p>}
          {!album.inLibrary && <p className="album-meta warn">Retiré de ta bibliothèque Spotify</p>}
          {album.hidden && <p className="album-meta warn">Masqué dans Spotithèque</p>}
        </div>
      </div>

      <PlayControls album={album} playback={playback} />

      {onAnother && (
        <button type="button" className="btn btn-block another" onClick={onAnother}>
          <DiceIcon /> Un autre
        </button>
      )}

      <h3 className="section-title">Tags</h3>
      {assigned.length > 0 ? (
        <div className="chips-wrap">
          {assigned.map((tag) => (
            <TagChip
              key={tag.id}
              label={tag.name}
              color={tag.color}
              state="on"
              onClick={() => toggle(tag)}
              title={`Retirer « ${tag.name} »`}
            />
          ))}
        </div>
      ) : (
        <p className="hint">Aucun tag sur cet album.</p>
      )}

      <h3 className="section-title">Titres</h3>
      <TrackList
        tracks={tracks}
        failed={tracksFailed}
        spotify={spotify}
        albumArtists={album.artistNames}
        onPlay={(position) => void playback.play(position)}
      />

      <h3 className="section-title">Ajouter un tag</h3>
      {data && (
        <TagPicker
          tags={available}
          alreadyOn={assigned}
          stateOf={() => 'off'}
          onToggle={toggle}
          onCreated={(tag) => applyTags([album.id], [tag.id], []).catch(toastError)}
        />
      )}

      <div className="album-actions danger-zone">
        {/* Masquer n'a de sens que pour un album encore affiché dans la bibliothèque, ou déjà masqué. */}
        {album.hidden ? (
          <button type="button" className="btn btn-block" onClick={unhide}>
            <EyeIcon size={18} /> Réafficher dans Spotithèque
          </button>
        ) : (
          album.inLibrary && (
            <button type="button" className="btn btn-block" onClick={hide}>
              <EyeOffIcon size={18} /> Masquer dans Spotithèque
            </button>
          )
        )}
        {album.inLibrary ? (
          <button type="button" className="btn btn-danger btn-block" onClick={removeSpotify} disabled={removing}>
            <TrashIcon size={18} /> {removing ? 'Retrait en cours…' : 'Retirer de Spotify'}
          </button>
        ) : (
          <button type="button" className="btn btn-danger btn-block" onClick={remove}>
            <TrashIcon size={18} /> Supprimer de Spotithèque
          </button>
        )}
      </div>
    </Sheet>
  )
}
