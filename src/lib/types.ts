import type { ArtistRef } from '../../shared/api'

export interface Album {
  id: string
  name: string
  artists: ArtistRef[]
  artistNames: string
  image: string | null
  imageLarge: string | null
  releaseDate: string | null
  year: number | null
  totalTracks: number | null
  addedAt: string | null
  inLibrary: boolean
  /** Titre + artistes normalisés, pour la recherche. */
  searchText: string
}

export interface Tag {
  id: number
  name: string
  color: string
}

export interface LibraryData {
  version: number
  albums: Album[]
  albumsById: Map<string, Album>
  tags: Tag[]
  tagsById: Map<number, Tag>
  /** albumId → identifiants des tags posés sur l'album. */
  links: Map<string, Set<number>>
}

export type SortKey = 'added' | 'artist' | 'title' | 'year' | 'random'

export interface Filters {
  query: string
  include: number[]
  exclude: number[]
  mode: 'and' | 'or'
  untagged: boolean
  removed: boolean
}

export const EMPTY_FILTERS: Filters = { query: '', include: [], exclude: [], mode: 'and', untagged: false, removed: false }
