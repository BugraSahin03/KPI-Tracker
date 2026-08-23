import { describe, expect, it } from 'vitest'
import { formatRepTarget, parseRepTarget } from './reps'

describe('Wiederholungsvorgaben', () => {
  it('akzeptiert einzelne Werte und normalisiert Bereiche typografisch', () => {
    expect(parseRepTarget('8')).toEqual({ min: 8 })
    expect(parseRepTarget(' 8 - 12 ')).toEqual({ min: 8, max: 12 })
    expect(parseRepTarget('8–12')).toEqual({ min: 8, max: 12 })
    expect(parseRepTarget('12—12')).toEqual({ min: 12 })
    expect(formatRepTarget(8, 12)).toBe('8–12')
  })

  it.each(['', '0', '101', '12-8', '8-', '-12', '8.5', 'acht', '8-101'])('weist ungültige Vorgaben zurück: %s', (value) => {
    expect(parseRepTarget(value)).toBeUndefined()
  })
})
