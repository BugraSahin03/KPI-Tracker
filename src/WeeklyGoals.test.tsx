import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { startOfISOWeek } from 'date-fns'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WeeklyGoalsManager, WeeklyTodaySection } from './WeeklyGoals'
import { toDateKey, todayKey } from './lib/date'
import { createInitialData } from './lib/storage'
import type { WeeklyGoal } from './types'

function goal(): WeeklyGoal {
  const start = toDateKey(startOfISOWeek(new Date()))
  const definition = { effectiveFrom: start, name: '3× GYM', targetCount: 3, sourceType: 'gym' as const, gymTemplateIds: [] as string[], gymTemplateNames: [] as string[], color: '#c6ff3d', icon: 'gym' as const, active: true, countingMode: 'unique-days' as const }
  return { id: 'weekly-gym', name: definition.name, targetCount: definition.targetCount, sourceType: definition.sourceType, gymTemplateIds: definition.gymTemplateIds, color: definition.color, icon: definition.icon, active: definition.active, countingMode: definition.countingMode, createdAt: todayKey(), startDate: start, definitions: [definition] }
}

describe('Wochenziel-Oberfläche', () => {
  it('öffnet die Wochenkontrolle, speichert eine Korrektur und stellt den Fokus wieder her', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Harness() {
      const [data, setData] = useState(() => {
        const initial = createInitialData(todayKey())
        initial.weeklyGoals = [goal()]
        return initial
      })
      return <WeeklyTodaySection data={data} selectedDate={todayKey()} onChange={(next) => { onChange(next); setData(next) }} onOpenGoals={vi.fn()} />
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: /3× GYM/ })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '3× GYM' })
    const mondayStatus = within(dialog).getByRole('combobox', { name: 'Status für Mo' })
    await user.selectOptions(mondayStatus, 'sick')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weeklyGoalAdjustments: [expect.objectContaining({ goalId: 'weekly-gym', status: 'sick' })] }))
    expect(mondayStatus).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Schließen' }))
    expect(trigger).toHaveFocus()
  })

  it('legt ein generisches manuelles Wochenziel am Montag der gewählten Woche an', async () => {
    const user = userEvent.setup()
    const data = createInitialData(todayKey())
    const onChange = vi.fn()
    render(<WeeklyGoalsManager data={data} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /Hinzufügen/ }))
    const dialog = screen.getByRole('dialog', { name: 'Neu anlegen' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '2× Mobility')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Quelle' }), 'manual')
    await user.click(within(dialog).getByRole('button', { name: /Speichern/ }))
    const saved = onChange.mock.calls[0]![0].weeklyGoals[0] as WeeklyGoal
    expect(saved).toMatchObject({ name: '2× Mobility', sourceType: 'manual', icon: 'calendar', startDate: toDateKey(startOfISOWeek(new Date())) })
    expect(saved.definitions[0].effectiveFrom).toBe(saved.startDate)
  })
})
