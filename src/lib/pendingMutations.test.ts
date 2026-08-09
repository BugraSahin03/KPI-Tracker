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
})
