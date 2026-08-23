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
})
