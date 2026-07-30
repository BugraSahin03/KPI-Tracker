import { describe, expect, it } from 'vitest'
import { createInitialData, loadData, saveData, setEntryStatus, STORAGE_KEY } from './storage'

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
    expect(data.version).toBe(2)
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
    expect(migrated.version).toBe(2)
    expect(migrated.goals[0].createdAt).toBe('2026-07-28')
    expect(migrated.goals[0].activityPeriods).toEqual([{ start: '2026-07-28' }])
    expect(migrated.entries).toHaveLength(1)
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
})
