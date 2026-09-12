import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupAlbums } from './lookup'

vi.mock('./activity', () => ({ logAction: vi.fn() }))

const releaseGroup = (title: string, artist: string) => ({
  'release-groups': [
    {
      id: `mbid-${title}`,
      title,
      'first-release-date': '2013-09-29',
      'artist-credit': [{ name: artist }],
      tags: [{ name: 'electronic', count: 5 }],
    },
  ],
})

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const refused = () => new Response('', { status: 503 })

/** Déroule les attentes (débit, temporisations) sans les subir réellement. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const result = promise.then((value) => value)
  await vi.advanceTimersByTimeAsync(120_000)
  return result
}

describe('lookupAlbums', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('insiste après un refus de MusicBrainz', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(ok(releaseGroup('Psychic', 'Darkside')))
    vi.stubGlobal('fetch', fetchMock)

    const { records } = await settle(lookupAlbums([{ id: 'a1', name: 'Psychic', artist: 'DARKSIDE' }]))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(records).toEqual([
      { albumId: 'a1', mbid: 'mbid-Psychic', title: 'Psychic', artist: 'Darkside', year: 2013, genres: ['electronic'], status: 'found' },
    ])
  })

  it("continue d'interroger MusicBrainz pour les albums suivants après un échec", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input)
      if (!url.includes('musicbrainz')) return Promise.resolve(ok({ search: [] }))
      // Le premier album se fait refuser quoi qu'il arrive ; le second doit malgré tout être cherché.
      if (url.includes('Introuvable')) return Promise.resolve(refused())
      return Promise.resolve(ok(releaseGroup('Echo', 'Brandt Brauer Frick')))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { records, unavailable } = await settle(
      lookupAlbums([
        { id: 'a1', name: 'Introuvable', artist: 'Personne' },
        { id: 'a2', name: 'Echo', artist: 'Brandt Brauer Frick' },
      ]),
    )

    expect(records.find((r) => r.albumId === 'a2')?.status).toBe('found')
    expect(records.find((r) => r.albumId === 'a1')?.status).toBe('missing')
    expect(unavailable).toBe(false)
  })

  it('se rabat sur Wikidata quand MusicBrainz ne répond pas', async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input)
      if (url.includes('musicbrainz')) return Promise.resolve(refused())
      return Promise.resolve(ok({ search: [{ id: 'Q123', label: 'Psychic', description: '2013 studio album by Darkside' }] }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { records } = await settle(lookupAlbums([{ id: 'a1', name: 'Psychic', artist: 'Darkside' }]))

    expect(records[0]).toMatchObject({ albumId: 'a1', mbid: 'wikidata:Q123', year: 2013, status: 'found' })
  })
})
