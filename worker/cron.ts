import type { SavedAlbumsPage } from '../shared/spotify'
import { toSyncAlbum } from '../shared/spotify'
import { bumpVersionStmt, nowIso, setSettingStmt } from './db'
import { UPSERT_ALBUMS } from './library'
import { collectRecentPlays } from './plays'
import { getTokens, spotifyFetch } from './spotify'

/** Petites pages : le plan gratuit n'accorde que 10 ms de calcul par exécution. */
const PAGE_SIZE = 20
const MAX_PAGES = 3

/**
 * Synchro quotidienne côté serveur : récupère les albums récemment ajoutés dans Spotify,
 * sans attendre que l'appli soit ouverte. Les albums retirés restent détectés par la
 * synchro complète du navigateur, trop lourde pour un Worker.
 */
export async function syncNewAlbums(env: Env): Promise<{ changes: number }> {
  const { accessToken } = await getTokens(env)
  let changes = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await spotifyFetch(env, `/me/albums?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, {}, accessToken)
    if (!res.ok) break
    const body = await res.json<SavedAlbumsPage>()
    const albums = (body.items ?? []).map(toSyncAlbum)
    if (albums.length === 0) break
    const result = await env.DB.prepare(UPSERT_ALBUMS).bind(JSON.stringify(albums), nowIso()).run()
    const written = result.meta.changes ?? 0
    changes += written
    // Page entièrement connue : les suivantes le sont aussi, la liste est triée par date d'ajout.
    if (written === 0) break
  }
  if (changes > 0) await env.DB.batch([bumpVersionStmt(env.DB), setSettingStmt(env.DB, 'last_cron_sync', nowIso())])
  else await setSettingStmt(env.DB, 'last_cron_sync', nowIso()).run()
  return { changes }
}

/** Tâches planifiées : relevé des écoutes toutes les 30 minutes, albums une fois par jour. */
export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  try {
    await collectRecentPlays(env)
  } catch (err) {
    console.error('Relevé des écoutes', err)
  }
  if (event.cron !== '*/30 * * * *') {
    try {
      await syncNewAlbums(env)
    } catch (err) {
      console.error('Synchro quotidienne', err)
    }
  }
}
