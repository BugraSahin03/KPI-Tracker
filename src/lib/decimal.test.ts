import { describe, expect, it } from 'vitest'
import { formatDecimalInput, parseDecimalInput } from './decimal'

describe('deutsche Dezimaleingaben', () => {
  it('akzeptiert Komma und Punkt ohne Rundung', () => {
    expect(parseDecimalInput('78,35')).toBe(78.35)
    expect(parseDecimalInput('61.25')).toBe(61.25)
    expect(formatDecimalInput(78.35)).toBe('78,35')
  })

  it('lehnt leere, gemischte und nicht endliche Werte ab', () => {
    for (const value of ['', '1,2.3', 'abc', '-1', '1e3', 'Infinity']) expect(parseDecimalInput(value)).toBeUndefined()
  })
})
