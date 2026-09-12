import { Hono } from 'hono'
import { nowIso } from './db'
import { badRequest } from './errors'
import type { AppEnv } from './types'
import { asObject, parseList } from './validate'

export const activityRoutes = new Hono<AppEnv>()

/** Nombre de lignes conservées : le journal sert au diagnostic récent, pas à l'archivage. */
export const ACTIVITY_KEPT = 5000
const MAX_DETAIL = 2000

const serialize = (detail: unknown) => (detail === undefined || detail === null ? null : JSON.stringify(detail).slice(0, MAX_DETAIL))

/**
 * Journalise une action réelle (pas un clic) : ce que l'utilisateur a changé, ce que l'appli a fait pour lui.
 * Renvoie une instruction, à glisser dans un batch existant pour ne pas coûter d'aller-retour.
 */
export function activityStmt(db: D1Database, action: string, detail?: unknown): D1PreparedStatement {
  return db.prepare('INSERT INTO activity (at, action, detail) VALUES (?, ?, ?)').bind(nowIso(), action, serialize(detail))
}

export const recordActivity = (db: D1Database, action: string, detail?: unknown): Promise<unknown> =>
  activityStmt(db, action, detail).run()

/** Purge les lignes les plus anciennes (appelée par la tâche quotidienne). */
export const trimActivityStmt = (db: D1Database): D1PreparedStatement =>
  db.prepare('DELETE FROM activity WHERE id <= (SELECT max(id) FROM activity) - ?').bind(ACTIVITY_KEPT)

/** Actions que seul le navigateur connaît : recherche dans les bases musicales, synchronisation Spotify. */
activityRoutes.post('/activity', async (c) => {
  const entries = parseList(asObject(await c.req.json()).entries, 200, (raw) => {
    const o = asObject(raw)
    if (typeof o.action !== 'string' || o.action.length === 0 || o.action.length > 60) throw badRequest('Action invalide.')
    return {
      at: typeof o.at === 'string' && o.at.length <= 40 ? o.at : nowIso(),
      action: o.action,
      detail: serialize(o.detail),
    }
  })
  if (entries.length === 0) return c.json({ saved: 0 })
  await c.env.DB.prepare(
    `INSERT INTO activity (at, action, detail)
     SELECT json_extract(value, '$.at'), json_extract(value, '$.action'), json_extract(value, '$.detail')
     FROM json_each(?1)`,
  )
    .bind(JSON.stringify(entries))
    .run()
  return c.json({ saved: entries.length })
})
