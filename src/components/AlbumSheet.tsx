import { useEffect, useState } from 'react'
import type { Device, SpotifyStatus } from '../../shared/api'
import { pickDevice } from '../../shared/devices'
import { api } from '../api'
import { clientKind, isPhone, spotifyAlbumUrl } from '../lib/device'
import { formatDate, plural } from '../lib/text'
import type { Album, Tag } from '../lib/types'
import { applyTags, useLibrary } from '../store'
import { toast, toastError } from '../toast'
import { AlbumCover } from './AlbumCover'
import { DiceIcon, ExternalIcon, PlayIcon, SpeakerIcon } from './Icons'
import { Sheet } from './Sheet'
import { TagPicker } from './TagPicker'

const EMPTY = new Set<number>()
const NO_DEVICE_MESSAGE = 'Aucun appareil Spotify disponible : ouvre Spotify sur un appareil, puis réessaie.'

function PlayControls({ album, spotify }: { album: Album; spotify: SpotifyStatus | null }) {
  const connected = spotify === 'connected'
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mustOpen, setMustOpen] = useState(false)

  // Liste des appareils rafraîchie tant que la fiche est ouverte : au moment du geste, on sait s'il faut ouvrir Spotify.
  useEffect(() => {
    if (!connected) return
    let alive = true
    const load = () =>
      api
        .devices()
        .then((r) => alive && setDevices(r.devices))
        .catch(() => alive && setDevices([]))
    void load()
    const timer = setInterval(load, 10_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [connected])

  const target = devices ? pickDevice(devices, { deviceId: choice, clientKind }) : null

  /** Ouvre l'album dans l'appli Spotify ; le serveur lancera la lecture dès que le téléphone sera connecté. */
  const openSpotify = () => {
    if (connected && isPhone) void api.playWhenReady(album.id).catch(() => undefined)
    window.location.href = spotifyAlbumUrl(album.id)
  }

  const play = async () => {
    setMustOpen(false)
    if (!connected) {
      openSpotify()
      return
    }
    if (devices && !target) {
      // Rien à piloter : sur l'iPhone, on ouvre Spotify dans le même geste (sinon iOS peut bloquer l'ouverture).
      if (isPhone) {
        toast('Ouverture de Spotify…')
        openSpotify()
      } else {
        toast(NO_DEVICE_MESSAGE, { tone: 'error' })
      }
      return
    }
    setBusy(true)
    try {
      const result = await api.play(album.id, target?.id ?? null, clientKind)
      if (result.status === 'playing') toast(`Lecture sur ${result.device.name}`)
      else if (isPhone) setMustOpen(true)
      else toast(NO_DEVICE_MESSAGE, { tone: 'error' })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="play-block">
      {mustOpen ? (
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={openSpotify}>
          <ExternalIcon /> Ouvrir Spotify pour écouter
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={play} disabled={busy}>
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
  const albumTags = data?.links.get(album.id) ?? EMPTY
  const added = formatDate(album.addedAt)
  const meta = [album.year, album.totalTracks ? plural(album.totalTracks, 'titre', 'titres') : null].filter(Boolean).join(' · ')

  const toggle = (tag: Tag) => {
    const has = albumTags.has(tag.id)
    applyTags([album.id], has ? [] : [tag.id], has ? [tag.id] : []).catch(toastError)
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
          {!album.inLibrary && <p className="album-meta warn">Retiré de ta bibliothèque Spotify</p>}
        </div>
      </div>

      <PlayControls key={album.id} album={album} spotify={spotify} />

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
    </Sheet>
  )
}
