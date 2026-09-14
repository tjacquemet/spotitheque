import { deleteSettingStmt, getSetting, nowIso, setSettingStmt } from './db'
import { ApiError, SpotifyReauthError } from './errors'

const ACCOUNTS_URL = 'https://accounts.spotify.com'
const API_URL = 'https://api.spotify.com/v1'

const SPOTIFY_SCOPES = [
  'user-library-read',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
  // « Retirer de Spotify » depuis la fiche d'un album (DELETE /me/library).
  'user-library-modify',
]

export interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
  /** Date de la connexion : Spotify exige une nouvelle autorisation 6 mois après. */
  authorizedAt: string
}

interface TokenResponse {
  access_token: string
  expires_in: number
  scope?: string
  refresh_token?: string
}

function basicAuth(env: Env): string {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new ApiError(500, 'config', 'Identifiants Spotify absents de la configuration du Worker.')
  }
  return `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`
}

function tokenRequest(env: Env, params: Record<string, string>): Promise<Response> {
  return fetch(`${ACCOUNTS_URL}/api/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
}

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.SPOTIFY_CLIENT_ID,
    scope: SPOTIFY_SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
  })
  return `${ACCOUNTS_URL}/authorize?${params}`
}

export async function exchangeCode(env: Env, code: string, redirectUri: string): Promise<StoredTokens> {
  const res = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  if (!res.ok) throw new ApiError(502, 'spotify_token', `Spotify a refusé la connexion (${res.status}).`)
  const data = await res.json<TokenResponse>()
  if (!data.refresh_token) throw new ApiError(502, 'spotify_token', "Spotify n'a pas fourni de refresh token.")
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? '',
    authorizedAt: nowIso(),
  }
}

/** Jetons Spotify valides pour au moins une minute, renouvelés si besoin. */
export async function getTokens(env: Env, force = false): Promise<StoredTokens> {
  const raw = await getSetting(env.DB, 'spotify_tokens')
  if (!raw) throw new SpotifyReauthError()
  const tokens = JSON.parse(raw) as StoredTokens
  if (!force && tokens.expiresAt - 60_000 > Date.now()) return tokens

  const res = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
  if (res.status === 400) {
    const body = await res.json<{ error?: string }>().catch(() => ({ error: undefined }))
    if (body.error === 'invalid_grant') {
      // Autorisation expirée (6 mois) ou révoquée : on oublie les jetons.
      await deleteSettingStmt(env.DB, 'spotify_tokens').run()
      throw new SpotifyReauthError()
    }
  }
  if (!res.ok) throw new ApiError(502, 'spotify_unavailable', `Spotify ne répond pas (${res.status}).`)

  const data = await res.json<TokenResponse>()
  const next: StoredTokens = {
    ...tokens,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? tokens.scope,
  }
  await setSettingStmt(env.DB, 'spotify_tokens', JSON.stringify(next)).run()
  return next
}

/** Appel à l'API Web de Spotify ; un 401 déclenche un renouvellement du jeton puis un nouvel essai. */
export async function spotifyFetch(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {},
  accessToken?: string,
): Promise<Response> {
  const call = (token: string) =>
    fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  let res = await call(accessToken ?? (await getTokens(env)).accessToken)
  if (res.status === 401) res = await call((await getTokens(env, true)).accessToken)
  if (res.status === 429) {
    throw new ApiError(429, 'spotify_rate_limited', 'Spotify limite les requêtes : réessaie dans un instant.')
  }
  return res
}

/** Traduit une réponse d'erreur de Spotify en message lisible. */
export async function spotifyError(res: Response): Promise<ApiError> {
  const body = await res
    .json<{ error?: { message?: string; reason?: string } }>()
    .catch(() => ({}) as { error?: { message?: string; reason?: string } })
  if (body.error?.reason === 'PREMIUM_REQUIRED') {
    return new ApiError(403, 'spotify_premium', 'Spotify Premium est nécessaire pour lancer la lecture.')
  }
  const detail = body.error?.message ? ` : ${body.error.message}` : ''
  return new ApiError(502, 'spotify_error', `Spotify a répondu ${res.status}${detail}.`)
}
