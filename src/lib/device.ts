import type { ClientKind } from '../../shared/api'

/** Téléphone (et non tablette ou ordinateur) : détermine l'appareil Spotify visé par défaut. */
export const clientKind: ClientKind =
  /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent) ? 'phone' : 'desktop'

export const isPhone = clientKind === 'phone'

/** Lien qui ouvre l'album dans l'appli Spotify (schéma spotify: sur téléphone, lecteur web sinon). */
export function spotifyAlbumUrl(albumId: string): string {
  return isPhone ? `spotify:album:${albumId}` : `https://open.spotify.com/album/${albumId}`
}
