import { Hono } from 'hono'
import type { MeResponse, MutationResult, TagDto } from '../shared/api'
import { TAG_COLORS } from '../shared/tags'
import { activityStmt, recordActivity } from './activity'
import { bumpVersionStmt, getSetting, nowIso, setSettingStmt, versionFrom } from './db'
import { ApiError, badRequest } from './errors'
import { collectRecentPlays } from './plays'
import { getTokens } from './spotify'
import type { AppEnv } from './types'
import { asObject, parseColor, parseList, parseSpotifyId, parseSyncAlbum, parseTagId, parseTagName } from './validate'

export const libraryRoutes = new Hono<AppEnv>()

libraryRoutes.get('/me', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('owner_id', 'owner_name', 'spotify_tokens', 'last_full_sync')",
  ).all<{ key: string; value: string }>()
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]))
  return c.json<MeResponse>({
    spotify: s.spotify_tokens ? 'connected' : s.owner_id ? 'reauth' : 'not_connected',
    displayName: s.owner_name ?? null,
    lastFullSync: s.last_full_sync ?? null,
  })
})

/** Relève l'historique d'écoute (appelé à l'ouverture de l'appli, et toutes les 30 minutes par la tâche planifiée). */
libraryRoutes.post('/plays/poll', async (c) => c.json(await collectRecentPlays(c.env)))

/** Jeton d'accès temporaire : le navigateur lit lui-même la bibliothèque Spotify (réponses trop lourdes pour le Worker). */
libraryRoutes.get('/spotify/token', async (c) => {
  const tokens = await getTokens(c.env)
  return c.json({ accessToken: tokens.accessToken, expiresAt: tokens.expiresAt })
})

// Chaque ligne est sérialisée en JSON par SQLite : le Worker ne fait que concaténer (limite de 10 ms de CPU).
const LIBRARY_QUERIES = [
  "SELECT CAST(value AS INTEGER) AS j FROM settings WHERE key = 'data_version'",
  `SELECT json_array(id, name, json(artists), image_url, image_url_large, release_date, total_tracks, added_at, in_library, last_played_at) AS j
   FROM albums`,
  'SELECT json_array(id, name, color, is_genre, is_pinned) AS j FROM tags ORDER BY name_key',
  'SELECT json_array(album_id, tag_id) AS j FROM album_tags',
]

libraryRoutes.get('/library', async (c) => {
  const db = c.env.DB
  const current = await getSetting(db, 'data_version')
  const headers = { 'Cache-Control': 'no-store' }
  if (c.req.header('If-None-Match') === `"v${current}"`) {
    return c.body(null, 304, { ...headers, ETag: `"v${current}"` })
  }
  const [version, albums, tags, links] = await db.batch<{ j: string | number }>(
    LIBRARY_QUERIES.map((sql) => db.prepare(sql)),
  )
  const join = (r: D1Result<{ j: string | number }>) => r.results.map((row) => row.j).join(',')
  const v = Number(version.results[0]?.j ?? 1)
  const body = `{"version":${v},"albums":[${join(albums)}],"tags":[${join(tags)}],"links":[${join(links)}]}`
  return c.body(body, 200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ETag: `"v${v}"` })
})

// N'écrit que les albums nouveaux ou modifiés (la clause WHERE du DO UPDATE ignore les lignes identiques).
export const UPSERT_ALBUMS = `
INSERT INTO albums (id, name, artists, image_url, image_url_large, release_date, total_tracks, upc, added_at, in_library, synced_at)
SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.artists'),
       json_extract(value, '$.image'), json_extract(value, '$.imageLarge'), json_extract(value, '$.releaseDate'),
       json_extract(value, '$.totalTracks'), json_extract(value, '$.upc'), json_extract(value, '$.addedAt'), 1, ?2
FROM json_each(?1) WHERE true
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name, artists = excluded.artists, image_url = excluded.image_url,
  image_url_large = excluded.image_url_large, release_date = excluded.release_date,
  total_tracks = excluded.total_tracks, upc = excluded.upc, added_at = excluded.added_at,
  in_library = 1, synced_at = excluded.synced_at
WHERE albums.name IS NOT excluded.name OR albums.artists IS NOT excluded.artists
   OR albums.image_url IS NOT excluded.image_url OR albums.image_url_large IS NOT excluded.image_url_large
   OR albums.release_date IS NOT excluded.release_date OR albums.total_tracks IS NOT excluded.total_tracks
   OR albums.upc IS NOT excluded.upc OR albums.added_at IS NOT excluded.added_at OR albums.in_library = 0`

libraryRoutes.post('/sync/albums', async (c) => {
  const body = asObject(await c.req.json())
  const albums = parseList(body.albums, 500, parseSyncAlbum)
  if (albums.length === 0) return c.json({ changes: 0, version: null })
  const db = c.env.DB
  const res = await db.prepare(UPSERT_ALBUMS).bind(JSON.stringify(albums), nowIso()).run()
  const changes = res.meta.changes ?? 0
  const version = changes > 0 ? versionFrom([await bumpVersionStmt(db).run()]) : null
  return c.json({ changes, version })
})

/** Fin d'une synchronisation complète : les albums absents de Spotify sont marqués comme retirés. */
libraryRoutes.post('/sync/finish', async (c) => {
  const body = asObject(await c.req.json())
  const allIds = parseList(body.allIds, 50_000, parseSpotifyId)
  const ids = JSON.stringify(allIds)
  const db = c.env.DB
  const [total, missing] = await db.batch<{ n: number }>([
    db.prepare('SELECT count(*) AS n FROM albums WHERE in_library = 1'),
    db.prepare('SELECT count(*) AS n FROM albums WHERE in_library = 1 AND id NOT IN (SELECT value FROM json_each(?))').bind(ids),
  ])
  const inLibrary = total.results[0]?.n ?? 0
  const removed = missing.results[0]?.n ?? 0
  // Garde-fou : une liste tronquée ne doit pas vider la bibliothèque.
  if (body.force !== true && removed > 20 && removed > inLibrary / 2) {
    throw new ApiError(409, 'sync_suspicious', `La synchronisation retirerait ${removed} albums sur ${inLibrary} : opération bloquée par sécurité.`)
  }
  const stmts = [
    db.prepare('UPDATE albums SET in_library = 0 WHERE in_library = 1 AND id NOT IN (SELECT value FROM json_each(?))').bind(ids),
    setSettingStmt(db, 'last_full_sync', nowIso()),
    activityStmt(db, 'sync.terminee', { albumsSpotify: allIds.length, retires: removed }),
  ]
  if (removed > 0) stmts.push(bumpVersionStmt(db))
  const results = await db.batch(stmts)
  return c.json({ removed, version: removed > 0 ? versionFrom(results) : null })
})

/**
 * Supprime définitivement des albums et leurs tags. Par sécurité, seuls les albums retirés de Spotify
 * peuvent l'être : un album encore dans la bibliothèque reviendrait à la synchro suivante.
 */
libraryRoutes.post('/albums/delete', async (c) => {
  const albumIds = parseList(asObject(await c.req.json()).albumIds, 5000, parseSpotifyId)
  if (albumIds.length === 0) throw badRequest('Aucun album à supprimer.')
  const db = c.env.DB
  const ids = JSON.stringify(albumIds)
  const results = await db.batch([
    db.prepare(
      `DELETE FROM album_tags WHERE album_id IN (
         SELECT id FROM albums WHERE in_library = 0 AND id IN (SELECT value FROM json_each(?))
       )`,
    ).bind(ids),
    db.prepare('DELETE FROM albums WHERE in_library = 0 AND id IN (SELECT value FROM json_each(?))').bind(ids),
    bumpVersionStmt(db),
  ])
  const deleted = results[1].meta.changes ?? 0
  await recordActivity(db, 'albums.supprimes', { demandes: albumIds.length, supprimes: deleted, albumIds: albumIds.slice(0, 20) })
  return c.json({ deleted, version: versionFrom(results) })
})

/** Couleur la moins utilisée de la palette, pour varier les nouveaux tags. */
async function nextColor(db: D1Database): Promise<string> {
  const { results } = await db.prepare('SELECT color, count(*) AS n FROM tags GROUP BY color').all<{ color: string; n: number }>()
  const used = new Map(results.map((r) => [r.color, r.n]))
  let best: string = TAG_COLORS[0]
  for (const color of TAG_COLORS) if ((used.get(color) ?? 0) < (used.get(best) ?? 0)) best = color
  return best
}

const TAG_FIELDS = 'id, name, color, is_genre AS isGenre, is_pinned AS isPinned'

interface TagRecord {
  id: number
  name: string
  color: string
  isGenre: number
  isPinned: number
}

const toTagDto = (row: TagRecord): TagDto => ({ ...row, isGenre: row.isGenre === 1, isPinned: row.isPinned === 1 })

async function requireTag(db: D1Database, id: number): Promise<TagDto> {
  const tag = await db.prepare(`SELECT ${TAG_FIELDS} FROM tags WHERE id = ?`).bind(id).first<TagRecord>()
  if (!tag) throw new ApiError(404, 'not_found', 'Tag introuvable.')
  return toTagDto(tag)
}

const isUniqueViolation = (err: unknown) => String(err).includes('UNIQUE')

libraryRoutes.post('/tags', async (c) => {
  const body = asObject(await c.req.json())
  const { name, key } = parseTagName(body.name)
  const db = c.env.DB
  const color = body.color === undefined ? await nextColor(db) : parseColor(body.color)
  const results = await db.batch([
    db.prepare('INSERT INTO tags (name, name_key, color) VALUES (?, ?, ?) ON CONFLICT(name_key) DO NOTHING').bind(name, key, color),
    db.prepare(`SELECT ${TAG_FIELDS} FROM tags WHERE name_key = ?`).bind(key),
    bumpVersionStmt(db),
  ])
  const tag = toTagDto(results[1].results[0] as TagRecord)
  const created = (results[0].meta.changes ?? 0) > 0
  if (created) await recordActivity(db, 'tag.cree', { nom: name })
  return c.json({ tag, created, version: versionFrom(results) })
})

libraryRoutes.patch('/tags/:id', async (c) => {
  const id = parseTagId(c.req.param('id'))
  const body = asObject(await c.req.json())
  const db = c.env.DB
  await requireTag(db, id)
  const sets: string[] = []
  const binds: unknown[] = []
  if (body.name !== undefined) {
    const { name, key } = parseTagName(body.name)
    sets.push('name = ?', 'name_key = ?')
    binds.push(name, key)
  }
  if (body.color !== undefined) {
    sets.push('color = ?')
    binds.push(parseColor(body.color))
  }
  if (body.isGenre !== undefined) {
    if (typeof body.isGenre !== 'boolean') throw badRequest('isGenre doit être un booléen.')
    sets.push('is_genre = ?')
    binds.push(body.isGenre ? 1 : 0)
  }
  if (body.isPinned !== undefined) {
    if (typeof body.isPinned !== 'boolean') throw badRequest('isPinned doit être un booléen.')
    sets.push('is_pinned = ?')
    binds.push(body.isPinned ? 1 : 0)
  }
  if (sets.length === 0) throw badRequest('Rien à modifier.')
  try {
    const results = await db.batch([
      db.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id),
      db.prepare(`SELECT ${TAG_FIELDS} FROM tags WHERE id = ?`).bind(id),
      activityStmt(db, 'tag.modifie', { id, nom: body.name, couleur: body.color, genre: body.isGenre, epingle: body.isPinned }),
      bumpVersionStmt(db),
    ])
    return c.json({ tag: toTagDto(results[1].results[0] as TagRecord), version: versionFrom(results) })
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'tag_exists', 'Un tag porte déjà ce nom.')
    throw err
  }
})

libraryRoutes.delete('/tags/:id', async (c) => {
  const id = parseTagId(c.req.param('id'))
  const db = c.env.DB
  const tag = await requireTag(db, id)
  const results = await db.batch([
    db.prepare('DELETE FROM album_tags WHERE tag_id = ?').bind(id),
    db.prepare('DELETE FROM tags WHERE id = ?').bind(id),
    activityStmt(db, 'tag.supprime', { id, nom: tag.name }),
    bumpVersionStmt(db),
  ])
  return c.json<MutationResult>({ version: versionFrom(results) })
})

/** Fusion : les albums du tag :id reçoivent le tag `into`, puis :id est supprimé. */
libraryRoutes.post('/tags/:id/merge', async (c) => {
  const id = parseTagId(c.req.param('id'))
  const into = parseTagId(asObject(await c.req.json()).into)
  if (id === into) throw badRequest('Impossible de fusionner un tag avec lui-même.')
  const db = c.env.DB
  const source = await requireTag(db, id)
  const target = await requireTag(db, into)
  const results = await db.batch([
    db.prepare(
      'INSERT OR IGNORE INTO album_tags (album_id, tag_id, created_at) SELECT album_id, ?2, created_at FROM album_tags WHERE tag_id = ?1',
    ).bind(id, into),
    db.prepare('DELETE FROM album_tags WHERE tag_id = ?').bind(id),
    db.prepare('DELETE FROM tags WHERE id = ?').bind(id),
    activityStmt(db, 'tag.fusionne', { de: source.name, vers: target.name }),
    bumpVersionStmt(db),
  ])
  return c.json<MutationResult>({ version: versionFrom(results) })
})

/** Ajoute et/ou retire des tags sur un ou plusieurs albums (même route pour l'unitaire et le masse). */
libraryRoutes.post('/album-tags', async (c) => {
  const body = asObject(await c.req.json())
  const albumIds = parseList(body.albumIds, 20_000, parseSpotifyId)
  const add = parseList(body.add ?? [], 200, parseTagId)
  const remove = parseList(body.remove ?? [], 200, parseTagId)
  if (albumIds.length === 0 || add.length + remove.length === 0) throw badRequest('Aucune modification demandée.')
  const db = c.env.DB
  const ids = JSON.stringify(albumIds)
  const stmts: D1PreparedStatement[] = []
  if (add.length > 0) {
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO album_tags (album_id, tag_id)
         SELECT a.value, t.id FROM json_each(?1) a
         JOIN albums al ON al.id = a.value
         JOIN tags t ON t.id IN (SELECT value FROM json_each(?2))`,
      ).bind(ids, JSON.stringify(add)),
    )
  }
  if (remove.length > 0) {
    stmts.push(
      db.prepare(
        `DELETE FROM album_tags
         WHERE album_id IN (SELECT value FROM json_each(?1)) AND tag_id IN (SELECT value FROM json_each(?2))`,
      ).bind(ids, JSON.stringify(remove)),
    )
  }
  stmts.push(
    activityStmt(db, 'albums.tags', { albums: albumIds.length, albumIds: albumIds.slice(0, 20), ajoutes: add, retires: remove }),
    bumpVersionStmt(db),
  )
  const results = await db.batch(stmts)
  return c.json<MutationResult>({ version: versionFrom(results) })
})
