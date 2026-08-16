export type GoalStatus = 'open' | 'done' | 'failed'
export type ProfileId = 'profile-bugra' | 'profile-sena'

export interface Profile {
  id: ProfileId
  name: 'Bugra' | 'Sena'
  initial: 'B' | 'S'
  color: string
}

export const DEFAULT_PROFILE_ID: ProfileId = 'profile-bugra'
export type GoalIcon = 'protein' | 'water' | 'activity' | 'sleep' | 'custom'

export interface GoalActivityPeriod {
  start: string
  /** Exclusive local date key. Missing while the period is active. */
  end?: string
}

export interface Goal {
  id: string
  name: string
  unit: string
  target: number
  icon: GoalIcon
  color: string
  active: boolean
  createdAt: string
  activityPeriods: GoalActivityPeriod[]
}

export interface DailyEntry {
  goalId: string
  date: string
  status: Exclude<GoalStatus, 'open'>
  updatedAt: string
}

export interface BodyMetric {
  id: string
  date: string
  weightKg?: number
  muscleMassKg?: number
  bodyFatPercent?: number
  bmi?: number
  leanBodyMassKg?: number
  source?: 'manual' | 'google-health' | 'local-import' | 'mixed'
  measuredAt?: string
  externalId?: string
  createdAt: string
}

export interface GymTemplateExercise {
  id: string
  name: string
  sets: number
  targetWeightKg?: number
  targetReps: number
  position: number
}

export interface GymTemplate {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  exercises: GymTemplateExercise[]
}

export interface GymSessionExercise {
  id: string
  templateExerciseId?: string
  name: string
  sets: number
  weightKg?: number
  reps: number
  position: number
  /** Individual performed sets. Missing only on legacy clients/drafts. */
  performedSets?: GymSessionSet[]
}

export interface GymSessionSet {
  id: string
  setNumber: number
  weightKg?: number
  reps: number
}

export interface GymSession {
  id: string
  templateId?: string
  templateName: string
  date: string
  startedAt: string
  completedAt: string
  exercises: GymSessionExercise[]
}

export interface AppData {
  version: 3
  goals: Goal[]
  entries: DailyEntry[]
  bodyMetrics: BodyMetric[]
  gymTemplates: GymTemplate[]
  gymSessions: GymSession[]
}

export type DataMutation =
  | { id: string; kind: 'entry.set'; entry: DailyEntry | { goalId: string; date: string; status: 'open'; updatedAt: string } }
  | { id: string; kind: 'goal.upsert'; goal: Goal }
  | { id: string; kind: 'goal.delete'; goalId: string }
  | { id: string; kind: 'body.upsert'; metric: BodyMetric }
  | { id: string; kind: 'body.delete'; metricId: string }
  | { id: string; kind: 'gym.template.upsert'; template: GymTemplate }
  | { id: string; kind: 'gym.template.delete'; templateId: string }
  | { id: string; kind: 'gym.session.complete'; session: GymSession }
  | { id: string; kind: 'gym.session.delete'; sessionId: string }

export type Period = 'week' | 'month' | 'year'
