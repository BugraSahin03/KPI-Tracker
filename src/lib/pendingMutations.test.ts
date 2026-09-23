import { afterEach, describe, expect, it } from 'vitest'
import { createInitialData } from './storage'
import {
  applyPendingMutations,
  loadPendingMutations,
  PENDING_MUTATIONS_STORAGE_KEY,
  persistPendingMutations,
} from './pendingMutations'
import type { DataMutation } from '../types'

afterEach(() => localStorage.clear())

describe('persistente Mutationsqueue', () => {
  it('ignoriert beschädigte Daten und mischt doppelte IDs nicht in die Queue', () => {
    localStorage.setItem(PENDING_MUTATIONS_STORAGE_KEY, '{kaputt')
    expect(loadPendingMutations()).toEqual([])

    const entry = { goalId: 'protein', date: '2026-08-01', status: 'done' as const, updatedAt: '2026-08-01T12:00:00.000Z' }
    localStorage.setItem(PENDING_MUTATIONS_STORAGE_KEY, JSON.stringify({
      version: 1,
      mutations: [
        { id: 'same-id', kind: 'entry.set', entry },
        { id: 'same-id', kind: 'entry.set', entry: { ...entry, status: 'failed' } },
        { id: 'invalid', kind: 'unknown' },
      ],
    }))
    expect(loadPendingMutations()).toEqual([{ profileId: 'profile-bugra', mutation: { id: 'same-id', kind: 'entry.set', entry } }])
  })

  it('persistiert stabile IDs rein strukturell und spielt eine Session optimistisch genau einmal ein', () => {
    const data = createInitialData('2026-08-03')
    const session = {
      id: 'session-one',
      templateId: data.gymTemplates[0]!.id,
      templateName: 'Push',
      date: '2099-08-03',
      startedAt: '2099-08-03T17:00:00.000Z',
      completedAt: '2099-08-03T18:00:00.000Z',
      exercises: [{ id: 'session-bench', name: 'Bankdrücken', sets: 3, weightKg: 70, reps: 8, position: 0 }],
    }
    const mutation: DataMutation = { id: 'stable-mutation-id', kind: 'gym.session.complete', session }
    persistPendingMutations([mutation])

    const restored = loadPendingMutations()
    expect(restored).toEqual([{ profileId: 'profile-bugra', mutation }])
    expect(applyPendingMutations(data, [...restored, { profileId: 'profile-bugra', mutation }]).gymSessions).toEqual([session])

    persistPendingMutations([])
    expect(localStorage.getItem(PENDING_MUTATIONS_STORAGE_KEY)).toBeNull()
  })

  it('bewahrt und simuliert eine profilbezogene Exercise-Merge-Mutation', () => {
    const data = createInitialData('2026-08-03')
    const timestamp = '2026-08-03T10:00:00Z'
    data.gymExercises = [
      { id: 'source', name: 'Curls', createdAt: timestamp, updatedAt: timestamp },
      { id: 'target', name: 'Bizeps Curls', createdAt: timestamp, updatedAt: timestamp },
    ]
    const mutation: DataMutation = { id: 'merge-offline', kind: 'gym.exercise.merge', sourceExerciseId: 'source', targetExerciseId: 'target', expectedSourceName: 'Curls', expectedTargetName: 'Bizeps Curls' }
    expect(persistPendingMutations([{ profileId: 'profile-bugra', mutation }])).toBe(true)
    expect(loadPendingMutations()).toEqual([{ profileId: 'profile-bugra', mutation }])
    const merged = applyPendingMutations(data, loadPendingMutations(), 'profile-bugra')
    expect(merged.gymExercises).toEqual([expect.objectContaining({ id: 'target' })])
    expect(applyPendingMutations(merged, loadPendingMutations(), 'profile-bugra')).toEqual(merged)
    expect(applyPendingMutations(data, loadPendingMutations(), 'profile-sena')).toBe(data)
  })

  it('simuliert globale Rename-CAS-Mutationen in der Offline-Queue deterministisch', () => {
    const data = createInitialData('2026-08-03')
    const timestamp = '2026-08-03T10:00:00Z'
    data.gymExercises = [{ id: 'bench', name: 'Bankdrücken', createdAt: timestamp, updatedAt: timestamp }]
    data.gymTemplates[0]!.exercises = [{ id: 'row', exerciseId: 'bench', name: 'Bankdrücken', sets: 3, targetReps: 10, position: 0 }]
    const mutation: DataMutation = { id: 'rename-offline', kind: 'gym.exercise.rename', exerciseId: 'bench', expectedName: 'Bankdrücken', expectedUpdatedAt: timestamp, name: 'Schrägbankdrücken', updatedAt: '2026-08-03T11:00:00Z' }
    persistPendingMutations([{ profileId: 'profile-bugra', mutation }])
    const renamed = applyPendingMutations(data, loadPendingMutations(), 'profile-bugra')
    expect(renamed.gymExercises![0]).toMatchObject({ name: 'Schrägbankdrücken', updatedAt: '2026-08-03T11:00:00Z' })
    expect(renamed.gymTemplates[0]!.exercises[0]!.name).toBe('Schrägbankdrücken')
    expect(applyPendingMutations(renamed, loadPendingMutations(), 'profile-bugra')).toEqual(renamed)
  })

  it('persistiert Lauf-Erstellung und -Löschung profilgetrennt für den Offline-Retry', () => {
    const data = createInitialData('2026-09-14')
    const run = {
      id: 'offline-run', environment: 'outdoor' as const, date: '2026-09-14', startTime: '18:00', durationSeconds: 1800,
      distanceKm: 5, averagePaceSecondsPerKm: 360, source: 'screenshot' as const, fingerprint: 'c'.repeat(64), createdAt: '2026-09-14T18:30:00Z',
    }
    const create: DataMutation = { id: 'create-offline-run', kind: 'run.create', run }
    const remove: DataMutation = { id: 'remove-offline-run', kind: 'run.delete', runId: run.id }
    expect(persistPendingMutations([{ profileId: 'profile-bugra', mutation: create }])).toBe(true)
    const restored = loadPendingMutations()
    expect(applyPendingMutations(data, restored, 'profile-bugra').runs).toEqual([run])
    expect(applyPendingMutations(data, restored, 'profile-sena')).toBe(data)
    expect(applyPendingMutations({ ...data, runs: [run] }, [{ profileId: 'profile-bugra', mutation: remove }], 'profile-bugra').runs).toEqual([])
  })

  it('persistiert Wochenziel und Tageskorrektur profilgetrennt für den Retry', () => {
    const data = createInitialData('2026-09-21')
    const definition = { effectiveFrom: '2026-09-21', name: '2× Mobility', targetCount: 2, sourceType: 'manual' as const, color: '#a78bfa', icon: 'calendar' as const, active: true, countingMode: 'unique-days' as const }
    const goal = { id: 'weekly-mobility', ...definition, createdAt: '2026-09-21', startDate: '2026-09-21', definitions: [definition] }
    const mutations: DataMutation[] = [
      { id: 'weekly-create-offline', kind: 'weekly-goal.upsert', goal },
      { id: 'weekly-adjust-offline', kind: 'weekly-goal.adjust', adjustment: { goalId: goal.id, date: '2026-09-21', status: 'done', updatedAt: '2026-09-21T12:00:00Z' } },
    ]
    persistPendingMutations(mutations.map((mutation) => ({ profileId: 'profile-bugra', mutation })))
    const restored = loadPendingMutations()
    expect(applyPendingMutations(data, restored, 'profile-bugra')).toMatchObject({ weeklyGoals: [goal], weeklyGoalAdjustments: [expect.objectContaining({ status: 'done' })] })
    expect(applyPendingMutations(data, restored, 'profile-sena')).toBe(data)
  })
})
