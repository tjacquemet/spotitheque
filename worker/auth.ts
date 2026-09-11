import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { randomToken, sha256Hex } from './crypto'
import { getSetting, nowIso, setSettingStmt } from './db'
import { ApiError } from './errors'
import { authorizeUrl, exchangeCode } from './spotify'
import type { AppEnv } from './types'

const SESSION_COOKIE = 'session'
const STATE_COOKIE = 'oauth_state'
const SESSION_MAX_AGE = 60 * 60 * 24 * 365
const DAY_MS = 86_400_000

const isHttps = (c: Context<AppEnv>) => new URL(c.req.url).protocol === 'https:'
const redirectUri = (c: Context<AppEnv>) => new URL('/api/auth/callback', c.req.url).toString()

function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
}

async function createSession(c: Context<AppEnv>) {
  const token = randomToken(32)
  const staleBefore = new Date(Date.now() - 400 * DAY_MS).toISOString()
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE last_seen_at < ?').bind(staleBefore),
    c.env.DB.prepare('INSERT INTO sessions (token_hash, user_agent) VALUES (?, ?)').bind(
      await sha256Hex(token),
      c.req.header('user-agent')?.slice(0, 300) ?? null,
    ),
  ])
  setSessionCookie(c, token)
}

export const authRoutes = new Hono<AppEnv>()

authRoutes.get('/login', (c) => {
  if (!c.env.SPOTIFY_CLIENT_ID || !c.env.SPOTIFY_CLIENT_SECRET) return c.redirect('/?auth_error=config')
  const state = randomToken(16)
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: isHttps(c), sameSite: 'Lax', path: '/api/auth', maxAge: 600 })
  return c.redirect(authorizeUrl(c.env, redirectUri(c), state))
})

authRoutes.get('/callback', async (c) => {
  const fail = (reason: string) => {
    deleteCookie(c, STATE_COOKIE, { path: '/api/auth' })
    return c.redirect(`/?auth_error=${reason}`)
  }
  if (c.req.query('error')) return fail('denied')
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state || state !== getCookie(c, STATE_COOKIE)) return fail('state')

  let tokens
  let profile: { id: string; display_name?: string | null }
  try {
    tokens = await exchangeCode(c.env, code, redirectUri(c))
    const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${tokens.accessToken}` } })
    if (!res.ok) return fail('profile')
    profile = await res.json()
  } catch (err) {
    console.error('Échec de la connexion Spotify', err)
    return fail('token')
  }

  // Le premier compte connecté devient propriétaire ; tout autre compte est refusé.
  const owner = await getSetting(c.env.DB, 'owner_id')
  if (owner && owner !== profile.id) return fail('not_owner')
  const db = c.env.DB
  await db.batch([
    setSettingStmt(db, 'owner_id', profile.id),
    setSettingStmt(db, 'owner_name', profile.display_name || profile.id),
    setSettingStmt(db, 'spotify_tokens', JSON.stringify(tokens)),
  ])

  // Une reconnexion Spotify (tous les 6 mois) garde la session en cours.
  const current = getCookie(c, SESSION_COOKIE)
  const hasSession = current
    ? await db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').bind(await sha256Hex(current)).first()
    : null
  if (!hasSession) await createSession(c)
  deleteCookie(c, STATE_COOKIE, { path: '/api/auth' })
  return c.redirect('/')
})

/** Connexion sans Spotify pour le développement local uniquement (DEV_LOGIN=1 dans .dev.vars). */
authRoutes.get('/dev-login', async (c) => {
  const host = new URL(c.req.url).hostname
  if (c.env.DEV_LOGIN !== '1' || (host !== '127.0.0.1' && host !== 'localhost')) {
    throw new ApiError(404, 'not_found', 'Route inconnue.')
  }
  await createSession(c)
  return c.redirect('/')
})

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

/** Exige une session valide ; la prolonge au plus une fois par jour (cookie et date de dernière visite). */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) throw new ApiError(401, 'unauthenticated', 'Connexion requise.')
  const hash = await sha256Hex(token)
  const row = await c.env.DB.prepare('SELECT last_seen_at FROM sessions WHERE token_hash = ?')
    .bind(hash)
    .first<{ last_seen_at: string }>()
  if (!row) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    throw new ApiError(401, 'unauthenticated', 'Session expirée.')
  }
  if (Date.now() - Date.parse(row.last_seen_at) > DAY_MS) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').bind(nowIso(), hash).run(),
    )
    setSessionCookie(c, token)
  }
  c.set('sessionHash', hash)
  await next()
}
