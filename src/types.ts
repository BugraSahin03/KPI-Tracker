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
  /** Stable profile exercise used across templates. Missing only on legacy clients. */
  exerciseId?: string
  name: string
  sets: number
  targetWeightKg?: number
  targetReps: number
  /** Upper bound when the target is a repetition range; omitted for a single target. */
  targetRepsMax?: number
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
  /** Stable profile exercise used for cross-template history. Missing on legacy sessions. */
  exerciseId?: string
  templateExerciseId?: string
  name: string
  sets: number
  weightKg?: number
  reps: number
  /** Planned repetition target snapshot. Missing on legacy sessions. */
  targetReps?: number
  targetRepsMax?: number
  /** Remind the next session of this stable template exercise to increase weight. */
  increaseNextTime?: boolean
  /** Whether the exercise was marked complete during this session. */
  completed?: boolean
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

export interface GymExercise {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export type RunEnvironment = 'indoor' | 'outdoor'

export interface RunningSession {
  id: string
  environment: RunEnvironment
  date: string
  /** Local wall-clock time from the Fitness summary, when visible. */
  startTime?: string
  durationSeconds: number
  distanceKm: number
  /** Stored snapshot; must stay close to duration / distance. */
  averagePaceSecondsPerKm: number
  averageHeartRateBpm?: number
  effort?: number
  activeCalories?: number
  totalCalories?: number
  elevationGainM?: number
  averagePowerWatts?: number
  averageCadenceSpm?: number
  source: 'screenshot' | 'manual' | 'shortcut'
  /** Stable duplicate guard without retaining the source image. */
  fingerprint: string
  createdAt: string
}

export type WeeklyGoalSourceType = 'gym' | 'run' | 'manual'
export type WeeklyGoalRunEnvironment = 'any' | RunEnvironment
export type WeeklyGoalAdjustmentStatus = 'done' | 'sick' | 'injured'
export type WeeklyGoalIcon = 'gym' | 'run' | 'calendar' | 'custom'

/** A dated snapshot keeps edits and pauses from changing older ISO weeks. */
export interface WeeklyGoalDefinition {
  effectiveFrom: string
  /** Exclusive local date key. */
  effectiveTo?: string
  name: string
  targetCount: number
  sourceType: WeeklyGoalSourceType
  gymTemplateIds?: string[]
  /** Immutable name snapshots keep historic matching stable after a template was deleted. */
  gymTemplateNames?: string[]
  runEnvironment?: WeeklyGoalRunEnvironment
  color: string
  icon: WeeklyGoalIcon
  active: boolean
  countingMode: 'unique-days'
}

export interface WeeklyGoal {
  id: string
  name: string
  targetCount: number
  sourceType: WeeklyGoalSourceType
  gymTemplateIds?: string[]
  runEnvironment?: WeeklyGoalRunEnvironment
  color: string
  icon: WeeklyGoalIcon
  createdAt: string
  startDate: string
  active: boolean
  countingMode: 'unique-days'
  definitions: WeeklyGoalDefinition[]
}

export interface WeeklyGoalAdjustment {
  goalId: string
  date: string
  status: WeeklyGoalAdjustmentStatus
  updatedAt: string
}

export interface AppData {
  version: 3
  goals: Goal[]
  entries: DailyEntry[]
  bodyMetrics: BodyMetric[]
  gymTemplates: GymTemplate[]
  gymSessions: GymSession[]
  /** Canonical profile exercise library. Missing only in legacy local payloads. */
  gymExercises?: GymExercise[]
  /** Runs were added without changing the legacy envelope version. */
  runs?: RunningSession[]
  /** Weekly goals were added without changing the legacy envelope version. */
  weeklyGoals?: WeeklyGoal[]
  weeklyGoalAdjustments?: WeeklyGoalAdjustment[]
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
  | { id: string; kind: 'run.create'; run: RunningSession }
  | { id: string; kind: 'run.delete'; runId: string }
  | { id: string; kind: 'weekly-goal.upsert'; goal: WeeklyGoal }
  | { id: string; kind: 'weekly-goal.delete'; goalId: string }
  | { id: string; kind: 'weekly-goal.adjust'; adjustment: WeeklyGoalAdjustment | { goalId: string; date: string; status: 'open'; updatedAt: string } }
  | { id: string; kind: 'gym.exercise.merge'; sourceExerciseId: string; targetExerciseId: string; expectedSourceName: string; expectedTargetName: string }
  | { id: string; kind: 'gym.exercise.rename'; exerciseId: string; expectedName: string; expectedUpdatedAt: string; name: string; updatedAt: string }

export type Period = 'week' | 'month' | 'year'
