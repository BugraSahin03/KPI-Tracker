import { differenceInCalendarDays } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dateRange } from './date'
import { createDemoData } from './demo'
import { calculateStats, dayStatus, goalIsScheduledOn } from './stats'

describe('Demo-Daten', () => {
  const anchor = new Date(2025, 5, 15)

  afterEach(() => {
    vi.useRealTimers()
  })

  it('erzeugt reproduzierbare Daten für zwölf Kalendermonate bis zum Stichtag', () => {
    const first = createDemoData(anchor)
    const second = createDemoData(anchor)

    expect(first).toEqual(second)
    expect(first.goals.map((goal) => goal.id)).toEqual(['protein', 'water'])
    expect(first.entries.length).toBeGreaterThan(500)
    expect(first.bodyMetrics.length).toBeGreaterThanOrEqual(20)
    expect(first.entries.every((entry) => entry.date >= '2024-07-01')).toBe(true)
    expect(first.entries.every((entry) => entry.date <= '2025-06-15')).toBe(true)
    expect(first.goals.every((goal) => goal.createdAt === '2024-07-01')).toBe(true)
    expect(first.goals.every((goal) => goalIsScheduledOn(goal, '2024-07-01'))).toBe(true)

    const firstMetric = first.bodyMetrics[0]
    const lastMetric = first.bodyMetrics.at(-1)!
    expect(firstMetric.weightKg).toBeGreaterThan(lastMetric.weightKg!)
    expect(firstMetric.muscleMassKg).toBeLessThan(lastMetric.muscleMassKg!)
    expect(
      differenceInCalendarDays(anchor, new Date(`${lastMetric.date}T12:00:00`)),
    ).toBeLessThan(14)
  })

  it('liefert sichtbar gemischte grüne, rote und offene Tage', () => {
    const data = createDemoData(anchor)
    const statuses = dateRange(new Date(2024, 6, 1), anchor).map((date) =>
      dayStatus(data, date),
    )

    expect(statuses.filter((status) => status === 'done').length).toBeGreaterThan(150)
    expect(statuses.filter((status) => status === 'failed').length).toBeGreaterThan(25)
    expect(statuses.filter((status) => status === 'open').length).toBeGreaterThan(5)
  })

  it('nimmt auch offene Demotage in realistische Statistik-Nenner auf', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2025, 5, 15, 12))
    const data = createDemoData()

    const month = calculateStats(data, 'month')
    const year = calculateStats(data, 'year')
    expect(month.total).toBe(30)
    expect(year.total).toBe(332)
    expect(month.rate).toBeGreaterThan(50)
    expect(month.rate).toBeLessThan(95)
    expect(year.rate).toBeGreaterThan(50)
    expect(year.rate).toBeLessThan(95)
    expect(month.currentStreak).toBeGreaterThanOrEqual(4)
  })
})
