// File de lecture Spotify : la boucle d'appels et ce qu'on en dit, hors du hook qui s'occupe des appareils.
// Tout passe par la file, même quand rien ne joue : un album ajouté plus tard se range à la fin
// au lieu de s'insérer au milieu de celui en cours.

import type { ClearQueueResult } from '../../shared/api'
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
 * Ce qui est parti dans la file. Quand la lecture démarre, le premier titre joue déjà :
 * les suivants seuls sont « à la suite ».
 */
export function queueMessage(started: boolean, added: number, device: string): string {
  const appareil = `sur ${device}`
  const suite = added > 1 ? ` · ${plural(added - 1, 'titre à la suite', 'titres à la suite')}` : ''
  return started
    ? `Lecture lancée ${appareil}${suite}`
    : `${plural(added, 'titre ajouté', 'titres ajoutés')} à la file ${appareil}`
}

/**
 * Ce que le vidage a donné. Spotify ne sachant pas vider une file, le Worker relance ce qui joue et
 * relit la file : le message dit ce qui a été constaté, jamais ce qui était espéré.
 */
export function clearMessage(result: ClearQueueResult): { text: string; ok: boolean } {
  if (result.status === 'nothing_playing') return { text: "Rien ne joue : il n'y a pas de file à vider.", ok: false }
  if (result.status === 'unchanged') {
    const reste = result.after === null ? '' : ` (${plural(result.after, 'titre toujours en attente', 'titres toujours en attente')})`
    return { text: `Spotify n'a pas vidé la file${reste}.`, ok: false }
  }
  if (result.before === 0) return { text: 'La file était déjà vide.', ok: true }
  const retires = result.before !== null && result.after !== null ? result.before - result.after : null
  return { text: retires === null ? 'File vidée.' : `File vidée · ${plural(retires, 'titre retiré', 'titres retirés')}`, ok: true }
}

/** Vide la file de lecture, puis annonce ce que Spotify a réellement fait. */
export async function clearQueue(connected: boolean): Promise<void> {
  if (!connected) {
    toast('Connecte Spotify pour utiliser la file de lecture.', { tone: 'error' })
    return
  }
  try {
    const { text, ok } = clearMessage(await api.clearQueue())
    toast(text, ok ? {} : { tone: 'error', duration: 6000 })
  } catch (err) {
    toastError(err)
  }
}

export interface QueueOptions {
  connected: boolean
  /** Appareil imposé ; sinon le serveur reprend celui qui joue, ou celui du même type que l'écran. */
  deviceId?: string | null
}

/**
 * Empile les titres de l'album dans la file de Spotify et annonce le résultat.
 * Un appel par lot de titres : le Worker est borné en sous-requêtes, pas les coffrets.
 */
export async function queueAlbum(albumId: string, { connected, deviceId = null }: QueueOptions): Promise<void> {
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
      toast(queueMessage(started, added, result.device.name))
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
