import { describe, expect, it } from 'vitest'
import { createInitialData, isAppData, isBodyMetric, isGymSession, isGymTemplate, legacyGymSetId, loadData, saveData, setEntryStatus, STORAGE_KEY } from './storage'

function memoryStorage(initial?: string) {
  let value = initial ?? null
  return {
    getItem: (key: string) => (key === STORAGE_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === STORAGE_KEY) value = next
    },
    read: () => value,
  }
}

describe('Storage-Layer', () => {
  it('startet mit den beiden Standardzielen', () => {
    const storage = memoryStorage()
    const data = loadData(storage)
    expect(data.goals.map((goal) => goal.name)).toEqual(['Protein', 'Wasser'])
    expect(data.version).toBe(3)
    expect(data.gymTemplates.map((template) => template.name)).toEqual(['Push', 'Pull', 'Beine'])
    expect(data.goals[0].activityPeriods).toHaveLength(1)
  })

  it('persistiert Statusänderungen und entfernt offene Einträge', () => {
    const storage = memoryStorage()
    const initial = createInitialData()
    initial.entries = setEntryStatus(initial.entries, 'protein', '2026-07-30', 'done')
    saveData(initial, storage)
    expect(loadData(storage).entries[0]).toMatchObject({
      goalId: 'protein',
      date: '2026-07-30',
      status: 'done',
    })

    initial.entries = setEntryStatus(initial.entries, 'protein', '2026-07-30', 'open')
    expect(initial.entries).toHaveLength(0)
  })

  it('fällt bei beschädigten Daten sicher auf Defaults zurück', () => {
    const storage = memoryStorage('{kein json')
    expect(loadData(storage).goals).toHaveLength(2)
  })

  it('migriert Version 1 und ersetzt das fehlerhafte Seed-Startdatum', () => {
    const legacy = {
      version: 1,
      goals: [
        {
          id: 'protein',
          name: 'Protein',
          unit: 'g',
          target: 120,
          icon: 'protein',
          color: '#c6ff3d',
          active: true,
          createdAt: '2020-01-01',
        },
      ],
      entries: [
        {
          goalId: 'protein',
          date: '2026-07-28',
          status: 'done',
          updatedAt: '2026-07-28T20:00:00.000Z',
        },
      ],
      bodyMetrics: [],
    }

    const migrated = loadData(memoryStorage(JSON.stringify(legacy)))
    expect(migrated.version).toBe(3)
    expect(migrated.goals[0].createdAt).toBe('2026-07-28')
    expect(migrated.goals[0].activityPeriods).toEqual([{ start: '2026-07-28' }])
    expect(migrated.entries).toHaveLength(1)
  })

  it('migriert gültige Version-2-Daten ohne Verlust und ergänzt GYM', () => {
    const current = createInitialData('2026-08-01')
    current.bodyMetrics.push({ id: 'body-old', date: '2026-08-01', weightKg: 80, createdAt: '2026-08-01T08:00:00Z' })
    const legacyV2 = { version: 2, goals: current.goals, entries: current.entries, bodyMetrics: current.bodyMetrics }
    const migrated = loadData(memoryStorage(JSON.stringify(legacyV2)))
    expect(migrated.version).toBe(3)
    expect(migrated.bodyMetrics).toEqual(current.bodyMetrics)
    expect(migrated.gymTemplates.map((template) => template.name)).toEqual(['Push', 'Pull', 'Beine'])
  })

  it('verwirft strukturell ungültige gespeicherte Daten ohne Laufzeitfehler', () => {
    const invalid = JSON.stringify({
      version: 2,
      goals: [{ id: 'defekt' }],
      entries: [],
      bodyMetrics: [],
    })
    expect(loadData(memoryStorage(invalid)).goals.map((goal) => goal.name)).toEqual([
      'Protein',
      'Wasser',
    ])
  })

  it('weist doppelte IDs, Einträge und verwaiste Referenzen zurück', () => {
    const duplicateGoals = createInitialData('2026-08-01')
    duplicateGoals.goals.push({ ...duplicateGoals.goals[0]! })
    expect(isAppData(duplicateGoals)).toBe(false)

    const duplicateEntries = createInitialData('2026-08-01')
    const entry = { goalId: 'protein', date: '2026-08-01', status: 'done' as const, updatedAt: '2026-08-01T12:00:00Z' }
    duplicateEntries.entries.push(entry, { ...entry })
    expect(isAppData(duplicateEntries)).toBe(false)

    const orphan = createInitialData('2026-08-01')
    orphan.entries.push({ ...entry, goalId: 'missing' })
    expect(isAppData(orphan)).toBe(false)
  })

  it('akzeptiert nur kanonische gültige ISO-Zeitstempel mit Zeitzone', () => {
    const base = { id: 'metric', date: '2026-08-01', weightKg: 80, createdAt: '2026-08-01T08:00:00Z' }
    expect(isBodyMetric({ ...base, measuredAt: '2026-08-01T09:00:00+02:00' })).toBe(true)
    expect(isBodyMetric({ ...base, measuredAt: '2026-08-01T09:00:00.123456789+02:00' })).toBe(true)
    expect(isBodyMetric({ ...base, measuredAt: '2026-08-01 09:00:00' })).toBe(false)
    expect(isBodyMetric({ ...base, measuredAt: '2026-02-30T09:00:00Z' })).toBe(false)
  })

  it('erzeugt für lange Legacy-Übungs-IDs stabile begrenzte Satz-IDs', () => {
    const sharedPrefix = `e${'x'.repeat(98)}`
    const first = `${sharedPrefix}a`
    const second = `${sharedPrefix}b`
    const ids = [legacyGymSetId(first, 1), legacyGymSetId(first, 2), legacyGymSetId(second, 1)]
    expect(ids).toEqual([legacyGymSetId(first, 1), legacyGymSetId(first, 2), legacyGymSetId(second, 1)])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id))).toBe(true)
  })

  it('validiert Wiederholungsbereiche und optionale Session-Fortschrittsfelder rückwärtskompatibel', () => {
    const timestamp = '2026-08-01T10:00:00Z'
    const template = { id: 'push', name: 'Push', createdAt: timestamp, updatedAt: timestamp, exercises: [
      { id: 'bench', name: 'Bankdrücken', sets: 3, targetReps: 8, targetRepsMax: 12, position: 0 },
    ] }
    expect(isGymTemplate(template)).toBe(true)
    expect(isGymTemplate({ ...template, exercises: [{ ...template.exercises[0], targetRepsMax: 7 }] })).toBe(false)
    expect(isGymTemplate({ ...template, exercises: [{ ...template.exercises[0], targetRepsMax: 101 }] })).toBe(false)

    const session = { id: 'session', templateName: 'Push', date: '2026-08-01', startedAt: timestamp, completedAt: '2026-08-01T11:00:00Z', exercises: [
      { id: 'session-bench', templateExerciseId: 'bench', name: 'Bankdrücken', sets: 3, reps: 9, targetReps: 8, targetRepsMax: 12, increaseNextTime: true, completed: true, position: 0 },
    ] }
    expect(isGymSession(session)).toBe(true)
    expect(isGymSession({ ...session, exercises: [{ ...session.exercises[0], reps: 0, performedSets: [
      { id: 'set-1', setNumber: 1, reps: 0 },
      { id: 'set-2', setNumber: 2, reps: 0 },
      { id: 'set-3', setNumber: 3, reps: 0 },
    ] }] })).toBe(true)
    expect(isGymSession({ ...session, exercises: [{ ...session.exercises[0], reps: -1 }] })).toBe(false)
    expect(isGymSession({ ...session, exercises: [{ ...session.exercises[0], increaseNextTime: 'ja' }] })).toBe(false)
    const legacyExercise = { id: 'legacy-bench', templateExerciseId: 'bench', name: 'Bankdrücken', sets: 3, reps: 9, position: 0 }
    expect(isGymSession({ ...session, exercises: [legacyExercise] })).toBe(true)
  })
})
