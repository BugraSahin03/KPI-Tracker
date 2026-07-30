import { differenceInCalendarDays, isSameDay, subDays } from 'date-fns'
import type { AppData, Goal, GoalStatus, Period } from '../types'
import { dateRange, periodBounds, toDateKey } from './date'

export interface GoalStat {
  goal: Goal
  done: number
  total: number
  rate: number
}

export interface Stats {
  rate: number
  done: number
  total: number
  currentStreak: number
  bestStreak: number
  perGoal: GoalStat[]
}

export function goalIsScheduledOn(goal: Goal, date: string) {
  return goal.activityPeriods.some(
    (period) => period.start <= date && (period.end === undefined || date < period.end),
  )
}

export function goalsForDate(data: AppData, date: string) {
  return data.goals.filter(
    (goal) =>
      goalIsScheduledOn(goal, date) ||
      data.entries.some((entry) => entry.goalId === goal.id && entry.date === date),
  )
}

export function statusFor(data: AppData, goalId: string, date: string): GoalStatus {
  return (
    data.entries.find((entry) => entry.goalId === goalId && entry.date === date)?.status ?? 'open'
  )
}

export function dayStatus(data: AppData, date: string): GoalStatus {
  const goals = goalsForDate(data, date)
  if (goals.length === 0) return 'open'
  const statuses = goals.map((goal) => statusFor(data, goal.id, date))
  if (statuses.every((status) => status === 'done')) return 'done'
  if (statuses.some((status) => status === 'failed')) return 'failed'
  return 'open'
}

function streaks(data: AppData, end: Date, rangeStart: Date) {
  let streakEnd = end
  if (isSameDay(end, new Date()) && dayStatus(data, toDateKey(end)) === 'open') {
    // An unfinished current day must not erase a streak earned through yesterday.
    streakEnd = subDays(end, 1)
  }
  const maxDays = Math.max(0, differenceInCalendarDays(streakEnd, rangeStart) + 1)
  let currentStreak = 0
  for (let index = 0; index < maxDays; index += 1) {
    if (dayStatus(data, toDateKey(subDays(streakEnd, index))) !== 'done') break
    currentStreak += 1
  }

  let running = 0
  let bestStreak = 0
  for (const key of dateRange(rangeStart, end)) {
    if (dayStatus(data, key) === 'done') {
      running += 1
      bestStreak = Math.max(bestStreak, running)
    } else {
      running = 0
    }
  }
  return { currentStreak, bestStreak }
}

export function calculateStats(data: AppData, period: Period, anchor = new Date()): Stats {
  const { start, end } = periodBounds(period, anchor, true)
  if (start > end) {
    return { rate: 0, done: 0, total: 0, currentStreak: 0, bestStreak: 0, perGoal: [] }
  }
  const dates = dateRange(start, end)
  const perGoal = data.goals
    .map((goal) => {
      const eligibleDates = dates.filter(
        (date) =>
          goalIsScheduledOn(goal, date) ||
          data.entries.some((entry) => entry.goalId === goal.id && entry.date === date),
      )
      const done = eligibleDates.filter((date) => statusFor(data, goal.id, date) === 'done').length
      return {
        goal,
        done,
        total: eligibleDates.length,
        rate: eligibleDates.length ? Math.round((done / eligibleDates.length) * 100) : 0,
      }
    })
    .filter((item) => item.total > 0)

  const done = perGoal.reduce((sum, goal) => sum + goal.done, 0)
  const total = perGoal.reduce((sum, goal) => sum + goal.total, 0)
  return {
    rate: total ? Math.round((done / total) * 100) : 0,
    done,
    total,
    ...streaks(data, end, start),
    perGoal,
  }
}
