import { describe, expect, it } from 'vitest'
import { createInitialData } from './storage'
import { fromDateKey, toDateKey } from './date'
import { closeAndAppendWeeklyDefinition, evaluateWeeklyGoal, setWeeklyAdjustment, weeklyGoalWeeksBetween } from './weeklyGoals'
import type { WeeklyGoal } from '../types'

function weeklyGoal(overrides: Partial<WeeklyGoal> = {}): WeeklyGoal {
  const definition = {
    effectiveFrom: '2026-09-01', name: '3× GYM', targetCount: 3, sourceType: 'gym' as const,
    gymTemplateIds: [] as string[], color: '#c6ff3d', icon: 'gym' as const, active: true, countingMode: 'unique-days' as const,
  }
  return {
    id: 'weekly-gym', name: definition.name, targetCount: definition.targetCount, sourceType: definition.sourceType,
    gymTemplateIds: [], color: definition.color, icon: definition.icon, createdAt: '2026-09-01', startDate: '2026-09-01',
    active: true, countingMode: 'unique-days', definitions: [definition], ...overrides,
  }
}

describe('Wochenziel-Auswertung', () => {
  it('zählt automatische Einheiten höchstens einmal pro Tag und dedupliziert manuelle Erledigungen', () => {
    const data = createInitialData('2026-09-01')
    const goal = weeklyGoal()
    data.weeklyGoals = [goal]
    data.gymSessions = [
      { id: 'morning', templateName: 'Push', date: '2026-09-21', startedAt: '2026-09-21T06:00:00Z', completedAt: '2026-09-21T07:00:00Z', exercises: [] },
      { id: 'evening', templateName: 'Pull', date: '2026-09-21', startedAt: '2026-09-21T18:00:00Z', completedAt: '2026-09-21T19:00:00Z', exercises: [] },
    ]
    data.weeklyGoalAdjustments = [{ goalId: goal.id, date: '2026-09-21', status: 'done', updatedAt: '2026-09-21T20:00:00Z' }]

    const result = evaluateWeeklyGoal(data, goal, '2026-09-21', '2026-09-22')

    expect(result.done).toBe(1)
    expect(result.days[0]).toMatchObject({ status: 'done', automatic: true, automaticLabels: ['Push', 'Pull'] })
    expect(result.status).toBe('partial')
  })

  it('filtert GYM-Vorlagen und Laufarten, ohne andere Aktivitäten mitzuzählen', () => {
    const data = createInitialData('2026-09-01')
    const gymGoal = weeklyGoal({ gymTemplateIds: ['upper'], definitions: [{ ...weeklyGoal().definitions[0]!, gymTemplateIds: ['upper'] }] })
    data.gymSessions = [
      { id: 'upper-session', templateId: 'upper', templateName: 'Upper', date: '2026-09-21', startedAt: '2026-09-21T06:00:00Z', completedAt: '2026-09-21T07:00:00Z', exercises: [] },
      { id: 'lower-session', templateId: 'lower', templateName: 'Lower', date: '2026-09-22', startedAt: '2026-09-22T06:00:00Z', completedAt: '2026-09-22T07:00:00Z', exercises: [] },
    ]
    expect(evaluateWeeklyGoal(data, gymGoal, '2026-09-21', '2026-09-22').done).toBe(1)

    const runGoal = weeklyGoal({
      id: 'weekly-run', name: 'Outdoor', targetCount: 2, sourceType: 'run', gymTemplateIds: undefined,
      runEnvironment: 'outdoor', icon: 'run',
      definitions: [{ effectiveFrom: '2026-09-01', name: 'Outdoor', targetCount: 2, sourceType: 'run', runEnvironment: 'outdoor', color: '#4dc5ff', icon: 'run', active: true, countingMode: 'unique-days' }],
    })
    data.runs = [
      { id: 'outdoor', environment: 'outdoor', date: '2026-09-21', durationSeconds: 1800, distanceKm: 5, averagePaceSecondsPerKm: 360, source: 'manual', fingerprint: 'a'.repeat(64), createdAt: '2026-09-21T08:00:00Z' },
      { id: 'indoor', environment: 'indoor', date: '2026-09-22', durationSeconds: 1800, distanceKm: 5, averagePaceSecondsPerKm: 360, source: 'manual', fingerprint: 'b'.repeat(64), createdAt: '2026-09-22T08:00:00Z' },
    ]
    expect(evaluateWeeklyGoal(data, runGoal, '2026-09-21', '2026-09-22').done).toBe(1)
  })

  it('behandelt Krankheit und Verletzung als entschuldigt, aber nicht als Training', () => {
    const data = createInitialData('2026-09-01')
    const goal = weeklyGoal()
    data.weeklyGoalAdjustments = [
      { goalId: goal.id, date: '2026-09-21', status: 'done', updatedAt: '2026-09-21T10:00:00Z' },
      { goalId: goal.id, date: '2026-09-22', status: 'sick', updatedAt: '2026-09-22T10:00:00Z' },
      { goalId: goal.id, date: '2026-09-23', status: 'injured', updatedAt: '2026-09-23T10:00:00Z' },
    ]
    const result = evaluateWeeklyGoal(data, goal, '2026-09-21', '2026-09-27')
    expect(result).toMatchObject({ done: 1, excused: 2, status: 'excused' })
  })

  it('bewahrt vergangene Definitionen und ordnet Grenzwochen nur dem Monat ihres Donnerstags zu', () => {
    const original = weeklyGoal()
    const edited = closeAndAppendWeeklyDefinition(original, {
      name: '4× GYM', targetCount: 4, sourceType: 'gym', gymTemplateIds: [], color: '#c6ff3d', icon: 'gym', active: true, countingMode: 'unique-days',
    }, '2026-10-05')
    const data = createInitialData('2026-09-01')
    expect(evaluateWeeklyGoal(data, edited, '2026-09-28', '2026-10-10').target).toBe(3)
    expect(evaluateWeeklyGoal(data, edited, '2026-10-05', '2026-10-10').target).toBe(4)

    expect(weeklyGoalWeeksBetween(fromDateKey('2026-08-01'), fromDateKey('2026-08-31')).map(toDateKey)).not.toContain('2026-08-31')
    expect(weeklyGoalWeeksBetween(fromDateKey('2026-09-01'), fromDateKey('2026-09-30')).map(toDateKey)).toContain('2026-08-31')
    expect(weeklyGoalWeeksBetween(fromDateKey('2026-09-01'), fromDateKey('2026-09-22'), true).map(toDateKey)).toContain('2026-09-21')
    expect(weeklyGoalWeeksBetween(fromDateKey('2027-05-01'), fromDateKey('2027-05-01'), true).map(toDateKey)).not.toContain('2027-04-26')
  })

  it('setzt und entfernt manuelle Tageskorrekturen deterministisch', () => {
    const first = setWeeklyAdjustment([], 'weekly-gym', '2026-09-21', 'done', '2026-09-21T10:00:00Z')
    const replaced = setWeeklyAdjustment(first, 'weekly-gym', '2026-09-21', 'sick', '2026-09-21T11:00:00Z')
    expect(replaced).toEqual([{ goalId: 'weekly-gym', date: '2026-09-21', status: 'sick', updatedAt: '2026-09-21T11:00:00Z' }])
    expect(setWeeklyAdjustment(replaced, 'weekly-gym', '2026-09-21', 'open')).toEqual([])
  })
})
