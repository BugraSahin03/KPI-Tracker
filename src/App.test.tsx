import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { STORAGE_KEY } from './lib/storage'

describe('Heute-Interaktion', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('markiert ein Ziel mit einem Klick als erfüllt und lässt es zurücksetzen', async () => {
    const user = userEvent.setup()
    render(<App />)

    const proteinCard = screen.getByText('Protein').closest('article')
    expect(proteinCard).not.toBeNull()
    const doneButton = proteinCard!.querySelector<HTMLButtonElement>('button.done')
    expect(doneButton).not.toBeNull()

    await user.click(doneButton!)
    expect(doneButton).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.entries).toHaveLength(1)
      expect(saved.entries[0].status).toBe('done')
    })

    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }))
    expect(doneButton).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.entries).toHaveLength(0)
    })
  })

  it('verhindert Check-ins für Zukunftstage', async () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
  })

  it('wechselt einen Check-in eindeutig zwischen fehlgeschlagen und erfüllt', async () => {
    const user = userEvent.setup()
    render(<App />)
    const proteinCard = screen.getByText('Protein').closest('article')!
    const failedButton = proteinCard.querySelector<HTMLButtonElement>('button.failed')!
    const doneButton = proteinCard.querySelector<HTMLButtonElement>('button.done')!

    await user.click(failedButton)
    expect(failedButton).toHaveAttribute('aria-pressed', 'true')
    expect(doneButton).toHaveAttribute('aria-pressed', 'false')

    await user.click(doneButton)
    expect(failedButton).toHaveAttribute('aria-pressed', 'false')
    expect(doneButton).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.entries).toHaveLength(1)
      expect(saved.entries[0].status).toBe('done')
    })
  })

  it('schließt das Zielformular per Escape und stellt den Fokus wieder her', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: 'Ziele' }).at(-1)!)
    const addButton = screen.getByRole('button', { name: 'Ziel hinzufügen' })
    await user.click(addButton)
    expect(screen.getByRole('dialog', { name: 'Neues Ziel' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(addButton).toHaveFocus()
  })
})
