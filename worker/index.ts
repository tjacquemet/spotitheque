import { Hono } from 'hono'
import { activityRoutes } from './activity'
import { authRoutes, requireSession } from './auth'
import { backupRoutes } from './backup'
import { handleScheduled } from './cron'
import { ApiError } from './errors'
import { libraryRoutes } from './library'
import { playerRoutes } from './player'
import { suggestRoutes } from './suggest'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>().basePath('/api')

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status)
  if (err instanceof SyntaxError) return c.json({ error: { code: 'bad_request', message: 'JSON invalide.' } }, 400)
  console.error(err)
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
