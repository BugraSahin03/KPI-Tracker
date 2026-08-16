// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PaceDatabase } from './db'
import { createInitialData } from '../src/lib/storage'

let database: PaceDatabase | undefined
afterEach(() => database?.close())

describe('PaceDatabase', () => {
  it('legt Bugra mit Startdaten und Sena vollständig leer an', () => {
    database = new PaceDatabase(':memory:')
    expect(database.listProfiles().map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'profile-bugra', name: 'Bugra' }, { id: 'profile-sena', name: 'Sena' },
    ])
    expect(database.getData('profile-bugra').goals).toHaveLength(2)
    expect(database.getData('profile-sena')).toEqual({ version: 3, goals: [], entries: [], bodyMetrics: [], gymTemplates: [], gymSessions: [] })
  })

  it('seedet den verbindlichen Berliner Tag statt des UTC-Hosttags', () => {
    database = new PaceDatabase(':memory:', { now: () => new Date('2026-08-06T22:30:00.000Z'), timeZone: 'Europe/Berlin' })
    expect(database.getData().goals.every((goal) => goal.createdAt === '2026-08-07')).toBe(true)
  })

  it('isoliert identische IDs, Referenzen, Löschungen und Mutationsreceipts nach Profil', () => {
    database = new PaceDatabase(':memory:')
    const goal = database.getData('profile-bugra').goals[0]!
    database.applyMutation('profile-sena', { id: 'same-receipt', kind: 'goal.upsert', goal: { ...goal, name: 'Senas Protein' } })
    database.applyMutation('profile-bugra', { id: 'same-receipt', kind: 'entry.set', entry: { goalId: goal.id, date: '2026-08-01', status: 'done', updatedAt: '2026-08-01T12:00:00Z' } })
    expect(database.getData('profile-sena').goals).toEqual([expect.objectContaining({ id: goal.id, name: 'Senas Protein' })])
    expect(database.getData('profile-bugra').entries).toHaveLength(1)
    database.applyMutation('profile-sena', { id: 'delete-sena', kind: 'goal.delete', goalId: goal.id })
    expect(database.getData('profile-sena').goals).toHaveLength(0)
    expect(database.getData('profile-bugra').goals).toHaveLength(2)
    expect(() => database!.applyMutation('profile-sena', { id: 'orphan-sena', kind: 'entry.set', entry: { goalId: goal.id, date: '2026-08-01', status: 'done', updatedAt: '2026-08-01T12:00:00Z' } })).toThrow(/Datenintegrität/)
  })

  it('bewahrt Session-Snapshots bei profilbezogener Vorlagenlöschung', () => {
    database = new PaceDatabase(':memory:')
    const template = database.getData('profile-bugra').gymTemplates[0]!
    database.applyMutation('profile-bugra', { id: 'template-exercise', kind: 'gym.template.upsert', template: { ...template, exercises: [{ id: 'bench', name: 'Bankdrücken', sets: 3, targetReps: 8, position: 0 }] } })
    database.applyMutation('profile-bugra', { id: 'session', kind: 'gym.session.complete', session: { id: 'session', templateId: template.id, templateName: template.name, date: '2026-08-01', startedAt: '2026-08-01T10:00:00Z', completedAt: '2026-08-01T11:00:00Z', exercises: [{ id: 'session-bench', templateExerciseId: 'bench', name: 'Bankdrücken', sets: 3, reps: 8, position: 0 }] } })
    database.applyMutation('profile-bugra', { id: 'delete-template', kind: 'gym.template.delete', templateId: template.id })
    const stored = database.getData('profile-bugra').gymSessions[0]!
    expect(stored).toMatchObject({ templateName: template.name })
    expect(stored).not.toHaveProperty('templateId')
  })
  it('legt Push, Pull und Beine exakt einmal als leere Startvorlagen an', () => {
    database = new PaceDatabase(':memory:')
    expect(database.getData().gymTemplates.map((template) => [template.name, template.exercises.length])).toEqual([
      ['Push', 0], ['Pull', 0], ['Beine', 0],
    ])
  })

  it('verwaltet Vorlagen und hält abgeschlossene Sessions als stabilen Snapshot', () => {
    database = new PaceDatabase(':memory:')
    const push = database.getData().gymTemplates.find((template) => template.name === 'Push')!
    const template = { ...push, updatedAt: '2026-08-03T10:00:00Z', exercises: [{ id: 'bench', name: 'Bankdrücken', sets: 3, targetWeightKg: 70, targetReps: 8, position: 0 }] }
    database.applyMutation({ id: 'save-push', kind: 'gym.template.upsert', template })
    const session = {
      id: 'session-one', templateId: push.id, templateName: 'Push', date: '2026-08-03', startedAt: '2026-08-03T17:00:00Z', completedAt: '2026-08-03T18:00:00Z',
      exercises: [{ id: 'session-bench', templateExerciseId: 'bench', name: 'Bankdrücken', sets: 3, weightKg: 72.5, reps: 8, position: 0 }],
    }
    expect(database.applyMutation({ id: 'complete-one', kind: 'gym.session.complete', session }).applied).toBe(true)
    database.applyMutation({ id: 'rename-push', kind: 'gym.template.upsert', template: { ...template, name: 'Push neu', exercises: [{ ...template.exercises[0]!, name: 'Schrägbank' }], updatedAt: '2026-08-03T19:00:00Z' } })
    database.applyMutation({ id: 'delete-push', kind: 'gym.template.delete', templateId: push.id })
    expect(database.getData().gymSessions).toEqual([expect.objectContaining({ templateName: 'Push', exercises: [expect.objectContaining({ name: 'Bankdrücken', weightKg: 72.5, performedSets: [
      expect.objectContaining({ setNumber: 1, weightKg: 72.5, reps: 8 }),
      expect.objectContaining({ setNumber: 2, weightKg: 72.5, reps: 8 }),
      expect.objectContaining({ setNumber: 3, weightKg: 72.5, reps: 8 }),
    ] })] })])
    expect(database.applyMutation({ id: 'complete-again-new-receipt', kind: 'gym.session.complete', session }).applied).toBe(false)
    expect(database.getData().gymSessions).toHaveLength(1)
    database.applyMutation({ id: 'delete-session', kind: 'gym.session.delete', sessionId: session.id })
    expect(database.getData().gymSessions).toHaveLength(0)
  })

  it('migriert Schema-5-Aggregate verlustfrei in einzelne Satzzeilen', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-schema5-'))
    const filename = path.join(root, 'pace.sqlite')
    try {
      database = new PaceDatabase(filename)
      const template = database.getData().gymTemplates[0]!
      const longExerciseId = `e${'m'.repeat(99)}`
      database.db.exec('DROP TABLE gym_session_sets; DELETE FROM schema_migrations WHERE version=6;')
      database.db.prepare('INSERT INTO gym_template_exercises(profile_id,id,template_id,name,sets,target_weight_kg,target_reps,position) VALUES (?,?,?,?,?,?,?,?)')
        .run('profile-bugra', longExerciseId, template.id, 'Deadlift', 3, 100, 20, 0)
      database.db.prepare('INSERT INTO gym_sessions(profile_id,id,template_id,template_name,date,started_at,completed_at) VALUES (?,?,?,?,?,?,?)')
        .run('profile-bugra', 'legacy-session', template.id, template.name, '2026-08-01', '2026-08-01T10:00:00Z', '2026-08-01T11:00:00Z')
      database.db.prepare('INSERT INTO gym_session_exercises(profile_id,id,session_id,template_exercise_id,name,sets,weight_kg,reps,position) VALUES (?,?,?,?,?,?,?,?,?)')
        .run('profile-bugra', longExerciseId, 'legacy-session', longExerciseId, 'Deadlift', 3, 100, 20, 0)
      database.close()
      database = new PaceDatabase(filename)
      expect(database.health()).toEqual({ sqliteReady: true, schemaVersion: 6 })
      const migratedSets = database.getData().gymSessions[0]?.exercises[0]?.performedSets
      expect(migratedSets).toEqual([
        expect.objectContaining({ setNumber: 1, weightKg: 100, reps: 20 }),
        expect.objectContaining({ setNumber: 2, weightKg: 100, reps: 20 }),
        expect.objectContaining({ setNumber: 3, weightKg: 100, reps: 20 }),
      ])
      expect(migratedSets?.every((set) => set.id.length <= 100)).toBe(true)
      const ids = migratedSets?.map((set) => set.id)
      database.close()
      database = new PaceDatabase(filename)
      expect(database.getData().gymSessions[0]?.exercises[0]?.performedSets?.map((set) => set.id)).toEqual(ids)
    } finally {
      database?.close()
      database = undefined
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('persistiert unterschiedliche Satzwerte profilisoliert und lädt sie unverändert', () => {
    database = new PaceDatabase(':memory:')
    const makeSession = (weight: number) => ({
      id: 'same-session', templateName: 'Pull', date: '2026-08-01', startedAt: '2026-08-01T10:00:00Z', completedAt: '2026-08-01T11:00:00Z',
      exercises: [{
        id: 'same-exercise', templateExerciseId: 'stable-row', name: 'Deadlift', sets: 3, weightKg: weight, reps: 8, position: 0,
        performedSets: [
          { id: 'same-set-1', setNumber: 1, weightKg: weight, reps: 8 },
          { id: 'same-set-2', setNumber: 2, weightKg: weight + 2.5, reps: 7 },
          { id: 'same-set-3', setNumber: 3, weightKg: weight + 5, reps: 6 },
        ],
      }],
    })
    database.applyMutation('profile-bugra', { id: 'same-receipt', kind: 'gym.session.complete', session: makeSession(100) })
    database.applyMutation('profile-sena', { id: 'same-receipt', kind: 'gym.session.complete', session: makeSession(50) })
    expect(database.getData('profile-bugra').gymSessions[0]?.exercises[0]?.performedSets?.map(({ weightKg, reps }) => [weightKg, reps])).toEqual([[100, 8], [102.5, 7], [105, 6]])
    expect(database.getData('profile-sena').gymSessions[0]?.exercises[0]?.performedSets?.map(({ weightKg, reps }) => [weightKg, reps])).toEqual([[50, 8], [52.5, 7], [55, 6]])
  })

  it('speichert einen vollständigen Stand transaktional mit Revision', () => {
    database = new PaceDatabase(':memory:')
    const data = createInitialData('2026-08-01')
    data.entries.push({ goalId: 'protein', date: '2026-08-01', status: 'done', updatedAt: new Date().toISOString() })
    expect(database.replaceData(data, 0)).toBe(1)
    expect(database.getData().entries).toEqual(data.entries)
    expect(() => database!.replaceData(data, 0)).toThrow(/zwischenzeitlich/)
  })

  it('dedupliziert Google-Datenpunkte und führt Gewicht und Fett zeitnah zusammen', () => {
    database = new PaceDatabase(':memory:')
    const base = { date: '2026-08-01', measuredAt: '2026-08-01T08:10:00Z', raw: {} }
    expect(database.upsertGooglePoint({ ...base, externalId: 'weight-1', weightKg: 80 }).inserted).toBe(true)
    expect(database.upsertGooglePoint({ ...base, externalId: 'weight-1', weightKg: 80 }).inserted).toBe(false)
    database.upsertGooglePoint({ ...base, externalId: 'fat-1', measuredAt: '2026-08-01T08:11:00Z', bodyFatPercent: 20 })
    const metrics = database.getData().bodyMetrics
    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({ weightKg: 80, bodyFatPercent: 20, leanBodyMassKg: 64, source: 'google-health' })
  })

  it('ergänzt eine manuelle Muskelmessung später mit Google-Werten', () => {
    database = new PaceDatabase(':memory:')
    database.applyMutation({ id: 'manual-first', kind: 'body.upsert', metric: { id: 'manual-1', date: '2026-08-01', muscleMassKg: 60, source: 'manual', createdAt: '2026-08-01T09:00:00Z' } })
    database.upsertGooglePoint({ externalId: 'google-weight', date: '2026-08-01', measuredAt: '2026-08-01T07:00:00Z', weightKg: 80, raw: {} })
    database.upsertGooglePoint({ externalId: 'google-fat', date: '2026-08-01', measuredAt: '2026-08-01T07:01:00Z', bodyFatPercent: 20, raw: {} })
    expect(database.getData().bodyMetrics).toEqual([expect.objectContaining({ id: 'manual-1', muscleMassKg: 60, weightKg: 80, bodyFatPercent: 20, source: 'mixed', measuredAt: '2026-08-01T07:01:00Z' })])
  })

  it('ergänzt einen Google-Datensatz manuell und behält dessen Deduplizierung', () => {
    database = new PaceDatabase(':memory:')
    const point = { externalId: 'google-first', date: '2026-08-01', measuredAt: '2026-08-01T07:00:00Z', weightKg: 80, raw: {} }
    const metricId = database.upsertGooglePoint(point).metricId
    const metric = database.getData().bodyMetrics[0]!
    database.applyMutation({ id: 'manual-after', kind: 'body.upsert', metric: { ...metric, muscleMassKg: 61, source: 'mixed' } })
    expect(database.upsertGooglePoint(point).inserted).toBe(false)
    expect(database.getData().bodyMetrics).toEqual([expect.objectContaining({ id: metricId, weightKg: 80, muscleMassKg: 61 })])
  })

  it('verliert bei parallelem Google-Sync keine unabhängige UI-Mutation', () => {
    database = new PaceDatabase(':memory:')
    database.upsertGooglePoint({ externalId: 'parallel-weight', date: '2026-08-01', measuredAt: '2026-08-01T07:00:00Z', weightKg: 80, raw: {} })
    database.applyMutation({ id: 'parallel-entry', kind: 'entry.set', entry: { goalId: 'protein', date: '2026-08-01', status: 'done', updatedAt: '2026-08-01T12:00:00Z' } })
    expect(database.getData()).toMatchObject({ entries: [{ status: 'done' }], bodyMetrics: [{ weightKg: 80 }] })
  })

  it('löscht nur die gewählte Messung und verhindert deren erneuten Google-Import', () => {
    database = new PaceDatabase(':memory:')
    const first = { externalId: 'delete-me', date: '2026-08-01', measuredAt: '2026-08-01T07:00:00Z', weightKg: 80, raw: {} }
    const firstId = database.upsertGooglePoint(first).metricId
    database.upsertGooglePoint({ externalId: 'keep-me', date: '2026-08-01', measuredAt: '2026-08-01T18:00:00Z', weightKg: 81, raw: {} })
    database.applyMutation({ id: 'delete-one', kind: 'body.delete', metricId: firstId })
    expect(database.getData().bodyMetrics).toHaveLength(1)
    expect(database.upsertGooglePoint(first).inserted).toBe(false)
    expect(database.getData().bodyMetrics).toHaveLength(1)
  })

  it('erlaubt lokalen Import nur beim unveränderten exakten Seed', () => {
    database = new PaceDatabase(':memory:')
    database.db.prepare("UPDATE goals SET name='Protein geändert' WHERE id='protein'").run()
    expect(() => database!.importIfPristine(createInitialData('2026-01-01'))).toThrow(/bearbeitete Daten/)
    database.close()
    database = new PaceDatabase(':memory:')
    database.db.prepare("DELETE FROM goals WHERE id='water'").run()
    expect(() => database!.importIfPristine(createInitialData('2026-01-01'))).toThrow(/bearbeitete Daten/)
  })

  it('sortiert mehrere Tagesmessungen deterministisch mit der neuesten Messung zuerst', () => {
    database = new PaceDatabase(':memory:')
    database.applyMutation({ id: 'morning-mutation', kind: 'body.upsert', metric: { id: 'morning', date: '2026-08-01', weightKg: 80, measuredAt: '2026-08-01T08:00:00Z', createdAt: '2026-08-01T08:01:00Z' } })
    database.applyMutation({ id: 'evening-mutation', kind: 'body.upsert', metric: { id: 'evening', date: '2026-08-01', weightKg: 81, measuredAt: '2026-08-01T20:00:00Z', createdAt: '2026-08-01T20:01:00Z' } })
    expect(database.getData().bodyMetrics.map((metric) => metric.weightKg)).toEqual([81, 80])
  })

  it('sortiert Messzeiten mit verschiedenen UTC-Offsets chronologisch', () => {
    database = new PaceDatabase(':memory:')
    database.applyMutation({ id: 'offset-old-mutation', kind: 'body.upsert', metric: { id: 'offset-old', date: '2026-08-01', weightKg: 80, measuredAt: '2026-08-01T09:00:00+02:00', createdAt: '2026-08-01T09:01:00+02:00' } })
    database.applyMutation({ id: 'offset-new-mutation', kind: 'body.upsert', metric: { id: 'offset-new', date: '2026-08-01', weightKg: 81, measuredAt: '2026-08-01T08:30:00Z', createdAt: '2026-08-01T08:31:00Z' } })
    expect(database.getData().bodyMetrics.map((metric) => metric.id)).toEqual(['offset-new', 'offset-old'])
  })

  it('meldet bei einer unerwarteten Schemaversion nicht ready', () => {
    database = new PaceDatabase(':memory:')
    database.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(7, new Date().toISOString())
    expect(database.health()).toEqual({ sqliteReady: false, schemaVersion: 7 })
  })

  it('verwaltet OAuth-States parallel und verbraucht jeden nur einmal', () => {
    database = new PaceDatabase(':memory:')
    database.addOauthState('one', new Date(Date.now() + 60_000).toISOString())
    database.addOauthState('two', new Date(Date.now() + 60_000).toISOString())
    expect(database.consumeOauthState('one')).toBe(true)
    expect(database.consumeOauthState('one')).toBe(false)
    expect(database.consumeOauthState('two')).toBe(true)
    database.addOauthState('expired', new Date(Date.now() - 1).toISOString())
    expect(database.consumeOauthState('expired')).toBe(false)
  })
})
