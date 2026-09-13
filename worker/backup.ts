import { Hono } from 'hono'
import { TAG_COLORS } from '../shared/tags'
import { bumpVersionStmt, nowIso, versionFrom } from './db'
import { badRequest } from './errors'
import type { AppEnv } from './types'
import { asObject, parseList, parseSyncAlbum, parseTagName } from './validate'

export const backupRoutes = new Hono<AppEnv>()

const EXPORT_TAGS = `
SELECT json_object(
  'name', name, 'color', color,
  'isGenre', json(CASE is_genre WHEN 1 THEN 'true' ELSE 'false' END),
  'isPinned', json(CASE is_pinned WHEN 1 THEN 'true' ELSE 'false' END)
) AS j FROM tags ORDER BY name_key`
const EXPORT_ALBUMS = `
SELECT json_object(
  'id', a.id, 'name', a.name, 'artists', json(a.artists), 'image', a.image_url, 'imageLarge', a.image_url_large,
  'releaseDate', a.release_date, 'totalTracks', a.total_tracks, 'addedAt', a.added_at,
  'tags', (SELECT json_group_array(t.name) FROM album_tags x JOIN tags t ON t.id = x.tag_id WHERE x.album_id = a.id)
) AS j
FROM albums a
WHERE EXISTS (SELECT 1 FROM album_tags x WHERE x.album_id = a.id)
ORDER BY a.added_at DESC`

/** Sauvegarde lisible : tous les tags et les albums tagués (avec leurs métadonnées, pour pouvoir tout reconstruire). */
backupRoutes.get('/export', async (c) => {
  const db = c.env.DB
  const [tags, albums] = await db.batch<{ j: string }>([db.prepare(EXPORT_TAGS), db.prepare(EXPORT_ALBUMS)])
  const join = (r: D1Result<{ j: string }>) => r.results.map((row) => row.j).join(',\n')
  const exportedAt = nowIso()
  const body = `{"app":"spotitheque","format":1,"exportedAt":"${exportedAt}",\n"tags":[\n${join(tags)}],\n"albums":[\n${join(albums)}]}\n`
  return c.body(body, 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="spotitheque-tags-${exportedAt.slice(0, 10)}.json"`,
    'Cache-Control': 'no-store',
  })
})

/** Restauration additive : crée les tags et albums manquants et ajoute les associations, sans rien supprimer. */
backupRoutes.post('/import', async (c) => {
  const body = asObject(await c.req.json())
  if (body.app !== 'spotitheque' || body.format !== 1) throw badRequest("Ce fichier n'est pas une sauvegarde Spotithèque.")

  const tags = new Map<string, { name: string; key: string; color: string; isGenre: number; isPinned: number }>()
  const addTag = (rawName: unknown, rawColor?: unknown, rawIsGenre?: unknown, rawIsPinned?: unknown) => {
    const { name, key } = parseTagName(rawName)
    const color = (TAG_COLORS as readonly unknown[]).includes(rawColor) ? (rawColor as string) : TAG_COLORS[tags.size % TAG_COLORS.length]
    if (!tags.has(key)) {
      tags.set(key, { name, key, color, isGenre: rawIsGenre === true ? 1 : 0, isPinned: rawIsPinned === true ? 1 : 0 })
    }
    return key
  }
  parseList(body.tags, 2000, (t) => {
    const o = asObject(t)
    return addTag(o.name, o.color, o.isGenre, o.isPinned)
  })

  const links: [string, string][] = []
  const albums = parseList(body.albums, 50_000, (raw) => {
    const o = asObject(raw)
    const album = parseSyncAlbum({ ...o, upc: null })
    for (const key of parseList(o.tags, 200, (name) => addTag(name))) links.push([album.id, key])
    return album
  })

  const db = c.env.DB
  const now = nowIso()
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO tags (name, name_key, color, is_genre, is_pinned)
       SELECT json_extract(value, '$.name'), json_extract(value, '$.key'), json_extract(value, '$.color'),
              json_extract(value, '$.isGenre'), json_extract(value, '$.isPinned')
       FROM json_each(?) WHERE true ON CONFLICT(name_key) DO NOTHING`,
    ).bind(JSON.stringify([...tags.values()])),
  ]
  // Un album inconnu est créé comme « retiré » : la prochaine synchro le réactivera s'il est dans Spotify.
  for (let i = 0; i < albums.length; i += 1000) {
    stmts.push(
      db.prepare(
        `INSERT INTO albums (id, name, artists, image_url, image_url_large, release_date, total_tracks, added_at, in_library, synced_at)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.artists'),
                json_extract(value, '$.image'), json_extract(value, '$.imageLarge'), json_extract(value, '$.releaseDate'),
                json_extract(value, '$.totalTracks'), json_extract(value, '$.addedAt'), 0, ?2
         FROM json_each(?1) WHERE true ON CONFLICT(id) DO NOTHING`,
      ).bind(JSON.stringify(albums.slice(i, i + 1000)), now),
    )
  }
  for (let i = 0; i < links.length; i += 5000) {
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO album_tags (album_id, tag_id)
         SELECT json_extract(p.value, '$[0]'), t.id FROM json_each(?) p
         JOIN tags t ON t.name_key = json_extract(p.value, '$[1]')
         JOIN albums a ON a.id = json_extract(p.value, '$[0]')`,
      ).bind(JSON.stringify(links.slice(i, i + 5000))),
    )
  }
  stmts.push(bumpVersionStmt(db))
  const results = await db.batch(stmts)
  const linkResults = results.slice(1 + Math.ceil(albums.length / 1000), -1)
  return c.json({
    tags: results[0].meta.changes ?? 0,
    albums: albums.length,
    links: linkResults.reduce((n, r) => n + (r.meta.changes ?? 0), 0),
    version: versionFrom(results),
  })
})
