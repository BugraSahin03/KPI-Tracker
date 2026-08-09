import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Dumbbell, Eye, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { formatShortDate, todayKey } from './lib/date'
import { isGymSession, makeId } from './lib/storage'
import type { AppData, GymSession, GymSessionExercise, GymTemplate, GymTemplateExercise } from './types'

type GymViewProps = {
  data: AppData
  onChange: (data: AppData) => boolean | void
  draftStorageKey?: string
  onEditorDirtyChange?: (dirty: boolean) => void
}

export const GYM_DRAFT_STORAGE_KEY = 'pace-gym-active-draft-v1'

type ExerciseDraft = {
  id: string
  name: string
  sets: string
  weight: string
  reps: string
}

function exerciseDraft(exercise?: GymTemplateExercise): ExerciseDraft {
  return {
    id: exercise?.id ?? makeId('gym-exercise'),
    name: exercise?.name ?? '',
    sets: String(exercise?.sets ?? 3),
    weight: exercise?.targetWeightKg === undefined ? '' : String(exercise.targetWeightKg),
    reps: String(exercise?.targetReps ?? 10),
  }
}

function TemplateEditor({ template, onSave, onCancel, onDirtyChange }: {
  template?: GymTemplate
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
    exercises: template?.exercises.map(exerciseDraft) ?? [exerciseDraft()],
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

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const now = new Date().toISOString()
    const normalized: GymTemplateExercise[] = exercises.map((exercise, position) => ({
      id: exercise.id,
      name: exercise.name.trim(),
      sets: Number(exercise.sets),
      ...(exercise.weight === '' ? {} : { targetWeightKg: Number(exercise.weight) }),
      targetReps: Number(exercise.reps),
      position,
    }))
    const normalizedNames = normalized.map((exercise) => exercise.name.toLocaleLowerCase('de-DE'))
    if (!name.trim() || normalized.some((exercise) => !exercise.name)) return
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setFormError('Jede Übung darf pro Einheit nur einmal vorkommen.')
      return
    }
    if (normalized.some((exercise) => exercise.sets < 1 || exercise.sets > 20 || exercise.targetReps < 1 || exercise.targetReps > 100 || (exercise.targetWeightKg !== undefined && (exercise.targetWeightKg < 0 || exercise.targetWeightKg > 1000)))) {
      setFormError('Bitte prüfe Sätze, Gewicht und Wiederholungen.')
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

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section ref={dialogRef} className="modal-sheet gym-template-modal" role="dialog" aria-modal="true" aria-labelledby="gym-template-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">Trainingsplan</p><h2 id="gym-template-title">{template ? 'Einheit bearbeiten' : 'Einheit anlegen'}</h2></div>
          <button type="button" className="mini-action" onClick={requestClose} aria-label="Schließen"><X /></button>
        </div>
        <form className="gym-template-form" onSubmit={submit}>
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
                  <label><span>kg</span><input type="number" inputMode="decimal" min="0" max="1000" step="0.25" value={exercise.weight} onChange={(event) => setExercises(exercises.map((item) => item.id === exercise.id ? { ...item, weight: event.target.value } : item))} placeholder="BW" /></label>
                  <label><span>Wdh.</span><input required type="number" inputMode="numeric" min="1" max="100" value={exercise.reps} onChange={(event) => setExercises(exercises.map((item) => item.id === exercise.id ? { ...item, reps: event.target.value } : item))} /></label>
                </div>
              </fieldset>
            ))}
          </div>
          <button type="button" className="outline-button full" disabled={exercises.length >= 30} onClick={() => setExercises([...exercises, exerciseDraft()])}><Plus /> Übung hinzufügen</button>
          {formError && <p className="gym-form-error" role="alert">{formError}</p>}
          <button type="submit" className="primary-button full"><Check /> Einheit speichern</button>
        </form>
      </section>
    </div>
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

export default function GymView({ data, onChange, draftStorageKey = GYM_DRAFT_STORAGE_KEY, onEditorDirtyChange }: GymViewProps) {
  const initialDraft = useMemo(() => loadGymDraft(draftStorageKey), [draftStorageKey])
  const [draft, setDraft] = useState<GymSession | null>(initialDraft)
  const [editingTemplate, setEditingTemplate] = useState<GymTemplate | 'new' | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<GymTemplate | null>(null)
  const [view, setView] = useState<'landing' | 'history' | 'manage'>('landing')
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [finishRequested, setFinishRequested] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const completingRef = useRef(false)
  const activeTitleRef = useRef<HTMLHeadingElement>(null)
  const activeSessionId = draft?.id
  const draftValid = Boolean(draft && validTrainingDate(draft.date) && !Number.isNaN(Date.parse(draft.startedAt)) && draft.exercises.length > 0 && draft.exercises.every((exercise) =>
    Number.isInteger(exercise.sets) && exercise.sets >= 1 && exercise.sets <= 20 &&
    Number.isInteger(exercise.reps) && exercise.reps >= 1 && exercise.reps <= 100 &&
    (exercise.weightKg === undefined || (Number.isFinite(exercise.weightKg) && exercise.weightKg >= 0 && exercise.weightKg <= 1000))))

  useEffect(() => {
    if (draft) sessionStorage.setItem(draftStorageKey, JSON.stringify(draft))
    else sessionStorage.removeItem(draftStorageKey)
  }, [draft, draftStorageKey])

  useEffect(() => {
    if (activeSessionId) activeTitleRef.current?.focus()
  }, [activeSessionId])

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
    setPendingTemplate(null)
    setDraft({
      id: makeId('gym-session'),
      templateId: template.id,
      templateName: template.name,
      date: todayKey(),
      startedAt,
      completedAt: startedAt,
      exercises: template.exercises.map((exercise): GymSessionExercise => ({
        id: makeId('gym-session-exercise'),
        templateExerciseId: exercise.id,
        name: exercise.name,
        sets: exercise.sets,
        ...(exercise.targetWeightKg === undefined ? {} : { weightKg: exercise.targetWeightKg }),
        reps: exercise.targetReps,
        position: exercise.position,
      })),
    })
  }

  const updateExercise = (id: string, values: Partial<GymSessionExercise>) => {
    if (!draft) return
    setDraft({ ...draft, exercises: draft.exercises.map((exercise) => exercise.id === id ? { ...exercise, ...values } : exercise) })
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
    window.setTimeout(() => {
      completingRef.current = false
      setIsCompleting(false)
    }, 0)
  }

  const saveTemplate = (template: GymTemplate) => {
    const accepted = onChange({
      ...data,
      gymTemplates: data.gymTemplates.some((item) => item.id === template.id)
        ? data.gymTemplates.map((item) => item.id === template.id ? template : item)
        : [...data.gymTemplates, template],
    })
    if (accepted === false) return
    setEditingTemplate(null)
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
    b.date.localeCompare(a.date) || b.completedAt.localeCompare(a.completedAt)), [data.gymSessions])

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
            {sortedSessions.map((session) => {
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
                      {session.exercises.map((exercise) => (
                        <div className="gym-history-exercise" key={exercise.id}>
                          <strong>{exercise.name}</strong>
                          <span>{exercise.sets} Sätze · {exercise.weightKg === undefined ? 'Körpergewicht' : `${exercise.weightKg.toLocaleString('de-DE')} kg`} · {exercise.reps} Wdh.</span>
                        </div>
                      ))}
                      <button type="button" className="link-button danger" onClick={() => removeSession(session)}><Trash2 /> Training löschen</button>
                    </div>
                  )}
                </article>
              )
            })}
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

      {draft && (
        <section className="gym-active-session" aria-label={`Aktives Training ${draft.templateName}`}>
          <div className="gym-session-head"><div><p>{formatShortDate(draft.date)}</p><h2 ref={activeTitleRef} tabIndex={-1}>{draft.templateName}</h2></div><span>Aktiv</span></div>
          <div className="gym-live-list">
            {draft.exercises.map((exercise, index) => (
              <article key={exercise.id} className="gym-live-card">
                <div className="gym-live-title"><span>{String(index + 1).padStart(2, '0')}</span><strong>{exercise.name}</strong></div>
                <div className="gym-number-row">
                  <label><span>Sätze</span><input required aria-label={`${exercise.name} Sätze`} type="number" min="1" max="20" inputMode="numeric" value={exercise.sets} onChange={(event) => updateExercise(exercise.id, { sets: Number(event.target.value) })} /></label>
                  <label><span>kg</span><input aria-label={`${exercise.name} Gewicht`} type="number" min="0" max="1000" step="0.25" inputMode="decimal" value={exercise.weightKg ?? ''} onChange={(event) => updateExercise(exercise.id, { weightKg: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="BW" /></label>
                  <label><span>Wdh.</span><input required aria-label={`${exercise.name} Wiederholungen`} type="number" min="1" max="100" inputMode="numeric" value={exercise.reps} onChange={(event) => updateExercise(exercise.id, { reps: Number(event.target.value) })} /></label>
                </div>
              </article>
            ))}
          </div>
          <button type="button" className="primary-button full gym-complete" disabled={!draftValid || isCompleting} onClick={() => setFinishRequested(true)}><Check /> Training beenden</button>
          <button type="button" className="link-button gym-cancel" onClick={() => { if (window.confirm('Aktuelles Training wirklich abbrechen?')) setDraft(null) }}>Training abbrechen</button>
        </section>
      )}

      {pendingTemplate && <TrainingConfirmDialog mode="start" template={pendingTemplate} onConfirm={start} onCancel={() => setPendingTemplate(null)} />}
      {draft && finishRequested && <TrainingConfirmDialog mode="finish" template={{ name: draft.templateName, exercises: draft.exercises }} isPending={isCompleting} onConfirm={complete} onCancel={() => setFinishRequested(false)} />}
      {editingTemplate && <TemplateEditor template={editingTemplate === 'new' ? undefined : editingTemplate} onSave={saveTemplate} onCancel={closeTemplate} onDirtyChange={onEditorDirtyChange} />}
    </section>
  )
}
