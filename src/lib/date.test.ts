import { describe, expect, it } from 'vitest'
import { historyDateGroup, periodBounds, periodLabel, toDateKey } from './date'

describe('Datumslogik', () => {
  it('verwendet Montag bis Sonntag als ISO-Woche', () => {
    const bounds = periodBounds('week', new Date(2026, 0, 1))
    expect(toDateKey(bounds.start)).toBe('2025-12-29')
    expect(toDateKey(bounds.end)).toBe('2026-01-04')
  })

  it('zeigt Kalenderwoche und ISO-Jahr eindeutig an', () => {
    expect(periodLabel('week', new Date(2026, 0, 1))).toContain('KW 1')
    expect(periodLabel('week', new Date(2026, 0, 1))).toContain('2026')
  })

  it('gruppiert lokale Trainingstage nach Kalenderjahr, Monat und eindeutiger ISO-Woche', () => {
    expect(historyDateGroup('2025-12-31')).toEqual({
      calendarYear: '2025',
      monthKey: '2025-12',
      monthLabel: 'Dezember',
      isoWeekKey: '2026-W01',
      isoWeekLabel: 'KW 1 · 2026',
    })
    expect(historyDateGroup('2026-01-01').isoWeekLabel).toBe('KW 1')
  })
})
