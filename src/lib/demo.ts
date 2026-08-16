import {
  differenceInCalendarDays,
  getDay,
  getMonth,
  startOfDay,
  startOfMonth,
  subMonths,
} from 'date-fns'
import type { AppData, BodyMetric, DailyEntry, GoalStatus, GymSession, GymTemplateExercise } from '../types'
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
  const programs: Record<string, Omit<GymTemplateExercise, 'id' | 'position'>[]> = {
    Push: [{ name: 'Bankdrücken', sets: 3, targetWeightKg: 70, targetReps: 8 }, { name: 'Schulterdrücken', sets: 3, targetWeightKg: 32.5, targetReps: 10 }],
    Pull: [{ name: 'Latzug', sets: 3, targetWeightKg: 60, targetReps: 10 }, { name: 'Rudern', sets: 3, targetWeightKg: 55, targetReps: 10 }],
    Beine: [{ name: 'Kniebeugen', sets: 3, targetWeightKg: 80, targetReps: 8 }, { name: 'Beinpresse', sets: 3, targetWeightKg: 140, targetReps: 10 }],
  }
  data.gymTemplates = data.gymTemplates.map((template) => ({ ...template, exercises: (programs[template.name] ?? []).map((exercise, position) => ({ ...exercise, id: `demo-${template.name}-${position}`, position })) }))
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

  const gymSessions: GymSession[] = []
  for (let offset = 10; offset <= Math.min(totalDays, 84); offset += 3) {
    const sessionDate = new Date(normalizedAnchor)
    sessionDate.setDate(sessionDate.getDate() - offset)
    const template = data.gymTemplates[gymSessions.length % data.gymTemplates.length]!
    const date = toDateKey(sessionDate)
    gymSessions.push({
      id: `demo-session-${date}`,
      templateId: template.id,
      templateName: template.name,
      date,
      startedAt: `${date}T17:30:00.000Z`,
      completedAt: `${date}T18:35:00.000Z`,
      exercises: template.exercises.map((exercise) => ({
        id: `demo-session-${date}-${exercise.position}`, templateExerciseId: exercise.id, name: exercise.name,
        sets: exercise.sets, weightKg: exercise.targetWeightKg, reps: exercise.targetReps, position: exercise.position,
        performedSets: Array.from({ length: exercise.sets }, (_, index) => ({
          id: `demo-session-${date}-${exercise.position}-set-${index + 1}`, setNumber: index + 1,
          weightKg: exercise.targetWeightKg, reps: exercise.targetReps,
        })),
      })),
    })
  }

  return {
    ...data,
    entries,
    bodyMetrics,
    gymSessions,
  }
}
