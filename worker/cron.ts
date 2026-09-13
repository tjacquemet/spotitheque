import type { SavedAlbumsPage } from '../shared/spotify'
import { toSyncAlbum } from '../shared/spotify'
import { activityStmt, recordActivity, trimActivityStmt } from './activity'
import { bumpVersionStmt, nowIso, setSettingStmt } from './db'
import { UPSERT_ALBUMS } from './library'
import { collectRecentPlays } from './plays'
import { getTokens, spotifyFetch } from './spotify'
import { analyzePendingAlbums } from './suggest'

/** Petites pages : le plan gratuit n'accorde que 10 ms de calcul par exécution. */
const PAGE_SIZE = 20
const MAX_PAGES = 3

/**
 * Synchro quotidienne côté serveur : récupère les albums récemment ajoutés dans Spotify,
 * sans attendre que l'appli soit ouverte. Les albums retirés restent détectés par la
 * synchro complète du navigateur, trop lourde pour un Worker.
 */
async function syncNewAlbums(env: Env): Promise<{ changes: number }> {
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

/** Lots d'albums soumis au modèle pendant la nuit : de quoi absorber les nouveautés sans épuiser le quota. */
const NIGHTLY_BATCHES = 3

/** Exécute une tâche de nuit sans interrompre les suivantes ; un échec laisse une trace consultable. */
async function attempt<T>(env: Env, task: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (err) {
    console.error(task, err)
    await recordActivity(env.DB, 'erreur', { tache: task, message: String(err).slice(0, 300) }).catch(() => undefined)
    return null
  }
}

/** Tâches planifiées : relevé des écoutes toutes les 30 minutes, albums et analyse une fois par jour. */
export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  const plays = (await attempt(env, 'ecoutes', () => collectRecentPlays(env)))?.updated ?? 0
  if (event.cron === '*/30 * * * *') {
    // Seules les relèves qui ont vu passer une écoute méritent une ligne : le reste serait du bruit.
    if (plays > 0) await recordActivity(env.DB, 'ecoutes.relevees', { albums: plays })
    return
  }
  const changes = (await attempt(env, 'synchro_quotidienne', () => syncNewAlbums(env)))?.changes ?? 0
  const analysis = await attempt(env, 'analyse_de_nuit', () => analyzePendingAlbums(env, NIGHTLY_BATCHES))
  await env.DB.batch([
    activityStmt(env.DB, 'cron.quotidien', {
      ecoutes: plays,
      albumsAjoutes: changes,
      analyses: analysis?.analyzed ?? 0,
      propositions: analysis?.suggested ?? 0,
    }),
    trimActivityStmt(env.DB),
  ])
}
