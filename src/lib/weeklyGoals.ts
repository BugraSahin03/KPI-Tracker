import { addDays, endOfISOWeek, startOfISOWeek } from 'date-fns'
import type {
  AppData,
  WeeklyGoal,
  WeeklyGoalAdjustment,
  WeeklyGoalAdjustmentStatus,
  WeeklyGoalDefinition,
} from '../types.js'
import { dateRange, fromDateKey, toDateKey } from './date.js'

export type WeeklyDayState = {
  date: string
  status: 'done' | 'sick' | 'injured' | 'open' | 'inactive' | 'future'
  automatic: boolean
  automaticLabels: string[]
  adjustment?: WeeklyGoalAdjustmentStatus
}

export type WeeklyEvaluation = {
  start: string
  end: string
  target: number
  done: number
  excused: number
  status: 'fulfilled' | 'excused' | 'failed' | 'partial' | 'open' | 'future' | 'inactive'
  days: WeeklyDayState[]
  definition?: WeeklyGoalDefinition
}

export function weeklyGoalDefinitionForDate(goal: WeeklyGoal, date: string) {
  return goal.definitions.find((definition) => definition.effectiveFrom <= date &&
    (definition.effectiveTo === undefined || date < definition.effectiveTo))
}

export function weeklyGoalCurrentDefinition(goal: WeeklyGoal, date: string) {
  return weeklyGoalDefinitionForDate(goal, date) ?? goal.definitions.at(-1)
}

function automaticLabels(data: AppData, definition: WeeklyGoalDefinition, date: string) {
  if (definition.sourceType === 'manual') return []
  if (definition.sourceType === 'gym') {
    const allowed = new Set(definition.gymTemplateIds ?? [])
    const allowedNames = new Set(definition.gymTemplateNames ?? [])
    return data.gymSessions
      .filter((session) => session.date === date && (allowed.size === 0 || (session.templateId !== undefined && allowed.has(session.templateId)) || (session.templateId === undefined && allowedNames.has(session.templateName))))
      .map((session) => session.templateName)
  }
  return (data.runs ?? [])
    .filter((run) => run.date === date && (definition.runEnvironment === undefined || definition.runEnvironment === 'any' || run.environment === definition.runEnvironment))
    .map((run) => run.environment === 'indoor' ? 'Indoor-Lauf' : 'Outdoor-Lauf')
}

export function evaluateWeeklyGoal(data: AppData, goal: WeeklyGoal, anchor: Date | string, today: string): WeeklyEvaluation {
  const anchorDate = typeof anchor === 'string' ? fromDateKey(anchor) : anchor
  const weekStart = toDateKey(startOfISOWeek(anchorDate))
  const weekEnd = toDateKey(endOfISOWeek(anchorDate))
  const adjustments = new Map((data.weeklyGoalAdjustments ?? [])
    .filter((item) => item.goalId === goal.id && item.date >= weekStart && item.date <= weekEnd)
    .map((item) => [item.date, item]))
  const days: WeeklyDayState[] = dateRange(fromDateKey(weekStart), fromDateKey(weekEnd)).map((date) => {
    if (date > today) return { date, status: 'future', automatic: false, automaticLabels: [] }
    const definition = weeklyGoalDefinitionForDate(goal, date)
    if (!definition?.active) return { date, status: 'inactive', automatic: false, automaticLabels: [] }
    const labels = automaticLabels(data, definition, date)
    const adjustment = adjustments.get(date)?.status
    if (adjustment === 'sick' || adjustment === 'injured') return { date, status: adjustment, automatic: false, automaticLabels: [], adjustment }
    if (labels.length || adjustment === 'done') return { date, status: 'done', automatic: labels.length > 0, automaticLabels: labels, adjustment }
    return { date, status: 'open', automatic: false, automaticLabels: [] }
  })
  const definitionsInWeek = goal.definitions.filter((definition) => definition.effectiveFrom <= weekEnd &&
    (definition.effectiveTo === undefined || definition.effectiveTo > weekStart))
  const definition = [...definitionsInWeek].reverse().find((item) => item.active) ?? definitionsInWeek.at(-1)
  if (!definition || !definitionsInWeek.some((item) => item.active)) {
    return { start: weekStart, end: weekEnd, target: definition?.targetCount ?? goal.targetCount, done: 0, excused: 0, status: weekStart > today ? 'future' : 'inactive', days, definition }
  }
  const target = definition.targetCount
  const done = days.filter((day) => day.status === 'done').length
  const rawExcused = days.filter((day) => day.status === 'sick' || day.status === 'injured').length
  const excused = Math.min(rawExcused, Math.max(0, target - done))
  let status: WeeklyEvaluation['status']
  if (weekStart > today) status = 'future'
  else if (done >= target) status = 'fulfilled'
  else if (done + excused >= target) status = 'excused'
  else if (weekEnd < today) status = 'failed'
  else status = done || excused ? 'partial' : 'open'
  return { start: weekStart, end: weekEnd, target, done, excused, status, days, definition }
}

export function activeWeeklyGoals(data: AppData, date: string) {
  return (data.weeklyGoals ?? []).filter((goal) => weeklyGoalDefinitionForDate(goal, date)?.active)
}

export function setWeeklyAdjustment(
  adjustments: WeeklyGoalAdjustment[],
  goalId: string,
  date: string,
  status: WeeklyGoalAdjustmentStatus | 'open',
  updatedAt = new Date().toISOString(),
) {
  const rest = adjustments.filter((item) => !(item.goalId === goalId && item.date === date))
  return status === 'open' ? rest : [...rest, { goalId, date, status, updatedAt }]
}

export function closeAndAppendWeeklyDefinition(goal: WeeklyGoal, next: Omit<WeeklyGoalDefinition, 'effectiveFrom' | 'effectiveTo'>, effectiveFrom: string): WeeklyGoal {
  const definitions = goal.definitions
    .filter((item) => item.effectiveFrom < effectiveFrom)
    .map((item) => item.effectiveTo === undefined || item.effectiveTo > effectiveFrom ? { ...item, effectiveTo: effectiveFrom } : item)
  const appended: WeeklyGoalDefinition = { ...next, effectiveFrom }
  return {
    ...goal,
    name: next.name,
    targetCount: next.targetCount,
    sourceType: next.sourceType,
    gymTemplateIds: next.gymTemplateIds,
    runEnvironment: next.runEnvironment,
    color: next.color,
    icon: next.icon,
    active: next.active,
    countingMode: 'unique-days',
    definitions: [...definitions, appended],
  }
}

export function weeklyGoalWeeksBetween(start: Date, end: Date, includeTrailingPartialWeek = false) {
  const weeks: Date[] = []
  let cursor = startOfISOWeek(start)
  const last = startOfISOWeek(end)
  const firstPeriodDay = toDateKey(start)
  const lastPeriodDay = toDateKey(end)
  while (cursor <= last) {
    // Assign every ISO week to the period that contains its Thursday. This
    // prevents the same boundary week from appearing in two adjacent months
    // or years while keeping the normal Monday-to-Sunday week view intact.
    const ownerDay = toDateKey(addDays(cursor, 3))
    const belongsToPeriod = ownerDay >= firstPeriodDay
    if (belongsToPeriod && (ownerDay <= lastPeriodDay || (includeTrailingPartialWeek && cursor.getTime() === last.getTime()))) weeks.push(cursor)
    cursor = addDays(cursor, 7)
  }
  return weeks
}
