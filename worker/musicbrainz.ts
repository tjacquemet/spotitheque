import { nowIso } from './db'

// MusicBrainz : encyclopédie musicale libre (licence CC0). C'est sa fiche, et non celle de Spotify,
// qui alimente les suggestions de tags — les conditions développeur de Spotify interdisent
// d'envoyer leur contenu à un modèle d'IA.

const API = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'Spotitheque/1.0 (https://spotitheque.spotitheque.workers.dev)'
/** MusicBrainz demande au plus une requête par seconde. */
const THROTTLE_MS = 1100

export interface MusicBrainzRecord {
  mbid: string | null
  title: string | null
  artist: string | null
  year: number | null
  genres: string[]
  status: 'found' | 'missing'
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** MusicBrainz est momentanément indisponible : l'album sera retenté, pas marqué comme introuvable. */
export class MusicBrainzUnavailable extends Error {}

async function query<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }).catch(
      () => null,
    )
    if (!res) throw new MusicBrainzUnavailable('réseau')
    if (res.status === 503 || res.status === 429) {
      await sleep(2000)
      continue
    }
    if (!res.ok) throw new MusicBrainzUnavailable(`HTTP ${res.status}`)
    return res.json<T>().catch(() => null)
  }
  throw new MusicBrainzUnavailable('limite de débit')
}

const escapeLucene = (value: string) => value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim()

interface SearchResponse {
  'release-groups'?: {
    id: string
    title: string
    'first-release-date'?: string
    'artist-credit'?: { name: string }[]
    score?: number
  }[]
}

interface GroupResponse {
  genres?: { name: string; count: number }[]
  tags?: { name: string; count: number }[]
}

/** Retrouve l'album dans MusicBrainz à partir de son titre et de son artiste, puis lit ses genres. */
export async function lookupAlbum(title: string, artist: string): Promise<MusicBrainzRecord> {
  const missing: MusicBrainzRecord = { mbid: null, title: null, artist: null, year: null, genres: [], status: 'missing' }
  const cleanTitle = escapeLucene(title)
  const cleanArtist = escapeLucene(artist)
  if (!cleanTitle) return missing

  const lucene = encodeURIComponent(`releasegroup:"${cleanTitle}"${cleanArtist ? ` AND artist:"${cleanArtist}"` : ''}`)
  const search = await query<SearchResponse>(`/release-group/?query=${lucene}&limit=1&fmt=json`)
  const group = search?.['release-groups']?.[0]
  if (!group || (group.score ?? 0) < 80) return missing

  await sleep(THROTTLE_MS)
  // Les genres sont un bonus : si cette seconde requête échoue, la fiche reste exploitable.
  const details = await query<GroupResponse>(`/release-group/${group.id}?inc=genres+tags&fmt=json`).catch(() => null)
  const genres = [...(details?.genres ?? []), ...(details?.tags ?? [])]
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((g) => g.name.toLowerCase())
  return {
    mbid: group.id,
    title: group.title,
    artist: group['artist-credit']?.map((a) => a.name).join(', ') ?? null,
    year: Number(group['first-release-date']?.slice(0, 4)) || null,
    genres: [...new Set(genres)].slice(0, 12),
    status: 'found',
  }
}

export function saveRecordStmt(db: D1Database, albumId: string, record: MusicBrainzRecord): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO album_musicbrainz (album_id, mbid, title, artist, year, genres, status, fetched_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(album_id) DO UPDATE SET mbid = excluded.mbid, title = excluded.title, artist = excluded.artist,
         year = excluded.year, genres = excluded.genres, status = excluded.status, fetched_at = excluded.fetched_at`,
    )
    .bind(albumId, record.mbid, record.title, record.artist, record.year, JSON.stringify(record.genres), record.status, nowIso())
}

export const musicBrainzThrottle = THROTTLE_MS
