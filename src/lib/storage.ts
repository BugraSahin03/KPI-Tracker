import type {
  AppData,
  BodyMetric,
  DailyEntry,
  Goal,
  GoalActivityPeriod,
  GoalIcon,
  GoalStatus,
} from '../types'
import { isValid, parseISO } from 'date-fns'
import { todayKey } from './date'

export const STORAGE_KEY = 'pace-tracker-data'
const DEFAULT_START_DATE = '2020-01-01'

type GoalBlueprint = Pick<Goal, 'id' | 'name' | 'unit' | 'target' | 'icon' | 'color'>

export const DEFAULT_GOALS: GoalBlueprint[] = [
  {
    id: 'protein',
    name: 'Protein',
    unit: 'g',
    target: 120,
    icon: 'protein',
    color: '#c6ff3d',
  },
  {
    id: 'water',
    name: 'Wasser',
    unit: 'L',
    target: 2,
    icon: 'water',
    color: '#4dc5ff',
  },
]

export function createInitialData(startDate = todayKey()): AppData {
  return {
    version: 2,
    goals: DEFAULT_GOALS.map((goal) => ({
      ...goal,
      active: true,
      createdAt: startDate,
      activityPeriods: [{ start: startDate }],
    })),
    entries: [],
    bodyMetrics: [],
  }
}

const goalIcons: GoalIcon[] = ['protein', 'water', 'activity', 'sleep', 'custom']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDateKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isValid(parseISO(value))
  )
}

function isActivityPeriod(value: unknown): value is GoalActivityPeriod {
  return (
    isRecord(value) &&
    isDateKey(value.start) &&
    (value.end === undefined || (isDateKey(value.end) && value.start <= value.end))
  )
}

function isGoal(value: unknown): value is Goal {
  const periods = isRecord(value) && Array.isArray(value.activityPeriods)
    ? value.activityPeriods
    : []
  const periodsAreConsistent =
    periods.length > 0 &&
    periods.every(isActivityPeriod) &&
    periods.every((period, index) => {
      if (index === 0) return true
      const previous = periods[index - 1] as GoalActivityPeriod
      return previous.end !== undefined && previous.end <= (period as GoalActivityPeriod).start
    })
  const lastPeriod = periods.at(-1) as GoalActivityPeriod | undefined

  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.unit === 'string' &&
    typeof value.target === 'number' &&
    Number.isFinite(value.target) &&
    value.target > 0 &&
    goalIcons.includes(value.icon as GoalIcon) &&
    typeof value.color === 'string' &&
    typeof value.active === 'boolean' &&
    isDateKey(value.createdAt) &&
    periodsAreConsistent &&
    value.createdAt === (periods[0] as GoalActivityPeriod).start &&
    value.active === (lastPeriod?.end === undefined)
  )
}

function isLegacyGoal(value: unknown): value is Omit<Goal, 'activityPeriods'> {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.unit === 'string' &&
    typeof value.target === 'number' &&
    Number.isFinite(value.target) &&
    value.target > 0 &&
    goalIcons.includes(value.icon as GoalIcon) &&
    typeof value.color === 'string' &&
    typeof value.active === 'boolean' &&
    isDateKey(value.createdAt)
  )
}

function isEntry(value: unknown): value is DailyEntry {
  return (
    isRecord(value) &&
    typeof value.goalId === 'string' &&
    isDateKey(value.date) &&
    (value.status === 'done' || value.status === 'failed') &&
    typeof value.updatedAt === 'string'
  )
}

function isBodyMetric(value: unknown): value is BodyMetric {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isDateKey(value.date) &&
    (value.weightKg === undefined ||
      (typeof value.weightKg === 'number' &&
        Number.isFinite(value.weightKg) &&
        value.weightKg > 0 &&
        value.weightKg <= 500)) &&
    (value.muscleMassKg === undefined ||
      (typeof value.muscleMassKg === 'number' &&
        Number.isFinite(value.muscleMassKg) &&
        value.muscleMassKg > 0 &&
        value.muscleMassKg <= 300)) &&
    typeof value.createdAt === 'string'
  )
}

function migrateV1(parsed: Record<string, unknown>): AppData | null {
  if (
    !Array.isArray(parsed.goals) ||
    !parsed.goals.every(isLegacyGoal) ||
    !Array.isArray(parsed.entries) ||
    !parsed.entries.every(isEntry) ||
    !Array.isArray(parsed.bodyMetrics) ||
    !parsed.bodyMetrics.every(isBodyMetric)
  ) {
    return null
  }

  const entries = parsed.entries
  const firstEntry = entries.map((entry) => entry.date).sort()[0]
  const migrationDate = todayKey()
  const fallbackStart = firstEntry ?? migrationDate
  const goals = parsed.goals.map((goal): Goal => {
    // Version 1 seeded built-in goals at 2020, which incorrectly counted every
    // day before the user installed the app. Anchor those seeds to real usage.
    const start = goal.createdAt.slice(0, 10) === DEFAULT_START_DATE
      ? fallbackStart
      : goal.createdAt.slice(0, 10)
    return {
      ...goal,
      createdAt: start,
      activityPeriods: [
        {
          start,
          ...(goal.active ? {} : { end: migrationDate }),
        },
      ],
    }
  })

  return {
    version: 2,
    goals,
    entries,
    bodyMetrics: parsed.bodyMetrics,
  }
}

export function loadData(storage: Pick<Storage, 'getItem'> = localStorage): AppData {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return createInitialData()
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return createInitialData()
    if (parsed.version === 1) return migrateV1(parsed) ?? createInitialData()
    if (
      parsed.version !== 2 ||
      !Array.isArray(parsed.goals) ||
      !parsed.goals.every(isGoal) ||
      !Array.isArray(parsed.entries) ||
      !parsed.entries.every(isEntry) ||
      !Array.isArray(parsed.bodyMetrics) ||
      !parsed.bodyMetrics.every(isBodyMetric)
    ) {
      return createInitialData()
    }
    return {
      version: 2,
      goals: parsed.goals,
      entries: parsed.entries,
      bodyMetrics: parsed.bodyMetrics,
    }
  } catch {
    return createInitialData()
  }
}

export function saveData(data: AppData, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function setEntryStatus(
  entries: DailyEntry[],
  goalId: string,
  date: string,
  status: GoalStatus,
) {
  const next = entries.filter((entry) => !(entry.goalId === goalId && entry.date === date))
  if (status === 'open') return next
  return [
    ...next,
    {
      goalId,
      date,
      status,
      updatedAt: new Date().toISOString(),
    },
  ]
}

export function toggleGoalActive(goal: Goal, date = todayKey()): Goal {
  const activityPeriods = goal.activityPeriods.map((period) => ({ ...period }))
  const lastPeriod = activityPeriods.at(-1)

  if (goal.active) {
    if (lastPeriod && lastPeriod.end === undefined) lastPeriod.end = date
    return { ...goal, active: false, activityPeriods }
  }

  if (lastPeriod?.end === date) {
    delete lastPeriod.end
  } else {
    activityPeriods.push({ start: date })
  }
  return { ...goal, active: true, activityPeriods }
}

export function makeId(prefix: string) {
  return `${prefix}-${todayKey()}-${Math.random().toString(36).slice(2, 9)}`
}
