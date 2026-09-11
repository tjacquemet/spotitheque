import { describe, expect, it } from 'vitest'
import { ApiError } from './errors'
import { parseSyncAlbum, parseTagId, parseTagName } from './validate'

const valid = {
  id: '1weenld61qoidwYuZ1GESA',
  name: 'Kind of Blue',
  artists: [{ id: '0kbYTNQb4Pb1rPbbaF0pT4', name: 'Miles Davis' }],
  image: 'https://i.scdn.co/300',
  imageLarge: 'https://i.scdn.co/640',
  releaseDate: '1959-08-17',
  totalTracks: 5,
  upc: '074646393523',
  addedAt: '2024-05-01T10:00:00Z',
}

describe('parseSyncAlbum', () => {
  it('accepte un album complet', () => {
    expect(parseSyncAlbum(valid)).toEqual(valid)
  })

  it('refuse un identifiant ou une image suspects', () => {
    expect(() => parseSyncAlbum({ ...valid, id: "1'; DROP TABLE albums" })).toThrow(ApiError)
    expect(() => parseSyncAlbum({ ...valid, image: 'javascript:alert(1)' })).toThrow(ApiError)
    expect(() => parseSyncAlbum({ ...valid, artists: 'Miles' })).toThrow(ApiError)
  })

  it('normalise les champs facultatifs absents à null', () => {
    const { image: _i, imageLarge: _l, upc: _u, ...rest } = valid
    const parsed = parseSyncAlbum(rest)
    expect(parsed.image).toBeNull()
    expect(parsed.upc).toBeNull()
  })
})

describe('parseTagName', () => {
  it("normalise les espaces et produit une clé insensible à la casse, accents compris", () => {
    expect(parseTagName('  Été   indien ')).toEqual({ name: 'Été indien', key: 'été indien' })
  })

  it('refuse un nom vide ou trop long', () => {
    expect(() => parseTagName('   ')).toThrow(ApiError)
    expect(() => parseTagName('x'.repeat(41))).toThrow(ApiError)
  })
})

describe('parseTagId', () => {
  it("accepte l'identifiant venant de l'URL", () => {
    expect(parseTagId('12')).toBe(12)
    expect(() => parseTagId('abc')).toThrow(ApiError)
    expect(() => parseTagId(0)).toThrow(ApiError)
  })
})
