// Types échangés entre le Worker et l'interface.

export interface ArtistRef {
  id: string
  name: string
}

/** Album tel que le navigateur l'envoie au Worker lors d'une synchronisation. */
export interface SyncAlbum {
  id: string
  name: string
  artists: ArtistRef[]
  image: string | null
  imageLarge: string | null
  releaseDate: string | null
  totalTracks: number | null
  upc: string | null
  addedAt: string | null
}

/**
 * GET /api/library renvoie des tableaux compacts pour limiter la taille de la réponse.
 * Album : [id, name, artists, image, imageLarge, releaseDate, totalTracks, addedAt, inLibrary]
 */
export type AlbumRow = [
  id: string,
  name: string,
  artists: ArtistRef[],
  image: string | null,
  imageLarge: string | null,
  releaseDate: string | null,
  totalTracks: number | null,
  addedAt: string | null,
  inLibrary: 0 | 1,
]
export type TagRow = [id: number, name: string, color: string, isGenre: 0 | 1]
export type LinkRow = [albumId: string, tagId: number]

export interface LibraryPayload {
  version: number
  albums: AlbumRow[]
  tags: TagRow[]
  links: LinkRow[]
}

export type SpotifyStatus = 'connected' | 'reauth' | 'not_connected'

export interface MeResponse {
  spotify: SpotifyStatus
  displayName: string | null
  lastFullSync: string | null
}

export interface TagDto {
  id: number
  name: string
  color: string
  /** Tag de genre musical : classé en fin de liste, après les autres. */
  isGenre: boolean
}

/** Réponse des routes qui modifient les données : nouvelle version de la bibliothèque. */
export interface MutationResult {
  version: number
}

export interface Device {
  id: string
  name: string
  type: string
  isActive: boolean
  isRestricted: boolean
}

export type ClientKind = 'phone' | 'desktop'

export type PlayResult = { status: 'playing'; device: Device } | { status: 'no_device' }

export interface ApiErrorBody {
  error: { code: string; message: string }
}

/** Fichier de sauvegarde produit par GET /api/export et relu par POST /api/import. */
export interface ExportFile {
  app: 'spotitheque'
  format: 1
  exportedAt: string
  tags: { name: string; color: string; isGenre?: boolean }[]
  albums: (Omit<SyncAlbum, 'upc'> & { tags: string[] })[]
}
