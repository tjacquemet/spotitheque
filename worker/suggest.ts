import { Hono } from 'hono'
import type { SuggestionRow } from '../shared/api'
import { TAG_COLORS, normalizeTagName } from '../shared/tags'
import { bumpVersionStmt, versionFrom } from './db'
import { ApiError, badRequest } from './errors'
import { MusicBrainzUnavailable, lookupAlbum, musicBrainzThrottle, saveRecordStmt } from './musicbrainz'
import type { AppEnv } from './types'
import { asObject, parseList, parseSpotifyId } from './validate'

export const suggestRoutes = new Hono<AppEnv>()

/** Albums enrichis par appel : MusicBrainz impose une requête par seconde. */
const ENRICH_PER_RUN = 5
/** Albums analysés par appel d'IA. */
const ANALYZE_PER_RUN = 12
const MODEL = '@cf/openai/gpt-oss-120b'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface AlbumToProcess {
  id: string
  name: string
  artists: string
}

interface EnrichedAlbum {
  id: string
  title: string
  artist: string
  year: number | null
  genres: string
}

/** Tags existants, avec leur nombre d'albums : ils servent de vocabulaire au modèle. */
async function tagVocabulary(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT t.name, t.is_genre AS isGenre, count(x.album_id) AS albums
       FROM tags t LEFT JOIN album_tags x ON x.tag_id = t.id
       GROUP BY t.id ORDER BY albums DESC`,
    )
    .all<{ name: string; isGenre: number; albums: number }>()
  return results
}

/**
 * Associations observées entre genres MusicBrainz et tags déjà posés : le modèle apprend
 * ainsi les habitudes de classement sans jamais recevoir de données Spotify.
 */
async function genreHabits(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT genre.value AS genre, t.name AS tag, count(*) AS n
       FROM album_musicbrainz mb
       JOIN json_each(mb.genres) genre
       JOIN album_tags x ON x.album_id = mb.album_id
       JOIN tags t ON t.id = x.tag_id
       GROUP BY genre.value, t.name HAVING n >= 2 ORDER BY n DESC LIMIT 60`,
    )
    .all<{ genre: string; tag: string; n: number }>()
  return results
}

function buildPrompt(
  albums: EnrichedAlbum[],
  vocabulary: { name: string; isGenre: number; albums: number }[],
  habits: { genre: string; tag: string; n: number }[],
) {
  // Deux listes séparées : le modèle doit recopier les noms exactement, sans y ajouter de mention.
  const format = (list: typeof vocabulary) => list.map((t) => `- ${t.name} (${t.albums} albums)`).join('\n')
  const genres = vocabulary.filter((t) => t.isGenre)
  const others = vocabulary.filter((t) => !t.isGenre)
  const tagList = [
    genres.length > 0 ? `Étiquettes de genre :\n${format(genres)}` : '',
    others.length > 0 ? `Autres étiquettes (ambiance, moment, usage) :\n${format(others)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const habitList = habits.map((h) => `- ${h.genre} → ${h.tag} (${h.n}×)`).join('\n')
  const albumList = albums
    .map((a, i) => {
      const genres = (JSON.parse(a.genres) as string[]).join(', ') || 'genres inconnus'
      return `${i + 1}. « ${a.title} » par ${a.artist}${a.year ? ` (${a.year})` : ''} — ${genres}`
    })
    .join('\n')

  const system = [
    "Tu ranges une collection musicale personnelle. Tu proposes des étiquettes pour chaque album, en t'appuyant sur les étiquettes déjà utilisées par le propriétaire.",
    'Règles : une à trois étiquettes par album ; privilégie les étiquettes existantes et recopie leur nom exactement, sans rien ajouter ;',
    "ne propose une nouvelle étiquette, dans « nouveaux », que si aucune existante ne convient vraiment.",
    'Réponds uniquement par un tableau JSON, sans texte autour, de la forme :',
    '[{"n":1,"tags":["Techno"],"nouveaux":[]},{"n":2,"tags":[],"nouveaux":["Bossa nova"]}]',
  ].join('\n')

  const user = [
    `Étiquettes existantes :\n${tagList || '(aucune)'}`,
    habitList ? `\nAssociations déjà observées entre genres et étiquettes :\n${habitList}` : '',
    `\nAlbums à étiqueter :\n${albumList}`,
  ].join('\n')

  return { system, user }
}

interface ModelSuggestion {
  n: number
  tags?: unknown
  nouveaux?: unknown
}

/** Workers AI renvoie selon les modèles { response } ou le format OpenAI { choices[].message.content }. */
function extractText(answer: unknown): string {
  if (typeof answer === 'string') return answer
  const o = answer as { response?: unknown; choices?: { message?: { content?: unknown } }[] }
  if (typeof o?.response === 'string') return o.response
  const content = o?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

function parseModelAnswer(text: string): ModelSuggestion[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? (parsed as ModelSuggestion[]) : []
  } catch {
    return []
  }
}

const asNames = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 3) : []

/** Enregistre les propositions du modèle, en les rattachant aux tags existants quand le nom correspond. */
async function saveSuggestions(
  db: D1Database,
  albums: EnrichedAlbum[],
  answers: ModelSuggestion[],
): Promise<number> {
  const { results: tags } = await db.prepare('SELECT id, name_key FROM tags').all<{ id: number; name_key: string }>()
  const byKey = new Map(tags.map((t) => [t.name_key, t.id]))
  const rows: { albumId: string; label: string; key: string; tagId: number | null }[] = []

  for (const answer of answers) {
    const album = albums[Number(answer.n) - 1]
    if (!album) continue
    for (const raw of [...asNames(answer.tags), ...asNames(answer.nouveaux)]) {
      const cleaned = normalizeTagName(raw)
      if (!cleaned.name || cleaned.name.length > 40) continue
      // Le modèle ajoute parfois une précision entre parenthèses : on retrouve l'étiquette d'origine.
      const stripped = normalizeTagName(cleaned.name.replace(/\s*\([^)]*\)\s*$/, ''))
      const match = byKey.has(cleaned.key) ? cleaned : byKey.has(stripped.key) ? stripped : cleaned
      if (rows.some((r) => r.albumId === album.id && r.key === match.key)) continue
      rows.push({ albumId: album.id, label: match.name, key: match.key, tagId: byKey.get(match.key) ?? null })
    }
  }
  if (rows.length === 0) return 0

  // Une proposition déjà refusée, ou un tag déjà posé, ne doit pas revenir.
  await db
    .prepare(
      `INSERT OR IGNORE INTO suggestions (album_id, label, label_key, tag_id, source, score)
       SELECT json_extract(value, '$.albumId'), json_extract(value, '$.label'), json_extract(value, '$.key'),
              json_extract(value, '$.tagId'), 'ai', 0.9
       FROM json_each(?1)
       WHERE NOT EXISTS (
         SELECT 1 FROM album_tags cur
         WHERE cur.album_id = json_extract(value, '$.albumId') AND cur.tag_id = json_extract(value, '$.tagId')
       )`,
    )
    .bind(JSON.stringify(rows))
    .run()
  return rows.length
}

/** Propositions gratuites : les tags posés sur les autres albums du même artiste. */
const SAME_ARTIST_SQL = `
INSERT OR IGNORE INTO suggestions (album_id, label, label_key, tag_id, source, score)
SELECT a.id, t.name, t.name_key, t.id, 'artist', 0.85
FROM json_each(?1) sel
JOIN albums a ON a.id = sel.value
JOIN albums other ON other.artists = a.artists AND other.id <> a.id
JOIN album_tags x ON x.album_id = other.id
JOIN tags t ON t.id = x.tag_id
WHERE NOT EXISTS (SELECT 1 FROM album_tags cur WHERE cur.album_id = a.id AND cur.tag_id = t.id)`

/**
 * Une passe d'analyse : enrichit quelques albums via MusicBrainz, puis en fait analyser un lot par l'IA.
 * L'interface rappelle cette route jusqu'à ce qu'il ne reste plus rien à traiter.
 */
suggestRoutes.post('/suggestions/run', async (c) => {
  const body = asObject(await c.req.json())
  const albumIds = parseList(body.albumIds, 1000, parseSpotifyId)
  if (albumIds.length === 0) throw badRequest('Aucun album à analyser.')
  const db = c.env.DB
  const selection = JSON.stringify(albumIds)

  // Règle « même artiste » : instantanée, elle tourne dès le premier appel.
  if (body.first === true) await db.prepare(SAME_ARTIST_SQL).bind(selection).run()

  const { results: toEnrich } = await db
    .prepare(
      `SELECT a.id, a.name, a.artists FROM json_each(?1) sel
       JOIN albums a ON a.id = sel.value
       LEFT JOIN album_musicbrainz mb ON mb.album_id = a.id
       WHERE mb.album_id IS NULL LIMIT ?2`,
    )
    .bind(selection, ENRICH_PER_RUN)
    .all<AlbumToProcess>()

  let unavailable = false
  for (const [index, album] of toEnrich.entries()) {
    if (index > 0) await sleep(musicBrainzThrottle)
    const artist = (JSON.parse(album.artists) as { name: string }[])[0]?.name ?? ''
    try {
      const record = await lookupAlbum(album.name, artist)
      await saveRecordStmt(db, album.id, record).run()
    } catch (err) {
      // Panne passagère : on ne marque pas l'album comme introuvable, il repassera plus tard.
      if (err instanceof MusicBrainzUnavailable) {
        unavailable = true
        break
      }
      throw err
    }
  }

  const { results: toAnalyze } = await db
    .prepare(
      `SELECT mb.album_id AS id, mb.title, mb.artist, mb.year, mb.genres FROM json_each(?1) sel
       JOIN album_musicbrainz mb ON mb.album_id = sel.value AND mb.status = 'found'
       WHERE NOT EXISTS (SELECT 1 FROM suggestions s WHERE s.album_id = mb.album_id AND s.source = 'ai')
       LIMIT ?2`,
    )
    .bind(selection, ANALYZE_PER_RUN)
    .all<EnrichedAlbum>()

  let suggested = 0
  if (toAnalyze.length > 0) {
    const [vocabulary, habits] = await Promise.all([tagVocabulary(db), genreHabits(db)])
    const { system, user } = buildPrompt(toAnalyze, vocabulary, habits)
    const answer = await c.env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 900,
    })
    const text = extractText(answer)
    const parsed = parseModelAnswer(text)
    if (parsed.length === 0) console.log('Réponse du modèle non exploitable :', JSON.stringify(answer).slice(0, 800))
    suggested = await saveSuggestions(db, toAnalyze, parsed)
    // Les albums sans réponse exploitable ne doivent pas être analysés en boucle.
    await db
      .prepare(
        `INSERT OR IGNORE INTO suggestions (album_id, label, label_key, tag_id, source, score, status)
         SELECT value, '', '', NULL, 'ai', 0, 'rejected' FROM json_each(?1)`,
      )
      .bind(JSON.stringify(toAnalyze.map((a) => a.id)))
      .run()
  }

  const remaining = await db
    .prepare(
      `SELECT count(*) AS n FROM json_each(?1) sel
       JOIN albums a ON a.id = sel.value
       LEFT JOIN album_musicbrainz mb ON mb.album_id = a.id
       WHERE mb.album_id IS NULL
          OR (mb.status = 'found' AND NOT EXISTS (SELECT 1 FROM suggestions s WHERE s.album_id = a.id AND s.source = 'ai'))`,
    )
    .bind(selection)
    .first<{ n: number }>()

  const version = suggested > 0 ? versionFrom([await bumpVersionStmt(db).run()]) : null
  return c.json({
    enriched: toEnrich.length,
    analyzed: toAnalyze.length,
    suggested,
    remaining: unavailable ? 0 : (remaining?.n ?? 0),
    unavailable,
    version,
  })
})

/** Propositions en attente, regroupées par album côté interface. */
suggestRoutes.get('/suggestions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.album_id AS albumId, s.label, s.tag_id AS tagId, s.source
     FROM suggestions s JOIN albums a ON a.id = s.album_id
     WHERE s.status = 'pending' AND s.label <> ''
     ORDER BY a.added_at DESC, s.source, s.label`,
  ).all<{ albumId: string; label: string; tagId: number | null; source: string }>()
  const items: SuggestionRow[] = results.map((r) => [r.albumId, r.label, r.tagId, r.source])
  return c.json({ items })
})

/** Accepte une proposition : crée le tag au besoin, le pose sur l'album, retire la proposition. */
suggestRoutes.post('/suggestions/accept', async (c) => {
  const body = asObject(await c.req.json())
  const albumId = parseSpotifyId(body.albumId)
  const { name, key } = normalizeTagName(typeof body.label === 'string' ? body.label : '')
  if (!name) throw badRequest('Proposition invalide.')
  const db = c.env.DB

  const existing = await db.prepare('SELECT id FROM tags WHERE name_key = ?').bind(key).first<{ id: number }>()
  let tagId = existing?.id
  if (!tagId) {
    const count = await db.prepare('SELECT count(*) AS n FROM tags').first<{ n: number }>()
    const color = TAG_COLORS[(count?.n ?? 0) % TAG_COLORS.length]
    const created = await db
      .prepare('INSERT INTO tags (name, name_key, color) VALUES (?, ?, ?) RETURNING id')
      .bind(name, key, color)
      .first<{ id: number }>()
    tagId = created?.id
  }
  if (!tagId) throw new ApiError(500, 'internal', "Le tag n'a pas pu être créé.")

  const results = await db.batch([
    db.prepare('INSERT OR IGNORE INTO album_tags (album_id, tag_id) VALUES (?, ?)').bind(albumId, tagId),
    db.prepare('DELETE FROM suggestions WHERE album_id = ? AND label_key = ?').bind(albumId, key),
    db.prepare('SELECT id, name, color, is_genre AS isGenre FROM tags WHERE id = ?').bind(tagId),
    bumpVersionStmt(db),
  ])
  const row = results[2].results[0] as { id: number; name: string; color: string; isGenre: number }
  return c.json({ tag: { ...row, isGenre: row.isGenre === 1 }, version: versionFrom(results) })
})

/** Refuse une proposition (ou toutes celles d'un album) : elle ne sera plus proposée. */
suggestRoutes.post('/suggestions/reject', async (c) => {
  const body = asObject(await c.req.json())
  const albumId = parseSpotifyId(body.albumId)
  const db = c.env.DB
  if (typeof body.label === 'string' && body.label.length > 0) {
    const { key } = normalizeTagName(body.label)
    await db.prepare("UPDATE suggestions SET status = 'rejected' WHERE album_id = ? AND label_key = ?").bind(albumId, key).run()
  } else {
    await db.prepare("UPDATE suggestions SET status = 'rejected' WHERE album_id = ?").bind(albumId).run()
  }
  return c.json({ ok: true })
})
