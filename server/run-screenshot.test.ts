// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { inferGermanScreenshotDate, parseRunScreenshotText, supportedImageSignature } from './run-screenshot'

describe('Apple Fitness Lauf-Screenshot', () => {
  it('erkennt deutsche Kerndaten trotz typischer OCR-Zeichenfehler', () => {
    const parsed = parseRunScreenshotText(`So. 13. Sept.\nLaufen outdoor\n14:36-15:16\nTrainingszeit Strecke\n0:40:10 5,27 KM\nAktivitätskilokalorien\n445 KCAL\nGesamtkilokalorien Höhenmeter\n514 KCAL 2 M\nS-Leistung S-Kadenz\n180 w 142 SPM\nS-Pace -Herzfrequenz\n7'37" IKM 161 8PM\nAnstrengung +\n6 Mäßig`, new Date('2026-09-14T12:00:00Z'))
    expect(parsed).toMatchObject({ environment: { value: 'outdoor' }, date: { value: '2026-09-13', confidence: 'medium' }, startTime: { value: '14:36' }, durationSeconds: { value: 2410 }, distanceKm: { value: 5.27 }, displayedPaceSecondsPerKm: { value: 457 }, averageHeartRateBpm: { value: 161 }, effort: { value: 6 }, activeCalories: { value: 445 }, totalCalories: { value: 514 }, elevationGainM: { value: 2 }, averagePowerWatts: { value: 180 }, averageCadenceSpm: { value: 142 } })
  })

  it('ordnet ein fehlendes Jahr immer dem jüngsten nicht zukünftigen Datum zu', () => {
    expect(inferGermanScreenshotDate('31. Dez.', new Date(2026, 0, 2)).value).toBe('2025-12-31')
    expect(inferGermanScreenshotDate('1. Jan.', new Date(2026, 0, 2)).value).toBe('2026-01-01')
  })

  it('verwendet für die Jahresinferenz die konfigurierte Zeitzone statt der Host-Zeitzone', () => {
    const instant = new Date('2025-12-31T23:30:00Z')
    expect(inferGermanScreenshotDate('1. Jan.', instant, 'Europe/Berlin').value).toBe('2026-01-01')
    expect(inferGermanScreenshotDate('1. Jan.', instant, 'America/New_York').value).toBe('2025-01-01')
  })

  it('akzeptiert die unterstützten Apple-HEIF-Marken, aber keine beliebige ISO-Mediendatei', () => {
    const signature = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp'), Buffer.from(brand), Buffer.alloc(8)])
    expect(supportedImageSignature(signature('heic'))).toBe(true)
    expect(supportedImageSignature(signature('heif'))).toBe(true)
    expect(supportedImageSignature(signature('mif1'))).toBe(true)
    expect(supportedImageSignature(signature('mp42'))).toBe(false)
  })
})
