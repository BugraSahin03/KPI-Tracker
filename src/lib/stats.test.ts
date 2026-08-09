import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialData, setEntryStatus, toggleGoalActive } from './storage'
import { calculateStats, dayGoalProgress, dayStatus, goalIsScheduledOn, sortBodyMetricsNewestFirst } from './stats'

describe('Statistik', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('berechnet Quote sowie beste Serie aus täglichen Check-ins', () => {
    const data = createInitialData('2024-01-01')
    for (const date of ['2024-01-01', '2024-01-02']) {
      data.entries = setEntryStatus(data.entries, 'protein', date, 'done')
      data.entries = setEntryStatus(data.entries, 'water', date, 'done')
    }
    data.entries = setEntryStatus(data.entries, 'protein', '2024-01-03', 'done')
    data.entries = setEntryStatus(data.entries, 'water', '2024-01-03', 'failed')

    const stats = calculateStats(data, 'week', new Date(2024, 0, 3))
    expect(stats.done).toBe(5)
    expect(stats.total).toBe(14)
    expect(stats.rate).toBe(36)
    expect(stats.bestStreak).toBe(2)
    expect(stats.perGoal.find((item) => item.goal.id === 'protein')?.rate).toBe(43)
  })

  it('markiert einen Tag erst bei vollständig erfüllten Zielen grün', () => {
    const data = createInitialData('2024-02-01')
    data.entries = setEntryStatus(data.entries, 'protein', '2024-02-01', 'done')
    expect(dayStatus(data, '2024-02-01')).toBe('open')
    data.entries = setEntryStatus(data.entries, 'water', '2024-02-01', 'done')
    expect(dayStatus(data, '2024-02-01')).toBe('done')
    data.entries = setEntryStatus(data.entries, 'water', '2024-02-01', 'failed')
    expect(dayStatus(data, '2024-02-01')).toBe('failed')
  })

  it('berechnet den Tagesfortschritt für beliebig viele aktive Ziele', () => {
    const data = createInitialData('2024-02-01')
    const date = '2024-02-01'

    expect(dayGoalProgress(data, date)).toEqual({ done: 0, total: 2, ratio: 0 })

    data.entries = setEntryStatus(data.entries, 'protein', date, 'done')
    expect(dayGoalProgress(data, date)).toEqual({ done: 1, total: 2, ratio: 0.5 })

    data.goals.push({
      ...data.goals[0]!,
      id: 'steps',
      name: 'Schritte',
      unit: 'k',
    })
    expect(dayGoalProgress(data, date)).toEqual({ done: 1, total: 3, ratio: 1 / 3 })

    data.entries = setEntryStatus(data.entries, 'water', date, 'done')
    expect(dayGoalProgress(data, date)).toEqual({ done: 2, total: 3, ratio: 2 / 3 })

    data.entries = setEntryStatus(data.entries, 'steps', date, 'done')
    expect(dayGoalProgress(data, date)).toEqual({ done: 3, total: 3, ratio: 1 })
  })

  it('liefert für Tage ohne aktive oder historische Ziele einen neutralen Fortschritt', () => {
    const data = createInitialData('2024-02-02')
    expect(dayGoalProgress(data, '2024-02-01')).toEqual({ done: 0, total: 0, ratio: 0 })
  })

  it('zählt bei einer Neuinstallation keine Tage vor der ersten Nutzung', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 30, 12))
    const stats = calculateStats(createInitialData(), 'month')
    expect(stats.total).toBe(2)
    expect(stats.rate).toBe(0)
  })

  it('berücksichtigt Pausen nur außerhalb ihrer Aktivitätsintervalle', () => {
    const data = createInitialData('2024-07-01')
    data.goals[0] = toggleGoalActive(data.goals[0], '2024-07-03')

    expect(goalIsScheduledOn(data.goals[0], '2024-07-02')).toBe(true)
    expect(goalIsScheduledOn(data.goals[0], '2024-07-03')).toBe(false)
    expect(calculateStats(data, 'month', new Date(2024, 6, 10)).perGoal[0].total).toBe(2)

    data.goals[0] = toggleGoalActive(data.goals[0], '2024-07-05')
    expect(goalIsScheduledOn(data.goals[0], '2024-07-04')).toBe(false)
    expect(goalIsScheduledOn(data.goals[0], '2024-07-05')).toBe(true)
    expect(calculateStats(data, 'month', new Date(2024, 6, 10)).perGoal[0].total).toBe(29)
  })

  it('behält die aktuelle Serie bei, solange der heutige Tag noch offen ist', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 3, 12))
    const data = createInitialData('2026-07-01')
    for (const date of ['2026-07-01', '2026-07-02']) {
      data.entries = setEntryStatus(data.entries, 'protein', date, 'done')
      data.entries = setEntryStatus(data.entries, 'water', date, 'done')
    }

    expect(calculateStats(data, 'week').currentStreak).toBe(2)
  })

  it('bezieht Monats- und Jahresstatistiken exakt auf einen historischen Anker', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 7, 12))
    const data = createInitialData('2024-01-01')
    for (const date of ['2024-01-30', '2024-01-31']) {
      data.entries = setEntryStatus(data.entries, 'protein', date, 'done')
      data.entries = setEntryStatus(data.entries, 'water', date, 'done')
    }
    data.entries = setEntryStatus(data.entries, 'protein', '2024-02-01', 'done')

    const january = calculateStats(data, 'month', new Date(2024, 0, 12))
    expect(january.done).toBe(4)
    expect(january.total).toBe(62)
    expect(january.currentStreak).toBe(2)
    expect(january.bestStreak).toBe(2)

    const year = calculateStats(data, 'year', new Date(2024, 5, 1))
    expect(year.done).toBe(5)
    expect(year.total).toBe(732)
    expect(year.bestStreak).toBe(2)
  })

  it('liefert für einen vollständig zukünftigen Zeitraum keine heutigen oder geplanten Daten', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 7, 12))
    const data = createInitialData('2026-08-01')
    data.entries = setEntryStatus(data.entries, 'protein', '2026-08-07', 'done')
    data.entries = setEntryStatus(data.entries, 'water', '2026-08-07', 'done')

    for (const [period, anchor] of [
      ['week', new Date(2026, 7, 12)],
      ['month', new Date(2026, 8, 1)],
      ['year', new Date(2027, 0, 1)],
    ] as const) {
      expect(calculateStats(data, period, anchor)).toEqual({
        rate: 0,
        done: 0,
        total: 0,
        currentStreak: 0,
        bestStreak: 0,
        perGoal: [],
      })
    }
  })

  it('sortiert Body-Messungen eines Tages für Latest, Trends und Verlauf identisch', () => {
    const metrics = [
      { id: 'morning', date: '2026-08-01', weightKg: 80, measuredAt: '2026-08-01T08:00:00Z', createdAt: '2026-08-01T08:01:00Z' },
      { id: 'evening', date: '2026-08-01', weightKg: 81, measuredAt: '2026-08-01T20:00:00Z', createdAt: '2026-08-01T20:01:00Z' },
    ]
    expect(sortBodyMetricsNewestFirst(metrics).map((metric) => metric.weightKg)).toEqual([81, 80])
  })

  it('vergleicht Body-Zeitstempel als Instants statt als Text', () => {
    const metrics = [
      { id: 'older-offset', date: '2026-08-01', weightKg: 80, measuredAt: '2026-08-01T09:00:00+02:00', createdAt: '2026-08-01T09:01:00+02:00' },
      { id: 'newer-utc', date: '2026-08-01', weightKg: 81, measuredAt: '2026-08-01T08:30:00Z', createdAt: '2026-08-01T08:31:00Z' },
    ]
    expect(sortBodyMetricsNewestFirst(metrics).map((metric) => metric.id)).toEqual(['newer-utc', 'older-offset'])
  })
})
