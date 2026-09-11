import { Hono } from 'hono'
import type { ClientKind, Device, PlayResult } from '../shared/api'
import { pickDevice } from '../shared/devices'
import { badRequest } from './errors'
import { getTokens, spotifyError, spotifyFetch } from './spotify'
import type { AppEnv } from './types'
import { asObject, parseSpotifyId } from './validate'

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

/** Lance l'album depuis la première piste puis coupe l'aléatoire. Renvoie false si l'appareil a disparu. */
async function startAlbum(env: Env, token: string, albumId: string, deviceId: string): Promise<boolean> {
  const device = encodeURIComponent(deviceId)
  const res = await spotifyFetch(
    env,
    `/me/player/play?device_id=${device}`,
    { method: 'PUT', body: { context_uri: `spotify:album:${albumId}`, offset: { position: 0 }, position_ms: 0 } },
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
  const target = pickDevice(devices, { deviceId, clientKind: parseClientKind(body.clientKind) })
  if (!target || !(await startAlbum(c.env, accessToken, albumId, target.id))) {
    return c.json<PlayResult>({ status: 'no_device' })
  }
  return c.json<PlayResult>({ status: 'playing', device: target })
})

const WAIT_WINDOW_MS = 25_000
const POLL_MS = 1_500

/**
 * Spotify était fermé sur le téléphone : l'interface ouvre l'album via un lien spotify: et appelle cette route.
 * On répond tout de suite, puis on surveille les appareils (30 s max après la réponse avec waitUntil)
 * et on lance la lecture dès que le téléphone se connecte.
 */
playerRoutes.post('/play/when-ready', async (c) => {
  const albumId = parseSpotifyId(asObject(await c.req.json()).albumId)
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
          await startAlbum(c.env, accessToken, albumId, phone.id).catch((err) => console.error('Lecture différée', err))
          return
        }
      }
    })(),
  )
  return c.json({ status: 'waiting' })
})
