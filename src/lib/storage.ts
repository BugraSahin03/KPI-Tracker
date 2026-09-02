import type {
  AppData,
  BodyMetric,
  DailyEntry,
  Goal,
  GoalActivityPeriod,
  GoalIcon,
  GoalStatus,
  GymSession,
  GymExercise,
  GymTemplate,
} from '../types.js'
import { isValid, parseISO } from 'date-fns'
import { todayKey } from './date.js'

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

export function createDefaultGymTemplates(timestamp = new Date().toISOString()): GymTemplate[] {
  return ['Push', 'Pull', 'Beine'].map((name) => ({
    id: `gym-template-${name.toLowerCase()}`,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    exercises: [],
  }))
}

export function createInitialData(startDate = todayKey()): AppData {
  return {
    version: 3,
    goals: DEFAULT_GOALS.map((goal) => ({
      ...goal,
      active: true,
      createdAt: startDate,
      activityPeriods: [{ start: startDate }],
    })),
    entries: [],
    bodyMetrics: [],
    gymTemplates: createDefaultGymTemplates(`${startDate}T00:00:00.000Z`),
    gymSessions: [],
    gymExercises: [],
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

function isIdentifier(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
}

function isTimestamp(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && isValid(parseISO(value)) && !Number.isNaN(Date.parse(value))
}

export function isGoal(value: unknown): value is Goal {
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
    isIdentifier(value.id) &&
    typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 40 &&
    typeof value.unit === 'string' && value.unit.trim().length > 0 && value.unit.length <= 8 &&
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

export function isEntry(value: unknown): value is DailyEntry {
  return (
    isRecord(value) &&
    isIdentifier(value.goalId) &&
    isDateKey(value.date) &&
    (value.status === 'done' || value.status === 'failed') &&
    isTimestamp(value.updatedAt)
  )
}

export function isBodyMetric(value: unknown): value is BodyMetric {
  return (
    isRecord(value) &&
    isIdentifier(value.id) &&
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
    (value.bodyFatPercent === undefined ||
      (typeof value.bodyFatPercent === 'number' && Number.isFinite(value.bodyFatPercent) && value.bodyFatPercent >= 0 && value.bodyFatPercent <= 100)) &&
    (value.bmi === undefined ||
      (typeof value.bmi === 'number' && Number.isFinite(value.bmi) && value.bmi > 0 && value.bmi <= 150)) &&
    (value.leanBodyMassKg === undefined ||
      (typeof value.leanBodyMassKg === 'number' && Number.isFinite(value.leanBodyMassKg) && value.leanBodyMassKg > 0 && value.leanBodyMassKg <= 500)) &&
    (value.source === undefined || ['manual', 'google-health', 'local-import', 'mixed'].includes(value.source as string)) &&
    (value.measuredAt === undefined || isTimestamp(value.measuredAt)) &&
    (value.externalId === undefined || (typeof value.externalId === 'string' && value.externalId.length <= 500)) &&
    isTimestamp(value.createdAt) &&
    [value.weightKg, value.muscleMassKg, value.bodyFatPercent, value.bmi, value.leanBodyMassKg].some((item) => item !== undefined)
  )
}

function orderedUniqueExercises(
  exercises: unknown[],
  validator: (exercise: unknown) => boolean,
) {
  if (exercises.length > 30 || !exercises.every(validator)) return false
  const records = exercises as Record<string, unknown>[]
  const ids = records.map((exercise) => String(exercise.id))
  const names = records.map((exercise) => String(exercise.name).trim().toLocaleLowerCase('de-DE'))
  return new Set(ids).size === ids.length && new Set(names).size === names.length &&
    records.every((exercise, index) => exercise.position === index)
}

function validExerciseNumbers(value: Record<string, unknown>, weightKey: 'targetWeightKg' | 'weightKg') {
  const weight = value[weightKey]
  const minimumReps = weightKey === 'targetWeightKg' ? 1 : 0
  return Number.isInteger(value.sets) && Number(value.sets) >= 1 && Number(value.sets) <= 20 &&
    Number.isInteger(value[weightKey === 'targetWeightKg' ? 'targetReps' : 'reps']) &&
    Number(value[weightKey === 'targetWeightKg' ? 'targetReps' : 'reps']) >= minimumReps &&
    Number(value[weightKey === 'targetWeightKg' ? 'targetReps' : 'reps']) <= 100 &&
    (weight === undefined || (typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1000))
}

function validOptionalRepRange(value: Record<string, unknown>, minKey: 'targetReps' | 'reps') {
  const max = value.targetRepsMax
  if (max === undefined) return true
  return Number.isInteger(max) && Number(max) >= Number(value[minKey]) && Number(max) <= 100
}

export function isGymTemplate(value: unknown): value is GymTemplate {
  if (!isRecord(value) || !Array.isArray(value.exercises)) return false
  return isIdentifier(value.id) && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 50 &&
    isTimestamp(value.createdAt) && isTimestamp(value.updatedAt) &&
    orderedUniqueExercises(value.exercises, (exercise) => isRecord(exercise) && isIdentifier(exercise.id) &&
      (exercise.exerciseId === undefined || isIdentifier(exercise.exerciseId)) &&
      typeof exercise.name === 'string' && exercise.name.trim().length > 0 && exercise.name.length <= 80 &&
      Number.isInteger(exercise.position) && validExerciseNumbers(exercise, 'targetWeightKg') && validOptionalRepRange(exercise, 'targetReps'))
}

export function isGymSession(value: unknown): value is GymSession {
  if (!isRecord(value) || !Array.isArray(value.exercises)) return false
  const valid = isIdentifier(value.id) && (value.templateId === undefined || isIdentifier(value.templateId)) &&
    typeof value.templateName === 'string' && value.templateName.trim().length > 0 && value.templateName.length <= 50 &&
    isDateKey(value.date) && isTimestamp(value.startedAt) && isTimestamp(value.completedAt) &&
    Date.parse(String(value.startedAt)) <= Date.parse(String(value.completedAt)) && value.exercises.length > 0 &&
    orderedUniqueExercises(value.exercises, (exercise) => isRecord(exercise) && isIdentifier(exercise.id) &&
      (exercise.templateExerciseId === undefined || isIdentifier(exercise.templateExerciseId)) &&
      (exercise.exerciseId === undefined || isIdentifier(exercise.exerciseId)) &&
      typeof exercise.name === 'string' && exercise.name.trim().length > 0 && exercise.name.length <= 80 &&
      Number.isInteger(exercise.position) && validExerciseNumbers(exercise, 'weightKg') &&
      (exercise.targetReps === undefined || (Number.isInteger(exercise.targetReps) && Number(exercise.targetReps) >= 1 && Number(exercise.targetReps) <= 100)) &&
      (exercise.targetRepsMax === undefined || (exercise.targetReps !== undefined && Number.isInteger(exercise.targetRepsMax) && Number(exercise.targetRepsMax) >= Number(exercise.targetReps) && Number(exercise.targetRepsMax) <= 100)) &&
      (exercise.increaseNextTime === undefined || typeof exercise.increaseNextTime === 'boolean') &&
      (exercise.completed === undefined || typeof exercise.completed === 'boolean') &&
      (exercise.performedSets === undefined || (Array.isArray(exercise.performedSets) &&
        exercise.performedSets.length === exercise.sets && exercise.performedSets.every((set, index) =>
          isRecord(set) && isIdentifier(set.id) && set.setNumber === index + 1 &&
          Number.isInteger(set.reps) && Number(set.reps) >= 0 && Number(set.reps) <= 100 &&
          (set.weightKg === undefined || (typeof set.weightKg === 'number' && Number.isFinite(set.weightKg) && set.weightKg >= 0 && set.weightKg <= 1000))) &&
        new Set(exercise.performedSets.map((set) => isRecord(set) ? set.id : '')).size === exercise.performedSets.length)))
  if (!valid) return false
  const setIds = (value.exercises as Record<string, unknown>[]).flatMap((exercise) =>
    Array.isArray(exercise.performedSets) ? exercise.performedSets.map((set) => isRecord(set) ? String(set.id) : '') : [])
  return new Set(setIds).size === setIds.length
}

export function isGymExercise(value: unknown): value is GymExercise {
  return isRecord(value) && isIdentifier(value.id) && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 80 &&
    isTimestamp(value.createdAt) && isTimestamp(value.updatedAt)
}

export function isAppData(value: unknown): value is AppData {
  if (!isRecord(value)) return false
  if (value.version === 1) return migrateV1(value) !== null
  if (value.version === 2) return migrateV2(value) !== null
  if (!(
    value.version === 3 &&
    Array.isArray(value.goals) && value.goals.every(isGoal) &&
    Array.isArray(value.entries) && value.entries.every(isEntry) &&
    Array.isArray(value.bodyMetrics) && value.bodyMetrics.every(isBodyMetric) &&
    Array.isArray(value.gymTemplates) && value.gymTemplates.every(isGymTemplate) &&
    Array.isArray(value.gymSessions) && value.gymSessions.every(isGymSession) &&
    (value.gymExercises === undefined || (Array.isArray(value.gymExercises) && value.gymExercises.every(isGymExercise)))
  )) return false
  const goals = value.goals as Goal[]
  const entries = value.entries as DailyEntry[]
  const metrics = value.bodyMetrics as BodyMetric[]
  const goalIds = new Set(goals.map((goal) => goal.id))
  const entryKeys = new Set(entries.map((entry) => `${entry.goalId}\0${entry.date}`))
  const metricIds = new Set(metrics.map((metric) => metric.id))
  const externalIds = metrics.flatMap((metric) => metric.externalId ? [metric.externalId] : [])
  const templates = value.gymTemplates as GymTemplate[]
  const sessions = value.gymSessions as GymSession[]
  const gymExercises = (value.gymExercises ?? []) as GymExercise[]
  const exerciseIds = new Set(gymExercises.map((exercise) => exercise.id))
  return goalIds.size === goals.length && metricIds.size === metrics.length &&
    new Set(externalIds).size === externalIds.length && entryKeys.size === entries.length &&
    entries.every((entry) => goalIds.has(entry.goalId)) &&
    new Set(templates.map((template) => template.id)).size === templates.length &&
    new Set(sessions.map((session) => session.id)).size === sessions.length &&
    exerciseIds.size === gymExercises.length &&
    (gymExercises.length === 0 || templates.every((template) => template.exercises.every((exercise) => exercise.exerciseId === undefined || exerciseIds.has(exercise.exerciseId))) &&
      sessions.every((session) => session.exercises.every((exercise) => exercise.exerciseId === undefined || exerciseIds.has(exercise.exerciseId))))
}

export function normalizeAppData(value: unknown): AppData | null {
  if (!isRecord(value)) return null
  if (value.version === 1) return migrateV1(value)
  if (value.version === 2) return migrateV2(value)
  return isAppData(value) && value.version === 3 ? value : null
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
    version: 3,
    goals,
    entries,
    bodyMetrics: parsed.bodyMetrics,
    gymTemplates: createDefaultGymTemplates(),
    gymSessions: [],
  }
}

function migrateV2(parsed: Record<string, unknown>): AppData | null {
  if (!Array.isArray(parsed.goals) || !parsed.goals.every(isGoal) ||
    !Array.isArray(parsed.entries) || !parsed.entries.every(isEntry) ||
    !Array.isArray(parsed.bodyMetrics) || !parsed.bodyMetrics.every(isBodyMetric)) return null
  const migrated = {
    version: 3 as const,
    goals: parsed.goals,
    entries: parsed.entries,
    bodyMetrics: parsed.bodyMetrics,
    gymTemplates: createDefaultGymTemplates(),
    gymSessions: [],
  }
  return isAppData(migrated) ? migrated : null
}

export function loadData(storage: Pick<Storage, 'getItem'> = localStorage): AppData {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return createInitialData()
    const parsed: unknown = JSON.parse(raw)
    const normalized = normalizeAppData(parsed)
    if (!normalized) {
      return createInitialData()
    }
    return normalized
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

/** Deterministic, identifier-safe fallback for legacy exercises without sets. */
export function legacyGymSetId(exerciseId: string, setNumber: number) {
  let first = 1779033703
  let second = 3144134277
  let third = 1013904242
  let fourth = 2773480762
  for (let index = 0; index < exerciseId.length; index++) {
    const code = exerciseId.charCodeAt(index)
    first = second ^ Math.imul(first ^ code, 597399067)
    second = third ^ Math.imul(second ^ code, 2869860233)
    third = fourth ^ Math.imul(third ^ code, 951274213)
    fourth = first ^ Math.imul(fourth ^ code, 2716044179)
  }
  first = Math.imul(third ^ (first >>> 18), 597399067)
  second = Math.imul(fourth ^ (second >>> 22), 2869860233)
  third = Math.imul(first ^ (third >>> 17), 951274213)
  fourth = Math.imul(second ^ (fourth >>> 19), 2716044179)
  const digest = [first, second, third, fourth].map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('')
  return `legacy-set-${exerciseId.slice(0, 44)}-${digest}-${setNumber}`
}
