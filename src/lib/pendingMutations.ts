import { DEFAULT_PROFILE_ID, type AppData, type DataMutation, type ProfileId } from '../types.js'
import { isBodyMetric, isEntry, isGoal, isGymSession, isGymTemplate } from './storage.js'

export const PENDING_MUTATIONS_STORAGE_KEY = 'pace-pending-mutations-v2'
export type PendingMutation = { profileId: ProfileId; mutation: DataMutation }

type StoredMutationQueue = {
  version: 2
  mutations: PendingMutation[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isIdentifier(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
}

type OpenEntry = { goalId: string; date: string; status: 'open'; updatedAt: string }

function isOpenEntry(value: unknown): value is OpenEntry {
  return isRecord(value) && isIdentifier(value.goalId) &&
    typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    value.status === 'open' && typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
}

export function isDataMutation(value: unknown): value is DataMutation {
  if (!isRecord(value) || !isIdentifier(value.id)) return false
  if (value.kind === 'goal.upsert') return isGoal(value.goal)
  if (value.kind === 'goal.delete') return isIdentifier(value.goalId)
  if (value.kind === 'body.upsert') return isBodyMetric(value.metric)
  if (value.kind === 'body.delete') return isIdentifier(value.metricId)
  if (value.kind === 'gym.template.upsert') return isGymTemplate(value.template)
  if (value.kind === 'gym.template.delete') return isIdentifier(value.templateId)
  if (value.kind === 'gym.session.complete') return isGymSession(value.session)
  if (value.kind === 'gym.session.delete') return isIdentifier(value.sessionId)
  if (value.kind === 'entry.set') return isEntry(value.entry) || isOpenEntry(value.entry)
  return false
}

function isProfileId(value: unknown): value is ProfileId { return value === 'profile-bugra' || value === 'profile-sena' }

export function loadPendingMutations(): PendingMutation[] {
  try {
    const raw = localStorage.getItem(PENDING_MUTATIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !Array.isArray(parsed.mutations)) return []
    const candidates: unknown[] = parsed.version === 2
      ? parsed.mutations
      : parsed.version === 1
        ? parsed.mutations.map((mutation) => ({ profileId: DEFAULT_PROFILE_ID, mutation }))
        : []
    const ids = new Set<string>()
    return candidates.filter((item): item is PendingMutation => {
      if (!isRecord(item) || !isProfileId(item.profileId) || !isDataMutation(item.mutation)) return false
      const key = `${item.profileId}\0${item.mutation.id}`
      if (ids.has(key)) return false
      ids.add(key)
      return true
    })
  } catch {
    return []
  }
}

export function persistPendingMutations(mutations: PendingMutation[] | DataMutation[]) {
  try {
    if (mutations.length === 0) {
      localStorage.removeItem(PENDING_MUTATIONS_STORAGE_KEY)
      return true
    }
    const normalized: PendingMutation[] = mutations.map((item) => 'mutation' in item ? item : ({ profileId: DEFAULT_PROFILE_ID, mutation: item }))
    const value: StoredMutationQueue = { version: 2, mutations: normalized }
    localStorage.setItem(PENDING_MUTATIONS_STORAGE_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function upsertById<T extends { id: string }>(items: T[], value: T) {
  return items.some((item) => item.id === value.id)
    ? items.map((item) => item.id === value.id ? value : item)
    : [...items, value]
}

export function applyPendingMutations(data: AppData, mutations: PendingMutation[] | DataMutation[], profileId: ProfileId = DEFAULT_PROFILE_ID) {
  return mutations.reduce<AppData>((current, item) => {
    const scoped = 'mutation' in item ? item : { profileId: DEFAULT_PROFILE_ID, mutation: item }
    if (scoped.profileId !== profileId) return current
    const mutation = scoped.mutation
    if (mutation.kind === 'goal.upsert') return { ...current, goals: upsertById(current.goals, mutation.goal) }
    if (mutation.kind === 'goal.delete') return {
      ...current,
      goals: current.goals.filter((goal) => goal.id !== mutation.goalId),
      entries: current.entries.filter((entry) => entry.goalId !== mutation.goalId),
    }
    if (mutation.kind === 'body.upsert') return { ...current, bodyMetrics: upsertById(current.bodyMetrics, mutation.metric) }
    if (mutation.kind === 'body.delete') return { ...current, bodyMetrics: current.bodyMetrics.filter((metric) => metric.id !== mutation.metricId) }
    if (mutation.kind === 'gym.template.upsert') return { ...current, gymTemplates: upsertById(current.gymTemplates, mutation.template) }
    if (mutation.kind === 'gym.template.delete') return {
      ...current,
      gymTemplates: current.gymTemplates.filter((template) => template.id !== mutation.templateId),
      gymSessions: current.gymSessions.map((session) => session.templateId === mutation.templateId
        ? { ...session, templateId: undefined }
        : session),
    }
    if (mutation.kind === 'gym.session.complete') return {
      ...current,
      gymSessions: current.gymSessions.some((session) => session.id === mutation.session.id)
        ? current.gymSessions
        : [...current.gymSessions, mutation.session],
    }
    if (mutation.kind === 'gym.session.delete') return { ...current, gymSessions: current.gymSessions.filter((session) => session.id !== mutation.sessionId) }

    const entries = current.entries.filter((entry) => !(entry.goalId === mutation.entry.goalId && entry.date === mutation.entry.date))
    return mutation.entry.status === 'open' ? { ...current, entries } : { ...current, entries: [...entries, mutation.entry] }
  }, data)
}
