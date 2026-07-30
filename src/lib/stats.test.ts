import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialData, setEntryStatus, toggleGoalActive } from './storage'
import { calculateStats, dayStatus, goalIsScheduledOn } from './stats'

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
})
