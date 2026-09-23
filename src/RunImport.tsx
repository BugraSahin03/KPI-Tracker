import { Check, Expand, ImagePlus, LoaderCircle, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api, type RunScreenshotRecognition } from './lib/api'
import { parseDecimalInput } from './lib/decimal'
import { makeId } from './lib/storage'
import type { RunningSession } from './types'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif'])
type Draft = RunScreenshotRecognition['draft']
type FieldKey = keyof Draft

function durationInput(seconds?: number) {
  if (seconds === undefined) return ''
  const hours = Math.floor(seconds / 3600)
  return `${hours}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
function parseDuration(value: string) {
  const parts = value.trim().split(':').map(Number)
  if (parts.some((item) => !Number.isInteger(item) || item < 0)) return undefined
  if (parts.length === 2 && parts[1]! < 60) return parts[0]! * 60 + parts[1]!
  if (parts.length === 3 && parts[1]! < 60 && parts[2]! < 60) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  return undefined
}
function paceLabel(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return '–'
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')} min/km`
}
function optionalInteger(value: string) { return value.trim() === '' ? undefined : Number(value) }
function optionalDecimal(value: string) { return value.trim() === '' ? undefined : parseDecimalInput(value) }
async function fingerprintRun(run: Omit<RunningSession, 'id' | 'fingerprint' | 'createdAt'>) {
  const stable = [run.environment, run.date, run.startTime ?? '', run.durationSeconds, run.distanceKm.toFixed(3)].join('|')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable))
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')
}

export default function RunImport({ onClose, onSave, existingFingerprints = [] }: { onClose: () => void; onSave: (run: RunningSession) => boolean | void; existingFingerprints?: readonly string[] }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const uploadButtonRef = useRef<HTMLButtonElement>(null)
  const previewButtonRef = useRef<HTMLButtonElement>(null)
  const lightboxRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  const zoomedRef = useRef(false)
  const wasZoomedRef = useRef(false)
  const recognitionSequenceRef = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [recognition, setRecognition] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set())
  const [form, setForm] = useState({ environment: 'outdoor', date: '', startTime: '', duration: '', distance: '', heart: '', effort: '', activeCalories: '', totalCalories: '', elevation: '', power: '', cadence: '' })
  const derivedPace = useMemo(() => {
    const duration = parseDuration(form.duration), distance = parseDecimalInput(form.distance)
    return duration !== undefined && distance !== undefined && distance > 0 ? Math.round(duration / distance) : undefined
  }, [form.duration, form.distance])
  const displayedPace = recognition?.displayedPaceSecondsPerKm.value
  const paceDiff = derivedPace !== undefined && displayedPace !== undefined ? Math.abs(derivedPace - displayedPace) : undefined

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => { zoomedRef.current = zoomed }, [zoomed])
  useEffect(() => {
    if (zoomed) {
      wasZoomedRef.current = true
      lightboxRef.current?.focus()
    } else if (wasZoomedRef.current) {
      wasZoomedRef.current = false
      previewButtonRef.current?.focus()
    }
  }, [zoomed])
  useEffect(() => () => { recognitionSequenceRef.current += 1 }, [])
  useEffect(() => {
    uploadButtonRef.current?.focus()
    const returnFocus = returnFocusRef.current
    const scrollY = window.scrollY
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (zoomedRef.current) setZoomed(false)
        else onClose()
        return
      }
      if (event.key !== 'Tab' || zoomedRef.current || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter((element) => !element.classList.contains('visually-hidden'))
      const first = focusable[0], last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.body.style.overflow = previousOverflow
      if (scrollY > 0) window.scrollTo(0, scrollY)
      returnFocus?.focus()
    }
  }, [onClose])

  const note = (key: FieldKey) => recognition && !touched.has(key) && recognition[key].confidence !== 'high'
    ? recognition[key].note ?? (recognition[key].value === undefined ? 'Nicht erkannt – bitte prüfen' : 'Automatisch ergänzt – bitte prüfen') : undefined
  const change = (key: keyof typeof form, value: string, source?: FieldKey) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (source) setTouched((current) => new Set([...current, source]))
  }
  const selectFile = async (selected?: File) => {
    if (!selected) return
    setError(null)
    const extensionOkay = /\.(?:jpe?g|png|heic|heif)$/i.test(selected.name)
    if ((!ACCEPTED_TYPES.has(selected.type) && !extensionOkay) || selected.size > MAX_FILE_BYTES) {
      setError(selected.size > MAX_FILE_BYTES ? 'Der Screenshot darf höchstens 12 MB groß sein.' : 'Bitte ein JPG-, PNG- oder HEIC-Bild auswählen.')
      return
    }
    const sequence = ++recognitionSequenceRef.current
    setFile(selected); setPreview(URL.createObjectURL(selected)); setBusy(true); setRecognition(null); setTouched(new Set())
    try {
      const result = await api.recognizeRunScreenshot(selected)
      if (sequence !== recognitionSequenceRef.current) return
      const draft = result.draft
      setRecognition(draft)
      setForm({
        environment: draft.environment.value ?? 'outdoor', date: draft.date.value ?? '', startTime: draft.startTime.value ?? '',
        duration: durationInput(draft.durationSeconds.value), distance: draft.distanceKm.value?.toLocaleString('de-DE', { maximumFractionDigits: 3 }) ?? '',
        heart: String(draft.averageHeartRateBpm.value ?? ''), effort: String(draft.effort.value ?? ''), activeCalories: String(draft.activeCalories.value ?? ''),
        totalCalories: String(draft.totalCalories.value ?? ''), elevation: String(draft.elevationGainM.value ?? ''), power: String(draft.averagePowerWatts.value ?? ''), cadence: String(draft.averageCadenceSpm.value ?? ''),
      })
    } catch (reason) {
      if (sequence === recognitionSequenceRef.current) setError(reason instanceof Error ? reason.message : 'Der Screenshot konnte nicht erkannt werden.')
    } finally {
      if (sequence === recognitionSequenceRef.current) setBusy(false)
    }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null)
    const durationSeconds = parseDuration(form.duration), distanceKm = parseDecimalInput(form.distance)
    const parsedDate = new Date(`${form.date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== form.date || form.date > new Date().toLocaleDateString('sv-SE')) return setError('Bitte prüfe das Laufdatum.')
    if (form.startTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(form.startTime)) return setError('Bitte prüfe die Startzeit.')
    if (durationSeconds === undefined || durationSeconds < 60 || durationSeconds > 86400) return setError('Dauer bitte als h:mm:ss eingeben.')
    if (distanceKm === undefined || distanceKm < .05 || distanceKm > 500 || derivedPace === undefined || derivedPace < 60 || derivedPace > 3600) return setError('Bitte prüfe Distanz und daraus berechnete Pace.')
    if (paceDiff !== undefined && paceDiff > Math.max(10, derivedPace * .05) && !window.confirm(`Die berechnete Pace (${paceLabel(derivedPace)}) weicht von der erkannten Anzeige (${paceLabel(displayedPace)}) ab. Trotzdem speichern?`)) return
    const optional = { averageHeartRateBpm: optionalInteger(form.heart), effort: optionalInteger(form.effort), activeCalories: optionalInteger(form.activeCalories), totalCalories: optionalInteger(form.totalCalories), elevationGainM: optionalDecimal(form.elevation), averagePowerWatts: optionalInteger(form.power), averageCadenceSpm: optionalInteger(form.cadence) }
    const integerWithin = (value: number | undefined, min: number, max: number) => value === undefined || (Number.isInteger(value) && value >= min && value <= max)
    if (!integerWithin(optional.averageHeartRateBpm, 30, 250) || !integerWithin(optional.effort, 1, 10)) return setError('Bitte prüfe Herzfrequenz und Anstrengung.')
    if (!integerWithin(optional.activeCalories, 0, 10000) || !integerWithin(optional.totalCalories, 0, 15000) ||
      !integerWithin(optional.averagePowerWatts, 0, 3000) || !integerWithin(optional.averageCadenceSpm, 0, 300) ||
      (optional.elevationGainM !== undefined && (!Number.isFinite(optional.elevationGainM) || optional.elevationGainM < 0 || optional.elevationGainM > 20000))) {
      return setError('Bitte prüfe die optionalen Messwerte.')
    }
    setBusy(true)
    const base = { environment: form.environment as RunningSession['environment'], date: form.date, ...(form.startTime ? { startTime: form.startTime } : {}), durationSeconds, distanceKm, averagePaceSecondsPerKm: derivedPace, ...optional, source: 'screenshot' as const }
    const fingerprint = await fingerprintRun(base)
    if (existingFingerprints.includes(fingerprint)) {
      setBusy(false)
      return setError('Dieser Lauf wurde bereits gespeichert oder ist schon zum Speichern vorgemerkt.')
    }
    const run: RunningSession = { ...base, id: makeId('run'), fingerprint, createdAt: new Date().toISOString() }
    const accepted = onSave(run)
    setBusy(false)
    if (accepted !== false) onClose()
  }

  return createPortal(<div className="modal-backdrop run-import-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="modal-sheet run-import-modal" role="dialog" aria-modal="true" aria-labelledby="run-import-title">
      <header className="modal-head"><div><p className="eyebrow">Lauf hinzufügen</p><h2 id="run-import-title">Screenshot prüfen</h2></div><button className="mini-action" type="button" onClick={onClose} aria-label="Schließen"><X /></button></header>
      {!file ? <div className="run-upload-step">
        <div className="run-upload-mark"><ImagePlus /></div><h3>Apple-Fitness-Screenshot</h3><p>Pace erkennt die Werte. Das Bild wird nur für diesen Import verarbeitet und nicht gespeichert.</p>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" onChange={(event) => void selectFile(event.target.files?.[0])} />
        <button ref={uploadButtonRef} className="primary-button" type="button" onClick={() => inputRef.current?.click()}><ImagePlus /> Screenshot auswählen</button><small>JPG, PNG oder HEIC · maximal 12 MB</small>
        {error && <p className="gym-form-error" role="alert">{error}</p>}
      </div> : <form className="run-review" onSubmit={(event) => void submit(event)}>
        <div className="run-preview-column"><button ref={previewButtonRef} type="button" className="run-preview" onClick={() => setZoomed(true)} aria-label="Screenshot vergrößern"><img src={preview} alt="Hochgeladener Apple-Fitness-Screenshot" /><span><Expand /> Vergrößern</span></button><button className="link-button" type="button" onClick={() => { recognitionSequenceRef.current += 1; setFile(null); setPreview(''); setRecognition(null); setBusy(false); setError(null) }}>Anderes Bild wählen</button></div>
        <div className="run-form-column">
          {busy && !recognition ? <div className="run-recognizing" role="status"><LoaderCircle /><strong>Screenshot wird erkannt …</strong><span>Das kann kurz dauern.</span></div> : <>
            <div className="run-field-grid">
              <label><span>Umgebung</span><select value={form.environment} onChange={(e) => change('environment', e.target.value, 'environment')}><option value="outdoor">Outdoor</option><option value="indoor">Indoor</option></select>{note('environment') && <small>{note('environment')}</small>}</label>
              <label className={note('date') ? 'needs-check' : ''}><span>Datum</span><input required type="date" value={form.date} max={new Date().toLocaleDateString('sv-SE')} onChange={(e) => change('date', e.target.value, 'date')} />{note('date') && <small>{note('date')}</small>}</label>
              <label><span>Startzeit <em>optional</em></span><input type="time" value={form.startTime} onChange={(e) => change('startTime', e.target.value, 'startTime')} />{note('startTime') && <small>{note('startTime')}</small>}</label>
              <label className={note('durationSeconds') ? 'needs-check' : ''}><span>Dauer</span><input required inputMode="numeric" placeholder="0:40:10" value={form.duration} onChange={(e) => change('duration', e.target.value, 'durationSeconds')} />{note('durationSeconds') && <small>{note('durationSeconds')}</small>}</label>
              <label className={note('distanceKm') ? 'needs-check' : ''}><span>Distanz</span><div className="run-input-unit"><input required inputMode="decimal" placeholder="5,27" value={form.distance} onChange={(e) => change('distance', e.target.value, 'distanceKm')} /><b>km</b></div>{note('distanceKm') && <small>{note('distanceKm')}</small>}</label>
              <div className={`run-derived${paceDiff !== undefined && paceDiff > 10 ? ' needs-check' : ''}`}><span>Ø Pace</span><strong>{paceLabel(derivedPace)}</strong>{displayedPace !== undefined && <small>Screenshot: {paceLabel(displayedPace)}</small>}</div>
            </div>
            <div className="run-optional-grid">
              {([['heart','Ø Herzfrequenz','BPM','averageHeartRateBpm'],['effort','Anstrengung','/ 10','effort'],['activeCalories','Aktivkalorien','kcal','activeCalories'],['totalCalories','Gesamtkalorien','kcal','totalCalories'],['elevation','Höhenmeter','m','elevationGainM'],['power','Ø Leistung','W','averagePowerWatts'],['cadence','Ø Kadenz','SPM','averageCadenceSpm']] as const).map(([key,label,unit,source]) => <label key={key}><span>{label} <em>optional</em></span><div className="run-input-unit"><input inputMode={key === 'elevation' ? 'decimal' : 'numeric'} value={form[key]} onChange={(e) => change(key, e.target.value, source)} /><b>{unit}</b></div>{note(source) && <small>{note(source)}</small>}</label>)}
            </div>
            {error && <p className="gym-form-error" role="alert">{error}</p>}
            <button className="primary-button full" type="submit" disabled={busy}><Check /> Lauf speichern</button>
          </>}
        </div>
      </form>}
    </section>
    {zoomed && <button ref={lightboxRef} type="button" className="run-image-lightbox" onClick={() => setZoomed(false)} aria-label="Vergrößerte Ansicht schließen"><img src={preview} alt="Apple-Fitness-Screenshot in vergrößerter Ansicht" /><X /></button>}
  </div>, document.body)
}
