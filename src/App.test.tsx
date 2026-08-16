import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addDays, addMonths, addWeeks, addYears, startOfISOWeek } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { formatDayTitle, formatShortDate, periodLabel, toDateKey } from './lib/date'
import { calculateStats } from './lib/stats'
import { createInitialData, setEntryStatus, STORAGE_KEY } from './lib/storage'
import { PENDING_MUTATIONS_STORAGE_KEY } from './lib/pendingMutations'

describe('Heute-Interaktion', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    let revision = 0
    const serverData = createInitialData()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && String(_input).includes('/api/mutations')) {
        const mutation = JSON.parse(String(init.body))
        if (mutation.kind === 'entry.set') {
          serverData.entries = serverData.entries.filter((entry) => !(entry.goalId === mutation.entry.goalId && entry.date === mutation.entry.date))
          if (mutation.entry.status !== 'open') serverData.entries.push(mutation.entry)
        }
        revision++
        return new Response(JSON.stringify({ data: serverData, revision, applied: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: serverData, revision }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('markiert ein Ziel mit einem Klick als erfüllt und lässt es zurücksetzen', async () => {
    const user = userEvent.setup()
    render(<App />)

    const proteinCard = (await screen.findByText('Protein')).closest('article')
    expect(proteinCard).not.toBeNull()
    const doneButton = proteinCard!.querySelector<HTMLButtonElement>('button.done')
    expect(doneButton).not.toBeNull()

    await user.click(doneButton!)
    expect(doneButton).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      const saves = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')
      const saved = JSON.parse(String(saves.at(-1)?.[1]?.body))
      expect(saved.entry.status).toBe('done')
    })

    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }))
    expect(doneButton).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => {
      const saves = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')
      const saved = JSON.parse(String(saves.at(-1)?.[1]?.body))
      expect(saved.entry.status).toBe('open')
    })
  })

  it('verhindert Check-ins für Zukunftstage', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Weiter' })).toBeDisabled()
  })

  it('verbirgt Google Health vollständig, wenn das Serverfeature aus ist', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Körper' })).at(-1)!)
    expect(screen.queryByText('Google Health')).not.toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/google-health/'))).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Gewicht (kg)' })).toBeInTheDocument()
  })

  it('akzeptiert deutsche und internationale Dezimalwerte für Körpermessungen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Körper' })).at(-1)!)
    await user.type(screen.getByRole('textbox', { name: 'Gewicht (kg)' }), '78,35')
    await user.type(screen.getByRole('textbox', { name: 'Muskelmasse (kg)' }), '61.25')
    await user.click(screen.getByRole('button', { name: 'Messung speichern' }))

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')
      const mutation = JSON.parse(String(calls.at(-1)?.[1]?.body))
      expect(mutation).toMatchObject({ kind: 'body.upsert', metric: { weightKg: 78.35, muscleMassKg: 61.25 } })
    })
    expect(screen.queryByText('Gültigen Wert eingeben')).not.toBeInTheDocument()
  })

  it('vereint Verlauf und Insights in einer Analyse hinter fünf Haupttabs', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Protein')

    expect(screen.queryAllByRole('button', { name: 'Verlauf' })).toHaveLength(0)
    expect(within(screen.getByRole('navigation', { name: 'Hauptnavigation' })).getAllByRole('button')).toHaveLength(5)
    expect(document.querySelectorAll('.desktop-rail nav button')).toHaveLength(5)

    await user.click(screen.getAllByRole('button', { name: 'Analyse' }).at(-1)!)
    const history = screen.getByRole('heading', { name: 'Verlauf' })
    const insights = screen.getByRole('heading', { name: 'Insights' })
    expect(history.compareDocumentPosition(insights) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Woche' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Monat' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Jahr' })).toHaveLength(1)
    expect(document.querySelectorAll('.date-stepper')).toHaveLength(1)

    const day = screen.getAllByRole('button', { name: /August 2026: 0 von 2 Zielen erfüllt/ }).find((button) => !button.hasAttribute('disabled'))!
    await user.click(day)
    expect(screen.getAllByRole('button', { name: 'Heute' }).at(-1)).toHaveAttribute('aria-current', 'page')
  })

  it('steuert Kalender und Insights gemeinsam und zeigt die Woche als sieben Tageskacheln', { timeout: 10_000 }, async () => {
    const user = userEvent.setup()
    const now = new Date()
    const previousMonthAnchor = addMonths(now, -1)
    const historicalWeekStart = startOfISOWeek(previousMonthAnchor)
    const firstHistoricalDate = toDateKey(historicalWeekStart)
    const secondHistoricalDate = toDateKey(addDays(historicalWeekStart, 1))
    const serverData = createInitialData(toDateKey(addYears(now, -1)))
    serverData.entries = setEntryStatus(serverData.entries, 'protein', firstHistoricalDate, 'done')
    serverData.entries = setEntryStatus(serverData.entries, 'water', firstHistoricalDate, 'done')
    serverData.entries = setEntryStatus(serverData.entries, 'protein', secondHistoricalDate, 'done')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ data: serverData, revision: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Analyse' })).at(-1)!)

    expect(screen.getAllByRole('button', { name: 'Woche' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Monat' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Jahr' })).toHaveLength(1)
    expect(document.querySelectorAll('.date-stepper')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(screen.getAllByText(periodLabel('month', previousMonthAnchor))).toHaveLength(2)
    const monthStats = calculateStats(serverData, 'month', previousMonthAnchor)
    expect(screen.getByText(`${monthStats.done} von ${monthStats.total} Check-ins`)).toBeInTheDocument()
    const monthPartial = screen.getByRole('button', {
      name: new RegExp(`${addDays(historicalWeekStart, 1).getDate()}\\. .*: 1 von 2 Zielen erfüllt`),
    })
    expect(monthPartial).toHaveClass('partial')
    expect(monthPartial).toHaveStyle({ '--goal-progress': '50%' })
    expect(within(monthPartial).getByText('1/2')).toHaveClass('progress-badge')
    expect(screen.getAllByRole('button', { name: /0 von 2 Zielen erfüllt/ })[0]).toHaveClass('failed')

    await user.click(screen.getByRole('button', { name: 'Jahr' }))
    expect(screen.getAllByText(periodLabel('year', previousMonthAnchor))).toHaveLength(2)
    expect(getComputedStyle(document.querySelector('.analysis-combined')!).gridTemplateColumns).toBe('minmax(0, 1fr)')
    expect(getComputedStyle(document.querySelector('.year-heatmap')!).overflowX).toBe('auto')
    const yearStats = calculateStats(serverData, 'year', previousMonthAnchor)
    expect(screen.getByText(`${yearStats.done} von ${yearStats.total} Check-ins`)).toBeInTheDocument()
    const yearPartial = screen.getByRole('button', {
      name: `${formatShortDate(secondHistoricalDate)}: 1 von 2 Zielen erfüllt`,
    })
    expect(yearPartial).toHaveClass('partial')
    expect(yearPartial).toHaveStyle({ '--goal-progress': '50%' })
    expect(yearPartial).toBeEmptyDOMElement()

    await user.click(screen.getByRole('button', { name: 'Woche' }))
    const historicalWeek = screen.getByRole('group', { name: periodLabel('week', previousMonthAnchor) })
    expect(within(historicalWeek).getAllByRole('button')).toHaveLength(7)
    expect(document.querySelector('.week-calendar .weekday-row')).toHaveTextContent('MoDiMiDoFrSaSo')
    expect(screen.getByText('3 von 14 Check-ins')).toBeInTheDocument()
    expect(within(historicalWeek).getByRole('button', { name: new RegExp(`${historicalWeekStart.getDate()}\\. .*: 2 von 2 Zielen erfüllt`) })).toBeEnabled()
    const weekPartial = within(historicalWeek).getByRole('button', { name: /1 von 2 Zielen erfüllt/ })
    expect(weekPartial).toHaveClass('partial')
    expect(within(weekPartial).getByText('1/2')).toHaveClass('progress-badge')

    await user.click(screen.getByRole('button', { name: /Zu heute/ }))
    expect(screen.getAllByText(periodLabel('week', now))).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(screen.getByText('0 von 0 Check-ins')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
    const futureWeek = screen.getByRole('group', { name: periodLabel('week', addWeeks(now, 1)) })
    expect(within(futureWeek).getAllByRole('button')).toHaveLength(7)
    within(futureWeek).getAllByRole('button').forEach((tile) => {
      expect(tile).toBeDisabled()
      expect(tile).toHaveClass('open')
      expect(tile).toHaveAccessibleName(/noch nicht verfügbar/)
    })

    await user.click(screen.getByRole('button', { name: /Zu heute/ }))
    await user.click(screen.getByRole('button', { name: 'Monat' }))
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(screen.getByText('0 von 0 Check-ins')).toBeInTheDocument()
    document.querySelectorAll<HTMLButtonElement>('.month-grid .day-tile').forEach((tile) => expect(tile).toBeDisabled())

    await user.click(screen.getByRole('button', { name: /Zu heute/ }))
    await user.click(screen.getByRole('button', { name: 'Woche' }))
    await user.click(screen.getByRole('button', { name: 'Zurück' }))
    const previousWeekAnchor = addWeeks(now, -1)
    const previousWeek = screen.getByRole('group', { name: periodLabel('week', previousWeekAnchor) })
    await user.click(within(previousWeek).getAllByRole('button')[0]!)
    expect(screen.getAllByRole('button', { name: 'Heute' }).at(-1)).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: formatDayTitle(toDateKey(startOfISOWeek(previousWeekAnchor))) })).toBeInTheDocument()
  })

  it('lässt historische Kalendertage ohne damals aktive Ziele neutral', async () => {
    const user = userEvent.setup()
    const serverData = createInitialData(toDateKey(new Date()))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ data: serverData, revision: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Analyse' })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'Zurück' }))

    const neutralDays = screen.getAllByRole('button', { name: /keine aktiven Ziele/ })
    expect(neutralDays.length).toBeGreaterThan(0)
    neutralDays.forEach((tile) => expect(tile).toHaveClass('open'))
  })

  it('behält einen aktiven Trainingsdraft über Tabwechsel hinweg', async () => {
    const user = userEvent.setup()
    const serverData = createInitialData('2026-08-03')
    serverData.gymTemplates[0]!.exercises = [{ id: 'bench', name: 'Bankdrücken', sets: 3, targetWeightKg: 70, targetReps: 8, position: 0 }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: serverData, revision: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'GYM' })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: /Training starten/ }))
    const weight = screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })
    await user.clear(weight)
    await user.type(weight, '72.5')
    await user.click((await screen.findAllByRole('button', { name: 'Heute' })).at(-1)!)
    expect(screen.queryByRole('region', { name: 'Aktives Training Push' })).not.toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: 'GYM' })).at(-1)!)
    expect(screen.getByRole('textbox', { name: 'Bankdrücken Satz 1 Gewicht' })).toHaveValue('72,5')
  })

  it('verwirft einen geänderten Trainingsplan beim Tabwechsel nur nach Bestätigung', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'GYM' })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    await user.click(screen.getByRole('button', { name: 'Einheit hinzufügen' }))
    await user.type(screen.getByRole('textbox', { name: 'Name der Einheit' }), 'Core')
    await user.click((await screen.findAllByRole('button', { name: 'Heute' })).at(-1)!)
    expect(screen.getByRole('dialog', { name: 'Einheit anlegen' })).toBeInTheDocument()
    confirm.mockReturnValue(true)
    await user.click((await screen.findAllByRole('button', { name: 'Heute' })).at(-1)!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Protein')).toBeInTheDocument()
  })

  it('entfernt eine dauerhaft abgelehnte Mutation aus der Queue und speichert die folgende', async () => {
    const user = userEvent.setup()
    const serverData = createInitialData('2026-08-03')
    let revision = 0
    let firstMutationResolve: ((response: Response) => void) | undefined
    const firstMutation = new Promise<Response>((resolve) => { firstMutationResolve = resolve })
    let mutationCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && String(input).includes('/api/mutations')) {
        mutationCalls++
        if (mutationCalls === 1) return firstMutation
        const mutation = JSON.parse(String(init.body))
        if (mutation.kind === 'entry.set') {
          serverData.entries = serverData.entries.filter((entry) => !(entry.goalId === mutation.entry.goalId && entry.date === mutation.entry.date))
          if (mutation.entry.status !== 'open') serverData.entries.push(mutation.entry)
        }
        revision++
        return new Response(JSON.stringify({ data: serverData, revision, applied: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: serverData, revision }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    render(<App />)
    const proteinCard = (await screen.findByText('Protein')).closest('article')!
    await user.click(proteinCard.querySelector<HTMLButtonElement>('button.failed')!)
    await user.click(proteinCard.querySelector<HTMLButtonElement>('button.done')!)
    firstMutationResolve!(new Response(JSON.stringify({ error: 'Ungültiger erster Check-in.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))

    await waitFor(() => expect(mutationCalls).toBe(2))
    await waitFor(() => expect(serverData.entries).toEqual([expect.objectContaining({ status: 'done' })]))
    expect(await screen.findByRole('alert')).toHaveTextContent('Speichern abgelehnt: Ungültiger erster Check-in. Die Änderung wurde zurückgesetzt.')
    expect(localStorage.getItem(PENDING_MUTATIONS_STORAGE_KEY)).toBeNull()
  })

  it('stellt ein abgeschlossenes Training nach transientem Fehler mit derselben Mutation-ID wieder zu', async () => {
    const user = userEvent.setup()
    const serverData = createInitialData('2026-08-03')
    serverData.gymTemplates[0]!.exercises = [{ id: 'bench', name: 'Bankdrücken', sets: 3, targetWeightKg: 70, targetReps: 8, position: 0 }]
    let online = false
    let revision = 0
    let appliedOnServer = 0
    const receipts = new Set<string>()
    const mutationIds: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && String(input).includes('/api/mutations')) {
        const mutation = JSON.parse(String(init.body))
        mutationIds.push(mutation.id)
        if (!online) throw new TypeError('Netz kurz weg')
        if (!receipts.has(mutation.id)) {
          receipts.add(mutation.id)
          appliedOnServer++
          if (mutation.kind === 'gym.session.complete') serverData.gymSessions.push(mutation.session)
        }
        revision++
        return new Response(JSON.stringify({ data: serverData, revision, applied: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: serverData, revision }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'GYM' })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: /Training starten/ }))
    await user.click(screen.getByRole('button', { name: 'Training beenden' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' }))

    expect(sessionStorage.getItem('pace-gym-active-draft-v1')).toBeNull()
    expect(JSON.parse(localStorage.getItem(PENDING_MUTATIONS_STORAGE_KEY)!).mutations).toHaveLength(1)
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('Deine Änderung bleibt vorgemerkt.')
    expect(mutationIds).toHaveLength(3)
    expect(new Set(mutationIds).size).toBe(1)

    cleanup()
    online = true
    render(<App />)

    await waitFor(() => expect(localStorage.getItem(PENDING_MUTATIONS_STORAGE_KEY)).toBeNull())
    expect(serverData.gymSessions).toHaveLength(1)
    expect(appliedOnServer).toBe(1)
    expect(mutationIds.at(-1)).toBe(mutationIds[0])
    expect(mutationIds).toHaveLength(4)
  })

  it('behält den Trainingsdraft, wenn die dauerhafte Vormerkung im Browser fehlschlägt', async () => {
    const user = userEvent.setup()
    const serverData = createInitialData('2026-08-03')
    serverData.gymTemplates[0]!.exercises = [{ id: 'bench', name: 'Bankdrücken', sets: 3, targetWeightKg: 70, targetReps: 8, position: 0 }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: serverData, revision: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === PENDING_MUTATIONS_STORAGE_KEY) throw new DOMException('Speicher voll', 'QuotaExceededError')
      return nativeSetItem.call(this, key, value)
    })

    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'GYM' })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'Push starten' }))
    await user.click(screen.getByRole('button', { name: /Training starten/ }))
    await user.click(screen.getByRole('button', { name: 'Training beenden' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Training beenden' })).getByRole('button', { name: 'Training beenden' }))

    expect(screen.getByRole('region', { name: 'Aktives Training Push' })).toBeInTheDocument()
    expect(sessionStorage.getItem('pace-gym-active-draft-v1')).not.toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('nicht sicher vorgemerkt')
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })

  it('behält den geöffneten Trainingsplan samt Eingaben, wenn die dauerhafte Vormerkung fehlschlägt', async () => {
    const user = userEvent.setup()
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === PENDING_MUTATIONS_STORAGE_KEY) throw new DOMException('Speicher voll', 'QuotaExceededError')
      return nativeSetItem.call(this, key, value)
    })

    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'GYM' })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'Einheiten verwalten' }))
    await user.click(screen.getByRole('button', { name: 'Push bearbeiten' }))
    const name = screen.getByRole('textbox', { name: 'Name der Einheit' })
    await user.clear(name)
    await user.type(name, 'Push Neu')
    await user.click(screen.getByRole('button', { name: 'Übung hinzufügen' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Bankdrücken')
    await user.click(screen.getByRole('button', { name: 'Einheit speichern' }))

    expect(screen.getByRole('dialog', { name: 'Einheit bearbeiten' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name der Einheit' })).toHaveValue('Push Neu')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Bankdrücken')
    expect(screen.getByRole('alert')).toHaveTextContent('nicht sicher vorgemerkt')
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })

  it('wechselt einen Check-in eindeutig zwischen fehlgeschlagen und erfüllt', async () => {
    const user = userEvent.setup()
    render(<App />)
    const proteinCard = (await screen.findByText('Protein')).closest('article')!
    const failedButton = proteinCard.querySelector<HTMLButtonElement>('button.failed')!
    const doneButton = proteinCard.querySelector<HTMLButtonElement>('button.done')!

    await user.click(failedButton)
    expect(failedButton).toHaveAttribute('aria-pressed', 'true')
    expect(doneButton).toHaveAttribute('aria-pressed', 'false')

    await user.click(doneButton)
    expect(failedButton).toHaveAttribute('aria-pressed', 'false')
    expect(doneButton).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      const saves = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')
      const saved = JSON.parse(String(saves.at(-1)?.[1]?.body))
      expect(saved.entry.status).toBe('done')
    })
  })

  it('schließt das Zielformular per Escape und stellt den Fokus wieder her', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click((await screen.findAllByRole('button', { name: 'Ziele' })).at(-1)!)
    const addButton = screen.getByRole('button', { name: 'Ziel hinzufügen' })
    await user.click(addButton)
    expect(screen.getByRole('dialog', { name: 'Neues Ziel' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(addButton).toHaveFocus()
  })

  it('zeigt Demo-Daten an, ohne bestehende lokale Daten zu verändern', async () => {
    const user = userEvent.setup()
    const existing = JSON.stringify({
      version: 1,
      goals: [],
      entries: [],
      bodyMetrics: [],
    })
    localStorage.setItem(STORAGE_KEY, existing)
    localStorage.setItem(PENDING_MUTATIONS_STORAGE_KEY, 'normale-queue-bleibt-unberührt')
    window.history.replaceState({}, '', '/?demo=1')

    render(<App />)
    expect(screen.getByLabelText('Demo-Modus aktiv')).toBeInTheDocument()
    expect(screen.getByText('Demo-Daten')).toBeInTheDocument()

    const proteinCard = screen.getByText('Protein').closest('article')
    const failedButton = proteinCard!.querySelector<HTMLButtonElement>('button.failed')
    await user.click(failedButton!)

    expect(localStorage.getItem(STORAGE_KEY)).toBe(existing)
    expect(localStorage.getItem(PENDING_MUTATIONS_STORAGE_KEY)).toBe('normale-queue-bleibt-unberührt')
    expect(screen.getByRole('link', { name: 'Normaler Modus' })).toHaveAttribute('href', '/')
  })

  it('trennt Demo-Profile und merkt sich Sena als letzte Auswahl', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/?demo=1')
    const view = render(<App />)
    expect(await screen.findByText('Protein')).toBeInTheDocument()
    const trigger = screen.getAllByRole('button', { name: 'Profil: Bugra' })[0]!
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(trigger)
    const profileDialog = screen.getByRole('dialog', { name: 'Profil wählen' })
    expect(profileDialog.parentElement?.parentElement).toBe(document.body)
    const bugraButton = within(profileDialog).getByRole('button', { name: 'Bugra – aktuelles Profil' })
    const senaButton = within(profileDialog).getByRole('button', { name: 'Zu Sena wechseln' })
    expect(bugraButton).toHaveFocus()
    expect(bugraButton).toHaveAttribute('aria-current', 'true')
    expect(senaButton).not.toHaveAttribute('aria-current')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Profil wählen' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    const switchToSena = screen.getByRole('button', { name: 'Zu Sena wechseln' })
    switchToSena.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Keine Ziele aktiv')).toBeInTheDocument()
    expect(screen.queryByText('Protein')).not.toBeInTheDocument()
    expect(localStorage.getItem('pace-demo-active-profile-v1')).toBe('profile-sena')
    await user.click(screen.getAllByRole('button', { name: 'Profil: Sena' })[0]!)
    await user.click(screen.getByRole('button', { name: 'Zu Bugra wechseln' }))
    expect(await screen.findByText('Protein')).toBeInTheDocument()
    view.unmount()
    localStorage.setItem('pace-demo-active-profile-v1', 'profile-sena')
    render(<App />)
    expect(await screen.findByText('Keine Ziele aktiv')).toBeInTheDocument()
  })

  it('lässt Sena ihr erstes normales Ziel über die native Formularvalidierung anlegen', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/?demo=1')
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Profil: Bugra' })[0]!)
    await user.click(screen.getByRole('button', { name: 'Zu Sena wechseln' }))
    await user.click(screen.getAllByRole('button', { name: 'Ziele' }).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'Ziel hinzufügen' }))
    const dialog = screen.getByRole('dialog', { name: 'Neues Ziel' })
    const form = dialog.querySelector('form')!
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Schritte')
    await user.type(within(dialog).getByRole('spinbutton', { name: 'Zielwert' }), '8000')
    await user.type(within(dialog).getByRole('textbox', { name: 'Einheit' }), 'Stk')
    expect(form.checkValidity()).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'Ziel anlegen' }))
    expect(await screen.findByText('Schritte')).toBeInTheDocument()
  })

  it('markiert einen vorübergehend fehlgeschlagenen lokalen Import nicht als erledigt', async () => {
    const local = createInitialData('2026-07-01')
    local.entries.push({ goalId: 'protein', date: '2026-07-01', status: 'done', updatedAt: '2026-07-01T12:00:00Z' })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: createInitialData(), revision: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockRejectedValueOnce(new TypeError('Netz kurz weg')))

    render(<App />)
    expect(await screen.findByText('Protein')).toBeInTheDocument()
    expect(localStorage.getItem('pace-server-import-v1')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('Netz kurz weg')
  })

  it('ergänzt bei zwei Tagesmessungen nur den explizit gewählten Datensatz', async () => {
    const user = userEvent.setup()
    const serverData = createInitialData('2026-08-01')
    serverData.bodyMetrics = [
      { id: 'google-morning', date: '2026-08-01', weightKg: 80, bodyFatPercent: 20, source: 'google-health', measuredAt: '2026-08-01T07:00:00Z', createdAt: '2026-08-01T07:01:00Z' },
      { id: 'google-evening', date: '2026-08-01', weightKg: 81, bodyFatPercent: 19, source: 'google-health', measuredAt: '2026-08-01T18:00:00Z', createdAt: '2026-08-01T18:01:00Z' },
    ]
    let capturedMutation: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/google-health/status')) {
        return new Response(JSON.stringify({ configured: false, connected: false, lastSyncAt: null, lastSyncError: null, pollingMinutes: 15 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (init?.method === 'POST' && url.includes('/api/mutations')) {
        capturedMutation = JSON.parse(String(init.body))
        const metric = (capturedMutation as { metric: typeof serverData.bodyMetrics[number] }).metric
        serverData.bodyMetrics = serverData.bodyMetrics.some((item) => item.id === metric.id)
          ? serverData.bodyMetrics.map((item) => item.id === metric.id ? metric : item)
          : [...serverData.bodyMetrics, metric]
        return new Response(JSON.stringify({ data: serverData, revision: 1, applied: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: serverData, revision: capturedMutation ? 1 : 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Körper' })).at(-1)!)
    await user.click(await screen.findByRole('button', { name: '80 vom 01.08.26 ergänzen' }))
    await user.type(screen.getByRole('textbox', { name: 'Muskelmasse (kg)' }), '60')
    await user.click(screen.getByRole('button', { name: 'Messung speichern' }))

    await waitFor(() => expect(capturedMutation).toMatchObject({ kind: 'body.upsert', metric: { id: 'google-morning', muscleMassKg: 60 } }))
    expect(serverData.bodyMetrics).toHaveLength(2)
    const untouched = serverData.bodyMetrics.find((metric) => metric.id === 'google-evening')
    expect(untouched).toMatchObject({ weightKg: 81 })
    expect(untouched).not.toHaveProperty('muscleMassKg')
    expect(await screen.findByText('60 kg Muskel')).toBeInTheDocument()
    expect(screen.getAllByText('81 kg').length).toBeGreaterThan(0)

    capturedMutation = undefined
    await user.type(screen.getByRole('textbox', { name: 'Muskelmasse (kg)' }), '62')
    await user.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(capturedMutation).toMatchObject({
      kind: 'body.upsert',
      metric: { date: '2026-08-01', muscleMassKg: 62, source: 'manual' },
    }))
    const newMetric = (capturedMutation as unknown as { metric: Record<string, unknown> }).metric
    expect(newMetric).not.toHaveProperty('measuredAt')
    expect(serverData.bodyMetrics).toHaveLength(3)
    expect(serverData.bodyMetrics.filter((metric) => metric.id.startsWith('google-'))).toHaveLength(2)
  })
})
