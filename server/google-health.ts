import { createHash, randomBytes } from 'node:crypto'
import type { GoogleMetricPoint, PaceDatabase } from './db.js'
import { config, googleHealthConfigured } from './config.js'
import { decryptToken, encryptToken } from './crypto.js'

const SCOPE = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly'
const API_ROOT = 'https://health.googleapis.com/v4/users/me/dataTypes'

interface GoogleDataPoint {
  name?: string
  dataSource?: unknown
  weight?: { sampleTime?: GoogleSampleTime; weightGrams?: number }
  bodyFat?: { sampleTime?: GoogleSampleTime; percentage?: number }
}
interface GoogleSampleTime {
  physicalTime?: string
  civilTime?: { date?: { year?: number; month?: number; day?: number } }
}

function dateFromSample(sample: GoogleSampleTime | undefined, physicalTime: string) {
  const date = sample?.civilTime?.date
  if (date?.year && date.month && date.day) {
    return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
  }
  return physicalTime.slice(0, 10)
}

export function parseGoogleDataPoint(dataType: 'weight' | 'body-fat', point: GoogleDataPoint): GoogleMetricPoint | null {
  const payload = dataType === 'weight' ? point.weight : point.bodyFat
  const measuredAt = payload?.sampleTime?.physicalTime
  if (!measuredAt || Number.isNaN(Date.parse(measuredAt))) return null
  const value = dataType === 'weight' ? point.weight?.weightGrams : point.bodyFat?.percentage
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (dataType === 'weight' && (value <= 0 || value > 500_000)) return null
  if (dataType === 'body-fat' && (value < 0 || value > 100)) return null
  const fallbackId = createHash('sha256').update(JSON.stringify([dataType, measuredAt, value, point.dataSource])).digest('hex')
  return {
    externalId: point.name || `${dataType}-${fallbackId}`,
    date: dateFromSample(payload.sampleTime, measuredAt),
    measuredAt,
    ...(dataType === 'weight' ? { weightKg: value / 1000 } : { bodyFatPercent: value }),
    raw: point,
  }
}

export function buildSyncWindows(start: Date, end: Date, maximumDays = 90) {
  if (!Number.isInteger(maximumDays) || maximumDays < 1 || maximumDays > 90 || start >= end) return []
  const windows: { start: string; end: string }[] = []
  let cursor = start.getTime()
  const endMs = end.getTime()
  const maximumMs = maximumDays * 86_400_000
  while (cursor < endMs) {
    const windowEnd = Math.min(cursor + maximumMs, endMs)
    windows.push({ start: new Date(cursor).toISOString(), end: new Date(windowEnd).toISOString() })
    cursor = windowEnd
  }
  return windows
}

export async function listGoogleWindow(
  dataType: 'weight' | 'body-fat', window: { start: string; end: string }, token: string,
  fetcher: typeof fetch = fetch,
) {
  const points: GoogleDataPoint[] = []
  let pageToken: string | undefined
  do {
    const filterField = dataType === 'weight' ? 'weight' : 'body_fat'
    const filter = `${filterField}.sample_time.physical_time >= "${window.start}" AND ${filterField}.sample_time.physical_time < "${window.end}"`
    const params = new URLSearchParams({ pageSize: '1000', filter })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetcher(`${API_ROOT}/${dataType}/dataPoints?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Google Health ${dataType} fehlgeschlagen (${response.status}).`)
    const payload = await response.json() as { dataPoints?: GoogleDataPoint[]; nextPageToken?: string }
    points.push(...(payload.dataPoints ?? []))
    pageToken = payload.nextPageToken || undefined
  } while (pageToken)
  return points
}

export class GoogleHealthService {
  private running = false
  constructor(private database: PaceDatabase) {}

  status() {
    const integration = this.database.getIntegration()
    return {
      configured: googleHealthConfigured(),
      connected: Boolean(integration?.refresh_token_encrypted || integration?.access_token_encrypted),
      lastSyncAt: integration?.last_sync_at ?? null,
      lastSyncError: integration?.last_sync_error ?? null,
      pollingMinutes: config.pollingMinutes,
    }
  }

  createAuthorizationUrl() {
    if (!googleHealthConfigured()) throw new Error('Google Health ist noch nicht konfiguriert.')
    const state = randomBytes(32).toString('base64url')
    this.database.addOauthState(createHash('sha256').update(state).digest('hex'), new Date(Date.now() + 10 * 60_000).toISOString())
    const params = new URLSearchParams({
      client_id: config.googleClientId!, redirect_uri: `${config.publicOrigin}/api/integrations/google-health/callback`,
      response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  async handleCallback(code: string, state: string) {
    const stateHash = createHash('sha256').update(state).digest('hex')
    if (!this.database.consumeOauthState(stateHash)) {
      throw new Error('OAuth-Status ist ungültig oder abgelaufen.')
    }
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: config.googleClientId!, client_secret: config.googleClientSecret!,
        redirect_uri: `${config.publicOrigin}/api/integrations/google-health/callback`, grant_type: 'authorization_code' }),
    })
    if (!response.ok) throw new Error(`Google Token-Austausch fehlgeschlagen (${response.status}).`)
    const tokens = await response.json() as { access_token: string; refresh_token?: string; expires_in: number }
    this.saveTokens(tokens)
    this.database.updateIntegration({ connectedAt: new Date().toISOString(), lastSyncError: null })
    await this.sync()
  }

  private saveTokens(tokens: { access_token: string; refresh_token?: string; expires_in: number }) {
    const key = config.tokenEncryptionKey!
    this.database.updateIntegration({
      accessTokenEncrypted: encryptToken(tokens.access_token, key),
      ...(tokens.refresh_token ? { refreshTokenEncrypted: encryptToken(tokens.refresh_token, key) } : {}),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })
  }

  private async accessToken() {
    const integration = this.database.getIntegration()
    if (!integration?.access_token_encrypted) throw new Error('Google Health ist nicht verbunden.')
    if (Date.parse(String(integration.token_expires_at)) > Date.now() + 60_000) {
      return decryptToken(String(integration.access_token_encrypted), config.tokenEncryptionKey!)
    }
    if (!integration.refresh_token_encrypted) throw new Error('Kein Google Refresh-Token vorhanden. Bitte neu verbinden.')
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.googleClientId!, client_secret: config.googleClientSecret!,
        refresh_token: decryptToken(String(integration.refresh_token_encrypted), config.tokenEncryptionKey!), grant_type: 'refresh_token' }),
    })
    if (!response.ok) throw new Error(`Google Token-Erneuerung fehlgeschlagen (${response.status}).`)
    const tokens = await response.json() as { access_token: string; expires_in: number }
    this.saveTokens(tokens)
    return tokens.access_token
  }

  async sync() {
    if (this.running) return { skipped: true, imported: 0 }
    if (!googleHealthConfigured() || !this.status().connected) return { skipped: true, imported: 0 }
    this.running = true
    try {
      const integration = this.database.getIntegration()
      const initial = new Date(Date.now() - config.initialSyncDays * 86_400_000)
      const cursor = integration?.sync_cursor ? new Date(String(integration.sync_cursor)) : initial
      const since = new Date(Math.max(initial.getTime(), cursor.getTime() - config.lookbackDays * 86_400_000))
      const syncEnd = new Date()
      const token = await this.accessToken()
      let imported = 0
      for (const window of buildSyncWindows(since, syncEnd)) {
        for (const dataType of ['weight', 'body-fat'] as const) {
          for (const raw of await listGoogleWindow(dataType, window, token)) {
            const parsed = parseGoogleDataPoint(dataType, raw)
            if (parsed && this.database.upsertGooglePoint(parsed).inserted) imported++
          }
        }
      }
      const now = syncEnd.toISOString()
      this.database.updateIntegration({ syncCursor: now, lastSyncAt: now, lastSyncError: null })
      return { skipped: false, imported }
    } catch (error) {
      this.database.updateIntegration({ lastSyncError: error instanceof Error ? error.message : 'Unbekannter Sync-Fehler' })
      throw error
    } finally {
      this.running = false
    }
  }

  async disconnect() {
    const integration = this.database.getIntegration()
    try {
      if (integration?.access_token_encrypted && config.tokenEncryptionKey) {
        const token = decryptToken(String(integration.access_token_encrypted), config.tokenEncryptionKey)
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
      }
    } catch {
      // Die lokale Trennung darf nicht von Googles Erreichbarkeit abhängen.
    } finally {
      this.database.disconnectIntegration()
    }
  }
}
