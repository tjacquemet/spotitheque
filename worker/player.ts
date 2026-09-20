import { Hono } from 'hono'
import type { ClientKind, Device, PlayResult, QueueResult } from '../shared/api'
import { pickDevice } from '../shared/devices'
import { recordActivity } from './activity'
import { badRequest } from './errors'
import { getTokens, spotifyError, spotifyFetch } from './spotify'
import { fetchAlbumTracks } from './tracks'
import type { AppEnv } from './types'
import { asObject, parseSpotifyId, parseTrackPosition } from './validate'

interface SpotifyDevice {
  id: string | null
  name: string
  type: string
  is_active: boolean
  is_restricted: boolean
}

export const playerRoutes = new Hono<AppEnv>()

async function listDevices(env: Env, token: string): Promise<Device[]> {
  const res = await spotifyFetch(env, '/me/player/devices', {}, token)
  if (!res.ok) throw await spotifyError(res)
  const { devices } = await res.json<{ devices: SpotifyDevice[] }>()
  return devices
    .filter((d): d is SpotifyDevice & { id: string } => Boolean(d.id))
    .map((d) => ({ id: d.id, name: d.name, type: d.type, isActive: d.is_active, isRestricted: d.is_restricted }))
}

/** Lance l'album à la piste demandée puis coupe l'aléatoire. Renvoie false si l'appareil a disparu. */
async function startAlbum(env: Env, token: string, albumId: string, deviceId: string, position = 0): Promise<boolean> {
  const device = encodeURIComponent(deviceId)
  const res = await spotifyFetch(
    env,
    `/me/player/play?device_id=${device}`,
    { method: 'PUT', body: { context_uri: `spotify:album:${albumId}`, offset: { position }, position_ms: 0 } },
    token,
  )
  if (res.status === 404) return false
  if (!res.ok) throw await spotifyError(res)
  // Lecture dans l'ordre : l'aléatoire est coupé après le démarrage (erreur sans conséquence ignorée).
  await spotifyFetch(env, `/me/player/shuffle?state=false&device_id=${device}`, { method: 'PUT' }, token).catch(() => null)
  return true
}

function parseClientKind(v: unknown): ClientKind {
  return v === 'phone' ? 'phone' : 'desktop'
}

playerRoutes.get('/devices', async (c) => {
  const { accessToken } = await getTokens(c.env)
  return c.json({ devices: await listDevices(c.env, accessToken) })
})

playerRoutes.post('/play', async (c) => {
  const body = asObject(await c.req.json())
  const albumId = parseSpotifyId(body.albumId)
  const deviceId = body.deviceId === undefined || body.deviceId === null ? null : String(body.deviceId)
  if (deviceId !== null && (deviceId.length === 0 || deviceId.length > 100)) throw badRequest('Appareil invalide.')
  const { accessToken } = await getTokens(c.env)
  const devices = await listDevices(c.env, accessToken)
  const position = parseTrackPosition(body.trackPosition)
  const target = pickDevice(devices, { deviceId, clientKind: parseClientKind(body.clientKind) })
  if (!target || !(await startAlbum(c.env, accessToken, albumId, target.id, position))) {
    await recordActivity(c.env.DB, 'lecture.sans_appareil', { albumId, appareils: devices.map((d) => d.name) })
    return c.json<PlayResult>({ status: 'no_device' })
  }
  await recordActivity(c.env.DB, 'lecture', { albumId, appareil: target.name, piste: position + 1 })
  return c.json<PlayResult>({ status: 'playing', device: target })
})

/**
 * Titres empilés par appel. La file de Spotify n'accepte qu'un titre par requête : ce plafond garde
 * l'exécution sous la limite de 50 sous-requêtes du plan gratuit. L'interface rappelle la route avec
 * `from` tant qu'il reste des titres, ce qui permet de servir même un coffret.
 */
const MAX_QUEUED = 40
/** Le temps que l'appareil soit reconnu actif après le lancement du premier titre. */
const WAKE_MS = 500

/** Lance un titre seul : pas de contexte d'album, la suite tiendra dans la file. */
async function startTrack(env: Env, token: string, trackId: string, deviceId: string): Promise<boolean> {
  const device = encodeURIComponent(deviceId)
  const res = await spotifyFetch(
    env,
    `/me/player/play?device_id=${device}`,
    { method: 'PUT', body: { uris: [`spotify:track:${trackId}`] } },
    token,
  )
  if (res.status === 404) return false
  if (!res.ok) throw await spotifyError(res)
  // Lecture dans l'ordre : l'aléatoire est coupé au démarrage (erreur sans conséquence ignorée).
  await spotifyFetch(env, `/me/player/shuffle?state=false&device_id=${device}`, { method: 'PUT' }, token).catch(() => null)
  return true
}

/**
 * Ajoute l'album à la file de lecture, titre par titre et dans l'ordre — y compris quand rien ne joue :
 * le premier titre est alors lancé seul et les suivants s'empilent derrière lui. Tout passe ainsi par la
 * file, si bien qu'un album ajouté plus tard se range à la suite au lieu de s'insérer dans celui en cours.
 */
playerRoutes.post('/queue', async (c) => {
  const body = asObject(await c.req.json())
  const albumId = parseSpotifyId(body.albumId)
  const from = parseTrackPosition(body.from)
  const deviceId = body.deviceId === undefined || body.deviceId === null ? null : String(body.deviceId)
  if (deviceId !== null && (deviceId.length === 0 || deviceId.length > 100)) throw badRequest('Appareil invalide.')
  const { accessToken } = await getTokens(c.env)
  const devices = await listDevices(c.env, accessToken)
  const target = pickDevice(devices, { deviceId, clientKind: parseClientKind(body.clientKind) })
  if (!target) return c.json<QueueResult>({ status: 'no_device' })

  const tracks = (await fetchAlbumTracks(c.env, accessToken, albumId)).filter((t) => t.id)
  const device = encodeURIComponent(target.id)
  let queued = 0
  let started = false
  for (const track of tracks.slice(from, from + MAX_QUEUED)) {
    const uri = encodeURIComponent(`spotify:track:${track.id}`)
    const res = await spotifyFetch(c.env, `/me/player/queue?uri=${uri}&device_id=${device}`, { method: 'POST' }, accessToken)
    if (res.ok) {
      queued++
      continue
    }
    // 404 sur le tout premier titre : l'appareil est éveillé mais silencieux, il n'existe donc pas encore
    // de file. On lance ce titre seul, et les suivants reprennent leur place derrière lui.
    if (res.status === 404 && queued === 0 && from === 0) {
      if (!(await startTrack(c.env, accessToken, track.id as string, target.id))) {
        return c.json<QueueResult>({ status: 'no_playback' })
      }
      started = true
      queued++
      await new Promise((resolve) => setTimeout(resolve, WAKE_MS))
      continue
    }
    if (queued === 0) throw await spotifyError(res)
    break
  }

  await recordActivity(c.env.DB, 'file_attente', {
    albumId,
    appareil: target.name,
    titres: queued,
    depuis: from,
    total: tracks.length,
    lecture: started,
  })
  return c.json<QueueResult>({ status: started ? 'started' : 'queued', device: target, queued, from, total: tracks.length })
})

const WAIT_WINDOW_MS = 25_000
const POLL_MS = 1_500

/**
 * Spotify était fermé sur le téléphone : l'interface ouvre l'album via un lien spotify: et appelle cette route.
 * On répond tout de suite, puis on surveille les appareils (30 s max après la réponse avec waitUntil)
 * et on lance la lecture dès que le téléphone se connecte.
 */
playerRoutes.post('/play/when-ready', async (c) => {
  const body = asObject(await c.req.json())
  const albumId = parseSpotifyId(body.albumId)
  const position = parseTrackPosition(body.trackPosition)
  const { accessToken } = await getTokens(c.env)
  const known = new Set((await listDevices(c.env, accessToken).catch(() => [])).map((d) => d.id))
  c.executionCtx.waitUntil(
    (async () => {
      const deadline = Date.now() + WAIT_WINDOW_MS
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        const devices = await listDevices(c.env, accessToken).catch(() => [])
        const usable = devices.filter((d) => !d.isRestricted)
        const phone = usable.find((d) => d.type === 'Smartphone') ?? usable.find((d) => !known.has(d.id))
        if (phone) {
          const started = await startAlbum(c.env, accessToken, albumId, phone.id, position).catch((err) => {
            console.error('Lecture différée', err)
            return false
          })
          await recordActivity(c.env.DB, 'lecture.differee', { albumId, appareil: phone.name, lance: started })
          return
        }
      }
      await recordActivity(c.env.DB, 'lecture.differee_abandonnee', { albumId, attente: WAIT_WINDOW_MS })
    })(),
  )
  return c.json({ status: 'waiting' })
})
