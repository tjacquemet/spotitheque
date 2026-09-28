// File de lecture Spotify, partagée par la fiche d'un album et le tirage au sort de la bibliothèque.
// Tout passe par la file, même quand rien ne joue : un album ajouté plus tard se range à la fin
// au lieu de s'insérer au milieu de celui en cours.

import { api } from '../api'
import { toast, toastError } from '../toast'
import { clientKind, isPhone, spotifyAlbumUrl } from './device'
import { plural } from './text'

export const NO_DEVICE_MESSAGE = 'Aucun appareil Spotify disponible : ouvre Spotify sur un appareil, puis réessaie.'

/** Ouvre l'album dans l'appli Spotify ; le serveur lancera la lecture dès que le téléphone sera connecté. */
export function openSpotifyAlbum(albumId: string, connected: boolean, trackPosition = 0) {
  if (connected && isPhone) void api.playWhenReady(albumId, trackPosition).catch(() => undefined)
  window.location.href = spotifyAlbumUrl(albumId)
}

/**
 * Ce qui est parti dans la file. L'album n'est nommé que lorsqu'on ne l'a pas sous les yeux —
 * après un tirage au sort, savoir lequel a été lancé est tout l'intérêt du message.
 * Quand la lecture démarre, le premier titre joue déjà : les suivants seuls sont « à la suite ».
 */
export function queueMessage(started: boolean, added: number, device: string, albumName?: string): string {
  const appareil = `sur ${device}`
  const suite = added > 1 ? ` · ${plural(added - 1, 'titre à la suite', 'titres à la suite')}` : ''
  if (albumName) {
    return started
      ? `« ${albumName} » lancé ${appareil}${suite}`
      : `« ${albumName} » ajouté à la file ${appareil} · ${plural(added, 'titre', 'titres')}`
  }
  return started
    ? `Lecture lancée ${appareil}${suite}`
    : `${plural(added, 'titre ajouté', 'titres ajoutés')} à la file ${appareil}`
}

export interface QueueOptions {
  connected: boolean
  /** Appareil imposé ; sinon le serveur reprend celui qui joue, ou celui du même type que l'écran. */
  deviceId?: string | null
  /** Nom de l'album, à annoncer quand il n'est pas sous les yeux. */
  albumName?: string
}

/**
 * Empile les titres de l'album dans la file de Spotify et annonce le résultat.
 * Un appel par lot de titres : le Worker est borné en sous-requêtes, pas les coffrets.
 */
export async function queueAlbum(albumId: string, { connected, deviceId = null, albumName }: QueueOptions): Promise<void> {
  if (!connected) {
    toast('Connecte Spotify pour utiliser la file de lecture.', { tone: 'error' })
    return
  }
  try {
    let from = 0
    let added = 0
    let started = false
    let result = await api.queueAlbum(albumId, deviceId, clientKind, from)
    while ((result.status === 'queued' || result.status === 'started') && result.queued > 0) {
      added += result.queued
      started ||= result.status === 'started'
      from = result.from + result.queued
      if (from >= result.total) break
      result = await api.queueAlbum(albumId, deviceId, clientKind, from)
    }

    if (result.status === 'queued' || result.status === 'started') {
      toast(queueMessage(started, added, result.device.name, albumName))
    } else if (result.status === 'no_device' && isPhone) {
      // Spotify est fermé sur le téléphone : on l'ouvre dans le même geste, la lecture suivra.
      toast('Ouverture de Spotify…')
      openSpotifyAlbum(albumId, connected)
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
  }
}
