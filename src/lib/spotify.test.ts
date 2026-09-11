import { describe, expect, it } from 'vitest'
import { isUnchanged, toSyncAlbum, type SpotifySavedAlbum } from './spotify'
import type { Album } from './types'

const item: SpotifySavedAlbum = {
  added_at: '2024-05-01T10:00:00Z',
  album: {
    id: '1weenld61qoidwYuZ1GESA',
    name: 'Kind of Blue',
    artists: [{ id: '0kbYTNQb4Pb1rPbbaF0pT4', name: 'Miles Davis' }],
    images: [
      { url: 'https://i.scdn.co/640', width: 640 },
      { url: 'https://i.scdn.co/300', width: 300 },
      { url: 'https://i.scdn.co/64', width: 64 },
    ],
    release_date: '1959-08-17',
    total_tracks: 5,
    external_ids: { upc: '074646393523' },
  },
}

describe('toSyncAlbum', () => {
  it('garde les champs utiles et choisit les pochettes 300 et 640 px', () => {
    expect(toSyncAlbum(item)).toEqual({
      id: '1weenld61qoidwYuZ1GESA',
      name: 'Kind of Blue',
      artists: [{ id: '0kbYTNQb4Pb1rPbbaF0pT4', name: 'Miles Davis' }],
      image: 'https://i.scdn.co/300',
      imageLarge: 'https://i.scdn.co/640',
      releaseDate: '1959-08-17',
      totalTracks: 5,
      upc: '074646393523',
      addedAt: '2024-05-01T10:00:00Z',
    })
  })

  it('supporte un album sans pochette ni code-barres', () => {
    const s = toSyncAlbum({ album: { ...item.album, images: [], external_ids: undefined } })
    expect(s.image).toBeNull()
    expect(s.imageLarge).toBeNull()
    expect(s.upc).toBeNull()
    expect(s.addedAt).toBeNull()
  })
})

describe('isUnchanged', () => {
  const s = toSyncAlbum(item)
  const known: Album = {
    ...s,
    artistNames: 'Miles Davis',
    year: 1959,
    inLibrary: true,
    searchText: 'kind of blue miles davis',
  }

  it('reconnaît un album identique', () => {
    expect(isUnchanged(known, s)).toBe(true)
  })

  it('détecte un album rajouté (nouvelle date) ou revenu dans la bibliothèque', () => {
    expect(isUnchanged(known, { ...s, addedAt: '2025-01-01T00:00:00Z' })).toBe(false)
    expect(isUnchanged({ ...known, inLibrary: false }, s)).toBe(false)
  })

  it('détecte un changement de métadonnées', () => {
    expect(isUnchanged(known, { ...s, image: 'https://i.scdn.co/other' })).toBe(false)
    expect(isUnchanged(known, { ...s, artists: [{ id: 'x', name: 'Miles Davis' }] })).toBe(false)
  })
})
