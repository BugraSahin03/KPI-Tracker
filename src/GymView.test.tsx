import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import GymView from './GymView'
import { todayKey } from './lib/date'
import { createInitialData } from './lib/storage'
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
    expect(screen.getByText('3 Sätze · 72,5 kg · 8 Wdh.')).toBeInTheDocument()
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
    const weight = screen.getByRole('spinbutton', { name: 'Bankdrücken Gewicht' })
    await user.clear(weight)
    await user.type(weight, '72.5')
    first.unmount()
    render(<Harness initial={data} />)
    expect(screen.getByRole('spinbutton', { name: 'Bankdrücken Gewicht' })).toHaveValue(72.5)
  })
})
