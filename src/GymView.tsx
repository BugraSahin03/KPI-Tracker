import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronUp, Dumbbell, Eye, Link2, Pencil, Plus, TrendingUp, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { formatShortDate, historyDateGroup, todayKey } from './lib/date'
import { formatDecimalInput, parseDecimalInput } from './lib/decimal'
import { formatRepTarget, parseRepTarget } from './lib/reps'
import { isGymSession, legacyGymSetId, makeId } from './lib/storage'
import type { AppData, DataMutation, GymExercise, GymSession, GymSessionExercise, GymSessionSet, GymTemplate, GymTemplateExercise } from './types'

type WithoutMutationId<T> = T extends { id: string } ? Omit<T, 'id'> : never
export type GymMutationIntent = WithoutMutationId<Extract<DataMutation, { kind: 'gym.template.upsert' | 'gym.exercise.merge' | 'gym.exercise.rename' }>>

type GymViewProps = {
  data: AppData
  onChange: (data: AppData, mutations?: GymMutationIntent[]) => boolean | void
  draftStorageKey?: string
  onEditorDirtyChange?: (dirty: boolean) => void
}

export const GYM_DRAFT_STORAGE_KEY = 'pace-gym-active-draft-v1'

type ExerciseDraft = {
  id: string
  name: string
  sets: string
  reps: string
  /** Preserved invisibly for existing pre-history exercises; never set for new exercises. */
  legacyWeightKg?: number
  exerciseId?: string
}

function exerciseDraft(exercise?: GymTemplateExercise): ExerciseDraft {
  return {
    id: exercise?.id ?? makeId('gym-exercise'),
    name: exercise?.name ?? '',
    sets: String(exercise?.sets ?? 3),
    reps: formatRepTarget(exercise?.targetReps ?? 10, exercise?.targetRepsMax),
    ...(exercise?.targetWeightKg === undefined ? {} : { legacyWeightKg: exercise.targetWeightKg }),
    ...(exercise?.exerciseId === undefined ? {} : { exerciseId: exercise.exerciseId }),
  }
}

function TemplateEditor({ template, library, templates, onSave, onCancel, onDirtyChange }: {
  template?: GymTemplate
  library: GymExercise[]
  templates: GymTemplate[]
  onSave: (template: GymTemplate) => void
  onCancel: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  )
  const [initialForm] = useState(() => ({
    name: template?.name ?? '',
    exercises: template?.exercises.map((exercise) => exerciseDraft({ ...exercise, exerciseId: exercise.exerciseId ?? library.find((item) => item.id === exercise.id)?.id })) ?? [exerciseDraft()],
  }))
  const [name, setName] = useState(initialForm.name)
  const [exercises, setExercises] = useState<ExerciseDraft[]>(initialForm.exercises)
  const [formError, setFormError] = useState<string | null>(null)
  const dirty = JSON.stringify({ name, exercises }) !== JSON.stringify(initialForm)
  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return
    onCancel()
  }, [dirty, onCancel])

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (!focusable.length) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [requestClose])

  useEffect(() => {
    const returnFocus = returnFocusRef.current
    return () => returnFocus?.focus()
  }, [])

  useEffect(() => {
    const scrollY = window.scrollY
    const previous = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    }
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.overflow = previous.overflow
      document.body.style.position = previous.position
      document.body.style.top = previous.top
      document.body.style.width = previous.width
      if (scrollY > 0) window.scrollTo(0, scrollY)
    }
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (exercises.some((exercise) => !parseRepTarget(exercise.reps))) {
      setFormError('Wiederholungen bitte als Zahl oder Bereich eingeben, z. B. 8–12.')
      return
    }
    for (const exercise of exercises) {
      const canonical = exercise.exerciseId ? library.find((item) => item.id === exercise.exerciseId) : undefined
      if (!canonical || canonical.name === exercise.name.trim()) continue
      const uses = templates.filter((item) => item.exercises.some((candidate) => candidate.exerciseId === exercise.exerciseId)).map((item) => item.name)
      if (uses.length > 0 && !window.confirm(`„${canonical.name}“ ist eine globale Übung in ${uses.join(', ')}. Wirklich überall in „${exercise.name.trim()}“ umbenennen? Auch die verknüpfte Historie wird künftig unter diesem Namen angezeigt.`)) return
    }
    const now = new Date().toISOString()
    const normalized: GymTemplateExercise[] = exercises.map((exercise, position) => {
      const target = parseRepTarget(exercise.reps)!
      let exerciseId = exercise.exerciseId
      if (!exerciseId) {
        const normalizedName = normalizeExerciseName(exercise.name)
        const duplicate = library.find((item) => normalizeExerciseName(item.name) === normalizedName)
        exerciseId = duplicate && window.confirm(`„${duplicate.name}“ existiert bereits. Bestehende Übung verwenden?\n\nOK: verbinden · Abbrechen: getrennt anlegen`)
          ? duplicate.id
          : makeId('gym-exercise-library')
      }
      return {
        id: exercise.id,
        exerciseId,
        name: exercise.name.trim(),
        sets: Number(exercise.sets),
        ...(exercise.legacyWeightKg === undefined ? {} : { targetWeightKg: exercise.legacyWeightKg }),
        targetReps: target.min,
        ...(target.max === undefined ? {} : { targetRepsMax: target.max }),
        position,
      }
    })
    const normalizedNames = normalized.map((exercise) => exercise.name.toLocaleLowerCase('de-DE'))
    if (!name.trim() || normalized.some((exercise) => !exercise.name)) return
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setFormError('Jede Übung darf pro Einheit nur einmal vorkommen.')
      return
    }
    if (normalized.some((exercise) => !Number.isInteger(exercise.sets) || exercise.sets < 1 || exercise.sets > 20 || !Number.isInteger(exercise.targetReps) || exercise.targetReps < 1 || exercise.targetReps > 100 || (exercise.targetRepsMax !== undefined && exercise.targetRepsMax < exercise.targetReps))) {
      setFormError('Bitte prüfe Sätze und Wiederholungen.')
      return
    }
    onSave({
      id: template?.id ?? makeId('gym-template'),
      name: name.trim(),
      createdAt: template?.createdAt ?? now,
      updatedAt: now,
      exercises: normalized,
    })
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= exercises.length) return
    const next = [...exercises]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setExercises(next)
  }

  return createPortal(
    <div className="modal-backdrop gym-template-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section ref={dialogRef} className="modal-sheet gym-template-modal" role="dialog" aria-modal="true" aria-labelledby="gym-template-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">Trainingsplan</p><h2 id="gym-template-title">{template ? 'Einheit bearbeiten' : 'Einheit anlegen'}</h2></div>
          <button type="button" className="mini-action" onClick={requestClose} aria-label="Schließen"><X /></button>
        </div>
        <form className="gym-template-form gym-template-scroll" onSubmit={submit}>
          <label><span>Name der Einheit</span><input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Oberkörper" autoFocus /></label>
          <div className="gym-form-heading"><strong>Übungen</strong><span>{exercises.length}/30</span></div>
          <div className="gym-exercise-builder">
            {exercises.map((exercise, index) => (
              <fieldset key={exercise.id} className="gym-builder-card">
                <legend>Übung {index + 1}</legend>
                <div className="gym-builder-actions">
                  <button type="button" aria-label={`Übung ${index + 1} nach oben`} disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp /></button>
                  <button type="button" aria-label={`Übung ${index + 1} nach unten`} disabled={index === exercises.length - 1} onClick={() => move(index, 1)}><ChevronDown /></button>
                  <button type="button" className="danger" aria-label={`Übung ${index + 1} entfernen`} onClick={() => setExercises(exercises.filter((item) => item.id !== exercise.id))}><Trash2 /></button>
                </div>
                <label className="gym-name-field"><span>Name</span><input required maxLength={80} value={exercise.name} onChange={(event) => setExercises(exercises.map((item) => item.id === exercise.id ? { ...item, name: event.target.value } : item))} placeholder="Bankdrücken" /></label>
                <div className="gym-number-row">
                  <label><span>Sätze</span><input required type="number" inputMode="numeric" min="1" max="20" value={exercise.sets} onChange={(event) => setExercises(exercises.map((item) => item.id === exercise.id ? { ...item, sets: event.target.value } : item))} /></label>
                  <label><span>Wdh.</span><input required type="text" inputMode="text" autoComplete="off" value={exercise.reps} aria-label={`${exercise.name || `Übung ${index + 1}`} Wiederholungsvorgabe`} placeholder="8–12" onChange={(event) => setExercises(exercises.map((item) => item.id === exercise.id ? { ...item, reps: event.target.value } : item))} onBlur={() => {
                    const target = parseRepTarget(exercise.reps)
                    if (target) setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, reps: formatRepTarget(target.min, target.max) } : item))
                  }} /></label>
                </div>
              </fieldset>
            ))}
          </div>
          <button type="button" className="outline-button full" disabled={exercises.length >= 30} onClick={() => setExercises([...exercises, exerciseDraft()])}><Plus /> Übung hinzufügen</button>
          {formError && <p className="gym-form-error" role="alert">{formError}</p>}
          <button type="submit" className="primary-button full gym-template-save"><Check /> Einheit speichern</button>
        </form>
      </section>
    </div>,
    document.body,
  )
}

function TrainingConfirmDialog({ mode, template, isPending = false, onConfirm, onCancel }: {
  mode: 'start' | 'finish'
  template: { name: string; exercises: readonly unknown[] }
  isPending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  )

  useEffect(() => {
    confirmRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!isPending) onCancel()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (!focusable.length) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isPending, onCancel])

  useEffect(() => {
    const returnFocus = returnFocusRef.current
    return () => returnFocus?.focus()
  }, [])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !isPending && onCancel()}>
      <section ref={dialogRef} className="modal-sheet gym-start-modal" role="dialog" aria-modal="true" aria-labelledby={`gym-${mode}-title`} aria-describedby={`gym-${mode}-description`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="gym-start-mark" aria-hidden="true"><Dumbbell /></div>
        <p className="eyebrow">{mode === 'start' ? 'Bereit fürs Training?' : 'Alles geschafft?'}</p>
        <h2 id={`gym-${mode}-title`}>{mode === 'start' ? `${template.name} starten` : 'Training beenden'}</h2>
        <p id={`gym-${mode}-description`}>{mode === 'start'
          ? `Heute stehen ${template.exercises.length} ${template.exercises.length === 1 ? 'Übung' : 'Übungen'} auf deinem Plan.`
          : `${template.name} wird mit deinen aktuellen Werten gespeichert.`}</p>
        <div className="gym-start-actions">
          <button ref={confirmRef} type="button" className="primary-button" disabled={isPending} onClick={onConfirm}>
            {mode === 'start' ? <>Training starten <ArrowRight /></> : <><Check /> {isPending ? 'Wird gespeichert …' : 'Training beenden'}</>}
          </button>
          <button type="button" className="link-button" disabled={isPending} onClick={onCancel}>{mode === 'start' ? 'Abbrechen' : 'Weiter trainieren'}</button>
        </div>
      </section>
    </div>
  )
}

function validTrainingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > todayKey()) return false
  const parsed = new Date(`${value}T12:00:00`)
  return !Number.isNaN(parsed.getTime()) && parsed.toLocaleDateString('sv-SE') === value
}

function loadGymDraft(storageKey: string): GymSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isGymSession(parsed) && validTrainingDate(parsed.date) ? parsed : null
  } catch {
    return null
  }
}

function historicalSetsByNumber(exercise: GymSessionExercise) {
  if (exercise.performedSets === undefined) {
    return new Map(Array.from({ length: exercise.sets }, (_, index) => {
      const setNumber = index + 1
      return [setNumber, {
        id: legacyGymSetId(exercise.id, setNumber), setNumber,
        ...(exercise.weightKg === undefined ? {} : { weightKg: exercise.weightKg }),
        reps: exercise.reps,
      } satisfies GymSessionSet] as const
    }))
  }
  const normalized = new Map<number, GymSessionSet>()
  const candidates = [...exercise.performedSets].sort((a, b) => a.setNumber - b.setNumber || a.id.localeCompare(b.id))
  for (const set of candidates) {
    if (!Number.isInteger(set.setNumber) || set.setNumber < 1 || set.setNumber > exercise.sets || normalized.has(set.setNumber)) continue
    normalized.set(set.setNumber, set)
  }
  return normalized
}

function setsForExercise(exercise: GymSessionExercise): GymSessionSet[] {
  const recorded = historicalSetsByNumber(exercise)
  return Array.from({ length: exercise.sets }, (_, index) => {
    const setNumber = index + 1
    return recorded.get(setNumber) ?? {
      id: legacyGymSetId(exercise.id, setNumber), setNumber, reps: exercise.reps,
    }
  })
}

function sessionWithIndividualSets(session: GymSession): GymSession {
  return { ...session, exercises: session.exercises.map((exercise) => ({ ...exercise, performedSets: setsForExercise(exercise) })) }
}

function loadExpandedExercises(storageKey: string, session: GymSession | null) {
  if (!session) return new Set<string>()
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(`${storageKey}-expanded`) ?? 'null')
    const exerciseIds = new Set(session.exercises.map((exercise) => exercise.id))
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string' && exerciseIds.has(id))) return new Set(parsed)
  } catch { /* use initial default */ }
  return new Set(session.exercises[0] ? [session.exercises[0].id] : [])
}

function loadRepsInputs(storageKey: string, session: GymSession | null) {
  if (!session) return {}
  const fallback = Object.fromEntries(session.exercises.flatMap((exercise) =>
    setsForExercise(exercise).map((set) => [set.id, String(set.reps)])))
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(`${storageKey}-reps`) ?? 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
    const setIds = new Set(session.exercises.flatMap((exercise) => setsForExercise(exercise).map((set) => set.id)))
    const entries = Object.entries(parsed)
    if (entries.some(([id, value]) => !setIds.has(id) || typeof value !== 'string')) return fallback
    return { ...fallback, ...Object.fromEntries(entries) }
  } catch {
    return fallback
  }
}

function validSetWeightInput(value: string) {
  if (value === '') return true
  const parsed = parseDecimalInput(value)
  return parsed !== undefined && parsed >= 0 && parsed <= 1000
}

function validSetRepsInput(value: string) {
  if (!/^\d+$/.test(value)) return false
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100
}

function validDraftExercise(exercise: GymSessionExercise, weightInputs: Record<string, string>, repsInputs: Record<string, string>) {
  return Number.isInteger(exercise.sets) && exercise.sets >= 1 && exercise.sets <= 20 &&
    setsForExercise(exercise).length === exercise.sets && setsForExercise(exercise).every((set) =>
      Number.isInteger(set.setNumber) && Number.isInteger(set.reps) && set.reps >= 0 && set.reps <= 100 &&
      (set.weightKg === undefined || (Number.isFinite(set.weightKg) && set.weightKg >= 0 && set.weightKg <= 1000)) &&
      validSetWeightInput(weightInputs[set.id] ?? formatDecimalInput(set.weightKg)) &&
      validSetRepsInput(repsInputs[set.id] ?? String(set.reps)))
}

function plannedReps(exercise: GymSessionExercise) {
  return formatRepTarget(exercise.targetReps ?? exercise.reps, exercise.targetRepsMax)
}

function normalizeExerciseName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE')
}

function latestExercisesByTemplateId(sessions: GymSession[], before: string) {
  const previous = new Map<string, GymSessionExercise>()
  const candidates = sessions
    .filter((session) => Date.parse(session.completedAt) < Date.parse(before))
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || b.date.localeCompare(a.date) || b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
  for (const session of candidates) {
    for (const exercise of session.exercises) {
      const exerciseId = exercise.exerciseId ?? exercise.templateExerciseId
      if (exerciseId && !previous.has(exerciseId)) previous.set(exerciseId, exercise)
    }
  }
  return previous
}

function MergeExerciseDialog({ source, library, templates, sessions, onConfirm, onCancel }: {
  source: GymExercise
  library: GymExercise[]
  templates: GymTemplate[]
  sessions: GymSession[]
  onConfirm: (targetId: string) => void
  onCancel: () => void
}) {
  const targets = library.filter((exercise) => exercise.id !== source.id && !templates.some((template) => {
    const ids = new Set(template.exercises.map((item) => item.exerciseId))
    return ids.has(source.id) && ids.has(exercise.id)
  }))
  const hasTargets = targets.length > 0
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '')
  const target = targets.find((exercise) => exercise.id === targetId)
  const sourcePlans = templates.filter((template) => template.exercises.some((exercise) => exercise.exerciseId === source.id)).map((template) => template.name)
  const historyCount = sessions.reduce((count, session) => count + session.exercises.filter((exercise) => exercise.exerciseId === source.id).length, 0)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  useEffect(() => {
    const returnFocus = returnFocusRef.current
    ;(hasTargets ? confirmRef.current : closeRef.current)?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled])'))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown); returnFocus?.focus() }
  }, [hasTargets, onCancel])
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section ref={dialogRef} className="modal-sheet gym-library-merge" role="dialog" aria-modal="true" aria-labelledby="gym-merge-title" aria-describedby="gym-merge-impact">
        <div className="modal-head"><div><p className="eyebrow">Übungen verbinden</p><h2 id="gym-merge-title">„{source.name}“ zusammenführen</h2></div><button ref={closeRef} type="button" className="mini-action" onClick={onCancel} aria-label="Schließen"><X /></button></div>
        <label><span>Zielübung</span><select value={targetId} disabled={!targets.length} onChange={(event) => setTargetId(event.target.value)}>{targets.length ? targets.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>) : <option value="">Keine zulässige Zielübung</option>}</select></label>
        {targets.length ? <p id="gym-merge-impact">Alle Verwendungen von „{source.name}“ werden auf „{target?.name ?? '–'}“ umgestellt. Betroffene Einheiten: {sourcePlans.length ? sourcePlans.join(', ') : 'keine'}. {historyCount} historische {historyCount === 1 ? 'Eintrag bleibt' : 'Einträge bleiben'} erhalten. Das Verbinden kann derzeit nicht rückgängig gemacht oder wieder getrennt werden.</p>
          : <p id="gym-merge-impact">Keine zulässige Zielübung verfügbar. Alle anderen Übungen werden bereits gemeinsam mit „{source.name}“ in derselben Einheit verwendet und können deshalb nicht verbunden werden.</p>}
        <button ref={confirmRef} type="button" className="primary-button full" disabled={!target} onClick={() => target && onConfirm(target.id)}><Link2 /> Endgültig verbinden</button>
        <button type="button" className="link-button full" onClick={onCancel}>Abbrechen</button>
      </section>
    </div>, document.body,
  )
}

function exerciseWeightSummary(exercise: GymSessionExercise) {
  const weights = setsForExercise(exercise).map((set) => set.weightKg)
  if (weights.every((weight) => weight === undefined)) return 'Gewicht offen'
  const defined = weights.filter((weight): weight is number => weight !== undefined)
  if (defined.length === weights.length && new Set(defined).size === 1) return `${defined[0]!.toLocaleString('de-DE')} kg`
  const values = weights.map((weight) => weight === undefined ? '–' : weight.toLocaleString('de-DE'))
  const compact = values.length <= 4 ? values.join(' / ') : `${values.slice(0, 3).join(' / ')} / …`
  return `${compact} kg`
}

type GymHistoryWeek = { key: string; label: string; sessions: GymSession[] }
type GymHistoryMonth = { key: string; label: string; weeks: GymHistoryWeek[] }
type GymHistoryYear = { key: string; months: GymHistoryMonth[] }

function groupGymHistory(sessions: GymSession[]): GymHistoryYear[] {
  const years: GymHistoryYear[] = []
  for (const session of sessions) {
    const group = historyDateGroup(session.date)
    let year = years.at(-1)
    if (year?.key !== group.calendarYear) {
      year = { key: group.calendarYear, months: [] }
      years.push(year)
    }
    let month = year.months.at(-1)
    if (month?.key !== group.monthKey) {
      month = { key: group.monthKey, label: group.monthLabel, weeks: [] }
      year.months.push(month)
    }
    let week = month.weeks.at(-1)
    if (week?.key !== group.isoWeekKey) {
      week = { key: group.isoWeekKey, label: group.isoWeekLabel, sessions: [] }
      month.weeks.push(week)
    }
    week.sessions.push(session)
  }
  return years
}

function defaultOpenHistoryMonth(sessions: GymSession[], currentDate = todayKey()) {
  const currentMonth = currentDate.slice(0, 7)
  if (sessions.some((session) => session.date.slice(0, 7) === currentMonth)) return currentMonth
  return sessions.reduce<string | null>((latest, session) => {
    const month = session.date.slice(0, 7)
    return latest === null || month > latest ? month : latest
  }, null)
}

function exerciseHistoryKey(exercise: GymSessionExercise) {
  return exercise.exerciseId ?? exercise.templateExerciseId
}

function gymSessionCompletionTime(session: GymSession) {
  const completed = Date.parse(session.completedAt)
  if (Number.isFinite(completed)) return completed
  const started = Date.parse(session.startedAt)
  if (Number.isFinite(started)) return started
  return Date.parse(`${session.date}T23:59:59`)
}

function exerciseWeightIncreased(current: GymSessionExercise, previous: GymSessionExercise) {
  const currentSets = historicalSetsByNumber(current)
  const previousSets = historicalSetsByNumber(previous)
  const comparableSetCount = Math.min(current.sets, previous.sets)
  if (comparableSetCount < 1) return false
  let increased = false
  for (let setNumber = 1; setNumber <= comparableSetCount; setNumber++) {
    const currentWeight = currentSets.get(setNumber)?.weightKg
    const previousWeight = previousSets.get(setNumber)?.weightKg
    if (currentWeight === undefined || previousWeight === undefined || !Number.isFinite(currentWeight) || !Number.isFinite(previousWeight)) return false
    if (currentWeight < previousWeight) return false
    if (currentWeight > previousWeight) increased = true
  }
  return increased
}

function historicalWeightIncreases(sessions: GymSession[]) {
  const increased = new Set<string>()
  const previousByExercise = new Map<string, GymSessionExercise>()
  const chronological = [...sessions].sort((a, b) =>
    a.date.localeCompare(b.date) || gymSessionCompletionTime(a) - gymSessionCompletionTime(b) || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
  for (const session of chronological) {
    const updates = new Map<string, GymSessionExercise>()
    for (const exercise of session.exercises) {
      const key = exerciseHistoryKey(exercise)
      if (!key) continue
      const previous = previousByExercise.get(key)
      if (previous && exerciseWeightIncreased(exercise, previous)) increased.add(`${session.id}\u0000${exercise.id}`)
      updates.set(key, exercise)
    }
    for (const [key, exercise] of updates) previousByExercise.set(key, exercise)
  }
  return increased
}

export default function GymView({ data, onChange, draftStorageKey = GYM_DRAFT_STORAGE_KEY, onEditorDirtyChange }: GymViewProps) {
  const library = useMemo<GymExercise[]>(() => data.gymExercises?.length ? data.gymExercises : data.gymTemplates.flatMap((template) => template.exercises.map((exercise) => ({
    id: exercise.exerciseId ?? exercise.id, name: exercise.name, createdAt: template.createdAt, updatedAt: template.updatedAt,
  }))), [data.gymExercises, data.gymTemplates])
  const initialDraft = useMemo(() => loadGymDraft(draftStorageKey), [draftStorageKey])
  const [draft, setDraft] = useState<GymSession | null>(() => initialDraft && sessionWithIndividualSets(initialDraft))
  const [setWeightInputs, setSetWeightInputs] = useState<Record<string, string>>(() => Object.fromEntries(
    initialDraft?.exercises.flatMap((exercise) => setsForExercise(exercise).map((set) => [set.id, formatDecimalInput(set.weightKg)])) ?? [],
  ))
  const [setRepsInputs, setSetRepsInputs] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(loadRepsInputs(draftStorageKey, initialDraft)),
  ))
  const [repsValidationRequested, setRepsValidationRequested] = useState<Set<string>>(new Set())
  const [expandedExerciseIds, setExpandedExerciseIds] = useState<Set<string>>(() => loadExpandedExercises(draftStorageKey, initialDraft))
  const [editingTemplate, setEditingTemplate] = useState<GymTemplate | 'new' | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<GymTemplate | null>(null)
  const [view, setView] = useState<'landing' | 'history' | 'manage' | 'library'>('landing')
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [openHistoryMonths, setOpenHistoryMonths] = useState<Set<string>>(() => {
    const defaultMonth = defaultOpenHistoryMonth(data.gymSessions)
    return new Set(defaultMonth ? [defaultMonth] : [])
  })
  const currentHistoryMonth = todayKey().slice(0, 7)
  const currentHistoryMonthAvailable = data.gymSessions.some((session) => session.date.slice(0, 7) === currentHistoryMonth)
  const hadCurrentHistoryMonthRef = useRef(currentHistoryMonthAvailable)
  const [finishRequested, setFinishRequested] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const completingRef = useRef(false)
  const activeTitleRef = useRef<HTMLHeadingElement>(null)
  const activeSessionId = draft?.id
  const draftValid = Boolean(draft && validTrainingDate(draft.date) && !Number.isNaN(Date.parse(draft.startedAt)) && draft.exercises.length > 0 &&
    draft.exercises.every((exercise) => validDraftExercise(exercise, setWeightInputs, setRepsInputs)))

  useEffect(() => {
    if (draft) sessionStorage.setItem(draftStorageKey, JSON.stringify(draft))
    else sessionStorage.removeItem(draftStorageKey)
  }, [draft, draftStorageKey])

  useEffect(() => {
    const key = `${draftStorageKey}-expanded`
    if (draft) sessionStorage.setItem(key, JSON.stringify([...expandedExerciseIds]))
    else sessionStorage.removeItem(key)
  }, [draft, draftStorageKey, expandedExerciseIds])

  useEffect(() => {
    const key = `${draftStorageKey}-reps`
    if (draft) sessionStorage.setItem(key, JSON.stringify(setRepsInputs))
    else sessionStorage.removeItem(key)
  }, [draft, draftStorageKey, setRepsInputs])

  useEffect(() => {
    if (activeSessionId) activeTitleRef.current?.focus()
  }, [activeSessionId])

  useEffect(() => {
    if (currentHistoryMonthAvailable && !hadCurrentHistoryMonthRef.current) {
      setOpenHistoryMonths((current) => new Set([...current, currentHistoryMonth]))
    }
    hadCurrentHistoryMonthRef.current = currentHistoryMonthAvailable
  }, [currentHistoryMonth, currentHistoryMonthAvailable])

  const requestStart = (template: GymTemplate) => {
    if (template.exercises.length === 0) {
      setView('manage')
      setEditingTemplate(template)
      return
    }
    setPendingTemplate(template)
  }

  const start = () => {
    if (!pendingTemplate) return
    const startedAt = new Date().toISOString()
    const template = pendingTemplate
    const previousByExercise = latestExercisesByTemplateId(data.gymSessions, startedAt)
    setPendingTemplate(null)
    const exercises = template.exercises.map((exercise): GymSessionExercise => {
      const id = makeId('gym-session-exercise')
      const canonicalId = exercise.exerciseId ?? exercise.id
      const previous = previousByExercise.get(canonicalId)
      const previousSets = previous ? historicalSetsByNumber(previous) : undefined
      const performedSets = Array.from({ length: exercise.sets }, (_, index): GymSessionSet => {
        const previousSet = previousSets?.get(index + 1)
        const weightKg = previous
          ? previousSet?.weightKg
          : exercise.targetWeightKg
        return {
          id: makeId('gym-session-set'), setNumber: index + 1,
          ...(weightKg === undefined ? {} : { weightKg }),
          reps: exercise.targetReps,
        }
      })
      const firstWeight = performedSets[0]?.weightKg
      return {
        id,
        templateExerciseId: exercise.id,
        exerciseId: canonicalId,
        name: exercise.name,
        sets: exercise.sets,
        ...(firstWeight === undefined ? {} : { weightKg: firstWeight }),
        reps: exercise.targetReps,
        targetReps: exercise.targetReps,
        ...(exercise.targetRepsMax === undefined ? {} : { targetRepsMax: exercise.targetRepsMax }),
        position: exercise.position,
        performedSets,
      }
    })
    setSetWeightInputs(Object.fromEntries(exercises.flatMap((exercise) => setsForExercise(exercise).map((set) => [set.id, formatDecimalInput(set.weightKg)]))))
    setSetRepsInputs(Object.fromEntries(exercises.flatMap((exercise) => setsForExercise(exercise).map((set) => [set.id, '']))))
    setRepsValidationRequested(new Set())
    setExpandedExerciseIds(new Set(exercises[0] ? [exercises[0].id] : []))
    setDraft({
      id: makeId('gym-session'),
      templateId: template.id,
      templateName: template.name,
      date: todayKey(),
      startedAt,
      completedAt: startedAt,
      exercises,
    })
  }

  const updateSet = (exerciseId: string, setId: string, values: Partial<GymSessionSet>) => {
    if (!draft) return
    setDraft({ ...draft, exercises: draft.exercises.map((exercise) => {
      if (exercise.id !== exerciseId) return exercise
      const performedSets = setsForExercise(exercise).map((set) => set.id === setId ? { ...set, ...values } : set)
      const first = performedSets[0]!
      return { ...exercise, performedSets, reps: first.reps, ...(first.weightKg === undefined ? { weightKg: undefined } : { weightKg: first.weightKg }) }
    }) })
  }

  const updateExercise = (exerciseId: string, values: Partial<GymSessionExercise>) => {
    if (!draft) return
    setDraft({ ...draft, exercises: draft.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, ...values } : exercise) })
  }

  const complete = () => {
    if (!draft || !draftValid || Date.parse(draft.startedAt) > Date.now() || completingRef.current) return
    completingRef.current = true
    setIsCompleting(true)
    const completed = { ...draft, completedAt: new Date().toISOString() }
    if (!isGymSession(completed)) {
      completingRef.current = false
      setIsCompleting(false)
      return
    }
    const accepted = onChange({ ...data, gymSessions: [...data.gymSessions, completed] })
    if (accepted === false) {
      completingRef.current = false
      setIsCompleting(false)
      return
    }
    setFinishRequested(false)
    setDraft(null)
    sessionStorage.removeItem(draftStorageKey)
    sessionStorage.removeItem(`${draftStorageKey}-expanded`)
    sessionStorage.removeItem(`${draftStorageKey}-reps`)
    window.setTimeout(() => {
      completingRef.current = false
      setIsCompleting(false)
    }, 0)
  }

  const saveTemplate = (template: GymTemplate) => {
    const now = new Date().toISOString()
    const names = new Map(template.exercises.map((exercise) => [exercise.exerciseId!, exercise.name]))
    const gymExercises = [...library]
    const mutations: GymMutationIntent[] = []
    for (const exercise of template.exercises) {
      const index = gymExercises.findIndex((item) => item.id === exercise.exerciseId)
      if (index >= 0) {
        const existing = gymExercises[index]!
        if (existing.name !== exercise.name) {
          mutations.push({ kind: 'gym.exercise.rename', exerciseId: existing.id, expectedName: existing.name, expectedUpdatedAt: existing.updatedAt, name: exercise.name, updatedAt: now })
          gymExercises[index] = { ...existing, name: exercise.name, updatedAt: now }
        }
      }
      else gymExercises.push({ id: exercise.exerciseId!, name: exercise.name, createdAt: now, updatedAt: now })
    }
    const nextTemplate = { ...template, exercises: template.exercises.map((exercise) => ({ ...exercise, name: names.get(exercise.exerciseId!)! })) }
    mutations.push({ kind: 'gym.template.upsert', template: nextTemplate })
    const accepted = onChange({
      ...data, gymExercises,
      gymTemplates: data.gymTemplates.some((item) => item.id === template.id)
        ? data.gymTemplates.map((item) => item.id === template.id ? nextTemplate : item)
        : [...data.gymTemplates, nextTemplate],
    }, mutations)
    if (accepted === false) return
    setEditingTemplate(null)
  }
  const mergeExercises = (sourceId: string, targetId: string) => {
    const source = library.find((exercise) => exercise.id === sourceId)
    const target = library.find((exercise) => exercise.id === targetId)
    if (!source || !target) return
    const next = {
      ...data,
      gymExercises: library.filter((exercise) => exercise.id !== sourceId),
      gymTemplates: data.gymTemplates.map((template) => ({ ...template, exercises: template.exercises.map((exercise) => exercise.exerciseId === sourceId ? { ...exercise, exerciseId: targetId, name: target.name } : exercise) })),
      gymSessions: data.gymSessions.map((session) => ({ ...session, exercises: session.exercises.map((exercise) => exercise.exerciseId === sourceId ? { ...exercise, exerciseId: targetId, name: target.name } : exercise) })),
    }
    if (onChange(next, [{ kind: 'gym.exercise.merge', sourceExerciseId: sourceId, targetExerciseId: targetId, expectedSourceName: source.name, expectedTargetName: target.name }]) !== false) setMergeSourceId(null)
  }

  const removeTemplate = (template: GymTemplate) => {
    if (!window.confirm(`„${template.name}“ löschen? Bereits absolvierte Trainings bleiben erhalten.`)) return
    onChange({ ...data, gymTemplates: data.gymTemplates.filter((item) => item.id !== template.id) })
  }
  const removeSession = (session: GymSession) => {
    if (!window.confirm(`Training „${session.templateName}“ vom ${formatShortDate(session.date)} löschen?`)) return
    const accepted = onChange({ ...data, gymSessions: data.gymSessions.filter((item) => item.id !== session.id) })
    if (accepted !== false && expandedSessionId === session.id) setExpandedSessionId(null)
  }
  const closeTemplate = useCallback(() => setEditingTemplate(null), [])
  const sortedSessions = useMemo(() => [...data.gymSessions].sort((a, b) =>
    b.date.localeCompare(a.date) || gymSessionCompletionTime(b) - gymSessionCompletionTime(a) || b.id.localeCompare(a.id)), [data.gymSessions])
  const historyGroups = useMemo(() => groupGymHistory(sortedSessions), [sortedSessions])
  const weightIncreases = useMemo(() => historicalWeightIncreases(data.gymSessions), [data.gymSessions])
  const previousByTemplateExercise = useMemo(() => {
    return latestExercisesByTemplateId([...data.gymSessions], draft?.startedAt ?? new Date().toISOString())
  }, [data.gymSessions, draft])

  const toggleExercise = (exerciseId: string) => {
    setExpandedExerciseIds((current) => {
      const next = new Set(current)
      if (next.has(exerciseId)) next.delete(exerciseId)
      else next.add(exerciseId)
      return next
    })
  }

  const toggleHistoryMonth = (monthKey: string) => {
    setOpenHistoryMonths((current) => {
      const next = new Set(current)
      if (next.has(monthKey)) next.delete(monthKey)
      else next.add(monthKey)
      return next
    })
  }

  const requestFinish = () => {
    const invalidExercise = draft?.exercises.find((exercise) => !validDraftExercise(exercise, setWeightInputs, setRepsInputs))
    if (invalidExercise) {
      setRepsValidationRequested((current) => new Set([...current, invalidExercise.id]))
      setExpandedExerciseIds((current) => new Set([...current, invalidExercise.id]))
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-exercise-id="${invalidExercise.id}"] [aria-invalid="true"], [data-exercise-id="${invalidExercise.id}"] input:invalid`)?.focus(), 0)
      return
    }
    if (draftValid) setFinishRequested(true)
  }

  return (
    <section className="view gym-view">
      {!draft && view === 'landing' && (
        <>
          <header className="page-intro gym-landing-head">
            <button type="button" className="round-action" onClick={() => setView('history')} aria-label="Trainingsverlauf öffnen"><Eye /></button>
            <div><p className="eyebrow">Dein Training</p><h1>GYM</h1></div>
            <button type="button" className="round-action" onClick={() => setView('manage')} aria-label="Einheiten verwalten"><Pencil /></button>
          </header>
          <div className="gym-split-grid" aria-label="Training auswählen">
            {data.gymTemplates.map((template) => (
              <button type="button" className="gym-split-card gym-split-start" key={template.id} onClick={() => requestStart(template)} aria-label={template.exercises.length ? `${template.name} starten` : `${template.name} bearbeiten`} aria-haspopup={template.exercises.length ? 'dialog' : undefined}>
                  <span className="gym-split-icon"><Dumbbell /></span>
                  <strong>{template.name}</strong>
                  <small>{template.exercises.length ? `${template.exercises.length} ${template.exercises.length === 1 ? 'Übung' : 'Übungen'}` : 'Plan eintragen'}</small>
              </button>
            ))}
            {data.gymTemplates.length === 0 && <div className="empty-state compact"><Dumbbell /><h2>Noch keine Einheit</h2><p>Lege in der Verwaltung deinen ersten Trainingsplan an.</p></div>}
          </div>
        </>
      )}

      {!draft && view === 'history' && (
        <section className="gym-subview" aria-labelledby="gym-history-title">
          <header className="gym-subview-head">
            <button type="button" className="round-action" onClick={() => setView('landing')} aria-label="Zurück zu GYM"><ArrowLeft /></button>
            <div><p className="eyebrow">Absolvierte Einheiten</p><h1 id="gym-history-title">Verlauf</h1></div>
            <span aria-hidden="true" />
          </header>
          <div className="gym-history-list">
            {historyGroups.map((year) => (
              <section className="gym-history-year" key={year.key} aria-labelledby={`gym-history-year-${year.key}`}>
                <h2 id={`gym-history-year-${year.key}`}>{year.key}</h2>
                {year.months.map((month) => {
                  const expanded = openHistoryMonths.has(month.key)
                  const sessionCount = month.weeks.reduce((count, week) => count + week.sessions.length, 0)
                  const contentId = `gym-history-month-content-${month.key}`
                  return (
                  <section className={`gym-history-month${expanded ? ' is-expanded' : ''}`} key={month.key} aria-labelledby={`gym-history-month-${month.key}`}>
                    <h3 className="gym-history-month-heading" id={`gym-history-month-${month.key}`} aria-label={month.label}>
                      <button type="button" className="gym-history-month-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => toggleHistoryMonth(month.key)}>
                        <span className="gym-history-month-name">{month.label}</span>
                        <span className="gym-history-month-count">{sessionCount} {sessionCount === 1 ? 'Einheit' : 'Einheiten'}</span>
                        {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                      </button>
                    </h3>
                    <div className="gym-history-month-content" id={contentId} hidden={!expanded}>
                    {month.weeks.map((week) => (
                      <section className="gym-history-week" key={`${month.key}-${week.key}`} aria-labelledby={`gym-history-week-${month.key}-${week.key}`}>
                        <div className="gym-history-week-head">
                          <h4 id={`gym-history-week-${month.key}-${week.key}`}>{week.label}</h4>
                          <span>{week.sessions.length} {week.sessions.length === 1 ? 'Einheit' : 'Einheiten'}</span>
                        </div>
                        <div className="gym-history-week-list">
                          {week.sessions.map((session) => {
                            const expanded = expandedSessionId === session.id
                            return (
                              <article className="gym-history-card" key={session.id}>
                                <button type="button" className="gym-history-summary" aria-expanded={expanded} onClick={() => setExpandedSessionId(expanded ? null : session.id)}>
                                  <time dateTime={session.date}>{formatShortDate(session.date)}</time>
                                  <span><strong>{session.templateName}</strong><small>{session.exercises.length} {session.exercises.length === 1 ? 'Übung' : 'Übungen'}</small></span>
                                  {expanded ? <ChevronUp /> : <ChevronDown />}
                                </button>
                                {expanded && (
                                  <div className="gym-history-details">
                                    {session.exercises.map((exercise) => {
                                      const didIncrease = weightIncreases.has(`${session.id}\u0000${exercise.id}`)
                                      return (
                                        <div className="gym-history-exercise" key={exercise.id}>
                                          <div className="gym-history-exercise-title">
                                            <strong>{exercise.name}</strong>
                                            {didIncrease && <span className="gym-history-increase" title="Gewicht gegenüber dem vorherigen Training gesteigert"><TrendingUp aria-hidden="true" /><span>Gesteigert</span></span>}
                                          </div>
                                          <div className="gym-history-sets">
                                            {Array.from({ length: exercise.sets }, (_, index) => {
                                              const setNumber = index + 1
                                              const set = historicalSetsByNumber(exercise).get(setNumber)
                                              return <span key={set?.id ?? legacyGymSetId(exercise.id, setNumber)}><b>Satz {setNumber}</b>{set ? <>{set.weightKg === undefined ? 'Nicht erfasst' : `${set.weightKg.toLocaleString('de-DE')} kg`} · {set.reps} Wdh.</> : 'Nicht erfasst'}</span>
                                            })}
                                          </div>
                                        </div>
                                      )
                                    })}
                                    <button type="button" className="link-button danger" onClick={() => removeSession(session)}><Trash2 /> Training löschen</button>
                                  </div>
                                )}
                              </article>
                            )
                          })}
                        </div>
                      </section>
                    ))}
                    </div>
                  </section>
                  )
                })}
              </section>
            ))}
            {sortedSessions.length === 0 && <div className="empty-state compact"><Dumbbell /><h2>Noch kein Training</h2><p>Deine abgeschlossenen Einheiten erscheinen hier.</p></div>}
          </div>
        </section>
      )}

      {!draft && view === 'manage' && (
        <section className="gym-subview" aria-labelledby="gym-manage-title">
          <header className="gym-subview-head">
            <button type="button" className="round-action" onClick={() => setView('landing')} aria-label="Zurück zu GYM"><ArrowLeft /></button>
            <div><p className="eyebrow">Trainingspläne</p><h1 id="gym-manage-title">Einheiten</h1></div>
            <button type="button" className="round-action" onClick={() => setEditingTemplate('new')} aria-label="Einheit hinzufügen"><Plus /></button>
          </header>
          <button type="button" className="outline-button full gym-library-open" onClick={() => setView('library')}><BookOpen /> Übungsbibliothek</button>
          <div className="gym-manage-list">
            {data.gymTemplates.map((template) => (
              <article className="gym-manage-card" key={template.id}>
                <span className="gym-split-icon"><Dumbbell /></span>
                <div><strong>{template.name}</strong><small>{template.exercises.length} {template.exercises.length === 1 ? 'Übung' : 'Übungen'}</small></div>
                <button type="button" className="mini-action" onClick={() => setEditingTemplate(template)} aria-label={`${template.name} bearbeiten`}><Pencil /></button>
                <button type="button" className="mini-action danger" onClick={() => removeTemplate(template)} aria-label={`${template.name} löschen`}><Trash2 /></button>
              </article>
            ))}
            {data.gymTemplates.length === 0 && <div className="empty-state compact"><Dumbbell /><h2>Noch keine Einheit</h2><p>Lege deinen ersten Trainingsplan an.</p><button type="button" className="primary-button" onClick={() => setEditingTemplate('new')}><Plus /> Einheit anlegen</button></div>}
          </div>
        </section>
      )}

      {!draft && view === 'library' && (
        <section className="gym-subview" aria-labelledby="gym-library-title">
          <header className="gym-subview-head">
            <button type="button" className="round-action" onClick={() => setView('manage')} aria-label="Zurück zu Einheiten"><ArrowLeft /></button>
            <div><p className="eyebrow">Globale Übungen</p><h1 id="gym-library-title">Bibliothek</h1></div>
            <span aria-hidden="true" />
          </header>
          {library.some((exercise, index) => library.findIndex((candidate) => normalizeExerciseName(candidate.name) === normalizeExerciseName(exercise.name)) !== index) && <p className="gym-duplicate-note"><Link2 /> Namensgleiche Übungen gefunden – verbinde sie nur, wenn sie wirklich dieselbe Übung sind.</p>}
          <div className="gym-library-list">
            {library.map((exercise) => {
              const plans = data.gymTemplates.filter((template) => template.exercises.some((candidate) => (candidate.exerciseId ?? candidate.id) === exercise.id)).map((template) => template.name)
              const duplicate = library.some((candidate) => candidate.id !== exercise.id && normalizeExerciseName(candidate.name) === normalizeExerciseName(exercise.name))
              return <article className="gym-library-card" key={exercise.id}>
                <div><strong>{exercise.name}</strong><small>{plans.length ? plans.join(' · ') : 'In keiner aktuellen Einheit'}{duplicate ? ' · Duplikat-Vorschlag' : ''}</small></div>
                <button type="button" className="mini-action" disabled={library.length < 2} onClick={() => setMergeSourceId(exercise.id)} aria-label={`${exercise.name} mit anderer Übung verbinden`}><Link2 /></button>
              </article>
            })}
            {library.length === 0 && <div className="empty-state compact"><BookOpen /><h2>Noch keine Übungen</h2><p>Übungen erscheinen hier, sobald du sie einer Einheit hinzufügst.</p></div>}
          </div>
        </section>
      )}

      {draft && (
        <section className="gym-active-session" aria-label={`Aktives Training ${draft.templateName}`}>
          <div className="gym-session-head"><div><p>{formatShortDate(draft.date)}</p><h2 ref={activeTitleRef} tabIndex={-1}>{draft.templateName}</h2></div><span>Aktiv</span></div>
          <div className="gym-live-list">
            {draft.exercises.map((exercise, index) => (
              <article key={exercise.id} className={`gym-live-card${expandedExerciseIds.has(exercise.id) ? ' expanded' : ''}${exercise.completed ? ' completed' : ''}`} data-exercise-id={exercise.id}>
                <button type="button" className="gym-live-summary" aria-expanded={expandedExerciseIds.has(exercise.id)} aria-controls={`${exercise.id}-sets`} id={`${exercise.id}-summary`} onClick={() => toggleExercise(exercise.id)}>
                  <span className="gym-live-index" aria-hidden="true">{exercise.completed ? <Check /> : String(index + 1).padStart(2, '0')}</span>
                  <span className="gym-live-plan"><strong>{exercise.name}</strong><small>{exercise.sets} Sätze · {exerciseWeightSummary(exercise)} · {plannedReps(exercise)} Wdh.</small></span>
                  <span className="gym-live-toggle"><small>{expandedExerciseIds.has(exercise.id) ? 'Offen' : 'Sätze'}</small>{expandedExerciseIds.has(exercise.id) ? <ChevronUp /> : <ChevronDown />}</span>
                </button>
                <div className="gym-set-list" id={`${exercise.id}-sets`} role="region" aria-labelledby={`${exercise.id}-summary`} hidden={!expandedExerciseIds.has(exercise.id)}>
                  {(exercise.exerciseId ?? exercise.templateExerciseId) && previousByTemplateExercise.get((exercise.exerciseId ?? exercise.templateExerciseId)!)?.increaseNextTime && (
                    <p className="gym-progression-hint" role="status"><TrendingUp /> Letztes Mal vorgemerkt: Gewicht steigern</p>
                  )}
                  {setsForExercise(exercise).map((set) => {
                    const previousKey = exercise.exerciseId ?? exercise.templateExerciseId
                    const previous = previousKey ? previousByTemplateExercise.get(previousKey) : undefined
                    const previousSet = previous && historicalSetsByNumber(previous).get(set.setNumber)
                    const weightInput = setWeightInputs[set.id] ?? formatDecimalInput(set.weightKg)
                    const repsInput = setRepsInputs[set.id] ?? String(set.reps)
                    const weightInvalid = !validSetWeightInput(weightInput)
                    const repsInvalid = (repsInput !== '' || repsValidationRequested.has(exercise.id)) && !validSetRepsInput(repsInput)
                    const weightErrorId = `${set.id}-weight-error`
                    const repsErrorId = `${set.id}-reps-error`
                    return <div className="gym-set-row" key={set.id}>
                      <strong className="gym-set-badge">Satz {set.setNumber}</strong>
                      <label className={`gym-metric-control${weightInvalid ? ' invalid' : ''}`}><input aria-label={`${exercise.name} Satz ${set.setNumber} Gewicht`} type="text" inputMode="decimal" autoComplete="off" value={weightInput} aria-invalid={weightInvalid} aria-describedby={weightInvalid ? weightErrorId : undefined} onChange={(event) => {
                        const value = event.target.value
                        setSetWeightInputs((current) => ({ ...current, [set.id]: value }))
                        const parsed = parseDecimalInput(value)
                        if (value === '') updateSet(exercise.id, set.id, { weightKg: undefined })
                        else if (parsed !== undefined && parsed <= 1000) updateSet(exercise.id, set.id, { weightKg: parsed })
                      }} onBlur={() => {
                        if (validSetWeightInput(weightInput)) setSetWeightInputs((current) => ({ ...current, [set.id]: formatDecimalInput(set.weightKg) }))
                      }} placeholder="kg" />{weightInput !== '' && <span className="gym-metric-suffix" aria-hidden="true">kg</span>}</label>
                      <label className={`gym-metric-control reps${repsInvalid ? ' invalid' : ''}`}><input aria-label={`${exercise.name} Satz ${set.setNumber} Wiederholungen`} aria-invalid={repsInvalid} aria-describedby={repsInvalid ? repsErrorId : undefined} type="number" min="0" max="100" inputMode="numeric" value={repsInput} onChange={(event) => {
                        const value = event.target.value
                        setSetRepsInputs((current) => ({ ...current, [set.id]: value }))
                        if (validSetRepsInput(value)) updateSet(exercise.id, set.id, { reps: Number(value) })
                      }} /><span className="gym-metric-suffix" aria-hidden="true">Wdh.</span></label>
                      <div className="gym-set-feedback">
                        {weightInvalid && <small id={weightErrorId} className="gym-set-error" role="alert">Gewicht muss zwischen 0 und 1.000 kg liegen.</small>}
                        {repsInvalid && <small id={repsErrorId} className="gym-set-error" role="alert">Wiederholungen müssen zwischen 0 und 100 liegen.</small>}
                        {!weightInvalid && !repsInvalid && <small>{previousSet ? <>Letztes Mal: <b>{previousSet.weightKg === undefined ? 'Nicht erfasst' : `${previousSet.weightKg.toLocaleString('de-DE')} kg`} × {previousSet.reps}</b></> : 'Noch kein Vergleich'}</small>}
                      </div>
                    </div>
                  })}
                  <div className="gym-exercise-options" aria-label={`Optionen für ${exercise.name}`}>
                    <label><input type="checkbox" aria-label={`${exercise.name} als erledigt markieren`} checked={Boolean(exercise.completed)} onChange={(event) => {
                      if (!event.target.checked) { updateExercise(exercise.id, { completed: false }); return }
                      const invalidSet = setsForExercise(exercise).find((set) => !validSetRepsInput(setRepsInputs[set.id] ?? String(set.reps)))
                      if (invalidSet) {
                        setRepsValidationRequested((current) => new Set([...current, exercise.id]))
                        setExpandedExerciseIds((current) => new Set([...current, exercise.id]))
                        window.setTimeout(() => document.querySelector<HTMLElement>(`[data-exercise-id="${exercise.id}"] [aria-invalid="true"]`)?.focus(), 0)
                        return
                      }
                      updateExercise(exercise.id, { completed: true })
                    }} /><span><Check /> Übung erledigt</span></label>
                    <label><input type="checkbox" aria-label={`${exercise.name}: nächstes Mal Gewicht steigern`} checked={Boolean(exercise.increaseNextTime)} onChange={(event) => updateExercise(exercise.id, { increaseNextTime: event.target.checked })} /><span><TrendingUp /> Nächstes Mal steigern</span></label>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <button type="button" className="primary-button full gym-complete" disabled={isCompleting} aria-disabled={!draftValid || isCompleting} onClick={requestFinish}><Check /> Training beenden</button>
          <button type="button" className="link-button gym-cancel" onClick={() => { if (window.confirm('Aktuelles Training wirklich abbrechen?')) setDraft(null) }}>Training abbrechen</button>
        </section>
      )}

      {pendingTemplate && <TrainingConfirmDialog mode="start" template={pendingTemplate} onConfirm={start} onCancel={() => setPendingTemplate(null)} />}
      {draft && finishRequested && <TrainingConfirmDialog mode="finish" template={{ name: draft.templateName, exercises: draft.exercises }} isPending={isCompleting} onConfirm={complete} onCancel={() => setFinishRequested(false)} />}
      {editingTemplate && <TemplateEditor template={editingTemplate === 'new' ? undefined : editingTemplate} library={library} templates={data.gymTemplates} onSave={saveTemplate} onCancel={closeTemplate} onDirtyChange={onEditorDirtyChange} />}
      {mergeSourceId && library.find((exercise) => exercise.id === mergeSourceId) && <MergeExerciseDialog source={library.find((exercise) => exercise.id === mergeSourceId)!} library={library} templates={data.gymTemplates} sessions={data.gymSessions} onConfirm={(targetId) => mergeExercises(mergeSourceId, targetId)} onCancel={() => setMergeSourceId(null)} />}
    </section>
  )
}
