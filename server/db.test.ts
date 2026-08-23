// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
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
    expect(database.getData('profile-sena')).toEqual({ version: 3, goals: [], entries: [], bodyMetrics: [], gymTemplates: [], gymSessions: [], gymExercises: [] })
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
    const canonicalId = database.getData().gymTemplates.find((item) => item.id === push.id)!.exercises[0]!.exerciseId
    const session = {
      id: 'session-one', templateId: push.id, templateName: 'Push', date: '2026-08-03', startedAt: '2026-08-03T17:00:00Z', completedAt: '2026-08-03T18:00:00Z',
      exercises: [{ id: 'session-bench', templateExerciseId: 'bench', name: 'Bankdrücken', sets: 3, weightKg: 72.5, reps: 8, position: 0 }],
    }
    expect(database.applyMutation({ id: 'complete-one', kind: 'gym.session.complete', session }).applied).toBe(true)
    database.applyMutation({ id: 'rename-push', kind: 'gym.template.upsert', template: { ...template, name: 'Push neu', exercises: [{ ...template.exercises[0]!, name: 'Schrägbank' }], updatedAt: '2026-08-03T19:00:00Z' } })
    const beforeRename = database.getData().gymExercises!.find((exercise) => exercise.id === canonicalId)!
    expect(beforeRename.name).toBe('Bankdrücken')
    database.applyMutation({ id: 'rename-bench-explicitly', kind: 'gym.exercise.rename', exerciseId: canonicalId!, expectedName: beforeRename.name, expectedUpdatedAt: beforeRename.updatedAt, name: 'Schrägbank', updatedAt: '2026-08-03T19:01:00Z' })
    database.applyMutation({ id: 'delete-push', kind: 'gym.template.delete', templateId: push.id })
    expect(database.getData().gymSessions).toEqual([expect.objectContaining({ templateName: 'Push', exercises: [expect.objectContaining({ name: 'Schrägbank', weightKg: 72.5, performedSets: [
      expect.objectContaining({ setNumber: 1, weightKg: 72.5, reps: 8 }),
      expect.objectContaining({ setNumber: 2, weightKg: 72.5, reps: 8 }),
      expect.objectContaining({ setNumber: 3, weightKg: 72.5, reps: 8 }),
    ] })] })])
    expect(database.getData().gymSessions[0]!.exercises[0]!.exerciseId).toBe(canonicalId)
    expect(database.getData().gymExercises).toContainEqual(expect.objectContaining({ id: canonicalId, name: 'Schrägbank' }))
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
      expect(database.health()).toEqual({ sqliteReady: true, schemaVersion: 9 })
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

  it('migriert Schema 6 auf 7 mit sicheren Standardwerten', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-schema6-'))
    const filename = path.join(root, 'pace.sqlite')
    try {
      const legacy = new Database(filename)
      for (const version of [1, 2, 3, 4, 5, 6]) {
        const migration = fs.readFileSync(path.resolve(`server/migrations/00${version}_${['initial', 'mutations_and_oauth_states', 'integration_tombstones', 'gym_tracking', 'profiles', 'gym_session_sets'][version - 1]}.sql`), 'utf8')
        legacy.exec(migration)
        legacy.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(version, '2026-08-01T00:00:00Z')
      }
      legacy.prepare('INSERT INTO app_state(singleton,revision,initialized_at,seed_pristine) VALUES (1,0,?,0)').run('2026-08-01T00:00:00Z')
      legacy.prepare('INSERT INTO gym_template_exercises(profile_id,id,template_id,name,sets,target_weight_kg,target_reps,position) VALUES (?,?,?,?,?,?,?,?)')
        .run('profile-bugra', 'bench', 'gym-template-push', 'Bankdrücken', 3, 40, 8, 0)
      legacy.prepare('INSERT INTO gym_sessions(profile_id,id,template_id,template_name,date,started_at,completed_at) VALUES (?,?,?,?,?,?,?)')
        .run('profile-bugra', 'legacy-session', 'gym-template-push', 'Push', '2026-08-01', '2026-08-01T10:00:00Z', '2026-08-01T11:00:00Z')
      legacy.prepare('INSERT INTO gym_session_exercises(profile_id,id,session_id,template_exercise_id,name,sets,weight_kg,reps,position) VALUES (?,?,?,?,?,?,?,?,?)')
        .run('profile-bugra', 'legacy-bench', 'legacy-session', 'bench', 'Bankdrücken', 3, 40, 8, 0)
      legacy.close()

      database = new PaceDatabase(filename)
      expect(database.health()).toEqual({ sqliteReady: true, schemaVersion: 9 })
      expect(database.getData().gymTemplates[0]?.exercises[0]).toEqual(expect.objectContaining({ targetReps: 8 }))
      expect(database.getData().gymTemplates[0]?.exercises[0]).not.toHaveProperty('targetRepsMax')
      expect(database.getData().gymSessions[0]?.exercises[0]).not.toHaveProperty('increaseNextTime')
      expect(database.getData().gymSessions[0]?.exercises[0]).not.toHaveProperty('completed')
    } finally {
      database?.close()
      database = undefined
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('migriert v7 ohne Namens-Automerge und verbindet Übungen später atomar samt Historie', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-schema7-library-'))
    const filename = path.join(root, 'pace.sqlite')
    try {
      const legacy = new Database(filename)
      const names = ['initial', 'mutations_and_oauth_states', 'integration_tombstones', 'gym_tracking', 'profiles', 'gym_session_sets', 'gym_progress']
      for (let version = 1; version <= 7; version++) {
        legacy.exec(fs.readFileSync(path.resolve(`server/migrations/00${version}_${names[version - 1]}.sql`), 'utf8'))
        legacy.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(version, '2026-08-01T00:00:00Z')
      }
      legacy.prepare('INSERT INTO app_state(singleton,revision,initialized_at,seed_pristine) VALUES (1,0,?,0)').run('2026-08-01T00:00:00Z')
      legacy.prepare("UPDATE gym_templates SET name='Upper' WHERE profile_id='profile-bugra' AND id='gym-template-push'").run()
      legacy.prepare("UPDATE gym_templates SET name='Fullbody' WHERE profile_id='profile-bugra' AND id='gym-template-pull'").run()
      const insertTemplateExercise = legacy.prepare('INSERT INTO gym_template_exercises(profile_id,id,template_id,name,sets,target_reps,position) VALUES (?,?,?,?,?,?,?)')
      insertTemplateExercise.run('profile-bugra', 'upper-biceps', 'gym-template-push', 'Bizeps Curls', 3, 10, 0)
      insertTemplateExercise.run('profile-bugra', 'full-biceps', 'gym-template-pull', 'Bizeps Curls', 4, 8, 0)
      insertTemplateExercise.run('profile-bugra', 'full-triceps', 'gym-template-pull', 'Trizeps Pushdowns', 3, 12, 1)
      insertTemplateExercise.run('profile-bugra', 'deleted-triceps', 'gym-template-beine', 'Trizeps Pushdowns', 3, 12, 0)
      const insertSession = legacy.prepare('INSERT INTO gym_sessions(profile_id,id,template_id,template_name,date,started_at,completed_at) VALUES (?,?,?,?,?,?,?)')
      const insertExercise = legacy.prepare('INSERT INTO gym_session_exercises(profile_id,id,session_id,template_exercise_id,name,sets,reps,position) VALUES (?,?,?,?,?,?,?,?)')
      insertSession.run('profile-bugra', 'upper-session', 'gym-template-push', 'Upper', '2026-08-01', '2026-08-01T10:00:00Z', '2026-08-01T11:00:00Z')
      insertExercise.run('profile-bugra', 'upper-session-biceps', 'upper-session', 'upper-biceps', 'Bizeps Curls', 3, 10, 0)
      insertSession.run('profile-bugra', 'deleted-session', 'gym-template-beine', 'Arme', '2026-08-02', '2026-08-02T10:00:00Z', '2026-08-02T11:00:00Z')
      insertExercise.run('profile-bugra', 'deleted-session-triceps', 'deleted-session', 'deleted-triceps', 'Trizeps Pushdowns', 3, 12, 0)
      legacy.prepare("DELETE FROM gym_templates WHERE profile_id='profile-bugra' AND id='gym-template-beine'").run()
      legacy.close()

      database = new PaceDatabase(filename)
      const migrated = database.getData('profile-bugra')
      const curls = migrated.gymExercises!.filter((exercise) => exercise.name === 'Bizeps Curls')
      expect(curls).toHaveLength(2)
      expect(migrated.gymExercises!.filter((exercise) => exercise.name === 'Trizeps Pushdowns')).toHaveLength(2)
      const pushRef = migrated.gymTemplates.find((template) => template.id === 'gym-template-push')!.exercises[0]!.exerciseId
      const pullRef = migrated.gymTemplates.find((template) => template.id === 'gym-template-pull')!.exercises[0]!.exerciseId
      expect(pushRef).not.toBe(pullRef)
      expect(migrated.gymSessions.find((session) => session.id === 'upper-session')!.exercises[0]!.exerciseId).toBe(pushRef)
      expect(migrated.gymSessions.find((session) => session.id === 'deleted-session')!.exercises[0]).toMatchObject({ name: 'Trizeps Pushdowns', exerciseId: expect.any(String) })

      const first = database.applyMutation('profile-bugra', { id: 'merge-curls', kind: 'gym.exercise.merge', sourceExerciseId: pullRef!, targetExerciseId: pushRef!, expectedSourceName: 'Bizeps Curls', expectedTargetName: 'Bizeps Curls' })
      const retry = database.applyMutation('profile-bugra', { id: 'merge-curls', kind: 'gym.exercise.merge', sourceExerciseId: pullRef!, targetExerciseId: pushRef!, expectedSourceName: 'Bizeps Curls', expectedTargetName: 'Bizeps Curls' })
      expect(first.applied).toBe(true)
      expect(retry.applied).toBe(false)
      const merged = database.getData('profile-bugra')
      expect(merged.gymExercises!.filter((exercise) => exercise.name === 'Bizeps Curls')).toHaveLength(1)
      expect(merged.gymTemplates.flatMap((template) => template.exercises).filter((exercise) => exercise.name === 'Bizeps Curls').map((exercise) => exercise.exerciseId)).toEqual([pushRef, pushRef])
      expect(merged.gymTemplates.flatMap((template) => template.exercises).filter((exercise) => exercise.name === 'Bizeps Curls').map(({ sets, targetReps }) => [sets, targetReps])).toEqual([[3, 10], [4, 8]])
      expect(merged.gymSessions).toHaveLength(2)
      const tricepsRef = merged.gymSessions.find((session) => session.id === 'deleted-session')!.exercises[0]!.exerciseId!
      database.applyMutation('profile-bugra', { id: 'merge-different-names', kind: 'gym.exercise.merge', sourceExerciseId: tricepsRef, targetExerciseId: pushRef!, expectedSourceName: 'Trizeps Pushdowns', expectedTargetName: 'Bizeps Curls' })
      expect(database.getData('profile-bugra').gymSessions.find((session) => session.id === 'deleted-session')!.exercises[0]).toMatchObject({ exerciseId: pushRef, name: 'Bizeps Curls' })
      expect(database.getData('profile-sena').gymExercises).toEqual([])
    } finally {
      database?.close()
      database = undefined
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('migriert sowohl altes Schema 8 ohne Alias-Tabelle als auch Entwicklungsschema 8 mit Alias-Tabelle auf 9', () => {
    for (const aliasesAlreadyPresent of [false, true]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `pace-schema8-alias-${aliasesAlreadyPresent}-`))
      const filename = path.join(root, 'pace.sqlite')
      try {
        const legacy = new Database(filename)
        const names = ['initial', 'mutations_and_oauth_states', 'integration_tombstones', 'gym_tracking', 'profiles', 'gym_session_sets', 'gym_progress', 'gym_exercise_library']
        for (let version = 1; version <= 8; version++) {
          legacy.exec(fs.readFileSync(path.resolve(`server/migrations/00${version}_${names[version - 1]}.sql`), 'utf8'))
          legacy.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(version, '2026-08-01T00:00:00Z')
        }
        if (aliasesAlreadyPresent) legacy.exec(`CREATE TABLE gym_exercise_aliases (
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (profile_id, source_id),
          FOREIGN KEY (profile_id, target_id) REFERENCES gym_exercises(profile_id, id) ON DELETE RESTRICT,
          CHECK (source_id <> target_id));
          CREATE INDEX gym_exercise_aliases_target_idx ON gym_exercise_aliases(profile_id,target_id);`)
        legacy.close()
        database = new PaceDatabase(filename)
        expect(database.health()).toEqual({ sqliteReady: true, schemaVersion: 9 })
        expect(database.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gym_exercise_aliases'").get()).toBeTruthy()
        database.close()
        database = undefined
      } finally {
        database?.close()
        database = undefined
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  })

  it('wählt für gelöschte Template-Historie den neuesten Namen mit stabilem ID-Tie-Breaker', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-schema7-latest-name-'))
    const filename = path.join(root, 'pace.sqlite')
    try {
      const legacy = new Database(filename)
      const names = ['initial', 'mutations_and_oauth_states', 'integration_tombstones', 'gym_tracking', 'profiles', 'gym_session_sets', 'gym_progress']
      for (let version = 1; version <= 7; version++) {
        legacy.exec(fs.readFileSync(path.resolve(`server/migrations/00${version}_${names[version - 1]}.sql`), 'utf8'))
        legacy.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(version, '2026-08-01T00:00:00Z')
      }
      legacy.prepare('INSERT INTO app_state(singleton,revision,initialized_at,seed_pristine) VALUES (1,0,?,0)').run('2026-08-01T00:00:00Z')
      const insertSession = legacy.prepare('INSERT INTO gym_sessions(profile_id,id,template_id,template_name,date,started_at,completed_at) VALUES (?,?,?,?,?,?,?)')
      const insertExercise = legacy.prepare('INSERT INTO gym_session_exercises(profile_id,id,session_id,template_exercise_id,name,sets,reps,position) VALUES (?,?,?,?,?,?,?,?)')
      insertSession.run('profile-bugra', 'old', 'gym-template-beine', 'Beine', '2026-08-01', '2026-08-01T10:00:00Z', '2026-08-01T11:00:00Z')
      insertExercise.run('profile-bugra', 'old-row', 'old', 'deleted-row', 'Alter Name', 3, 10, 0)
      insertSession.run('profile-bugra', 'tie-a', 'gym-template-beine', 'Beine', '2026-08-02', '2026-08-02T10:00:00Z', '2026-08-02T11:00:00Z')
      insertExercise.run('profile-bugra', 'tie-a-row', 'tie-a', 'deleted-row', 'Neuer Name A', 3, 10, 0)
      insertSession.run('profile-bugra', 'tie-z', 'gym-template-beine', 'Beine', '2026-08-02', '2026-08-02T10:00:00Z', '2026-08-02T11:00:00Z')
      insertExercise.run('profile-bugra', 'tie-z-row', 'tie-z', 'deleted-row', 'Neuer Name Z', 3, 10, 0)
      legacy.prepare("DELETE FROM gym_templates WHERE profile_id='profile-bugra' AND id='gym-template-beine'").run()
      legacy.close()
      database = new PaceDatabase(filename)
      const linked = database.getData('profile-bugra').gymSessions.filter((session) => ['old', 'tie-a', 'tie-z'].includes(session.id)).map((session) => session.exercises[0]!)
      expect(new Set(linked.map((exercise) => exercise.exerciseId)).size).toBe(1)
      expect(linked.every((exercise) => exercise.name === 'Neuer Name Z')).toBe(true)
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
        id: 'same-exercise', templateExerciseId: 'stable-row', name: 'Deadlift', sets: 3, weightKg: weight, reps: 8,
        targetReps: 8, targetRepsMax: 12, increaseNextTime: weight === 100, completed: true, position: 0,
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
    expect(database.getData('profile-bugra').gymSessions[0]?.exercises[0]).toMatchObject({ targetReps: 8, targetRepsMax: 12, increaseNextTime: true, completed: true })
    expect(database.getData('profile-sena').gymSessions[0]?.exercises[0]).toMatchObject({ targetReps: 8, targetRepsMax: 12, completed: true })
    expect(database.getData('profile-sena').gymSessions[0]?.exercises[0]).not.toHaveProperty('increaseNextTime')
  })

  it('hält Merge-Aliase über veraltete Upserts, Sessions, Transitivität und Profile stabil', () => {
    database = new PaceDatabase(':memory:')
    const [push, pull, legs] = database.getData('profile-bugra').gymTemplates
    const at = '2026-08-20T10:00:00Z'
    database.applyMutation('profile-bugra', { id: 'alias-source-setup', kind: 'gym.template.upsert', template: { ...push!, updatedAt: at, exercises: [{ id: 'source-row', exerciseId: 'alias-source', name: 'Source', sets: 3, targetReps: 10, position: 0 }] } })
    database.applyMutation('profile-bugra', { id: 'alias-target-setup', kind: 'gym.template.upsert', template: { ...pull!, updatedAt: at, exercises: [{ id: 'target-row', exerciseId: 'alias-target', name: 'Target', sets: 4, targetReps: 8, position: 0 }] } })
    database.applyMutation('profile-bugra', { id: 'alias-merge', kind: 'gym.exercise.merge', sourceExerciseId: 'alias-source', targetExerciseId: 'alias-target', expectedSourceName: 'Source', expectedTargetName: 'Target' })

    database.applyMutation('profile-bugra', { id: 'stale-template-after-alias', kind: 'gym.template.upsert', template: { ...push!, updatedAt: '2026-08-20T11:00:00Z', exercises: [{ id: 'stale-new-row', exerciseId: 'alias-source', name: 'Stale Name', sets: 2, targetReps: 12, position: 0 }] } })
    database.applyMutation('profile-bugra', { id: 'stale-session-after-alias', kind: 'gym.session.complete', session: { id: 'stale-session', templateName: 'Push', date: '2026-08-20', startedAt: '2026-08-20T12:00:00Z', completedAt: '2026-08-20T13:00:00Z', exercises: [{ id: 'stale-session-row', exerciseId: 'alias-source', name: 'Noch älter', sets: 2, reps: 12, position: 0 }] } })
    let stored = database.getData('profile-bugra')
    expect(stored.gymExercises!.some((exercise) => exercise.id === 'alias-source')).toBe(false)
    expect(stored.gymTemplates.find((template) => template.id === push!.id)!.exercises[0]).toMatchObject({ exerciseId: 'alias-target', name: 'Target' })
    expect(stored.gymSessions.find((session) => session.id === 'stale-session')!.exercises[0]).toMatchObject({ exerciseId: 'alias-target', name: 'Target' })

    database.applyMutation('profile-bugra', { id: 'alias-final-setup', kind: 'gym.template.upsert', template: { ...legs!, updatedAt: at, exercises: [{ id: 'final-row', exerciseId: 'alias-final', name: 'Final', sets: 3, targetReps: 9, position: 0 }] } })
    database.applyMutation('profile-bugra', { id: 'alias-transitive-merge', kind: 'gym.exercise.merge', sourceExerciseId: 'alias-target', targetExerciseId: 'alias-final', expectedSourceName: 'Target', expectedTargetName: 'Final' })
    database.applyMutation('profile-bugra', { id: 'oldest-device-upsert', kind: 'gym.template.upsert', template: { ...push!, updatedAt: '2026-08-20T14:00:00Z', exercises: [{ id: 'oldest-row', exerciseId: 'alias-source', name: 'Resurrect', sets: 1, targetReps: 20, position: 0 }] } })
    stored = database.getData('profile-bugra')
    expect(stored.gymExercises!.map((exercise) => exercise.id)).not.toContain('alias-source')
    expect(stored.gymExercises!.map((exercise) => exercise.id)).not.toContain('alias-target')
    expect(stored.gymTemplates.find((template) => template.id === push!.id)!.exercises[0]).toMatchObject({ exerciseId: 'alias-final', name: 'Final' })
    expect(database.db.prepare("SELECT target_id FROM gym_exercise_aliases WHERE profile_id='profile-bugra' AND source_id='alias-source'").pluck().get()).toBe('alias-final')

    const senaPush = { id: 'sena-push', name: 'Push', createdAt: at, updatedAt: at, exercises: [{ id: 'sena-row', exerciseId: 'alias-source', name: 'Senas eigene Übung', sets: 3, targetReps: 10, position: 0 }] }
    database.applyMutation('profile-sena', { id: 'sena-same-source-id', kind: 'gym.template.upsert', template: senaPush })
    expect(database.getData('profile-sena').gymTemplates[0]!.exercises[0]).toMatchObject({ exerciseId: 'alias-source', name: 'Senas eigene Übung' })
  })

  it('persistiert auch das Verbinden zweier nicht mehr verwendeter Bibliotheksübungen', () => {
    database = new PaceDatabase(':memory:')
    const [push, pull] = database.getData('profile-bugra').gymTemplates
    const at = '2026-08-20T10:00:00Z'
    database.applyMutation('profile-bugra', { id: 'orphan-a-setup', kind: 'gym.template.upsert', template: { ...push!, updatedAt: at, exercises: [{ id: 'orphan-row-a', exerciseId: 'orphan-a', name: 'Orphan A', sets: 3, targetReps: 10, position: 0 }] } })
    database.applyMutation('profile-bugra', { id: 'orphan-b-setup', kind: 'gym.template.upsert', template: { ...pull!, updatedAt: at, exercises: [{ id: 'orphan-row-b', exerciseId: 'orphan-b', name: 'Orphan B', sets: 3, targetReps: 10, position: 0 }] } })
    database.applyMutation('profile-bugra', { id: 'orphan-delete-a', kind: 'gym.template.delete', templateId: push!.id })
    database.applyMutation('profile-bugra', { id: 'orphan-delete-b', kind: 'gym.template.delete', templateId: pull!.id })
    expect(database.applyMutation('profile-bugra', { id: 'orphan-merge', kind: 'gym.exercise.merge', sourceExerciseId: 'orphan-a', targetExerciseId: 'orphan-b', expectedSourceName: 'Orphan A', expectedTargetName: 'Orphan B' }).applied).toBe(true)
    expect(database.getData('profile-bugra').gymExercises).toEqual([expect.objectContaining({ id: 'orphan-b' })])
    expect(database.db.prepare("SELECT target_id FROM gym_exercise_aliases WHERE profile_id='profile-bugra' AND source_id='orphan-a'").pluck().get()).toBe('orphan-b')
  })

  it('weist Same-Template-Merges vor jeder Umschreibung vollständig zurück', () => {
    database = new PaceDatabase(':memory:')
    const push = database.getData('profile-bugra').gymTemplates[0]!
    database.applyMutation('profile-bugra', { id: 'same-template-setup', kind: 'gym.template.upsert', template: { ...push, exercises: [
      { id: 'same-a-row', exerciseId: 'same-a', name: 'A', sets: 3, targetReps: 10, position: 0 },
      { id: 'same-b-row', exerciseId: 'same-b', name: 'B', sets: 3, targetReps: 10, position: 1 },
    ] } })
    expect(() => database!.applyMutation('profile-bugra', { id: 'same-template-rejected', kind: 'gym.exercise.merge', sourceExerciseId: 'same-a', targetExerciseId: 'same-b', expectedSourceName: 'A', expectedTargetName: 'B' })).toThrow(/gemeinsam in einer Einheit/)
    expect(database.getData('profile-bugra').gymExercises!.map((exercise) => exercise.id)).toEqual(expect.arrayContaining(['same-a', 'same-b']))
    expect(database.db.prepare("SELECT COUNT(*) FROM gym_exercise_aliases WHERE profile_id='profile-bugra'").pluck().get()).toBe(0)
    expect(database.db.prepare("SELECT 1 FROM mutation_receipts WHERE profile_id='profile-bugra' AND mutation_id='same-template-rejected'").get()).toBeUndefined()
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
    database.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(10, new Date().toISOString())
    expect(database.health()).toEqual({ sqliteReady: false, schemaVersion: 10 })
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
