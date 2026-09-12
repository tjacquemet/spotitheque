import { compareText, normalize } from './text'
import type { Album, Filters, SortKey } from './types'

const NO_TAGS: ReadonlySet<number> = new Set()

/** Albums correspondant aux filtres (recherche, tags inclus/exclus, filtres spéciaux). */
export function filterAlbums(albums: Album[], links: Map<string, Set<number>>, f: Filters): Album[] {
  const words = normalize(f.query).split(/\s+/).filter(Boolean)
  return albums.filter((album) => {
    if (album.inLibrary === f.removed) return false
    const tags = links.get(album.id) ?? NO_TAGS
    // « Sans tag » seul : aucun tag. Combiné à des tags : aucun tag en dehors de ceux demandés.
    if (f.untagged) {
      for (const tagId of tags) if (!f.include.includes(tagId)) return false
    }
    if (f.include.length > 0) {
      const ok = f.mode === 'and' ? f.include.every((t) => tags.has(t)) : f.include.some((t) => tags.has(t))
      if (!ok) return false
    }
    if (f.exclude.some((t) => tags.has(t))) return false
    return words.every((w) => album.searchText.includes(w))
  })
}

export function hasActiveFilters(f: Filters): boolean {
  return f.query.trim() !== '' || f.include.length > 0 || f.exclude.length > 0 || f.untagged || f.removed
}

/** Hash stable (FNV-1a) : l'ordre aléatoire reste le même tant que la graine ne change pas. */
function hash(s: string, seed: number): number {
  let h = 2166136261 ^ seed
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const firstArtist = (a: Album) => a.artists[0]?.name ?? ''

export function sortAlbums(albums: Album[], sort: SortKey, seed = 0): Album[] {
  const list = [...albums]
  switch (sort) {
    // Écoutes les plus récentes d'abord ; les albums jamais relevés ferment la marche.
    case 'played':
      return list.sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '') || (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    case 'added':
      return list.sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    case 'artist':
      return list.sort(
        (a, b) => compareText(firstArtist(a), firstArtist(b)) || (a.year ?? 0) - (b.year ?? 0) || compareText(a.name, b.name),
      )
    case 'title':
      return list.sort((a, b) => compareText(a.name, b.name))
    case 'year':
      return list.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || compareText(a.name, b.name))
    case 'random': {
      const keys = new Map(list.map((a) => [a.id, hash(a.id, seed)]))
      return list.sort((a, b) => keys.get(a.id)! - keys.get(b.id)!)
    }
  }
}

/** Nombre d'albums portant chaque tag parmi `albums`. */
export function countTags(albums: Album[], links: Map<string, Set<number>>): Map<number, number> {
  const counts = new Map<number, number>()
  for (const album of albums) {
    for (const tag of links.get(album.id) ?? NO_TAGS) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return counts
}
