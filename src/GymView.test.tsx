import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import GymView from './GymView'
import './App.css'
import { todayKey } from './lib/date'
import { createDemoData } from './lib/demo'
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

async function fillEmptyReps(user: ReturnType<typeof userEvent.setup>, value = '8') {
  void user
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="number"][aria-label*=" Satz "][aria-label$=" Wiederholungen"]')) {
    if (input.value === '') fireEvent.change(input, { target: { value } })
  }
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.useRealTimers()
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
    expect(screen.getByRole('button', { name: /August.*1 Einheit/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Juli.*1 Einheit/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('time').map((node) => node.textContent)).toEqual(['01.08.26'])
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

  it('gliedert den Verlauf absteigend nach Kalenderjahr, Monat und ISO-Kalenderwoche', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    data.gymSessions = [
      session('december', '2025-12-31'),
      session('january-one', '2026-01-01'),
      session('january-two', '2026-01-08'),
    ]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    const yearHeadings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(yearHeadings).toEqual(['2026', '2025'])
    expect(screen.getAllByRole('heading', { name: 'Januar', level: 3 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Dezember', level: 3 })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'KW 1', level: 4 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'KW 2', level: 4 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Dezember.*1 Einheit/ }))
    expect(screen.getByRole('heading', { name: 'KW 1 · 2026', level: 4 })).toBeInTheDocument()
    expect(screen.getAllByRole('time').map((node) => node.textContent)).toEqual(['08.01.26', '01.01.26', '31.12.25'])
  })

  it('öffnet standardmäßig nur den aktuellen Monat und lässt mehrere Monate unabhängig geöffnet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 20, 12))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const data = withPushExercise()
    data.gymSessions = [
      session('august-one', '2026-08-01'),
      session('august-two', '2026-08-15'),
      session('july', '2026-07-20'),
    ]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    const august = screen.getByRole('button', { name: /August.*2 Einheiten/ })
    const july = screen.getByRole('button', { name: /Juli.*1 Einheit/ })
    expect(august).toHaveAttribute('aria-expanded', 'true')
    expect(july).toHaveAttribute('aria-expanded', 'false')
    expect(august).toHaveAttribute('aria-controls', 'gym-history-month-content-2026-08')
    expect(document.getElementById('gym-history-month-content-2026-08')).not.toHaveAttribute('hidden')
    expect(document.getElementById('gym-history-month-content-2026-07')).toHaveAttribute('hidden')
    expect(august.closest('.gym-history-month')).toHaveClass('is-expanded')
    expect(july.closest('.gym-history-month')).not.toHaveClass('is-expanded')

    await user.click(july)
    expect(august).toHaveAttribute('aria-expanded', 'true')
    expect(july).toHaveAttribute('aria-expanded', 'true')
    expect(july.closest('.gym-history-month')).toHaveClass('is-expanded')
    expect(screen.getAllByRole('time')).toHaveLength(3)
    await user.click(august)
    expect(august).toHaveAttribute('aria-expanded', 'false')
    expect(july).toHaveAttribute('aria-expanded', 'true')
    expect(august.closest('.gym-history-month')).not.toHaveClass('is-expanded')

    await user.click(screen.getByRole('button', { name: 'Zurück zu GYM' }))
    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    expect(screen.getByRole('button', { name: /August.*2 Einheiten/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Juli.*1 Einheit/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('öffnet bei fehlendem aktuellem Monat den neuesten vorhandenen Monat auch über einen Jahreswechsel', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 2, 5, 12))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const data = withPushExercise()
    data.gymSessions = [session('december', '2025-12-31'), session('january', '2026-01-02')]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    expect(screen.getByRole('button', { name: /Januar.*1 Einheit/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Dezember.*1 Einheit/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('time').map((node) => node.textContent)).toEqual(['02.01.26'])
  })

  it('öffnet den aktuellen Monat, sobald dort erstmals ein Training entsteht, ohne manuelle Monatszustände zurückzusetzen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 2, 5, 12))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const data = withPushExercise()
    data.gymSessions = [session('january', '2026-01-02')]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    const january = screen.getByRole('button', { name: /Januar.*1 Einheit/ })
    expect(january).toHaveAttribute('aria-expanded', 'true')
    await user.click(january)
    expect(january).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByRole('button', { name: 'Zurück zu GYM' }))
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    await fillEmptyReps(user)
    await user.click(screen.getByRole('button', { name: 'Training beenden' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' }))
    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))

    expect(screen.getByRole('button', { name: /März.*1 Einheit/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Januar.*1 Einheit/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('markiert echte Gewichtssteigerungen über kanonisch verknüpfte Einheiten hinweg konservativ', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const weighted = (id: string, date: string, templateExerciseId: string, weights: Array<number | undefined>, increaseNextTime = false): GymSession => ({
      id,
      templateId: id.startsWith('upper') ? 'upper' : 'fullbody',
      templateName: id.startsWith('upper') ? 'Upper' : 'Fullbody',
      date,
      startedAt: `${date}T17:00:00.000Z`,
      completedAt: `${date}T18:00:00.000Z`,
      exercises: [{
        id: `${id}-curl`, exerciseId: 'canonical-curl', templateExerciseId, name: 'Bizeps Curls', sets: weights.length,
        reps: 8, position: 0, increaseNextTime,
        performedSets: weights.map((weightKg, index) => ({
          id: `${id}-set-${index + 1}`, setNumber: index + 1, ...(weightKg === undefined ? {} : { weightKg }), reps: 8,
        })),
      }],
    })
    data.gymSessions = [
      weighted('upper-base', '2026-07-01', 'upper-curl', [10, 10]),
      weighted('fullbody-up', '2026-07-08', 'fullbody-curl', [12, 12]),
      weighted('upper-mixed', '2026-07-15', 'upper-curl', [14, 10]),
      weighted('fullbody-missing', '2026-07-22', 'fullbody-curl', [16, undefined]),
      weighted('upper-equal-flagged', '2026-07-29', 'upper-curl', [16, 10], true),
    ]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    await user.click(screen.getByRole('button', { name: /08.07.26/ }))
    expect(screen.getByText('Gesteigert').closest('[title]')).toHaveAttribute('title', 'Gewicht gegenüber dem vorherigen Training gesteigert')

    await user.click(screen.getByRole('button', { name: /15.07.26/ }))
    expect(screen.queryByText('Gesteigert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /22.07.26/ }))
    expect(screen.queryByText('Gesteigert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /29.07.26/ }))
    expect(screen.queryByText('Gesteigert')).not.toBeInTheDocument()
  })

  it('unterstützt Legacy-Historie über die stabile Template-Übung, aber verbindet nicht nur nach Namen', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const base = session('legacy-base', '2026-06-01')
    const increased = session('legacy-up', '2026-06-08')
    increased.exercises[0] = { ...increased.exercises[0]!, weightKg: 75 }
    const sameNameOtherExercise = session('other-row', '2026-06-15')
    sameNameOtherExercise.exercises[0] = { ...sameNameOtherExercise.exercises[0]!, templateExerciseId: 'other-bench-row', weightKg: 80 }
    data.gymSessions = [base, increased, sameNameOtherExercise]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    await user.click(screen.getByRole('button', { name: /08.06.26/ }))
    expect(screen.getByText('Gesteigert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /15.06.26/ }))
    expect(screen.queryByText('Gesteigert')).not.toBeInTheDocument()
  })

  it('macht die Gewichtsprogression auch in der visuellen Demo sichtbar', async () => {
    const user = userEvent.setup()
    render(<Harness initial={createDemoData(new Date(2026, 7, 27, 12))} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    await user.click(screen.getByRole('button', { name: /17.08.26/ }))
    expect(screen.getAllByText('Gesteigert')).toHaveLength(2)
  })

  it('vergleicht nach Trainingstag und innerhalb desselben Tages nach Abschlusszeit', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const morning = session('morning', '2026-01-02', 'Morgens')
    morning.completedAt = '2026-08-01T08:00:00.000Z'
    morning.exercises[0] = { ...morning.exercises[0]!, weightKg: 70 }
    const evening = session('evening', '2026-01-02', 'Abends')
    evening.completedAt = '2026-08-01T18:00:00.000Z'
    evening.exercises[0] = { ...evening.exercises[0]!, weightKg: 72.5 }
    const nextDay = session('next-day', '2026-01-03', 'Folgetag')
    nextDay.completedAt = '2026-01-03T18:00:00.000Z'
    nextDay.exercises[0] = { ...nextDay.exercises[0]!, weightKg: 75 }
    data.gymSessions = [nextDay, morning, evening]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    expect(screen.getAllByRole('time').map((node) => node.textContent)).toEqual(['03.01.26', '02.01.26', '02.01.26'])

    await user.click(screen.getByRole('button', { name: /Abends/ }))
    expect(screen.getByText('Gesteigert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Folgetag/ }))
    expect(screen.getByText('Gesteigert')).toBeInTheDocument()
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

  it('portaliert einen langen Einheiten-Editor viewportfest mit interner Scrollfläche und räumt Body-Lock beim Unmount auf', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    data.gymTemplates[0]!.exercises = Array.from({ length: 20 }, (_, index) => ({
      id: `exercise-${index}`, name: `Übung ${index + 1}`, sets: 3, targetWeightKg: 20 + index, targetReps: 10, position: index,
    }))
    const rendered = render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    await user.click(screen.getByRole('button', { name: 'Push bearbeiten' }))

    const dialog = screen.getByRole('dialog', { name: 'Einheit bearbeiten' })
    const backdrop = dialog.parentElement!
    const form = within(dialog).getByRole('button', { name: 'Einheit speichern' }).closest('form')!
    expect(backdrop).toHaveClass('modal-backdrop', 'gym-template-backdrop')
    expect(backdrop.parentElement).toBe(document.body)
    expect(dialog.closest('.view')).toBeNull()
    expect(dialog).toHaveClass('gym-template-modal')
    expect(form).toHaveClass('gym-template-scroll')
    expect(dialog.querySelectorAll('.gym-builder-card')).toHaveLength(20)
    expect(getComputedStyle(backdrop).position).toBe('fixed')
    expect(getComputedStyle(dialog).overflow).toBe('hidden')
    expect(getComputedStyle(form).overflowY).toBe('auto')
    expect(getComputedStyle(within(dialog).getByRole('button', { name: 'Einheit speichern' })).position).toBe('sticky')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.position).toBe('fixed')
    expect(screen.getByRole('textbox', { name: 'Name der Einheit' })).toHaveFocus()

    rendered.unmount()
    expect(screen.queryByRole('dialog', { name: 'Einheit bearbeiten' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(document.body.style.position).toBe('')
  })

  it('behält Dirty-Bestätigung, Escape und Fokus-Rückgabe im portalierten Editor bei und löst Body-Lock sauber', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Harness initial={withPushExercise()} />)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    const trigger = screen.getByRole('button', { name: 'Push bearbeiten' })
    await user.click(trigger)
    const name = screen.getByRole('textbox', { name: 'Name der Einheit' })
    await user.type(name, ' neu')
    await user.keyboard('{Escape}')
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'Einheit bearbeiten' })).toBeInTheDocument()
    expect(document.body.style.position).toBe('fixed')

    confirm.mockReturnValue(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Einheit bearbeiten' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(document.body.style.position).toBe('')
    expect(trigger).toHaveFocus()
  })

  it('fragt vor dem Abschluss nach und speichert erst nach Bestätigung', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const data = withPushExercise()
    render(<GymView data={data} onChange={onChange} draftStorageKey="finish-draft" />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    await fillEmptyReps(user)
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
    await fillEmptyReps(user)
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
    await fillEmptyReps(user)
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
    const reps = screen.getByRole('spinbutton', { name: 'Bankdrücken Satz 1 Wiederholungen' })
    await user.clear(weight)
    await user.type(weight, '72.5')
    await user.type(reps, '0')
    first.unmount()
    const addedAfterStart = session('added-after-start', '2026-08-20')
    addedAfterStart.exercises[0] = { ...addedAfterStart.exercises[0]!, weightKg: 99, performedSets: [
      { id: 'added-1', setNumber: 1, weightKg: 99, reps: 8 },
      { id: 'added-2', setNumber: 2, weightKg: 99, reps: 8 },
      { id: 'added-3', setNumber: 3, weightKg: 99, reps: 8 },
    ] }
    data.gymSessions = [addedAfterStart]
    render(<Harness initial={data} />)
    expect(screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })).toHaveValue('72,5')
    expect(screen.getByRole('spinbutton', { name: 'Bankdrücken Satz 1 Wiederholungen' })).toHaveValue(0)
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
    await fillEmptyReps(user)
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
      expect.objectContaining({ setNumber: 1, weightKg: 72.5, reps: 8 }),
      expect.objectContaining({ setNumber: 2, weightKg: 75.5, reps: 9 }),
      expect.objectContaining({ setNumber: 3, weightKg: 72.5, reps: 8 }),
    ])
  })

  it('übernimmt die letzten Gewichte satzgenau und zeigt gemischte Werte kompakt im Header', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    data.gymTemplates[0]!.exercises[0]!.targetWeightKg = 40
    const previous = session('mixed', '2026-08-20')
    previous.exercises[0]!.performedSets = [
      { id: 'mixed-1', setNumber: 1, weightKg: 70, reps: 10 },
      { id: 'mixed-2', setNumber: 2, weightKg: 70, reps: 9 },
      { id: 'mixed-3', setNumber: 3, weightKg: 120, reps: 8 },
    ]
    data.gymSessions = [previous]
    render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))

    expect(screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })).toHaveValue('70')
    expect(screen.getByRole('textbox', { name: 'Bankdrücken Satz 2 Gewicht' })).toHaveValue('70')
    expect(screen.getByRole('textbox', { name: 'Bankdrücken Satz 3 Gewicht' })).toHaveValue('120')
    expect(screen.getByRole('button', { name: /Bankdrücken.*70 \/ 70 \/ 120 kg/ })).toBeInTheDocument()
  })

  it('nutzt ohne Historie einmalig das Legacy-Templategewicht und startet neue Übungen leer', async () => {
    const user = userEvent.setup()
    const legacy = withPushExercise()
    const first = render(<GymView data={legacy} onChange={vi.fn()} draftStorageKey="legacy-weight-draft" />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.getAllByRole('textbox', { name: /Bankdrücken Satz \d Gewicht/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['70', '70', '70'])
    first.unmount()
    sessionStorage.removeItem('legacy-weight-draft')
    sessionStorage.removeItem('legacy-weight-draft-expanded')

    const fresh = withPushExercise()
    delete fresh.gymTemplates[0]!.exercises[0]!.targetWeightKg
    render(<GymView data={fresh} onChange={vi.fn()} draftStorageKey="fresh-weight-draft" />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.getAllByRole('textbox', { name: /Bankdrücken Satz \d Gewicht/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['', '', ''])
    expect(screen.getByRole('button', { name: /Bankdrücken.*Gewicht offen/ })).toBeInTheDocument()
  })

  it('lässt zusätzliche Sätze bei vorhandener Historie leer und übernimmt bei weniger Sätzen nur die ersten', async () => {
    const user = userEvent.setup()
    const previous = session('three', '2026-08-20')
    previous.exercises[0]!.performedSets = [
      { id: 'three-1', setNumber: 1, weightKg: 70, reps: 8 },
      { id: 'three-2', setNumber: 2, weightKg: 75, reps: 8 },
      { id: 'three-3', setNumber: 3, weightKg: 80, reps: 8 },
    ]
    const more = withPushExercise()
    more.gymTemplates[0]!.exercises[0]!.sets = 4
    more.gymSessions = [previous]
    const first = render(<GymView data={more} onChange={vi.fn()} draftStorageKey="more-sets-draft" />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.getAllByRole('textbox', { name: /Bankdrücken Satz \d Gewicht/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['70', '75', '80', ''])
    first.unmount()
    sessionStorage.removeItem('more-sets-draft')
    sessionStorage.removeItem('more-sets-draft-expanded')

    const fewer = withPushExercise()
    fewer.gymTemplates[0]!.exercises[0]!.sets = 2
    fewer.gymSessions = [previous]
    render(<GymView data={fewer} onChange={vi.fn()} draftStorageKey="fewer-sets-draft" />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.getAllByRole('textbox', { name: /Bankdrücken Satz \d Gewicht/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['70', '75'])
  })

  it('normalisiert unvollständige, unsortierte und doppelte historische Satznummern deterministisch', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    data.gymTemplates[0]!.exercises[0]!.targetWeightKg = 40
    const previous = session('irregular', '2026-08-20')
    previous.exercises[0]!.performedSets = [
      { id: 'z-duplicate', setNumber: 2, weightKg: 80, reps: 7 },
      { id: 'extra', setNumber: 4, weightKg: 200, reps: 5 },
      { id: 'set-one', setNumber: 1, weightKg: 70, reps: 10 },
      { id: 'a-duplicate', setNumber: 2, weightKg: 75, reps: 8 },
    ]
    data.gymSessions = [previous]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    await user.click(screen.getByRole('button', { name: /20.08.26/ }))
    expect(screen.getByText('Nicht erfasst')).toBeInTheDocument()
    expect(screen.queryByText(/200 kg/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Zurück zu GYM' }))
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))

    expect(screen.getAllByRole('textbox', { name: /Bankdrücken Satz \d Gewicht/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['70', '75', ''])
    expect(screen.getByRole('button', { name: /Bankdrücken.*70 \/ 75 \/ – kg/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Letztes Mal:/)).toHaveLength(2)
    expect(screen.queryByText(/200 kg/)).not.toBeInTheDocument()
    expect(screen.queryByText(/40 kg/)).not.toBeInTheDocument()
  })

  it('behandelt ein abgeschlossenes Set ohne Gewicht im Folgetraining als nicht erfasst statt als Körpergewicht', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const previous = session('without-weight', '2026-08-20')
    previous.exercises[0] = {
      ...previous.exercises[0]!, weightKg: undefined,
      performedSets: [1, 2, 3].map((setNumber) => ({ id: `without-${setNumber}`, setNumber, reps: 8 })),
    }
    data.gymSessions = [previous]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Trainingsverlauf öffnen' }))
    await user.click(screen.getByRole('button', { name: /20.08.26/ }))
    expect(screen.getAllByText(/Nicht erfasst/)).toHaveLength(3)
    expect(document.body).not.toHaveTextContent(/Körpergewicht|\bBW\b/)
    await user.click(screen.getByRole('button', { name: 'Zurück zu GYM' }))
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))

    const weights = screen.getAllByRole('textbox', { name: /Bankdrücken Satz \d Gewicht/ })
    expect(weights.map((input) => (input as HTMLInputElement).value)).toEqual(['', '', ''])
    expect(weights.every((input) => input.getAttribute('placeholder') === 'kg')).toBe(true)
    expect(screen.getAllByText(/Letztes Mal:/)).toHaveLength(3)
    expect(screen.getAllByText(/Nicht erfasst × 8/)).toHaveLength(3)
    expect(screen.getByRole('button', { name: /Bankdrücken.*Gewicht offen/ })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Körpergewicht|\bBW\b/)
  })

  it('blendet Gewicht im Templateeditor aus, bewahrt Legacy-Fallbacks bei Änderungen und gibt neuen Übungen keines', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onChange = vi.fn()
    const data = withPushExercise()
    data.gymExercises = [{ id: 'canonical-bench', name: 'Bankdrücken', createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z' }]
    data.gymTemplates[0]!.exercises[0]!.exerciseId = 'canonical-bench'
    render(<GymView data={data} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    await user.click(screen.getByRole('button', { name: 'Push bearbeiten' }))
    const dialog = screen.getByRole('dialog', { name: 'Einheit bearbeiten' })
    expect(within(dialog).queryByText(/^kg$/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByPlaceholderText('kg')).not.toBeInTheDocument()
    await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Schrägbankdrücken')
    await user.clear(within(dialog).getByRole('spinbutton', { name: 'Sätze' }))
    await user.type(within(dialog).getByRole('spinbutton', { name: 'Sätze' }), '4')
    const reps = within(dialog).getByRole('textbox', { name: 'Schrägbankdrücken Wiederholungsvorgabe' })
    await user.clear(reps)
    await user.type(reps, '10-12')
    await user.click(within(dialog).getByRole('button', { name: 'Übung hinzufügen' }))
    const names = within(dialog).getAllByRole('textbox', { name: 'Name' })
    await user.type(names[1]!, 'Butterfly')
    await user.click(within(dialog).getByRole('button', { name: 'Einheit speichern' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('verknüpfte Historie'))
    const changed = onChange.mock.calls[0]![0] as AppData
    expect(onChange.mock.calls[0]![1]).toEqual([
      expect.objectContaining({ kind: 'gym.exercise.rename', exerciseId: 'canonical-bench', expectedName: 'Bankdrücken', name: 'Schrägbankdrücken' }),
      expect.objectContaining({ kind: 'gym.template.upsert' }),
    ])
    expect(changed.gymTemplates[0]?.exercises[0]).toMatchObject({ name: 'Schrägbankdrücken', sets: 4, targetReps: 10, targetRepsMax: 12, targetWeightKg: 70 })
    expect(changed.gymTemplates[0]?.exercises[1]).toMatchObject({ name: 'Butterfly', sets: 3, targetReps: 10 })
    expect(changed.gymTemplates[0]?.exercises[1]).not.toHaveProperty('targetWeightKg')
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
    expect(screen.getAllByRole('textbox', { name: /Bankdrücken Satz \d Gewicht/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['85', '85', '85'])
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
    await fillEmptyReps(user)
    const weight = screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })
    const finish = screen.getByRole('button', { name: 'Training beenden' })

    for (const invalid of ['1000,5', '1001', '-1', 'abc']) {
      await user.clear(weight)
      await user.type(weight, invalid)
      await user.tab()
      expect(weight).toHaveValue(invalid)
      expect(weight).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('alert')).toHaveTextContent('zwischen 0 und 1.000 kg')
      expect(finish).toHaveAttribute('aria-disabled', 'true')
    }

    await user.clear(weight)
    await user.type(weight, '1000')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(finish).toHaveAttribute('aria-disabled', 'false')

    await user.clear(weight)
    await user.type(weight, '80,5')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(weight).toHaveAttribute('aria-invalid', 'false')
    expect(finish).toHaveAttribute('aria-disabled', 'false')
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

  it('zeigt Übungen als zugängliche stabile Accordions mit nur der ersten Übung initial offen', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    data.gymTemplates[0]!.exercises.push({ id: 'fly', name: 'Butterfly', sets: 2, targetWeightKg: 35, targetReps: 12, position: 1 })
    const first = render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))

    const bench = screen.getByRole('button', { name: /Bankdrücken.*3 Sätze.*70 kg.*8 Wdh/ })
    const fly = screen.getByRole('button', { name: /Butterfly.*2 Sätze.*35 kg.*12 Wdh/ })
    expect(bench).toHaveAttribute('aria-expanded', 'true')
    expect(fly).toHaveAttribute('aria-expanded', 'false')
    expect(bench).toHaveAttribute('aria-controls')
    expect(document.getElementById(bench.getAttribute('aria-controls')!)).not.toHaveAttribute('hidden')
    expect(document.getElementById(fly.getAttribute('aria-controls')!)).toHaveAttribute('hidden')

    fly.focus()
    await user.keyboard('{Enter}')
    expect(fly).toHaveAttribute('aria-expanded', 'true')
    const flyWeight = screen.getByRole('textbox', { name: 'Butterfly Satz 2 Gewicht' })
    const weightControl = flyWeight.closest('label')
    const repsControl = screen.getByRole('spinbutton', { name: 'Butterfly Satz 2 Wiederholungen' }).closest('label')
    expect(weightControl).toHaveClass('gym-metric-control')
    expect(weightControl?.querySelector('.gym-metric-suffix')).toHaveTextContent('kg')
    expect(repsControl).toHaveClass('gym-metric-control', 'reps')
    expect(repsControl?.querySelector('.gym-metric-suffix')).toHaveTextContent('Wdh.')
    await user.clear(flyWeight)
    await user.type(flyWeight, '37,5')
    await user.click(bench)
    expect(bench).toHaveAttribute('aria-expanded', 'false')
    expect(fly).toHaveAttribute('aria-expanded', 'true')
    await user.click(fly)
    await user.click(fly)
    expect(screen.getByRole('textbox', { name: 'Butterfly Satz 2 Gewicht' })).toHaveValue('37,5')
    first.unmount()
    render(<Harness initial={data} />)
    expect(screen.getByRole('button', { name: /Bankdrücken.*3 Sätze/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Butterfly.*2 Sätze/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Butterfly Satz 2 Gewicht' })).toHaveValue('37,5')
  })

  it('öffnet und fokussiert beim Abschlussversuch eine geschlossene ungültige Übung', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    data.gymTemplates[0]!.exercises.push({ id: 'fly', name: 'Butterfly', sets: 2, targetWeightKg: 35, targetReps: 12, position: 1 })
    render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    await fillEmptyReps(user)
    const fly = screen.getByRole('button', { name: /Butterfly.*2 Sätze/ })
    await user.click(fly)
    const invalidWeight = screen.getByRole('textbox', { name: 'Butterfly Satz 1 Gewicht' })
    await user.clear(invalidWeight)
    await user.type(invalidWeight, '1001')
    await user.click(fly)
    expect(fly).toHaveAttribute('aria-expanded', 'false')

    const finish = screen.getByRole('button', { name: 'Training beenden' })
    expect(finish).toHaveAttribute('aria-disabled', 'true')
    await user.click(finish)
    await waitFor(() => {
      expect(fly).toHaveAttribute('aria-expanded', 'true')
      expect(invalidWeight).toHaveFocus()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('zwischen 0 und 1.000 kg')
    expect(screen.queryByRole('dialog', { name: 'Training beenden' })).not.toBeInTheDocument()
  })

  it('startet mit leeren Wiederholungen und validiert sie erst beim Erledigen der Übung, wobei null gültig ist', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const first = render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    let reps = screen.getAllByRole('spinbutton', { name: /Bankdrücken Satz \d Wiederholungen/ })
    expect(reps.map((input) => (input as HTMLInputElement).value)).toEqual(['', '', ''])
    expect(reps.every((input) => input.getAttribute('aria-invalid') === 'false')).toBe(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    first.unmount()
    render(<Harness initial={data} />)
    reps = screen.getAllByRole('spinbutton', { name: /Bankdrücken Satz \d Wiederholungen/ })
    expect(reps.map((input) => (input as HTMLInputElement).value)).toEqual(['', '', ''])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const completed = screen.getByRole('checkbox', { name: 'Bankdrücken als erledigt markieren' })
    await user.click(completed)
    await waitFor(() => {
      expect(reps[0]).toHaveFocus()
    })
    expect(completed).not.toBeChecked()
    expect(screen.getAllByRole('alert')).toHaveLength(3)
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('zwischen 0 und 100')

    await fillEmptyReps(user, '0')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(completed)
    expect(completed).toBeChecked()
    expect(screen.getByRole('button', { name: 'Training beenden' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('zeigt ein nicht erfasstes Gewicht neutral und ohne widersprüchliches kg-Suffix', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    delete data.gymTemplates[0]!.exercises[0]!.targetWeightKg
    render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    const weight = screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })
    const control = weight.closest('.gym-metric-control')!
    expect(weight).toHaveValue('')
    expect(weight).toHaveAttribute('placeholder', 'kg')
    expect(control.querySelector('.gym-metric-suffix')).not.toBeInTheDocument()
  })

  it('hält bei gleichzeitig ungültigen Satzwerten beide Beschreibungen im DOM bis zur jeweiligen Recovery', async () => {
    const user = userEvent.setup()
    render(<Harness initial={withPushExercise()} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    const weight = screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })
    const reps = screen.getByRole('spinbutton', { name: 'Bankdrücken Satz 1 Wiederholungen' })
    const row = weight.closest('.gym-set-row') as HTMLElement
    await user.clear(weight)
    await user.type(weight, '1001')
    await user.clear(reps)
    await user.type(reps, '101')

    const weightErrorId = weight.getAttribute('aria-describedby')
    const repsErrorId = reps.getAttribute('aria-describedby')
    expect(document.getElementById(weightErrorId!)).toHaveTextContent('Gewicht muss zwischen 0 und 1.000 kg liegen.')
    expect(document.getElementById(repsErrorId!)).toHaveTextContent('Wiederholungen müssen zwischen 0 und 100 liegen.')
    expect(within(row).getAllByRole('alert')).toHaveLength(2)
    expect(within(row).queryByText('Noch kein Vergleich')).not.toBeInTheDocument()

    await user.clear(weight)
    await user.type(weight, '80,5')
    expect(weight).not.toHaveAttribute('aria-describedby')
    expect(document.getElementById(weightErrorId!)).not.toBeInTheDocument()
    expect(reps).toHaveAttribute('aria-describedby', repsErrorId)
    expect(document.getElementById(repsErrorId!)).toBeInTheDocument()
    expect(within(row).getAllByRole('alert')).toHaveLength(1)
    expect(within(row).queryByText('Noch kein Vergleich')).not.toBeInTheDocument()

    await user.clear(reps)
    await user.type(reps, '8')
    expect(reps).not.toHaveAttribute('aria-describedby')
    expect(document.getElementById(repsErrorId!)).not.toBeInTheDocument()
    expect(within(row).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(row).getByText('Noch kein Vergleich')).toBeInTheDocument()
  })

  it('speichert eine Wiederholungsrange normalisiert und nutzt je Satz weiterhin ganze Ist-Werte', async () => {
    const user = userEvent.setup()
    render(<Harness initial={withPushExercise()} />)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    await user.click(screen.getByRole('button', { name: 'Push bearbeiten' }))
    const target = screen.getByRole('textbox', { name: 'Bankdrücken Wiederholungsvorgabe' })
    await user.clear(target)
    await user.type(target, '8 - 12')
    await user.tab()
    expect(target).toHaveValue('8–12')
    await user.click(screen.getByRole('button', { name: 'Einheit speichern' }))
    await user.click(screen.getByRole('button', { name: 'Zurück zu GYM' }))
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))

    expect(screen.getByRole('button', { name: /Bankdrücken.*8–12 Wdh/ })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Bankdrücken Satz 1 Wiederholungen' })).toHaveValue(null)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('erklärt ungültige Wiederholungsbereiche im Vorlageneditor', async () => {
    const user = userEvent.setup()
    render(<Harness initial={withPushExercise()} />)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    await user.click(screen.getByRole('button', { name: 'Push bearbeiten' }))
    const target = screen.getByRole('textbox', { name: 'Bankdrücken Wiederholungsvorgabe' })
    await user.clear(target)
    await user.type(target, '12-8')
    await user.click(screen.getByRole('button', { name: 'Einheit speichern' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Zahl oder Bereich')
    expect(screen.getByRole('dialog', { name: 'Einheit bearbeiten' })).toBeInTheDocument()
  })

  it('persistiert Erledigt- und Steigerungsmarkierung im Draft und speichert beide beim Abschluss', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const data = withPushExercise()
    const first = render(<GymView data={data} onChange={onChange} draftStorageKey="progress-draft" />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    await fillEmptyReps(user)
    await user.click(screen.getByRole('checkbox', { name: 'Bankdrücken als erledigt markieren' }))
    await user.click(screen.getByRole('checkbox', { name: 'Bankdrücken: nächstes Mal Gewicht steigern' }))
    expect(document.querySelector('[data-exercise-id]')).toHaveClass('completed')
    first.unmount()

    render(<GymView data={data} onChange={onChange} draftStorageKey="progress-draft" />)
    expect(screen.getByRole('checkbox', { name: 'Bankdrücken als erledigt markieren' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Bankdrücken: nächstes Mal Gewicht steigern' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Training beenden' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' }))
    expect((onChange.mock.calls[0]![0] as AppData).gymSessions[0]?.exercises[0]).toMatchObject({ completed: true, increaseNextTime: true })
  })

  it('zeigt die letzte stabile Steigerungsvormerkung genau im Folgetraining und entscheidet danach neu', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const previous = session('previous', '2026-08-20')
    previous.exercises[0] = { ...previous.exercises[0]!, increaseNextTime: true }
    const unrelatedLater = session('unrelated', '2026-08-21')
    unrelatedLater.exercises[0] = { ...unrelatedLater.exercises[0]!, templateExerciseId: 'other-exercise', increaseNextTime: true }
    data.gymSessions = [unrelatedLater, previous]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    await fillEmptyReps(user)
    expect(screen.getByRole('status')).toHaveTextContent('Gewicht steigern')
    expect(screen.getByRole('checkbox', { name: 'Bankdrücken: nächstes Mal Gewicht steigern' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Training beenden' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' }))

    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('lässt eine ältere Vormerkung nicht erneut aufleben, wenn die jüngste passende Session sie nicht setzt', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const older = session('older', '2026-08-19')
    older.exercises[0] = { ...older.exercises[0]!, increaseNextTime: true }
    const latest = session('latest', '2026-08-20')
    data.gymSessions = [older, latest]
    render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('nutzt Gewicht und Progression templateübergreifend über die kanonische Übungs-ID', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    data.gymExercises = [{ id: 'canonical-bench', name: 'Bankdrücken', createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z' }]
    data.gymTemplates[0]!.exercises[0] = { ...data.gymTemplates[0]!.exercises[0]!, exerciseId: 'canonical-bench', sets: 3, targetReps: 8, targetRepsMax: 12 }
    data.gymTemplates[1]!.exercises = [{ id: 'pull-bench-row', exerciseId: 'canonical-bench', name: 'Bankdrücken', sets: 4, targetReps: 5, position: 0 }]
    const pullHistory = session('pull-history', '2026-08-20', 'Pull')
    pullHistory.templateId = data.gymTemplates[1]!.id
    pullHistory.exercises[0] = {
      ...pullHistory.exercises[0]!, templateExerciseId: 'pull-bench-row', exerciseId: 'canonical-bench', sets: 4, reps: 5, increaseNextTime: true,
      performedSets: [1, 2, 3, 4].map((setNumber) => ({ id: `pull-${setNumber}`, setNumber, weightKg: 90 + setNumber, reps: 5 })),
    }
    data.gymSessions = [pullHistory]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: 'Training starten' }))
    expect(screen.getAllByRole('textbox', { name: /Bankdrücken Satz \d Gewicht/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['91', '92', '93'])
    expect(screen.getByRole('button', { name: /3 Sätze.*8–12 Wdh/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Gewicht steigern')
    expect(screen.queryByRole('textbox', { name: 'Bankdrücken Satz 4 Gewicht' })).not.toBeInTheDocument()
  })

  it('zeigt die Bibliothek als GYM-Unterseite und merged auch unterschiedlich benannte Übungen erst nach Dialogbestätigung', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const timestamp = '2026-08-01T10:00:00Z'
    data.gymExercises = [
      { id: 'curl-a', name: 'Bizeps Curls', createdAt: timestamp, updatedAt: timestamp },
      { id: 'curl-b', name: 'Bizeps Curls', createdAt: timestamp, updatedAt: timestamp },
      { id: 'pushdown', name: 'Trizeps Pushdowns', createdAt: timestamp, updatedAt: timestamp },
    ]
    data.gymTemplates[0]!.exercises[0] = { ...data.gymTemplates[0]!.exercises[0]!, exerciseId: 'curl-a', name: 'Bizeps Curls' }
    data.gymTemplates[1]!.exercises = [{ id: 'curl-row-b', exerciseId: 'curl-b', name: 'Bizeps Curls', sets: 4, targetReps: 12, position: 0 }]
    data.gymTemplates[2]!.exercises = [{ id: 'pushdown-row', exerciseId: 'pushdown', name: 'Trizeps Pushdowns', sets: 3, targetReps: 10, position: 0 }]
    render(<Harness initial={data} />)

    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    await user.click(screen.getByRole('button', { name: 'Übungsbibliothek' }))
    expect(screen.getByRole('heading', { name: 'Bibliothek' })).toBeInTheDocument()
    expect(screen.getByText(/Namensgleiche Übungen gefunden/)).toBeInTheDocument()
    const connect = screen.getAllByRole('button', { name: 'Trizeps Pushdowns mit anderer Übung verbinden' })[0]!
    await user.click(connect)
    let dialog = screen.getByRole('dialog', { name: /Trizeps Pushdowns.*zusammenführen/ })
    expect(within(dialog).getByRole('button', { name: 'Endgültig verbinden' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Trizeps Pushdowns.*zusammenführen/ })).not.toBeInTheDocument()
    expect(connect).toHaveFocus()
    await user.click(connect)
    dialog = screen.getByRole('dialog', { name: /Trizeps Pushdowns.*zusammenführen/ })
    expect(dialog).toHaveTextContent('historische Einträge bleiben erhalten')
    expect(dialog).toHaveTextContent('nicht rückgängig gemacht oder wieder getrennt')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Zielübung' }), 'curl-a')
    await user.click(within(dialog).getByRole('button', { name: 'Endgültig verbinden' }))
    expect(screen.queryByText('Trizeps Pushdowns')).not.toBeInTheDocument()
    expect(screen.getAllByText('Bizeps Curls').length).toBeGreaterThanOrEqual(2)
  })

  it('erklärt im Merge-Dialog verständlich, wenn alle Ziele schon im selben Plan liegen', async () => {
    const user = userEvent.setup()
    const data = withPushExercise()
    const timestamp = '2026-08-01T10:00:00Z'
    data.gymExercises = [
      { id: 'same-a', name: 'Curl A', createdAt: timestamp, updatedAt: timestamp },
      { id: 'same-b', name: 'Curl B', createdAt: timestamp, updatedAt: timestamp },
    ]
    data.gymTemplates[0]!.exercises = [
      { id: 'same-row-a', exerciseId: 'same-a', name: 'Curl A', sets: 3, targetReps: 10, position: 0 },
      { id: 'same-row-b', exerciseId: 'same-b', name: 'Curl B', sets: 3, targetReps: 10, position: 1 },
    ]
    render(<Harness initial={data} />)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    await user.click(screen.getByRole('button', { name: 'Übungsbibliothek' }))
    await user.click(screen.getByRole('button', { name: 'Curl A mit anderer Übung verbinden' }))
    const dialog = screen.getByRole('dialog', { name: /Curl A.*zusammenführen/ })
    expect(dialog).toHaveTextContent('Keine zulässige Zielübung verfügbar')
    expect(within(dialog).getByRole('button', { name: 'Schließen' })).toHaveFocus()
    expect(within(dialog).getByRole('combobox', { name: 'Zielübung' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Endgültig verbinden' })).toBeDisabled()
  })

  it('übergibt auch einen verwaisten Bibliotheks-Merge als explizite Mutation', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const data = withPushExercise()
    const timestamp = '2026-08-01T10:00:00Z'
    data.gymExercises = [
      { id: 'orphan-source', name: 'Alt', createdAt: timestamp, updatedAt: timestamp },
      { id: 'orphan-target', name: 'Neu', createdAt: timestamp, updatedAt: timestamp },
    ]
    data.gymTemplates.forEach((template) => { template.exercises = [] })
    render(<GymView data={data} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    await user.click(screen.getByRole('button', { name: 'Übungsbibliothek' }))
    await user.click(screen.getByRole('button', { name: 'Alt mit anderer Übung verbinden' }))
    await user.click(screen.getByRole('button', { name: 'Endgültig verbinden' }))
    expect(onChange.mock.calls[0]![1]).toEqual([{ kind: 'gym.exercise.merge', sourceExerciseId: 'orphan-source', targetExerciseId: 'orphan-target', expectedSourceName: 'Alt', expectedTargetName: 'Neu' }])
  })

  it('fragt bei einer neuen namensgleichen Übung und verlinkt niemals automatisch', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onChange = vi.fn()
    const data = withPushExercise()
    const timestamp = '2026-08-01T10:00:00Z'
    data.gymTemplates[0]!.exercises[0]!.exerciseId = 'canonical-bench'
    data.gymExercises = [{ id: 'canonical-bench', name: 'Bankdrücken', createdAt: timestamp, updatedAt: timestamp }]
    render(<GymView data={data} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Pull bearbeiten' }))
    await user.click(screen.getByRole('button', { name: 'Übung hinzufügen' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Bankdrücken')
    await user.click(screen.getByRole('button', { name: 'Einheit speichern' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Bestehende Übung verwenden'))
    const changed = onChange.mock.calls[0]![0] as AppData
    const pullExercise = changed.gymTemplates.find((template) => template.name === 'Pull')!.exercises[0]!
    expect(pullExercise.exerciseId).not.toBe('canonical-bench')
    expect(changed.gymExercises).toHaveLength(2)
  })
})
