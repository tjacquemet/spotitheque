import { describe, expect, it } from 'vitest'
import { countTags, filterAlbums, hasActiveFilters, sortAlbums } from './filter'
import { normalize } from './text'
import { EMPTY_FILTERS, type Album } from './types'

function album(id: string, name: string, artist: string, extra: Partial<Album> = {}): Album {
  return {
    id,
    name,
    artists: [{ id: `ar-${artist}`, name: artist }],
    artistNames: artist,
    image: null,
    imageLarge: null,
    releaseDate: null,
    year: null,
    totalTracks: null,
    addedAt: null,
    inLibrary: true,
    searchText: normalize(`${name} ${artist}`),
    ...extra,
  }
}

const JAZZ = 1
const CALME = 2
const ROCK = 3

const albums = [
  album('a', 'Kind of Blue', 'Miles Davis', { addedAt: '2024-01-01T00:00:00Z', releaseDate: '1959-08-17', year: 1959 }),
  album('b', 'Vespertine', 'Björk', { addedAt: '2024-03-01T00:00:00Z', releaseDate: '2001-08-27', year: 2001 }),
  album('c', 'Nevermind', 'Nirvana', { addedAt: '2024-02-01T00:00:00Z', releaseDate: '1991-09-24', year: 1991 }),
  album('d', 'Blue Train', 'John Coltrane', { addedAt: '2023-12-01T00:00:00Z', releaseDate: '1958-01-01', year: 1958 }),
  album('e', 'Album retiré', 'Quelqu’un', { inLibrary: false }),
]

const links = new Map<string, Set<number>>([
  ['a', new Set([JAZZ, CALME])],
  ['b', new Set([CALME])],
  ['c', new Set([ROCK])],
  ['e', new Set([JAZZ])],
])

const ids = (list: Album[]) => list.map((a) => a.id)

describe('filterAlbums', () => {
  it('ne montre que les albums de la bibliothèque par défaut', () => {
    expect(ids(filterAlbums(albums, links, EMPTY_FILTERS))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('montre uniquement les albums retirés avec le filtre dédié', () => {
    expect(ids(filterAlbums(albums, links, { ...EMPTY_FILTERS, removed: true }))).toEqual(['e'])
  })

  it('filtre les albums sans tag', () => {
    expect(ids(filterAlbums(albums, links, { ...EMPTY_FILTERS, untagged: true }))).toEqual(['d'])
  })

  it('combine les tags inclus en ET par défaut', () => {
    expect(ids(filterAlbums(albums, links, { ...EMPTY_FILTERS, include: [JAZZ, CALME] }))).toEqual(['a'])
  })

  it('combine les tags inclus en OU sur demande', () => {
    expect(ids(filterAlbums(albums, links, { ...EMPTY_FILTERS, include: [JAZZ, ROCK], mode: 'or' }))).toEqual(['a', 'c'])
  })

  it('exclut les albums portant un tag exclu', () => {
    expect(ids(filterAlbums(albums, links, { ...EMPTY_FILTERS, include: [CALME], exclude: [JAZZ] }))).toEqual(['b'])
  })

  it('cherche sans tenir compte des accents ni des majuscules, mot par mot', () => {
    expect(ids(filterAlbums(albums, links, { ...EMPTY_FILTERS, query: 'bjork' }))).toEqual(['b'])
    expect(ids(filterAlbums(albums, links, { ...EMPTY_FILTERS, query: 'blue  COLTRANE' }))).toEqual(['d'])
  })
})

describe('sortAlbums', () => {
  const inLibrary = albums.filter((a) => a.inLibrary)

  it('trie par date d’ajout, plus récents d’abord', () => {
    expect(ids(sortAlbums(inLibrary, 'added'))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('trie par artiste sans tenir compte des accents', () => {
    expect(ids(sortAlbums(inLibrary, 'artist'))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('trie par année de sortie, plus récentes d’abord', () => {
    expect(ids(sortAlbums(inLibrary, 'year'))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('garde le même ordre aléatoire pour une même graine', () => {
    const first = ids(sortAlbums(inLibrary, 'random', 42))
    expect(ids(sortAlbums(inLibrary, 'random', 42))).toEqual(first)
    expect([...first].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('countTags', () => {
  it('compte les albums par tag dans la liste donnée', () => {
    const counts = countTags(albums.filter((a) => a.inLibrary), links)
    expect(counts.get(JAZZ)).toBe(1)
    expect(counts.get(CALME)).toBe(2)
    expect(counts.get(ROCK)).toBe(1)
  })
})

describe('hasActiveFilters', () => {
  it('ignore une recherche vide ou faite d’espaces', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: '   ' })).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, exclude: [1] })).toBe(true)
  })
})
