import type { SpotifyStatus } from '../../shared/api'
import { type AlbumPlayback, useAlbumPlayback } from '../hooks/useAlbumPlayback'
import { isPhone, spotifyAlbumUrl } from '../lib/device'
import { formatDate, plural } from '../lib/text'
import type { Album, Tag } from '../lib/types'
import { applyTags, deleteAlbums, useLibrary } from '../store'
import { toast, toastError } from '../toast'
import { AlbumCover } from './AlbumCover'
import { DiceIcon, ExternalIcon, PlayIcon, SpeakerIcon, TrashIcon } from './Icons'
import { Sheet } from './Sheet'
import { TagPicker } from './TagPicker'
import { TrackList } from './TrackList'

const EMPTY = new Set<number>()

function PlayControls({ album, playback }: { album: Album; playback: AlbumPlayback }) {
  const { connected, devices, target, choice, setChoice, busy, mustOpen, play, openSpotify } = playback

  return (
    <div className="play-block">
      {mustOpen ? (
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => openSpotify()}>
          <ExternalIcon /> Ouvrir Spotify pour écouter
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => void play()} disabled={busy}>
          <PlayIcon /> {busy ? 'Lancement…' : 'Écouter'}
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
  const albumTags = data?.links.get(album.id) ?? EMPTY
  const added = formatDate(album.addedAt)
  const played = formatDate(album.lastPlayedAt)
  const meta = [album.year, album.totalTracks ? plural(album.totalTracks, 'titre', 'titres') : null].filter(Boolean).join(' · ')

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
          {added && <p className="album-meta">Ajouté le {added}</p>}
          {played && <p className="album-meta">Écouté le {played}</p>}
          {!album.inLibrary && <p className="album-meta warn">Retiré de ta bibliothèque Spotify</p>}
        </div>
      </div>

      <PlayControls album={album} playback={playback} />

      {onAnother && (
        <button type="button" className="btn btn-block another" onClick={onAnother}>
          <DiceIcon /> Un autre
        </button>
      )}

      <h3 className="section-title">Tags</h3>
      {data && (
        <TagPicker
          tags={data.tags}
          stateOf={(tag) => (albumTags.has(tag.id) ? 'on' : 'off')}
          onToggle={toggle}
          onCreated={(tag) => applyTags([album.id], [tag.id], []).catch(toastError)}
        />
      )}

      <h3 className="section-title">Titres</h3>
      <TrackList
        albumId={album.id}
        spotify={spotify}
        albumArtists={album.artistNames}
        onPlay={(position) => void playback.play(position)}
      />

      {!album.inLibrary && (
        <button type="button" className="btn btn-danger btn-block danger-zone" onClick={remove}>
          <TrashIcon size={18} /> Supprimer de Spotithèque
        </button>
      )}
    </Sheet>
  )
}
