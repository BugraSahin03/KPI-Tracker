import type { AppData, DataMutation, Profile, ProfileId } from '../types'

export interface DataEnvelope {
  data: AppData
  revision: number
  profileId: ProfileId
  profiles: Profile[]
  features?: { googleHealth: boolean }
}

export interface GoogleHealthStatus {
  configured: boolean
  connected: boolean
  lastSyncAt: string | null
  lastSyncError: string | null
  pollingMinutes: number
}

export type RecognizedRunField<T> = { value?: T; confidence: 'high' | 'medium' | 'low'; note?: string }
export type RunScreenshotRecognition = { draft: {
  environment: RecognizedRunField<'indoor' | 'outdoor'>; date: RecognizedRunField<string>; startTime: RecognizedRunField<string>
  durationSeconds: RecognizedRunField<number>; distanceKm: RecognizedRunField<number>; displayedPaceSecondsPerKm: RecognizedRunField<number>
  averageHeartRateBpm: RecognizedRunField<number>; effort: RecognizedRunField<number>; activeCalories: RecognizedRunField<number>
  totalCalories: RecognizedRunField<number>; elevationGainM: RecognizedRunField<number>; averagePowerWatts: RecognizedRunField<number>; averageCadenceSpm: RecognizedRunField<number>
} }

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new ApiError(payload?.error ?? `Serverfehler (${response.status})`, response.status)
  }
  return response.json() as Promise<T>
}

export const api = {
  load: (profileId: ProfileId) => request<DataEnvelope>(`/api/data?profileId=${encodeURIComponent(profileId)}`),
  mutate: (profileId: ProfileId, mutation: DataMutation) => request<DataEnvelope & { applied: boolean }>('/api/mutations', {
    method: 'POST', body: JSON.stringify({ ...mutation, profileId, mutation }),
  }),
  importLocal: (profileId: ProfileId, data: AppData) => request<DataEnvelope>('/api/import/local', {
    method: 'POST',
    body: JSON.stringify({ profileId, data, onlyIfPristine: true }),
  }),
  recognizeRunScreenshot: async (file: File) => {
    const response = await fetch('/api/runs/screenshot/recognize', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      throw new ApiError(payload?.error ?? `Erkennung fehlgeschlagen (${response.status})`, response.status)
    }
    return response.json() as Promise<RunScreenshotRecognition>
  },
  googleHealthStatus: () => request<GoogleHealthStatus>('/api/integrations/google-health/status'),
  syncGoogleHealth: () => request<{ imported: number; skipped: boolean }>('/api/integrations/google-health/sync', { method: 'POST' }),
  disconnectGoogleHealth: () => request<{ disconnected: boolean }>('/api/integrations/google-health', { method: 'DELETE' }),
}
