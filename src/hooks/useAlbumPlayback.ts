import { useEffect, useState } from 'react'
import type { Device, SpotifyStatus } from '../../shared/api'
import { pickDevice } from '../../shared/devices'
import { api } from '../api'
import { clientKind, isPhone, spotifyAlbumUrl } from '../lib/device'
import { plural } from '../lib/text'
import { toast, toastError } from '../toast'

export const NO_DEVICE_MESSAGE = 'Aucun appareil Spotify disponible : ouvre Spotify sur un appareil, puis réessaie.'

export interface AlbumPlayback {
  connected: boolean
  /** null tant que la liste des appareils n'est pas connue. */
  devices: Device[] | null
  target: Device | null
  choice: string | null
  setChoice: (id: string | null) => void
  busy: boolean
  /** Empile l'album dans la file de lecture de Spotify, sans interrompre ce qui joue. */
  queue: () => Promise<void>
  /** Spotify était fermé : il reste à l'ouvrir à la main. */
  mustOpen: boolean
  play: (trackPosition?: number) => Promise<void>
  openSpotify: (trackPosition?: number) => void
}

/**
 * Lecture d'un album : appareils disponibles, appareil visé, démarrage à la piste voulue.
 * Un seul exemplaire par fiche — c'est lui qui interroge Spotify toutes les dix secondes.
 */
export function useAlbumPlayback(albumId: string, spotify: SpotifyStatus | null): AlbumPlayback {
  const connected = spotify === 'connected'
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mustOpen, setMustOpen] = useState(false)

  // Liste rafraîchie tant que la fiche est ouverte : au moment du geste, on sait s'il faut ouvrir Spotify.
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
  const openSpotify = (trackPosition = 0) => {
    if (connected && isPhone) void api.playWhenReady(albumId, trackPosition).catch(() => undefined)
    window.location.href = spotifyAlbumUrl(albumId)
  }

  const queue = async () => {
    if (!connected) {
      toast('Connecte Spotify pour utiliser la file de lecture.', { tone: 'error' })
      return
    }
    setBusy(true)
    try {
      const result = await api.queueAlbum(albumId, choice, clientKind)
      if (result.status === 'queued') {
        const reste = result.queued < result.total ? ` (sur ${result.total})` : ''
        toast(`${plural(result.queued, 'titre ajouté', 'titres ajoutés')} à la file sur ${result.device.name}${reste}`)
      } else if (result.status === 'playing') {
        toast(`Rien ne jouait : lecture lancée sur ${result.device.name}`)
      } else if (result.status === 'no_device' && isPhone) {
        // Spotify est fermé sur le téléphone : on l'ouvre dans le même geste, la lecture suivra.
        toast('Ouverture de Spotify…')
        openSpotify()
      } else if (result.status === 'no_playback') {
        toast("Spotify n'a pas pu lancer la lecture sur cet appareil : ouvre Spotify, puis réessaie.", {
          tone: 'error',
          duration: 8000,
        })
      } else {
        toast(NO_DEVICE_MESSAGE, { tone: 'error' })
      }
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const play = async (trackPosition = 0) => {
    setMustOpen(false)
    if (!connected) {
      openSpotify(trackPosition)
      return
    }
    if (devices && !target) {
      // Rien à piloter : sur l'iPhone, on ouvre Spotify dans le même geste (sinon iOS peut bloquer l'ouverture).
      if (isPhone) {
        toast('Ouverture de Spotify…')
        openSpotify(trackPosition)
      } else {
        toast(NO_DEVICE_MESSAGE, { tone: 'error' })
      }
      return
    }
    setBusy(true)
    try {
      const result = await api.play(albumId, target?.id ?? null, clientKind, trackPosition)
      if (result.status === 'playing') toast(`Lecture sur ${result.device.name}`)
      else if (isPhone) setMustOpen(true)
      else toast(NO_DEVICE_MESSAGE, { tone: 'error' })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return { connected, devices, target, choice, setChoice, busy, mustOpen, play, queue, openSpotify }
}
