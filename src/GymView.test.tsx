import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import GymView from './GymView'
import { todayKey } from './lib/date'
import { createInitialData, legacyGymSetId } from './lib/storage'
import type { AppData, GymSession } from './types'

function Harness({ initial }: { initial: AppData }) {
  const [data, setData] = useState(initial)
  return <GymView data={data} onChange={setData} />
}

function withPushExercise() {
  const data = createInitialData('2026-08-03')
  data.gymTemplates[0]!.exercises = [{ id: 'bench', name: 'Bankdrücken', sets: 3, targetWeightKg: 70, targetReps: 8, position: 0 }]
  return data
}

function session(id: string, date: string, name = 'Push'): GymSession {
  return {
    id, templateId: 'push', templateName: name, date,
    startedAt: `${date}T17:00:00.000Z`, completedAt: `${date}T18:00:00.000Z`,
    exercises: [{ id: `${id}-bench`, templateExerciseId: 'bench', name: 'Bankdrücken', sets: 3, weightKg: 72.5, reps: 8, position: 0 }],
  }
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('GYM-Workflow', () => {
  it('zeigt auf der Landing nur Kopfaktionen und vollständig klickbare Einheiten-Kacheln', () => {
    const data = withPushExercise()
    data.gymSessions = [session('old', '2026-08-01')]
    render(<Harness initial={data} />)

    expect(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Einheiten verwalten' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push starten' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pull bearbeiten' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Einheit hinzufügen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Push löschen' })).not.toBeInTheDocument()
    expect(screen.queryByText('Auswählen')).not.toBeInTheDocument()
    expect(screen.queryByText('01.08.26')).not.toBeInTheDocument()
  })

  it('öffnet den Verlauf date-first, klappt Snapshots auf und löscht bestätigt', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const data = withPushExercise()
    data.gymSessions = [session('older', '2026-07-01', 'Pull'), session('newer', '2026-08-01')]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    expect(screen.getByRole('heading', { name: 'Verlauf' })).toBeInTheDocument()
    const dates = screen.getAllByRole('time').map((node) => node.textContent)
    expect(dates).toEqual(['01.08.26', '01.07.26'])
    await user.click(screen.getByRole('button', { name: /01.08.26/ }))
    expect(screen.getAllByText(/72,5 kg/)).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Training löschen' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.queryByText('01.08.26')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Zurück zu GYM' }))
    expect(screen.getByRole('heading', { name: 'GYM' })).toBeInTheDocument()
  })

  it('zeigt einen klaren Empty State im Trainingsverlauf', async () => {
    const user = userEvent.setup()
    render(<Harness initial={withPushExercise()} />)
    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    expect(screen.getByRole('heading', { name: 'Noch kein Training' })).toBeInTheDocument()
  })

  it('startet eine befüllte Einheit erst nach Bestätigung und stellt Dialogfokus wieder her', async () => {
    const user = userEvent.setup()
    render(<Harness initial={withPushExercise()} />)
    const tile = screen.getByRole('button', { name: 'Push starten' })
    await user.click(tile)
    const dialog = screen.getByRole('dialog', { name: 'Push starten' })
    expect(dialog).toHaveAccessibleDescription('Heute stehen 1 Übung auf deinem Plan.')
    const start = screen.getByRole('button', { name: 'Training starten' })
    const cancel = screen.getByRole('button', { name: 'Abbrechen' })
    expect(start).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(start).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(dialog).not.toBeInTheDocument()
    expect(tile).toHaveFocus()
    await user.click(tile)
    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('öffnet eine leere Kachel direkt in der Verwaltung und im Editor', async () => {
    const user = userEvent.setup()
    render(<Harness initial={createInitialData('2026-08-03')} />)
    await user.click(screen.getByRole('button', { name: 'Push bearbeiten' }))
    expect(screen.getByRole('heading', { name: 'Einheiten' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Einheit bearbeiten' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Push starten' })).not.toBeInTheDocument()
  })

  it('verwaltet Erstellen, Bearbeiten und Löschen nur auf der Stift-Unterseite', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Harness initial={withPushExercise()} />)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    expect(screen.getByRole('button', { name: 'Einheit hinzufügen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push bearbeiten' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push löschen' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Einheit hinzufügen' }))
    await user.type(screen.getByRole('textbox', { name: 'Name der Einheit' }), 'Core')
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Plank')
    await user.click(screen.getByRole('button', { name: 'Einheit speichern' }))
    expect(screen.getByRole('button', { name: 'Core bearbeiten' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Core löschen' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Core bearbeiten' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Zurück zu GYM' }))
    expect(screen.getByRole('button', { name: 'Push starten' })).toBeInTheDocument()
  })

  it('fragt vor dem Abschluss nach und speichert erst nach Bestätigung', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const data = withPushExercise()
    render(<GymView data={data} onChange={onChange} draftStorageKey="finish-draft" />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    const finishTrigger = screen.getByRole('button', { name: 'Training beenden' })
    await user.click(finishTrigger)
    const dialog = screen.getByRole('dialog', { name: 'Training beenden' })
    expect(dialog).toHaveAccessibleDescription('Push wird mit deinen aktuellen Werten gespeichert.')
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Weiter trainieren' }))
    expect(dialog).not.toBeInTheDocument()
    expect(finishTrigger).toHaveFocus()

    await user.click(finishTrigger)
    await user.dblClick(within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const changed = onChange.mock.calls[0]![0] as AppData
    expect(changed.gymSessions[0]!.date).toBe(todayKey())
    expect(sessionStorage.getItem('finish-draft')).toBeNull()
  })

  it('schließt den Abschlussdialog per Escape und hält den Fokus im Dialog', async () => {
    const user = userEvent.setup()
    render(<Harness initial={withPushExercise()} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    const finish = screen.getByRole('button', { name: 'Training beenden' })
    await user.click(finish)
    const confirm = within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' })
    const keepGoing = screen.getByRole('button', { name: 'Weiter trainieren' })
    expect(confirm).toHaveFocus()
    await user.tab({ shift: true })
    expect(keepGoing).toHaveFocus()
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Training beenden' })).not.toBeInTheDocument()
    expect(finish).toHaveFocus()
  })

  it('behält Abschlussdialog und Draft, wenn die persistente Änderung abgelehnt wird', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn(() => false)
    render(<GymView data={withPushExercise()} onChange={onChange} draftStorageKey="failed-finish" />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    await user.click(screen.getByRole('button', { name: 'Training beenden' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' }))
    expect(onChange).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'Training beenden' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Aktives Training Push' })).toBeInTheDocument()
    expect(sessionStorage.getItem('failed-finish')).not.toBeNull()
  })

  it('stellt einen aktiven Draft mit geänderten Werten über Remount wieder her', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const first = render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    const weight = screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })
    await user.clear(weight)
    await user.type(weight, '72.5')
    first.unmount()
    render(<Harness initial={data} />)
    expect(screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })).toHaveValue('72,5')
  })

  it('zeigt exakt die Template-Sätze, vergleicht stabil per Übungs-ID und speichert jeden Satz einzeln', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const data = withPushExercise()
    data.gymSessions = [session('previous', '2026-08-01')]
    render(<GymView data={data} onChange={onChange} draftStorageKey="sets-draft" />)

    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.getAllByText(/Letztes Mal:/)).toHaveLength(3)
    expect(screen.getAllByText(/72,5 kg × 8/)).toHaveLength(3)
    const weight = screen.getByRole('textbox', { name: 'Bankdrücken Satz 2 Gewicht' })
    await user.clear(weight)
    await user.type(weight, '75,5')
    const reps = screen.getByRole('spinbutton', { name: 'Bankdrücken Satz 2 Wiederholungen' })
    await user.clear(reps)
    await user.type(reps, '9')
    await user.click(screen.getByRole('button', { name: 'Training beenden' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' }))

    const changed = onChange.mock.calls[0]![0] as AppData
    expect(changed.gymSessions.at(-1)?.exercises[0]?.performedSets).toEqual([
      expect.objectContaining({ setNumber: 1, weightKg: 70, reps: 8 }),
      expect.objectContaining({ setNumber: 2, weightKg: 75.5, reps: 9 }),
      expect.objectContaining({ setNumber: 3, weightKg: 70, reps: 8 }),
    ])
  })

  it('folgt für Vortrainingsvergleiche der Timestamp-Chronologie statt inkonsistenter Import-Datumswerte', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const fewer = session('fewer', '2026-08-01')
    fewer.exercises[0] = {
      ...fewer.exercises[0]!, sets: 2,
      performedSets: [
        { id: 'fewer-1', setNumber: 1, weightKg: 71, reps: 9 },
        { id: 'fewer-2', setNumber: 2, weightKg: 72, reps: 8 },
      ],
    }
    const wrongId = session('wrong-id', '2026-08-15')
    wrongId.exercises[0] = { ...wrongId.exercises[0]!, templateExerciseId: 'different-bench-id', weightKg: 99 }
    const importedWithFutureDate = session('imported', '2099-01-01')
    importedWithFutureDate.startedAt = '2026-08-14T10:00:00Z'
    importedWithFutureDate.completedAt = '2026-08-14T11:00:00Z'
    importedWithFutureDate.exercises[0] = { ...importedWithFutureDate.exercises[0]!, weightKg: 85 }
    const futureTimestampWithPastDate = session('future-timestamp', '2020-01-01')
    futureTimestampWithPastDate.startedAt = '2099-01-01T10:00:00Z'
    futureTimestampWithPastDate.completedAt = '2099-01-01T11:00:00Z'
    futureTimestampWithPastDate.exercises[0] = { ...futureTimestampWithPastDate.exercises[0]!, weightKg: 150 }
    data.gymSessions = [fewer, wrongId, importedWithFutureDate, futureTimestampWithPastDate]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.getAllByText(/85 kg × 8/)).toHaveLength(3)
    expect(screen.queryByText(/99 kg/)).not.toBeInTheDocument()
    expect(screen.queryByText(/150 kg/)).not.toBeInTheDocument()
  })

  it('begrenzt einen längeren Vortrainingsvergleich auf die aktuelle Satzanzahl', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    data.gymTemplates[0]!.exercises[0]!.sets = 2
    data.gymSessions = [session('three-sets', '2026-08-01')]
    render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.getAllByText(/Letztes Mal:/)).toHaveLength(2)
    expect(screen.queryByRole('textbox', { name: 'Bankdrücken Satz 3 Gewicht' })).not.toBeInTheDocument()
  })

  it('kennzeichnet zusätzliche aktuelle Sätze ohne erfundenen Vortrainingswert', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const previous = session('two-sets', '2026-08-01')
    previous.exercises[0] = {
      ...previous.exercises[0]!, sets: 2,
      performedSets: [
        { id: 'two-1', setNumber: 1, weightKg: 71, reps: 9 },
        { id: 'two-2', setNumber: 2, weightKg: 72, reps: 8 },
      ],
    }
    data.gymSessions = [previous]
    render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.getAllByText(/Letztes Mal:/)).toHaveLength(2)
    expect(screen.getByText('Noch kein Vergleich')).toBeInTheDocument()
  })

  it('blockiert übergroße und ungültige Satzgewichte sichtbar bis zur gültigen Korrektur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<GymView data={withPushExercise()} onChange={onChange} draftStorageKey="weight-range-draft" />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    const weight = screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })
    const finish = screen.getByRole('button', { name: 'Training beenden' })

    for (const invalid of ['1000,5', '1001', '-1', 'abc']) {
      await user.clear(weight)
      await user.type(weight, invalid)
      await user.tab()
      expect(weight).toHaveValue(invalid)
      expect(weight).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('alert')).toHaveTextContent('zwischen 0 und 1.000 kg')
      expect(finish).toBeDisabled()
    }

    await user.clear(weight)
    await user.type(weight, '1000')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(finish).toBeEnabled()

    await user.clear(weight)
    await user.type(weight, '80,5')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(weight).toHaveAttribute('aria-invalid', 'false')
    expect(finish).toBeEnabled()
    await user.click(finish)
    await user.click(within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' }))
    const changed = onChange.mock.calls[0]![0] as AppData
    expect(changed.gymSessions[0]?.exercises[0]?.performedSets?.[0]?.weightKg).toBe(80.5)
  })

  it('migriert alte Drafts mit maximal langen Übungs-IDs deterministisch auf begrenzte Satz-IDs', async () => {
    const longExerciseId = `x${'a'.repeat(99)}`
    const timestamp = new Date().toISOString()
    const legacyDraft: GymSession = {
      id: 'legacy-draft', templateName: 'Pull', date: todayKey(), startedAt: timestamp, completedAt: timestamp,
      exercises: [{ id: longExerciseId, templateExerciseId: 'stable-row', name: 'Deadlift', sets: 3, weightKg: 100, reps: 8, position: 0 }],
    }
    sessionStorage.setItem('long-id-draft', JSON.stringify(legacyDraft))
    const first = render(<GymView data={withPushExercise()} onChange={vi.fn()} draftStorageKey="long-id-draft" />)
    await waitFor(() => {
      const stored = JSON.parse(sessionStorage.getItem('long-id-draft')!) as GymSession
      const ids = stored.exercises[0]!.performedSets!.map((set) => set.id)
      expect(ids).toEqual([1, 2, 3].map((number) => legacyGymSetId(longExerciseId, number)))
      expect(ids.every((id) => id.length <= 100)).toBe(true)
    })
    const firstIds = (JSON.parse(sessionStorage.getItem('long-id-draft')!) as GymSession).exercises[0]!.performedSets!.map((set) => set.id)
    first.unmount()
    render(<GymView data={withPushExercise()} onChange={vi.fn()} draftStorageKey="long-id-draft" />)
    expect((JSON.parse(sessionStorage.getItem('long-id-draft')!) as GymSession).exercises[0]!.performedSets!.map((set) => set.id)).toEqual(firstIds)
  })
})
