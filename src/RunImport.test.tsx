import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunImport from './RunImport'
import { api } from './lib/api'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Lauf-Screenshot-Import', () => {
  const recognizedDraft = {
    environment: { value: 'outdoor' as const, confidence: 'high' as const }, date: { value: '2026-09-13', confidence: 'medium' as const, note: 'Jahr ergänzt' },
    startTime: { value: '14:36', confidence: 'high' as const }, durationSeconds: { value: 2410, confidence: 'high' as const }, distanceKm: { value: 5.27, confidence: 'high' as const },
    displayedPaceSecondsPerKm: { value: 457, confidence: 'high' as const }, averageHeartRateBpm: { value: 161, confidence: 'high' as const }, effort: { value: 6, confidence: 'high' as const },
    activeCalories: { value: 445, confidence: 'high' as const }, totalCalories: { value: 514, confidence: 'high' as const }, elevationGainM: { value: 2, confidence: 'high' as const },
    averagePowerWatts: { value: 180, confidence: 'high' as const }, averageCadenceSpm: { value: 142, confidence: 'high' as const },
  }

  it('zeigt Bild und erkannte Daten kontrollierbar an, ohne vor Bestätigung zu speichern', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
    vi.spyOn(api, 'recognizeRunScreenshot').mockResolvedValue({ draft: recognizedDraft })
    const onSave = vi.fn()
    const { container } = render(<RunImport onClose={vi.fn()} onSave={onSave} />)
    const file = new File(['image'], 'lauf.jpg', { type: 'image/jpeg' })
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByDisplayValue('5,27')).toBeInTheDocument())
    expect(screen.getByRole('img', { name: /hochgeladener Apple-Fitness-Screenshot/i })).toBeInTheDocument()
    expect(screen.getByText('7:37 min/km')).toBeInTheDocument()
    expect(screen.getByText('Jahr ergänzt')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('weist zu große Dateien vor dem Upload zurück', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(), revokeObjectURL: vi.fn() })
    const recognize = vi.spyOn(api, 'recognizeRunScreenshot')
    const { container } = render(<RunImport onClose={vi.fn()} onSave={vi.fn()} />)
    const file = new File(['x'], 'lauf.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'size', { value: 12 * 1024 * 1024 + 1 })
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]')!, { target: { files: [file] } })
    expect(screen.getByRole('alert')).toHaveTextContent('höchstens 12 MB')
    expect(recognize).not.toHaveBeenCalled()
  })

  it('weist optionale Dezimalwerte und Werte außerhalb der Servergrenzen vor dem Speichern zurück', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
    vi.spyOn(api, 'recognizeRunScreenshot').mockResolvedValue({ draft: recognizedDraft })
    const onSave = vi.fn()
    const { container } = render(<RunImport onClose={vi.fn()} onSave={onSave} />)
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'lauf.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(screen.getByDisplayValue('5,27')).toBeInTheDocument())
    fireEvent.change(screen.getByDisplayValue('445'), { target: { value: '1.5' } })
    fireEvent.click(screen.getByRole('button', { name: /lauf speichern/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('optionalen Messwerte')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('meldet ein vorhandenes Lauf-Fingerprint direkt und speichert keinen zweiten Lauf', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
    vi.spyOn(api, 'recognizeRunScreenshot').mockResolvedValue({ draft: recognizedDraft })
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(10).buffer) } })
    const onSave = vi.fn()
    const fingerprint = '0a'.repeat(32)
    const { container } = render(<RunImport existingFingerprints={[fingerprint]} onClose={vi.fn()} onSave={onSave} />)
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'lauf.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(screen.getByDisplayValue('5,27')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /lauf speichern/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('bereits gespeichert')
    expect(onSave).not.toHaveBeenCalled()
  })
})
