// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseConfig } from './config'

describe('Server-Konfiguration', () => {
  it.each([
    [{ PORT: '1.5' }, 'PORT'],
    [{ GOOGLE_HEALTH_POLL_MINUTES: 'NaN' }, 'GOOGLE_HEALTH_POLL_MINUTES'],
    [{ GOOGLE_HEALTH_LOOKBACK_DAYS: '91' }, 'GOOGLE_HEALTH_LOOKBACK_DAYS'],
    [{ PACE_HEIGHT_CM: 'Infinity' }, 'PACE_HEIGHT_CM'],
    [{ PACE_PUBLIC_ORIGIN: 'keine-url' }, 'PACE_PUBLIC_ORIGIN'],
    [{ PACE_GOOGLE_HEALTH_ENABLED: 'vielleicht' }, 'PACE_GOOGLE_HEALTH_ENABLED'],
    [{ PACE_TIME_ZONE: 'Mars/Olympus_Mons' }, 'PACE_TIME_ZONE'],
    [{ PACE_ALLOWED_TAILSCALE_USERS: 'bugra@example.com,,sena@example.com' }, 'PACE_ALLOWED_TAILSCALE_USERS'],
  ])('weist ungültige Zahlen mit Variablennamen zurück', (env, key) => {
    expect(() => parseConfig(env, '/tmp')).toThrow(key)
  })

  it('akzeptiert begrenzte gültige Werte', () => {
    expect(parseConfig({ PORT: '8080', GOOGLE_HEALTH_LOOKBACK_DAYS: '90', PACE_HEIGHT_CM: '181.5', PACE_GOOGLE_HEALTH_ENABLED: 'true', PACE_TIME_ZONE: 'Europe/Berlin' }, '/tmp')).toMatchObject({ port: 8080, lookbackDays: 90, heightCm: 181.5, googleHealthEnabled: true, timeZone: 'Europe/Berlin' })
    expect(parseConfig({}, '/tmp').timeZone).toBe('Europe/Berlin')
  })

  it('trimmt und dedupliziert die Mehrfach-Allowlist und akzeptiert die alte Singular-Variable', () => {
    expect(parseConfig({ PACE_ALLOWED_TAILSCALE_USERS: ' bugra@example.com, sena@example.com,bugra@example.com ' }, '/tmp').allowedTailscaleUsers).toEqual(['bugra@example.com', 'sena@example.com'])
    expect(parseConfig({ PACE_ALLOWED_TAILSCALE_USER: 'bugra@example.com' }, '/tmp').allowedTailscaleUsers).toEqual(['bugra@example.com'])
  })

  it('erzwingt in Produktion Loopback, HTTPS, Allowlist und deaktiviertes Google Health', () => {
    const valid = { NODE_ENV: 'production', HOST: '127.0.0.1', PACE_PUBLIC_ORIGIN: 'https://pace.example.ts.net', PACE_ALLOWED_TAILSCALE_USERS: 'bugra@example.com,sena@example.com', PACE_GOOGLE_HEALTH_ENABLED: 'false' }
    expect(parseConfig(valid, '/tmp')).toMatchObject({ production: true, host: '127.0.0.1', allowedTailscaleUsers: ['bugra@example.com', 'sena@example.com'], googleHealthEnabled: false })
    expect(() => parseConfig({ ...valid, HOST: '0.0.0.0' }, '/tmp')).toThrow('Loopback')
    expect(() => parseConfig({ ...valid, PACE_PUBLIC_ORIGIN: 'http://localhost:4173' }, '/tmp')).toThrow('HTTPS')
    expect(() => parseConfig({ ...valid, PACE_ALLOWED_TAILSCALE_USERS: undefined }, '/tmp')).toThrow('PACE_ALLOWED_TAILSCALE_USERS')
    expect(() => parseConfig({ ...valid, PACE_GOOGLE_HEALTH_ENABLED: 'true' }, '/tmp')).toThrow('false')
  })

  it('kanonisiert eine reine HTTPS-Origin und weist URL-Zusätze zurück', () => {
    expect(parseConfig({ PACE_PUBLIC_ORIGIN: 'https://PACE.example.ts.net:443/' }, '/tmp').publicOrigin).toBe('https://pace.example.ts.net')
    for (const origin of ['https://user:pass@pace.example/', 'https://pace.example/app', 'https://pace.example/?x=1', 'https://pace.example/#x']) {
      expect(() => parseConfig({ PACE_PUBLIC_ORIGIN: origin }, '/tmp')).toThrow('PACE_PUBLIC_ORIGIN')
    }
  })
})
