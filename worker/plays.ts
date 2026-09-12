import { bumpVersionStmt, getSetting, setSettingStmt } from './db'
import { ApiError } from './errors'
import { getTokens, spotifyError, spotifyFetch } from './spotify'

const CURSOR_KEY = 'plays_cursor'

interface PlayedItem {
  played_at: string
  track?: { album?: { id?: string } }
}

/**
 * Spotify ne donne que les 50 derniers titres écoutés : on relève l'historique régulièrement
 * et on garde, pour chaque album, la date d'écoute la plus récente jamais vue.
 */
export async function collectRecentPlays(env: Env): Promise<{ updated: number; scopeMissing: boolean }> {
  const tokens = await getTokens(env)
  if (tokens.scope && !tokens.scope.includes('user-read-recently-played')) {
    return { updated: 0, scopeMissing: true }
  }

  const cursor = await getSetting(env.DB, CURSOR_KEY)
  const query = cursor ? `?limit=50&after=${encodeURIComponent(cursor)}` : '?limit=50'
  const res = await spotifyFetch(env, `/me/player/recently-played${query}`, {}, tokens.accessToken)
  if (res.status === 403) return { updated: 0, scopeMissing: true }
  if (!res.ok) throw await spotifyError(res)
  const body = await res.json<{ items?: PlayedItem[] }>()

  const plays = new Map<string, string>()
  for (const item of body.items ?? []) {
    const id = item.track?.album?.id
    if (!id || !item.played_at) continue
    const known = plays.get(id)
    if (!known || known < item.played_at) plays.set(id, item.played_at)
  }

  // L'album en cours d'écoute n'est pas encore dans l'historique.
  const playing = await spotifyFetch(env, '/me/player/currently-playing', {}, tokens.accessToken).catch(() => null)
  if (playing?.ok && playing.status === 200) {
    const current = await playing
      .json<{ is_playing?: boolean; item?: { album?: { id?: string } } }>()
      .catch(() => null)
    const id = current?.item?.album?.id
    if (current?.is_playing && id) plays.set(id, new Date().toISOString())
  }

  if (plays.size === 0) return { updated: 0, scopeMissing: false }

  const payload = JSON.stringify([...plays].map(([id, at]) => ({ id, at })))
  const newest = [...plays.values()].reduce((a, b) => (a > b ? a : b))
  const result = await env.DB.prepare(
    `UPDATE albums SET last_played_at = json_extract(value, '$.at')
     FROM json_each(?1)
     WHERE albums.id = json_extract(value, '$.id')
       AND (albums.last_played_at IS NULL OR albums.last_played_at < json_extract(value, '$.at'))`,
  )
    .bind(payload)
    .run()

  const updated = result.meta.changes ?? 0
  const stmts = [setSettingStmt(env.DB, CURSOR_KEY, String(Date.parse(newest)))]
  if (updated > 0) stmts.push(bumpVersionStmt(env.DB))
  await env.DB.batch(stmts)
  return { updated, scopeMissing: false }
}

export function scopeError(): ApiError {
  return new ApiError(403, 'spotify_scope', "Spotithèque a besoin d'une autorisation supplémentaire : reconnecte Spotify.")
}
