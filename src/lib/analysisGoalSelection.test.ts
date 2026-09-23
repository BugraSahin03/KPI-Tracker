import { beforeEach, describe, expect, it } from 'vitest'
import {
  analysisGoalSelectionStorageKey,
  loadAnalysisGoalSelection,
  reconcileAnalysisGoalSelection,
  saveAnalysisGoalSelection,
  selectedAnalysisGoalIds,
  toggleAnalysisGoal,
} from './analysisGoalSelection'

describe('Analyse-Zielauswahl', () => {
  beforeEach(() => localStorage.clear())

  it('startet mit allen Zielen und nimmt neue Ziele automatisch auf', () => {
    const selection = loadAnalysisGoalSelection('missing')
    expect(selectedAnalysisGoalIds(selection, ['protein', 'water'])).toEqual(['protein', 'water'])
    expect(selectedAnalysisGoalIds(selection, ['protein', 'water', 'sleep'])).toEqual(['protein', 'water', 'sleep'])
  })

  it('macht den ersten Klick zur Einzelauswahl und verhindert eine leere Auswahl', () => {
    const one = toggleAnalysisGoal({ mode: 'all' }, 'protein', ['protein', 'water', 'sleep'])
    expect(one).toEqual({ mode: 'custom', goalIds: ['protein'] })
    expect(toggleAnalysisGoal(one, 'protein', ['protein', 'water', 'sleep'])).toBe(one)
    expect(toggleAnalysisGoal(one, 'water', ['protein', 'water', 'sleep'])).toEqual({ mode: 'custom', goalIds: ['protein', 'water'] })
  })

  it('wechselt bei Auswahl aller Einzelziele in den Alle-Modus zurück', () => {
    expect(toggleAnalysisGoal(
      { mode: 'custom', goalIds: ['protein', 'water'] },
      'sleep',
      ['protein', 'water', 'sleep'],
    )).toEqual({ mode: 'all' })
    expect(reconcileAnalysisGoalSelection(
      { mode: 'custom', goalIds: ['protein', 'water', 'sleep'] },
      ['protein', 'water', 'sleep'],
    )).toEqual({ mode: 'all' })
  })

  it('entfernt gelöschte Ziele robust und fällt ohne gültige Auswahl auf alle zurück', () => {
    expect(reconcileAnalysisGoalSelection(
      { mode: 'custom', goalIds: ['protein', 'deleted'] },
      ['protein', 'water'],
    )).toEqual({ mode: 'custom', goalIds: ['protein'] })
    expect(reconcileAnalysisGoalSelection(
      { mode: 'custom', goalIds: ['deleted'] },
      ['protein', 'water'],
    )).toEqual({ mode: 'all' })
  })

  it('speichert die Auswahl getrennt je Profil und Demo-Modus', () => {
    const bugraKey = analysisGoalSelectionStorageKey('profile-bugra')
    const senaKey = analysisGoalSelectionStorageKey('profile-sena')
    const demoKey = analysisGoalSelectionStorageKey('profile-bugra', true)
    saveAnalysisGoalSelection(bugraKey, { mode: 'custom', goalIds: ['protein'] })
    saveAnalysisGoalSelection(senaKey, { mode: 'custom', goalIds: ['water'] })

    expect(loadAnalysisGoalSelection(bugraKey)).toEqual({ mode: 'custom', goalIds: ['protein'] })
    expect(loadAnalysisGoalSelection(senaKey)).toEqual({ mode: 'custom', goalIds: ['water'] })
    expect(loadAnalysisGoalSelection(demoKey)).toEqual({ mode: 'all' })
  })

  it('ignoriert kaputte oder unvollständige Storage-Payloads', () => {
    for (const [key, value] of [
      ['invalid-json', '{'],
      ['wrong-version', JSON.stringify({ version: 2, mode: 'custom', goalIds: ['protein'] })],
      ['wrong-mode', JSON.stringify({ version: 1, mode: 'single', goalIds: ['protein'] })],
      ['wrong-ids', JSON.stringify({ version: 1, mode: 'custom', goalIds: ['protein', 42] })],
      ['missing-ids', JSON.stringify({ version: 1, mode: 'custom' })],
    ] as const) {
      localStorage.setItem(key, value)
      expect(loadAnalysisGoalSelection(key)).toEqual({ mode: 'all' })
    }
  })

  it('hält neue Ziele in einer benutzerdefinierten Auswahl abgewählt', () => {
    const selection = { mode: 'custom' as const, goalIds: ['protein'] }
    expect(selectedAnalysisGoalIds(selection, ['protein', 'water', 'sleep'])).toEqual(['protein'])
  })
})
