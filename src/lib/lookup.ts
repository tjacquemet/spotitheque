import type { LookupRecord } from '../../shared/api'
import { logAction } from './activity'

// Recherche des albums dans des bases musicales libres, depuis le navigateur : les adresses IP de
// Cloudflare sont partagées et se font brider. MusicBrainz refuse environ deux requêtes sur cinq, mais
// ces refus arrivent en quelques dizaines de millisecondes et la tentative suivante passe : il faut
// insister plutôt qu'abandonner. Wikidata (CC0) ne sert que de dernier recours, sa recherche étant faible.

const MB_API = 'https://musicbrainz.org/ws/2'
const WD_API = 'https://www.wikidata.org/w/api.php'
/** Rythme demandé par MusicBrainz : une requête par seconde. */
const MB_THROTTLE_MS = 1100
const MB_BACKOFF_MS = [400, 900, 1600, 2600, 4000]
/** Albums d'affilée sans réponse avant de laisser la base souffler. */
const MB_FAILURES_BEFORE_PAUSE = 4
const MB_PAUSE_MS = 30_000
const WD_THROTTLE_MS = 300
/** Genres retenus par album : les premiers tags MusicBrainz sont les plus consensuels. */
const MAX_GENRES = 6

interface ReleaseGroup {
  id: string
  title: string
  score?: number
  'first-release-date'?: string
  'artist-credit'?: { name: string }[]
  tags?: { name: string; count?: number }[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const escapeLucene = (value: string) => value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim()

const simplifyTitle = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\((deluxe|remaster(ed)?|edition|version|expanded|bonus|anniversary)[^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

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

const genresOf = (group: ReleaseGroup) =>
  (group.tags ?? [])
    .filter((t) => (t.count ?? 1) > 0 && t.name.length <= 40)
    .slice(0, MAX_GENRES)
    .map((t) => t.name)

/**
 * MusicBrainz, interrogé avec insistance : chaque recherche est retentée tant qu'elle se fait refuser,
 * et un refus n'invalide que cette recherche-là. La source n'est mise en pause que si plusieurs albums
 * de suite échouent — auquel cas elle est retentée après un moment, pas abandonnée pour toute la passe.
 */
class MusicBrainz {
  private lastCall = 0
  private failures = 0
  private pausedUntil = 0
  attempts = 0
  pauses = 0
  /** Refus de débit (503, 429) : la base répond, elle demande d'attendre. */
  refusals = 0
  /** Requête qui n'est jamais partie : réseau coupé, ou bloquée par le navigateur (CSP). */
  blocked = 0

  get available() {
    return Date.now() >= this.pausedUntil
  }

  async search(lucene: string, limit: number): Promise<ReleaseGroup[] | null> {
    if (!this.available) return null
    const url = `${MB_API}/release-group/?query=${encodeURIComponent(lucene)}&limit=${limit}&fmt=json`
    for (const backoff of MB_BACKOFF_MS) {
      const wait = MB_THROTTLE_MS - (Date.now() - this.lastCall)
      if (wait > 0) await sleep(wait)
      this.attempts++
      const res = await fetch(url, { headers: { Accept: 'application/json' } }).catch(() => null)
      this.lastCall = Date.now()
      if (res?.ok) {
        const body = await res.json().catch(() => null)
        this.failures = 0
        return (body?.['release-groups'] ?? []) as ReleaseGroup[]
      }
      if (!res) this.blocked++
      else if (res.status === 503 || res.status === 429) this.refusals++
      // 503 et 429 sont des refus de débit : la tentative suivante passe généralement.
      if (res && res.status !== 503 && res.status !== 429) break
      await sleep(backoff)
    }
    this.noteFailure()
    return null
  }

  private noteFailure() {
    if (++this.failures < MB_FAILURES_BEFORE_PAUSE) return
    this.failures = 0
    this.pauses++
    this.pausedUntil = Date.now() + MB_PAUSE_MS
  }
}

interface WikidataHit {
  id: string
  label: string
  description?: string
}

/**
 * Wikidata : données libres (CC0), sans bridage. La recherche ne porte que sur le titre — elle ne compare
 * qu'aux libellés — et c'est la description (« 1959 studio album by Miles Davis ») qui confirme l'artiste.
 */
async function wikidataLookup(artist: string, title: string): Promise<{ record: LookupRecord | null; blocked: boolean }> {
  const url = `${WD_API}?action=wbsearchentities&search=${encodeURIComponent(title)}&language=en&uselang=en&type=item&limit=20&format=json&origin=*`
  const res = await fetch(url).catch(() => null)
  if (!res) return { record: null, blocked: true }
  if (!res.ok) return { record: null, blocked: false }
  const body = await res.json().catch(() => null)
  const hits = (body?.search ?? []) as WikidataHit[]
  const wantedArtist = simplifyTitle(artist)
  if (!wantedArtist) return { record: null, blocked: false }

  const hit = hits.find((h) => {
    const description = simplifyTitle(h.description ?? '')
    const isRelease = description.includes('album') || description.includes(' ep') || description.endsWith(' ep')
    return isRelease && description.includes(wantedArtist)
  })
  if (!hit) return { record: null, blocked: false }
  const year = Number(hit.description?.match(/\b(19|20)\d{2}\b/)?.[0]) || null
  return {
    record: { albumId: '', mbid: `wikidata:${hit.id}`, title: hit.label, artist, year, genres: [], status: 'found' },
    blocked: false,
  }
}

/**
 * Cherche les fiches des albums donnés. Un album introuvable dans les deux bases est marqué comme tel
 * pour ne pas être recherché sans fin ; `unavailable` signale que rien n'a pu être cherché.
 */
export async function lookupAlbums(
  albums: { id: string; name: string; artist: string }[],
): Promise<{ records: LookupRecord[]; unavailable: boolean }> {
  const byArtist = new Map<string, typeof albums>()
  for (const album of albums) {
    const list = byArtist.get(album.artist) ?? []
    list.push(album)
    byArtist.set(album.artist, list)
  }

  const musicBrainz = new MusicBrainz()
  const records: LookupRecord[] = []
  let viaWikidata = 0
  let wikidataBlocked = 0

  for (const [artist, list] of byArtist) {
    const cleanArtist = escapeLucene(artist)
    // Un artiste présent plusieurs fois : une seule recherche donne toutes ses sorties.
    const groups = list.length > 1 && cleanArtist ? ((await musicBrainz.search(`artist:"${cleanArtist}"`, 100)) ?? []) : []

    for (const album of list) {
      let match = matchTitle(groups, album.name)
      if (!match && escapeLucene(album.name)) {
        const precise = await musicBrainz.search(
          `releasegroup:"${escapeLucene(album.name)}"${cleanArtist ? ` AND artist:"${cleanArtist}"` : ''}`,
          5,
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
          genres: genresOf(match),
          status: 'found',
        })
      } else {
        await sleep(WD_THROTTLE_MS)
        const wikidata = await wikidataLookup(artist, album.name)
        if (wikidata.record) viaWikidata++
        if (wikidata.blocked) wikidataBlocked++
        records.push(
          wikidata.record
            ? { ...wikidata.record, albumId: album.id }
            : { albumId: album.id, mbid: null, title: null, artist: null, year: null, genres: [], status: 'missing' },
        )
      }
    }
  }

  const found = records.filter((r) => r.status === 'found').length
  logAction('lookup', {
    albums: albums.length,
    found,
    viaWikidata,
    requetesMusicBrainz: musicBrainz.attempts,
    refusMusicBrainz: musicBrainz.refusals,
    // Requêtes qui ne sont jamais parties : réseau, ou navigateur qui les bloque (CSP).
    bloquees: musicBrainz.blocked + wikidataBlocked,
    pausesMusicBrainz: musicBrainz.pauses,
    introuvables: records.filter((r) => r.status === 'missing').map((r) => r.albumId),
  })
  // Rien trouvé alors que les requêtes n'aboutissent pas : ces albums n'ont pas été cherchés, ils ne sont
  // pas introuvables. On ne renvoie rien, pour ne pas enregistrer un « introuvable » qui n'en est pas un.
  const unavailable = found === 0 && (musicBrainz.blocked + wikidataBlocked > 0 || musicBrainz.pauses > 0)
  return { records: unavailable ? [] : records, unavailable }
}
