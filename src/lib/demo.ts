import {
  differenceInCalendarDays,
  getDay,
  getMonth,
  startOfDay,
  startOfMonth,
  subMonths,
} from 'date-fns'
import type { AppData, BodyMetric, DailyEntry, GoalStatus } from '../types'
import { dateRange, toDateKey } from './date'
import { createInitialData } from './storage'

function stableScore(date: string, salt: number) {
  let value = salt
  for (let index = 0; index < date.length; index += 1) {
    value = (value * 33 + date.charCodeAt(index)) % 9973
  }
  return value % 100
}

function demoStatus(
  date: string,
  goal: 'protein' | 'water',
  daysBeforeAnchor: number,
): GoalStatus {
  // A short active streak makes the current-series insight useful immediately.
  if (daysBeforeAnchor >= 0 && daysBeforeAnchor <= 3) return 'done'
  // A few intentionally untracked days keep neutral calendar tiles visible.
  if (stableScore(date, 7) < 5) return 'open'

  const parsed = new Date(`${date}T12:00:00`)
  const month = getMonth(parsed)
  const weekday = getDay(parsed)
  const seasonalBoost = [4, 3, 1, -2, -4, -1, 2, 5, 7, 4, 1, -1][month]
  const weekendPenalty = weekday === 0 || weekday === 6 ? -7 : 0
  const threshold =
    (goal === 'water' ? 84 : 78) + seasonalBoost + weekendPenalty
  const score = stableScore(date, goal === 'water' ? 71 : 19)

  if (score < threshold) return 'done'
  if (score < threshold + 13) return 'failed'
  return 'open'
}

export function createDemoData(anchor = new Date()): AppData {
  const normalizedAnchor = startOfDay(anchor)
  const start = startOfMonth(subMonths(normalizedAnchor, 11))
  const data = createInitialData(toDateKey(start))
  const entries: DailyEntry[] = []

  for (const date of dateRange(start, normalizedAnchor)) {
    const daysBeforeAnchor = differenceInCalendarDays(normalizedAnchor, new Date(`${date}T12:00:00`))
    for (const goalId of ['protein', 'water'] as const) {
      const status = demoStatus(date, goalId, daysBeforeAnchor)
      if (status === 'open') continue
      entries.push({
        goalId,
        date,
        status,
        updatedAt: `${date}T20:00:00.000Z`,
      })
    }
  }

  const totalDays = differenceInCalendarDays(normalizedAnchor, start)
  const bodyMetrics: BodyMetric[] = []
  for (let offset = 0; offset <= totalDays; offset += 14) {
    const measurementDate = new Date(start)
    measurementDate.setDate(measurementDate.getDate() + offset)
    if (measurementDate > normalizedAnchor) break
    const progress = totalDays === 0 ? 1 : offset / totalDays
    const wave = Math.sin(offset / 19) * 0.45
    const date = toDateKey(measurementDate)
    bodyMetrics.push({
      id: `demo-body-${date}`,
      date,
      weightKg: Math.round((87.4 - progress * 6.3 + wave) * 10) / 10,
      muscleMassKg: Math.round((60.1 + progress * 2.5 + Math.sin(offset / 31) * 0.16) * 10) / 10,
      createdAt: `${date}T07:15:00.000Z`,
    })
  }

  return {
    ...data,
    entries,
    bodyMetrics,
  }
}
