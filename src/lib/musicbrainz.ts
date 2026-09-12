import type { MusicBrainzRecord } from '../../shared/api'

// Les requêtes MusicBrainz partent du navigateur : les adresses IP de Cloudflare sont partagées
// entre des milliers de Workers et se font brider en quelques appels.

const API = 'https://musicbrainz.org/ws/2'
/** MusicBrainz demande au plus une requête par seconde. */
const THROTTLE_MS = 1200

export class MusicBrainzUnavailable extends Error {}

interface ReleaseGroup {
  id: string
  title: string
  'first-release-date'?: string
  'artist-credit'?: { name: string }[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const escapeLucene = (value: string) => value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim()

export const simplifyTitle = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\((deluxe|remaster(ed)?|edition|version|expanded|bonus|anniversary)[^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

async function search(lucene: string, limit: number): Promise<ReleaseGroup[]> {
  const url = `${API}/release-group/?query=${encodeURIComponent(lucene)}&limit=${limit}&fmt=json`
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } }).catch(() => null)
    if (!res) throw new MusicBrainzUnavailable('réseau')
    if (res.status === 503 || res.status === 429) {
      await sleep(3000)
      continue
    }
    if (!res.ok) throw new MusicBrainzUnavailable(`HTTP ${res.status}`)
    const body = await res.json().catch(() => null)
    return (body?.['release-groups'] ?? []) as ReleaseGroup[]
  }
  throw new MusicBrainzUnavailable('limite de débit')
}

/** Toutes les sorties d'un artiste en une requête : utile quand plusieurs de ses albums sont à enrichir. */
const searchArtistGroups = (artist: string) => {
  const clean = escapeLucene(artist)
  return clean ? search(`artist:"${clean}"`, 100) : Promise.resolve([])
}

/** Recherche précise, pour les artistes trop prolifiques pour tenir dans une seule réponse. */
const searchOneAlbum = (artist: string, title: string) => {
  const cleanTitle = escapeLucene(title)
  const cleanArtist = escapeLucene(artist)
  if (!cleanTitle) return Promise.resolve([])
  return search(`releasegroup:"${cleanTitle}"${cleanArtist ? ` AND artist:"${cleanArtist}"` : ''}`, 5)
}

/** Retrouve l'album parmi les sorties de l'artiste, en tolérant les mentions d'édition. */
function matchTitle(groups: ReleaseGroup[], title: string): ReleaseGroup | null {
  const wanted = simplifyTitle(title)
  if (!wanted) return null
  return (
    groups.find((g) => simplifyTitle(g.title) === wanted) ??
    groups.find((g) => {
      const other = simplifyTitle(g.title)
      return other.length > 4 && (other.startsWith(wanted) || wanted.startsWith(other))
    }) ??
    null
  )
}

/**
 * Cherche les fiches MusicBrainz d'une liste d'albums, un artiste à la fois.
 * Renvoie ce qui a pu être trouvé ; un album introuvable est marqué comme tel pour ne pas être recherché sans fin.
 */
export async function lookupAlbums(
  albums: { id: string; name: string; artist: string }[],
  onProgress?: (done: number) => void,
): Promise<{ records: MusicBrainzRecord[]; unavailable: boolean }> {
  const byArtist = new Map<string, typeof albums>()
  for (const album of albums) {
    const list = byArtist.get(album.artist) ?? []
    list.push(album)
    byArtist.set(album.artist, list)
  }

  const records: MusicBrainzRecord[] = []
  const toRecord = (album: { id: string }, artist: string, match: ReleaseGroup | null): MusicBrainzRecord =>
    match
      ? {
          albumId: album.id,
          mbid: match.id,
          title: match.title,
          artist: match['artist-credit']?.map((a) => a.name).join(', ') ?? artist,
          year: Number(match['first-release-date']?.slice(0, 4)) || null,
          status: 'found',
        }
      : { albumId: album.id, mbid: null, title: null, artist: null, year: null, status: 'missing' }

  let done = 0
  let first = true
  try {
    for (const [artist, list] of byArtist) {
      let groups: ReleaseGroup[] = []
      // Une seule requête couvre souvent tout l'artiste ; inutile pour un album isolé.
      if (list.length > 1) {
        if (!first) await sleep(THROTTLE_MS)
        first = false
        groups = await searchArtistGroups(artist)
      }
      for (const album of list) {
        let match = matchTitle(groups, album.name)
        if (!match) {
          // Artiste trop prolifique pour une seule réponse : on cherche l'album précisément.
          if (!first) await sleep(THROTTLE_MS)
          first = false
          match = matchTitle(await searchOneAlbum(artist, album.name), album.name)
        }
        records.push(toRecord(album, artist, match))
        done++
        onProgress?.(done)
      }
    }
  } catch (err) {
    if (err instanceof MusicBrainzUnavailable) return { records, unavailable: true }
    throw err
  }
  return { records, unavailable: false }
}
