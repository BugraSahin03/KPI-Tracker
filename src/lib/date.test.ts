import { describe, expect, it } from 'vitest'
import { periodBounds, periodLabel, toDateKey } from './date'

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
})
