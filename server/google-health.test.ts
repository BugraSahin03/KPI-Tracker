// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { buildSyncWindows, listGoogleWindow, parseGoogleDataPoint } from './google-health'

describe('Google Health v4 Parser', () => {
  it('wandelt Gramm in Kilogramm um und nutzt die lokale Messdatum-Angabe', () => {
    const parsed = parseGoogleDataPoint('weight', {
      name: 'users/u/dataTypes/weight/dataPoints/abc',
      weight: { sampleTime: { physicalTime: '2026-08-01T23:30:00Z', civilTime: { date: { year: 2026, month: 8, day: 2 } } }, weightGrams: 82400 },
    })
    expect(parsed).toMatchObject({ externalId: 'users/u/dataTypes/weight/dataPoints/abc', date: '2026-08-02', weightKg: 82.4 })
  })

  it('weist ungültige Körperfettwerte ab', () => {
    expect(parseGoogleDataPoint('body-fat', {
      bodyFat: { sampleTime: { physicalTime: '2026-08-01T08:00:00Z' }, percentage: 101 },
    })).toBeNull()
  })

  it('teilt historische Abfragen lückenlos in höchstens 90 Tage', () => {
    const windows = buildSyncWindows(new Date('2025-01-01T00:00:00Z'), new Date('2025-08-01T00:00:00Z'))
    expect(windows).toHaveLength(3)
    expect(windows[0]).toEqual({ start: '2025-01-01T00:00:00.000Z', end: '2025-04-01T00:00:00.000Z' })
    expect(windows[1]?.start).toBe(windows[0]?.end)
    expect(windows[2]?.end).toBe('2025-08-01T00:00:00.000Z')
    for (const window of windows) expect(Date.parse(window.end) - Date.parse(window.start)).toBeLessThanOrEqual(90 * 86_400_000)
  })

  it('setzt Unter- und Obergrenze und verfolgt alle Seiten', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ dataPoints: [{ name: 'one' }], nextPageToken: 'page-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dataPoints: [{ name: 'two' }] }), { status: 200 }))
    const window = { start: '2026-01-01T00:00:00.000Z', end: '2026-03-01T00:00:00.000Z' }
    const points = await listGoogleWindow('weight', window, 'token', fetcher)
    expect(points).toHaveLength(2)
    const filter = new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get('filter')
    expect(filter).toContain('weight.sample_time.physical_time >= "2026-01-01T00:00:00.000Z"')
    expect(filter).toContain('weight.sample_time.physical_time < "2026-03-01T00:00:00.000Z"')
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('pageToken=page-2')
  })
})
