export type GoalStatus = 'open' | 'done' | 'failed'
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
  createdAt: string
}

export interface AppData {
  version: 2
  goals: Goal[]
  entries: DailyEntry[]
  bodyMetrics: BodyMetric[]
}

export type Period = 'week' | 'month' | 'year'
