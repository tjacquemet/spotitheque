import { describe, expect, it } from 'vitest'
import { normalizeTagName, tagSortKey } from './tags'

describe('normalizeTagName', () => {
  it('réduit les espaces et produit une clé insensible à la casse', () => {
    expect(normalizeTagName('  Dimanche   matin ')).toEqual({ name: 'Dimanche matin', key: 'dimanche matin' })
  })

  it('gère les accents dans la clé', () => {
    expect(normalizeTagName('ÉTÉ').key).toBe('été')
  })
})

describe('tagSortKey', () => {
  it('ignore un emoji en début de nom', () => {
    expect(tagSortKey('🎷 jazz')).toBe('jazz')
    expect(tagSortKey('⭐️ à découvrir')).toBe('à découvrir')
    expect(tagSortKey('🇫🇷 chanson')).toBe('chanson')
  })

  it('laisse le nom intact quand il commence par une lettre ou un chiffre', () => {
    expect(tagSortKey('jazz')).toBe('jazz')
    expect(tagSortKey('70s')).toBe('70s')
  })

  it("garde le nom d'origine si le tag n'est fait que d'emojis", () => {
    expect(tagSortKey('🎸')).toBe('🎸')
  })

  it('range les tags décorés à leur place alphabétique', () => {
    const names = ['🎷 jazz', 'calme', '⭐️ à découvrir', 'rock']
    const collator = new Intl.Collator('fr', { sensitivity: 'base' })
    expect([...names].sort((a, b) => collator.compare(tagSortKey(a), tagSortKey(b)))).toEqual([
      '⭐️ à découvrir',
      'calme',
      '🎷 jazz',
      'rock',
    ])
  })
})
