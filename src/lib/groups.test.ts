import { describe, expect, it } from 'vitest'
import { tagGroupLabel } from './groups'
import type { Tag } from './types'

const tag = (name: string, extra: Partial<Tag> = {}): Tag => ({
  id: name.length,
  name,
  color: '#ffffff',
  isGenre: false,
  isPinned: false,
  ...extra,
})

const labels = (tags: Tag[]) => tags.map((_, i) => tagGroupLabel(tags, i))

describe('tagGroupLabel', () => {
  it("n'annonce pas les tags ordinaires quand ils ouvrent la liste", () => {
    expect(labels([tag('Chill'), tag('Sunny')])).toEqual([null, null])
  })

  it('annonce chaque groupe une seule fois, dans l’ordre', () => {
    const tags = [
      tag('A écouter', { isPinned: true }),
      tag('All time favorites', { isPinned: true }),
      tag('Chill'),
      tag('Techno', { isGenre: true }),
      tag('House', { isGenre: true }),
    ]
    expect(labels(tags)).toEqual(['Épinglés', null, 'Autres', 'Genres', null])
  })

  it('passe le groupe absent sans laisser de trou', () => {
    const tags = [tag('A écouter', { isPinned: true }), tag('Techno', { isGenre: true })]
    expect(labels(tags)).toEqual(['Épinglés', 'Genres'])
  })

  it('garde le comportement actuel quand aucun tag n’est épinglé', () => {
    const tags = [tag('Chill'), tag('Techno', { isGenre: true })]
    expect(labels(tags)).toEqual([null, 'Genres'])
  })
})
