import { Hono, type Context } from 'hono'
import { activityRoutes, recordActivity } from './activity'
import { authRoutes, requireSession } from './auth'
import { backupRoutes } from './backup'
import { handleScheduled } from './cron'
import { ApiError } from './errors'
import { libraryRoutes } from './library'
import { playerRoutes } from './player'
import { suggestRoutes } from './suggest'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>().basePath('/api')

/** Le journal ne doit jamais faire échouer la réponse : une erreur d'écriture est ignorée. */
const journalError = (c: Context<AppEnv>, detail: Record<string, unknown>) =>
  recordActivity(c.env.DB, 'erreur', { route: `${c.req.method} ${c.req.path}`, ...detail }).catch(() => undefined)

app.onError(async (err, c) => {
  if (err instanceof ApiError) {
    // Les refus ordinaires — validation, session expirée, reconnexion Spotify — n'ont rien d'anormal.
    if (err.status >= 500) await journalError(c, { code: err.code, message: err.message })
    return c.json({ error: { code: err.code, message: err.message } }, err.status)
  }
  if (err instanceof SyntaxError) return c.json({ error: { code: 'bad_request', message: 'JSON invalide.' } }, 400)
  console.error(err)
  await journalError(c, { message: String(err).slice(0, 300) })
  return c.json({ error: { code: 'internal', message: 'Erreur interne du serveur.' } }, 500)
})

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route inconnue.' } }, 404))

// Protection CSRF : toute écriture doit être un appel JSON (impossible depuis un formulaire d'un autre site).
app.use('*', async (c, next) => {
  const method = c.req.method
  if (method !== 'GET' && method !== 'HEAD' && !c.req.header('Content-Type')?.startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Requête JSON attendue.')
  }
  await next()
})

app.route('/auth', authRoutes)
app.use('*', requireSession)
app.route('/', libraryRoutes)
app.route('/', backupRoutes)
app.route('/', playerRoutes)
app.route('/', suggestRoutes)
app.route('/', activityRoutes)

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(event, env))
  },
}
