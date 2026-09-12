import type { MusicBrainzRecord } from '../../shared/api'

// Recherche des albums dans des bases musicales libres, depuis le navigateur : les adresses IP de
// Cloudflare sont partagées et se font brider. MusicBrainz d'abord, Wikidata (CC0) en second recours,
// car MusicBrainz refuse une bonne partie des requêtes même à une par seconde.

const MB_API = 'https://musicbrainz.org/ws/2'
const WD_API = 'https://www.wikidata.org/w/api.php'
const MB_THROTTLE_MS = 1500
const WD_THROTTLE_MS = 300

export class LookupUnavailable extends Error {}

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

/** Requête MusicBrainz avec quelques tentatives : leurs refus arrivent en quelques millisecondes. */
async function musicBrainzSearch(lucene: string, limit: number): Promise<ReleaseGroup[]> {
  const url = `${MB_API}/release-group/?query=${encodeURIComponent(lucene)}&limit=${limit}&fmt=json`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } }).catch(() => null)
    if (!res) throw new LookupUnavailable('réseau')
    if (res.status === 503 || res.status === 429) {
      await sleep(1500 * (attempt + 1))
      continue
    }
    if (!res.ok) throw new LookupUnavailable(`HTTP ${res.status}`)
    const body = await res.json().catch(() => null)
    return (body?.['release-groups'] ?? []) as ReleaseGroup[]
  }
  throw new LookupUnavailable('limite de débit')
}

/** Retrouve l'album parmi les sorties d'un artiste, en tolérant les mentions d'édition. */
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

interface WikidataHit {
  id: string
  label: string
  description?: string
}

/**
 * Wikidata : données libres (CC0), sans clé ni bridage sévère.
 * La recherche porte sur le titre seul — elle ne compare qu'aux libellés —
 * et c'est la description (« 1959 studio album by Miles Davis ») qui confirme l'artiste.
 */
async function wikidataLookup(artist: string, title: string): Promise<MusicBrainzRecord | null> {
  const url = `${WD_API}?action=wbsearchentities&search=${encodeURIComponent(title)}&language=en&uselang=en&type=item&limit=20&format=json&origin=*`
  const res = await fetch(url).catch(() => null)
  if (!res?.ok) return null
  const body = await res.json().catch(() => null)
  const hits = (body?.search ?? []) as WikidataHit[]
  const wantedArtist = simplifyTitle(artist)
  if (!wantedArtist) return null

  const hit = hits.find((h) => {
    const description = simplifyTitle(h.description ?? '')
    const isRelease = description.includes('album') || description.includes(' ep') || description.endsWith(' ep')
    return isRelease && description.includes(wantedArtist)
  })
  if (!hit) return null
  const year = Number(hit.description?.match(/\b(19|20)\d{2}\b/)?.[0]) || null
  return { albumId: '', mbid: `wikidata:${hit.id}`, title: hit.label, artist, year, status: 'found' }
}

/**
 * Cherche les fiches des albums donnés. Un album introuvable dans les deux bases est marqué comme tel
 * pour ne pas être recherché sans fin ; `unavailable` signale que rien n'a pu être cherché.
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
  let musicBrainzDown = false
  let lastMusicBrainz = 0
  let done = 0

  const throttledMusicBrainz = async <T>(task: () => Promise<T>): Promise<T | null> => {
    if (musicBrainzDown) return null
    const wait = MB_THROTTLE_MS - (Date.now() - lastMusicBrainz)
    if (wait > 0) await sleep(wait)
    try {
      const result = await task()
      lastMusicBrainz = Date.now()
      return result
    } catch (err) {
      lastMusicBrainz = Date.now()
      if (err instanceof LookupUnavailable) {
        // Inutile d'insister pendant cette passe : Wikidata prend le relais.
        musicBrainzDown = true
        return null
      }
      throw err
    }
  }

  for (const [artist, list] of byArtist) {
    const cleanArtist = escapeLucene(artist)
    let groups: ReleaseGroup[] = []
    if (list.length > 1 && cleanArtist) {
      groups = (await throttledMusicBrainz(() => musicBrainzSearch(`artist:"${cleanArtist}"`, 100))) ?? []
    }

    for (const album of list) {
      let match = matchTitle(groups, album.name)
      if (!match && escapeLucene(album.name)) {
        const precise = await throttledMusicBrainz(() =>
          musicBrainzSearch(
            `releasegroup:"${escapeLucene(album.name)}"${cleanArtist ? ` AND artist:"${cleanArtist}"` : ''}`,
            5,
          ),
        )
        match = precise ? matchTitle(precise, album.name) : null
      }

      if (match) {
        records.push({
          albumId: album.id,
          mbid: match.id,
          title: match.title,
          artist: match['artist-credit']?.map((a) => a.name).join(', ') ?? artist,
          year: Number(match['first-release-date']?.slice(0, 4)) || null,
          status: 'found',
        })
      } else {
        await sleep(WD_THROTTLE_MS)
        const fromWikidata = await wikidataLookup(artist, album.name)
        records.push(
          fromWikidata
            ? { ...fromWikidata, albumId: album.id }
            : { albumId: album.id, mbid: null, title: null, artist: null, year: null, status: 'missing' },
        )
      }
      done++
      onProgress?.(done)
    }
  }

  const found = records.some((r) => r.status === 'found')
  return { records, unavailable: musicBrainzDown && !found }
}
