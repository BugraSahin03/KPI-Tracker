import express, { type NextFunction, type Request, type Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { isBodyMetric, isEntry, isGoal, isGymSession, isGymTemplate, normalizeAppData } from '../src/lib/storage.js'
import { DEFAULT_PROFILE_ID, type AppData, type DataMutation } from '../src/types.js'
import type { PaceDatabase } from './db.js'
import type { GoogleHealthService } from './google-health.js'
import { config } from './config.js'
import { dateKeyInTimeZone } from './time.js'

type AppOptions = {
  now?: () => Date
  timeZone?: string
}

// Vite proxies /api in local development. The browser therefore sends the
// frontend origin while Express sees the proxy target as its request host.
// Keep this allowlist loopback-only and inactive in production.
const DEVELOPMENT_FRONTEND_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

function writeOriginIsAllowed(request: Request, origin: string) {
  const requestOrigin = `${request.protocol}://${request.get('host')}`
  const expectedOrigin = config.publicOrigin ?? requestOrigin
  return origin === expectedOrigin || (
    !config.production &&
    config.publicOrigin === undefined &&
    DEVELOPMENT_FRONTEND_ORIGINS.has(origin)
  )
}

export function createApp(database: PaceDatabase, googleHealth: GoogleHealthService, options: AppOptions = {}) {
  const now = options.now ?? (() => new Date())
  const timeZone = options.timeZone ?? config.timeZone
  const serverToday = () => dateKeyInTimeZone(now(), timeZone)
  const app = express()
  app.disable('x-powered-by')
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
    next()
  })
  app.use(express.json({ limit: '2mb', type: 'application/json' }))

  app.get('/api/health', (_request, response) => {
    try {
      const health = database.health()
      return response.status(health.sqliteReady ? 200 : 503).json({ status: health.sqliteReady ? 'ok' : 'unavailable', ...health })
    } catch {
      return response.status(503).json({ status: 'unavailable', sqliteReady: false, schemaVersion: null })
    }
  })

  app.use('/api', (request, response, next) => {
    if (config.allowedTailscaleUsers.length && !config.allowedTailscaleUsers.includes(request.get('Tailscale-User-Login') ?? '')) {
      return response.status(403).json({ error: 'Tailscale-Identität nicht erlaubt.' })
    }
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next()
    const origin = request.get('origin')
    if ((config.production && !origin) || (origin && !writeOriginIsAllowed(request, origin))) return response.status(403).json({ error: 'Anfrage von fremder oder fehlender Herkunft abgelehnt.' })
    return next()
  })

  const envelope = (profileId: string) => ({ data: database.getData(profileId), profileId, profiles: database.listProfiles(), revision: database.getRevision(), features: { googleHealth: config.googleHealthEnabled } })
  app.get('/api/data', (request, response, next) => {
    try {
      const profileId = typeof request.query.profileId === 'string' ? request.query.profileId : DEFAULT_PROFILE_ID
      return response.json(envelope(profileId))
    } catch (error) { return next(error) }
  })
  app.post('/api/mutations', (request, response, next) => {
    try {
      const body = request.body as { profileId?: unknown; mutation?: unknown }
      const profileId = typeof body.profileId === 'string' ? body.profileId : DEFAULT_PROFILE_ID
      const mutation = body.mutation ?? request.body
      if (!isDataMutation(mutation)) return response.status(400).json({ error: 'Ungültige Pace-Mutation.' })
      const futureError = futureMutationError(mutation, serverToday(), timeZone)
      if (futureError) return response.status(400).json({ error: futureError })
      const result = database.applyMutation(profileId, mutation)
      return response.json({ ...result, ...envelope(profileId) })
    } catch (error) { return next(error) }
  })
  app.post('/api/import/local', (request, response, next) => {
    try {
      const body = request.body as { profileId?: unknown; data?: unknown; onlyIfPristine?: unknown }
      const profileId = typeof body.profileId === 'string' ? body.profileId : DEFAULT_PROFILE_ID
      const normalized = normalizeAppData(body.data)
      if (body.onlyIfPristine !== true || !normalized) {
        return response.status(400).json({ error: 'Ungültiger oder unsicherer Import.' })
      }
      const futureError = futureImportError(normalized, serverToday(), timeZone)
      if (futureError) return response.status(400).json({ error: futureError })
      const imported = {
        ...normalized,
        bodyMetrics: normalized.bodyMetrics.map((metric) => ({ ...metric, source: metric.source ?? 'local-import' as const })),
      }
      const revision = database.importIfPristine(profileId, imported)
      return response.json({ ...envelope(profileId), revision })
    } catch (error) { return next(error) }
  })

  if (config.googleHealthEnabled) {
    app.get('/api/integrations/google-health/status', (_request, response) => response.json(googleHealth.status()))
    app.get('/api/integrations/google-health/connect', (_request, response, next) => {
      try { return response.redirect(googleHealth.createAuthorizationUrl()) } catch (error) { return next(error) }
    })
    app.get('/api/integrations/google-health/callback', async (request, response, next) => {
      try {
        const code = typeof request.query.code === 'string' ? request.query.code : ''
        const state = typeof request.query.state === 'string' ? request.query.state : ''
        if (!code || !state) return response.status(400).send('Google OAuth-Antwort unvollständig.')
        await googleHealth.handleCallback(code, state)
        return response.redirect('/?google=connected')
      } catch (error) { return next(error) }
    })
    app.post('/api/integrations/google-health/sync', async (_request, response, next) => {
      try { return response.json(await googleHealth.sync()) } catch (error) { return next(error) }
    })
    app.delete('/api/integrations/google-health', async (_request, response, next) => {
      try {
        await googleHealth.disconnect()
        return response.json({ disconnected: true })
      } catch (error) { return next(error) }
    })
  }

  app.use('/api', (_request, response) => response.status(404).json({ error: 'API-Endpunkt nicht gefunden.' }))

  if (fs.existsSync(config.distPath)) {
    app.use(express.static(config.distPath, { index: false, maxAge: '1h' }))
    app.get('*path', (_request, response) => response.sendFile(path.join(config.distPath, 'index.html')))
  }

  app.use((error: Error & { code?: string }, _request: Request, response: Response, _next: NextFunction) => {
    void _next
    console.error(error)
    if (error instanceof SyntaxError && 'body' in error) return response.status(400).json({ error: 'Ungültiges JSON.' })
    if (error.code === 'PROFILE_NOT_FOUND') return response.status(404).json({ error: error.message })
    if (error.code === 'IMPORT_PROFILE_FORBIDDEN' || error.code === 'DATA_INTEGRITY') return response.status(400).json({ error: error.message })
    if (error.code === 'REVISION_CONFLICT' || error.code === 'IMPORT_CONFLICT' || error.code === 'GYM_EXERCISE_CONFLICT') return response.status(409).json({ error: error.message })
    if (error.name === 'SqliteError' && ['SQLITE_CONSTRAINT_FOREIGNKEY', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error.code ?? '')) {
      return response.status(400).json({ error: 'Mutation verletzt die Datenintegrität.' })
    }
    return response.status(500).json({ error: error.message || 'Interner Serverfehler.' })
  })
  return app
}

function futureGoalError(goal: { createdAt: string; activityPeriods: { start: string; end?: string }[] }, today: string, timeZone: string) {
  if (goal.createdAt > today) return `Ziel-Beginndatum liegt in der Zukunft (${timeZone}).`
  if (goal.activityPeriods.some((period) => period.start > today || (period.end !== undefined && period.end > today))) {
    return `Ziel-Zeitraum enthält ein Datum in der Zukunft (${timeZone}).`
  }
  return undefined
}

function futureMutationError(mutation: DataMutation, today: string, timeZone: string) {
  if (mutation.kind === 'entry.set' && mutation.entry.date > today) return `Tagesziel-Datum liegt in der Zukunft (${timeZone}).`
  if (mutation.kind === 'body.upsert' && mutation.metric.date > today) return `Messdatum liegt in der Zukunft (${timeZone}).`
  if (mutation.kind === 'goal.upsert') return futureGoalError(mutation.goal, today, timeZone)
  if (mutation.kind === 'gym.session.complete' && mutation.session.date > today) return `Trainingstag liegt in der Zukunft (${timeZone}).`
  return undefined
}

function futureImportError(data: AppData, today: string, timeZone: string) {
  if (data.entries.some((entry) => entry.date > today)) return `Import enthält einen zukünftigen Tagesziel-Eintrag (${timeZone}).`
  if (data.bodyMetrics.some((metric) => metric.date > today)) return `Import enthält ein zukünftiges Messdatum (${timeZone}).`
  for (const goal of data.goals) {
    const error = futureGoalError(goal, today, timeZone)
    if (error) return `Import: ${error}`
  }
  if (data.gymSessions.some((session) => session.date > today)) return `Import enthält einen zukünftigen Trainingstag (${timeZone}).`
  return undefined
}

function validId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
}

function isDataMutation(value: unknown): value is DataMutation {
  if (!value || typeof value !== 'object') return false
  const mutation = value as Partial<DataMutation> & Record<string, unknown>
  if (!validId(mutation.id)) return false
  if (mutation.kind === 'goal.upsert') return isGoal(mutation.goal)
  if (mutation.kind === 'goal.delete') return validId(mutation.goalId)
  if (mutation.kind === 'body.upsert') return isBodyMetric(mutation.metric)
  if (mutation.kind === 'body.delete') return validId(mutation.metricId)
  if (mutation.kind === 'gym.template.upsert') return isGymTemplate(mutation.template)
  if (mutation.kind === 'gym.template.delete') return validId(mutation.templateId)
  if (mutation.kind === 'gym.session.complete') return isGymSession(mutation.session)
  if (mutation.kind === 'gym.session.delete') return validId(mutation.sessionId)
  if (mutation.kind === 'gym.exercise.merge') return validId(mutation.sourceExerciseId) && validId(mutation.targetExerciseId) && mutation.sourceExerciseId !== mutation.targetExerciseId &&
    typeof mutation.expectedSourceName === 'string' && mutation.expectedSourceName.trim().length > 0 && typeof mutation.expectedTargetName === 'string' && mutation.expectedTargetName.trim().length > 0
  if (mutation.kind === 'gym.exercise.rename') return validId(mutation.exerciseId) && typeof mutation.expectedName === 'string' && mutation.expectedName.trim().length > 0 &&
    typeof mutation.expectedUpdatedAt === 'string' && !Number.isNaN(Date.parse(mutation.expectedUpdatedAt)) && typeof mutation.name === 'string' && mutation.name.trim().length > 0 && mutation.name.trim().length <= 80 &&
    typeof mutation.updatedAt === 'string' && !Number.isNaN(Date.parse(mutation.updatedAt))
  if (mutation.kind === 'entry.set') {
    const entry = mutation.entry as Record<string, unknown> | undefined
    if (entry?.status === 'open') return validId(entry.goalId) && typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && typeof entry.updatedAt === 'string' && !Number.isNaN(Date.parse(entry.updatedAt))
    return isEntry(entry)
  }
  return false
}
