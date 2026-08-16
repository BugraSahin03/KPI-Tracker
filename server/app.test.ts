// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { PaceDatabase } from './db'
import { GoogleHealthService } from './google-health'
import { config } from './config'
import { todayKey } from '../src/lib/date'
import { legacyGymSetId } from '../src/lib/storage'

let database: PaceDatabase | undefined
afterEach(() => database?.close())

describe('Pace API', () => {
  it('liefert und verändert ausschließlich das explizit gewählte Profil', async () => {
    database = new PaceDatabase(':memory:')
    const app = createApp(database, new GoogleHealthService(database))
    const sena = await request(app).get('/api/data?profileId=profile-sena').expect(200)
    expect(sena.body).toMatchObject({ profileId: 'profile-sena', data: { goals: [], entries: [], bodyMetrics: [], gymTemplates: [], gymSessions: [] } })
    expect(sena.body.profiles).toHaveLength(2)
    const goal = database.getData('profile-bugra').goals[0]!
    await request(app).post('/api/mutations').send({ profileId: 'profile-sena', mutation: { id: 'sena-goal', kind: 'goal.upsert', goal: { ...goal, name: 'Senas Ziel' } } }).expect(200)
    expect((await request(app).get('/api/data?profileId=profile-sena')).body.data.goals[0].name).toBe('Senas Ziel')
    expect((await request(app).get('/api/data?profileId=profile-bugra')).body.data.goals.some((item: { name: string }) => item.name === 'Senas Ziel')).toBe(false)
    await request(app).get('/api/data?profileId=unbekannt').expect(404)
    await request(app).post('/api/import/local').send({ profileId: 'profile-sena', data: database.getData('profile-bugra'), onlyIfPristine: true }).expect(400)
  })
  it('wendet dieselbe Mutation nach verlorener Antwort nur einmal an', async () => {
    database = new PaceDatabase(':memory:')
    const app = createApp(database, new GoogleHealthService(database))
    const mutation = { id: 'mutation-lost-response', kind: 'entry.set', entry: { goalId: 'protein', date: '2026-08-01', status: 'done', updatedAt: new Date().toISOString() } }
    const first = await request(app).post('/api/mutations').send(mutation).expect(200)
    const retry = await request(app).post('/api/mutations').send(mutation).expect(200)
    expect(first.body.applied).toBe(true)
    expect(retry.body.applied).toBe(false)
    expect(retry.body.revision).toBe(first.body.revision)
    expect(retry.body.data.entries).toHaveLength(1)
  })

  it('schließt ein erneut zugestelltes Training mit stabiler Mutation-ID serverseitig nur einmal ab', async () => {
    database = new PaceDatabase(':memory:')
    const app = createApp(database, new GoogleHealthService(database))
    const startedAt = new Date(Date.now() - 60_000).toISOString()
    const completedAt = new Date().toISOString()
    const longExerciseId = `e${'x'.repeat(99)}`
    const mutation = {
      id: 'stable-gym-completion',
      kind: 'gym.session.complete',
      session: {
        id: 'stable-gym-session', templateName: 'Push', date: todayKey(), startedAt, completedAt,
        exercises: [{ id: longExerciseId, name: 'Bankdrücken', sets: 3, weightKg: 72.5, reps: 8, position: 0 }],
      },
    }

    const first = await request(app).post('/api/mutations').send(mutation).expect(200)
    const retry = await request(app).post('/api/mutations').send(mutation).expect(200)

    expect(first.body.applied).toBe(true)
    expect(retry.body.applied).toBe(false)
    expect(retry.body.revision).toBe(first.body.revision)
    expect(retry.body.data.gymSessions).toHaveLength(1)
    const ids = first.body.data.gymSessions[0].exercises[0].performedSets.map((set: { id: string }) => set.id)
    expect(ids).toEqual([1, 2, 3].map((number) => legacyGymSetId(longExerciseId, number)))
    expect(ids.every((id: string) => id.length <= 100)).toBe(true)
  })

  it('akzeptiert den Berliner Kalendertag direkt nach Mitternacht trotz UTC-Vortag', async () => {
    database = new PaceDatabase(':memory:')
    const instant = new Date('2026-08-06T22:30:00.000Z')
    const berlinApp = createApp(database, new GoogleHealthService(database), {
      now: () => instant,
      timeZone: 'Europe/Berlin',
    })
    const mutation = {
      id: 'berlin-midnight',
      kind: 'gym.session.complete',
      session: {
        id: 'berlin-midnight-session', templateName: 'Push', date: '2026-08-07',
        startedAt: '2026-08-06T22:05:00.000Z', completedAt: '2026-08-06T22:25:00.000Z',
        exercises: [{ id: 'berlin-midnight-exercise', name: 'Bankdrücken', sets: 3, weightKg: 72.5, reps: 8, position: 0 }],
      },
    }

    const accepted = await request(berlinApp).post('/api/mutations').send(mutation).expect(200)
    expect(accepted.body.applied).toBe(true)
    await request(berlinApp).post('/api/mutations').send({ id: 'berlin-body', kind: 'body.upsert', metric: { id: 'berlin-body', date: '2026-08-07', weightKg: 81, createdAt: '2026-08-06T22:20:00Z' } }).expect(200)

    database.close()
    database = new PaceDatabase(':memory:')
    const utcApp = createApp(database, new GoogleHealthService(database), {
      now: () => instant,
      timeZone: 'UTC',
    })
    await request(utcApp).post('/api/mutations').send({ ...mutation, id: 'utc-midnight' }).expect(400)
    await request(utcApp).post('/api/mutations').send({ id: 'utc-body', kind: 'body.upsert', metric: { id: 'utc-body', date: '2026-08-07', weightKg: 81, createdAt: '2026-08-06T22:20:00Z' } }).expect(400)
  })

  it('importiert lokale Daten nur in eine unveränderte Datenbank', async () => {
    database = new PaceDatabase(':memory:')
    const app = createApp(database, new GoogleHealthService(database))
    const current = (await request(app).get('/api/data')).body.data
    current.bodyMetrics.push({ id: 'old', date: '2026-07-01', muscleMassKg: 60, createdAt: new Date().toISOString() })
    await request(app).post('/api/import/local').send({ data: current, onlyIfPristine: true }).expect(200)
    await request(app).post('/api/import/local').send({ data: current, onlyIfPristine: true }).expect(409)
  })

  it('antwortet bei ungültigen Mutationen und Referenzen mit 400', async () => {
    database = new PaceDatabase(':memory:')
    const app = createApp(database, new GoogleHealthService(database))
    await request(app).post('/api/mutations').send({ id: 'bad', kind: 'body.upsert', metric: { id: 'empty', date: '2026-08-01', createdAt: 'not-a-time' } }).expect(400)
    await request(app).post('/api/mutations').send({ id: 'orphan', kind: 'entry.set', entry: { goalId: 'missing', date: '2026-08-01', status: 'done', updatedAt: '2026-08-01T12:00:00Z' } }).expect(400)
    const invalidTemplate = {
      id: 'gym-invalid', name: 'Push', createdAt: '2026-08-03T10:00:00Z', updatedAt: '2026-08-03T10:00:00Z',
      exercises: [
        { id: 'one', name: 'Bankdrücken', sets: 0, targetWeightKg: -1, targetReps: 8, position: 0 },
        { id: 'two', name: 'bankdrücken', sets: 3, targetWeightKg: 70, targetReps: 101, position: 1 },
      ],
    }
    await request(app).post('/api/mutations').send({ id: 'invalid-template', kind: 'gym.template.upsert', template: invalidTemplate }).expect(400)
    await request(app).post('/api/mutations').send({
      id: 'future-session', kind: 'gym.session.complete', session: {
        id: 'future', templateName: 'Push', date: '2099-01-01', startedAt: '2099-01-01T17:00:00Z', completedAt: '2099-01-01T18:00:00Z',
        exercises: [{ id: 'future-bench', name: 'Bankdrücken', sets: 3, weightKg: 70, reps: 8, position: 0 }],
      },
    }).expect(400)
    const duplicate = database.getData()
    duplicate.goals.push({ ...duplicate.goals[0]! })
    await request(app).post('/api/import/local').send({ data: duplicate, onlyIfPristine: true }).expect(400)
  })

  it('lässt Google Health bei ausgeschaltetem Feature vollständig ruhen', async () => {
    database = new PaceDatabase(':memory:')
    const previous = config.googleHealthEnabled
    config.googleHealthEnabled = false
    try {
      const app = createApp(database, new GoogleHealthService(database))
      const data = await request(app).get('/api/data').expect(200)
      expect(data.body.features.googleHealth).toBe(false)
      await request(app).get('/api/integrations/google-health/status').expect(404)
      await request(app).get('/api/integrations/google-health/connect').expect(404)
    } finally {
      config.googleHealthEnabled = previous
    }
  })

  it('erlaubt mehreren Tailscale-Identitäten API-Zugriff, aber hält Health lokal frei', async () => {
    database = new PaceDatabase(':memory:')
    const previous = config.allowedTailscaleUsers
    config.allowedTailscaleUsers = ['bugra@example.com', 'sena@example.com']
    try {
      const app = createApp(database, new GoogleHealthService(database))
      await request(app).get('/api/health').expect(200)
      await request(app).get('/api/data').expect(403)
      await request(app).get('/api/data').set('Tailscale-User-Login', 'bugra@example.com').expect(200)
      await request(app).get('/api/data').set('Tailscale-User-Login', 'sena@example.com').expect(200)
      await request(app).get('/api/data').set('Tailscale-User-Login', 'andere@example.com').expect(403)
    } finally {
      config.allowedTailscaleUsers = previous
    }
  })

  it('prüft Health ohne persönliche Daten und meldet Schema 6', async () => {
    database = new PaceDatabase(':memory:')
    const response = await request(createApp(database, new GoogleHealthService(database))).get('/api/health').expect(200)
    expect(response.body).toEqual({ status: 'ok', sqliteReady: true, schemaVersion: 6 })
    expect(JSON.stringify(response.body)).not.toContain('Bugra')
  })

  it('liefert bei nicht prüfbarer SQLite-Datenbank Health 503 ohne Details', async () => {
    database = new PaceDatabase(':memory:')
    database.health = () => { throw new Error('interner Dateipfad /secret/pace.sqlite') }
    const response = await request(createApp(database, new GoogleHealthService(database))).get('/api/health').expect(503)
    expect(response.body).toEqual({ status: 'unavailable', sqliteReady: false, schemaVersion: null })
    expect(JSON.stringify(response.body)).not.toContain('secret')
  })

  it('liefert bei unerwarteter Schemaversion Health 503', async () => {
    database = new PaceDatabase(':memory:')
    database.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(7, new Date().toISOString())
    const response = await request(createApp(database, new GoogleHealthService(database))).get('/api/health').expect(503)
    expect(response.body).toEqual({ status: 'unavailable', sqliteReady: false, schemaVersion: 7 })
  })

  it('setzt restriktive Browser-Sicherheitsheader', async () => {
    database = new PaceDatabase(':memory:')
    const response = await request(createApp(database, new GoogleHealthService(database))).get('/api/health').expect(200)
    expect(response.headers['permissions-policy']).toContain('camera=()')
    expect(response.headers['content-security-policy']).toContain("default-src 'self'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('verlangt in Produktion bei Schreibzugriffen exakt die konfigurierte Origin', async () => {
    database = new PaceDatabase(':memory:')
    const previousProduction = config.production
    const previousOrigin = config.publicOrigin
    config.production = true
    config.publicOrigin = 'https://pace.example.ts.net'
    try {
      const app = createApp(database, new GoogleHealthService(database))
      const mutation = { id: 'origin-entry', kind: 'entry.set', entry: { goalId: 'protein', date: '2026-08-01', status: 'done', updatedAt: '2026-08-01T12:00:00Z' } }
      await request(app).post('/api/mutations').send(mutation).expect(403)
      await request(app).post('/api/mutations').set('Origin', 'https://evil.example').send(mutation).expect(403)
      await request(app).post('/api/mutations').set('Origin', 'https://pace.example.ts.net').send(mutation).expect(200)
    } finally {
      config.production = previousProduction
      config.publicOrigin = previousOrigin
    }
  })

  it('lehnt zukünftige Messungen und Zielzeiträume ab, akzeptiert aber heute', async () => {
    database = new PaceDatabase(':memory:')
    const app = createApp(database, new GoogleHealthService(database), { now: () => new Date('2026-08-08T12:00:00Z'), timeZone: 'Europe/Berlin' })
    const baseMetric = { id: 'today-body', date: '2026-08-08', weightKg: 81, createdAt: '2026-08-08T12:00:00Z' }
    await request(app).post('/api/mutations').send({ id: 'today-body-mutation', kind: 'body.upsert', metric: baseMetric }).expect(200)
    await request(app).post('/api/mutations').send({ id: 'future-body-mutation', kind: 'body.upsert', metric: { ...baseMetric, id: 'future-body', date: '2026-08-09' } }).expect(400)
    const goal = database.getData().goals[0]!
    await request(app).post('/api/mutations').send({ id: 'future-goal-created', kind: 'goal.upsert', goal: { ...goal, createdAt: '2026-08-09' } }).expect(400)
    await request(app).post('/api/mutations').send({ id: 'future-goal-start', kind: 'goal.upsert', goal: { ...goal, activityPeriods: [{ start: '2026-08-09' }] } }).expect(400)
    await request(app).post('/api/mutations').send({ id: 'future-goal-end', kind: 'goal.upsert', goal: { ...goal, activityPeriods: [{ start: '2026-08-01', end: '2026-08-09' }] } }).expect(400)
    await request(app).post('/api/mutations').send({ id: 'future-entry', kind: 'entry.set', entry: { goalId: goal.id, date: '2026-08-09', status: 'done', updatedAt: '2026-08-08T12:00:00Z' } }).expect(400)
  })

  it('lehnt zukünftige Body-, Ziel- und GYM-Daten beim Import ab', async () => {
    const attempt = async (change: (data: ReturnType<PaceDatabase['getData']>) => void) => {
      database?.close()
      database = new PaceDatabase(':memory:')
      const data = database.getData()
      change(data)
      return request(createApp(database, new GoogleHealthService(database), { now: () => new Date('2026-08-08T12:00:00Z'), timeZone: 'Europe/Berlin' }))
        .post('/api/import/local').send({ data, onlyIfPristine: true }).expect(400)
    }
    await attempt((data) => data.bodyMetrics.push({ id: 'future-body', date: '2026-08-09', weightKg: 80, createdAt: '2026-08-08T12:00:00Z' }))
    await attempt((data) => data.entries.push({ goalId: 'protein', date: '2026-08-09', status: 'done', updatedAt: '2026-08-08T12:00:00Z' }))
    await attempt((data) => { data.goals[0]!.createdAt = '2026-08-09'; data.goals[0]!.activityPeriods = [{ start: '2026-08-09' }] })
    await attempt((data) => { data.goals[0]!.activityPeriods = [{ start: '2026-08-01', end: '2026-08-09' }] })
    await attempt((data) => data.gymSessions.push({ id: 'future-session', templateName: 'Push', date: '2026-08-09', startedAt: '2026-08-09T10:00:00Z', completedAt: '2026-08-09T11:00:00Z', exercises: [] }))
  })
})
