import { addWeeks, endOfISOWeek, format, getISOWeek, getISOWeekYear, isSameISOWeek, startOfISOWeek } from 'date-fns'
import { de } from 'date-fns/locale'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Dumbbell, Footprints, Pause, Pencil, Play, Plus, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { fromDateKey, periodBounds, toDateKey, todayKey } from './lib/date'
import { activeWeeklyGoals, closeAndAppendWeeklyDefinition, evaluateWeeklyGoal, setWeeklyAdjustment, weeklyGoalCurrentDefinition, weeklyGoalDefinitionForDate, weeklyGoalWeeksBetween } from './lib/weeklyGoals'
import { makeId } from './lib/storage'
import type { AppData, Period, WeeklyGoal, WeeklyGoalAdjustmentStatus, WeeklyGoalDefinition, WeeklyGoalIcon, WeeklyGoalSourceType } from './types'

const colors = ['#c6ff3d', '#4dc5ff', '#a78bfa', '#ffb347', '#ff607f']
const dayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function WeeklyIcon({ icon, size = 20 }: { icon: WeeklyGoalIcon; size?: number }) {
  if (icon === 'gym') return <Dumbbell size={size} aria-hidden="true" />
  if (icon === 'run') return <Footprints size={size} aria-hidden="true" />
  return <CalendarDays size={size} aria-hidden="true" />
}

function resultLabel(result: ReturnType<typeof evaluateWeeklyGoal>) {
  const progress = result.excused ? `${result.done} erledigt + ${result.excused} entschuldigt / ${result.target}` : `${result.done}/${result.target}`
  if (result.status === 'fulfilled') return { progress, label: 'Erfüllt' }
  if (result.status === 'excused') return { progress, label: 'Entschuldigt' }
  if (result.status === 'failed') return { progress, label: 'Verfehlt' }
  return { progress, label: result.status === 'inactive' ? 'Nicht aktiv' : 'Läuft' }
}

export function WeeklyTodaySection({ data, selectedDate, onChange, onOpenGoals }: { data: AppData; selectedDate: string; onChange: (data: AppData) => void; onOpenGoals: () => void }) {
  const goals = activeWeeklyGoals(data, selectedDate)
  const [selected, setSelected] = useState<WeeklyGoal | null>(null)
  return <>
    <section className="weekly-today" aria-labelledby="weekly-today-title">
      <header><div><p>Wochenziele</p><h2 id="weekly-today-title">Diese Woche</h2></div><span>KW {getISOWeek(fromDateKey(selectedDate))}</span></header>
      {goals.length ? <div className="weekly-card-list">{goals.map((goal) => {
        const result = evaluateWeeklyGoal(data, goal, selectedDate, todayKey())
        const presentation = weeklyGoalDefinitionForDate(goal, selectedDate) ?? goal
        const copy = resultLabel(result)
        return <button type="button" className={`weekly-card ${result.status}`} style={{ '--weekly-color': presentation.color } as CSSProperties} onClick={() => setSelected(goal)} key={goal.id}>
          <span className="weekly-card-icon"><WeeklyIcon icon={presentation.icon} /></span>
          <span className="weekly-card-copy"><strong>{presentation.name}</strong><small>{copy.label}</small></span>
          <span className="weekly-day-strip" aria-hidden="true">{result.days.map((day, index) => <i className={day.status} key={day.date} title={dayLabels[index]} />)}</span>
          <b>{copy.progress}</b>
        </button>
      })}</div> : <button type="button" className="weekly-empty" onClick={onOpenGoals}><Plus size={18} /> Wochenziel anlegen</button>}
    </section>
    {selected && <WeeklyGoalDetail data={data} goal={selected} initialDate={selectedDate} onChange={onChange} onClose={() => setSelected(null)} />}
  </>
}

function WeeklyGoalDetail({ data, goal, initialDate, onChange, onClose }: { data: AppData; goal: WeeklyGoal; initialDate: string; onChange: (data: AppData) => void; onClose: () => void }) {
  const [anchor, setAnchor] = useState(fromDateKey(initialDate))
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  const result = evaluateWeeklyGoal(data, goal, anchor, todayKey())
  const presentation = result.definition ?? weeklyGoalCurrentDefinition(goal, toDateKey(anchor)) ?? goal
  const currentWeek = isSameISOWeek(anchor, new Date())
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)')]
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    const returnFocus = returnFocusRef.current
    return () => { document.body.style.overflow = before; document.removeEventListener('keydown', keydown); returnFocus?.focus() }
  }, [])
  const change = (date: string, status: WeeklyGoalAdjustmentStatus | 'open') => {
    if (date > todayKey()) return
    onChange({ ...data, weeklyGoalAdjustments: setWeeklyAdjustment(data.weeklyGoalAdjustments ?? [], goal.id, date, status) })
  }
  return createPortal(<div className="weekly-modal-backdrop" onMouseDown={onClose}>
    <div className="weekly-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="weekly-detail-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
      <header><div className="weekly-modal-title"><span style={{ color: presentation.color }}><WeeklyIcon icon={presentation.icon} /></span><div><p>Wochenziel</p><h2 id="weekly-detail-title">{presentation.name}</h2></div></div><button type="button" className="mini-action" aria-label="Schließen" onClick={onClose}><X /></button></header>
      <div className="weekly-week-stepper"><button type="button" aria-label="Vorige Woche" onClick={() => setAnchor(addWeeks(anchor, -1))}><ChevronLeft /></button><div><strong>KW {getISOWeek(anchor)} · {getISOWeekYear(anchor)}</strong><span>{format(startOfISOWeek(anchor), 'dd. MMM', { locale: de })} – {format(endOfISOWeek(anchor), 'dd. MMM', { locale: de })}</span></div><button type="button" aria-label="Nächste Woche" disabled={currentWeek} onClick={() => setAnchor(addWeeks(anchor, 1))}><ChevronRight /></button></div>
      <div className={`weekly-result ${result.status}`}><strong>{resultLabel(result).progress}</strong><span>{resultLabel(result).label}</span></div>
      <div className="weekly-days">{result.days.map((day, index) => {
        const automatic = day.automaticLabels.length > 0
        return <article className={`weekly-day ${day.status}`} key={day.date}>
          <div className="weekly-day-heading"><time dateTime={day.date}><b>{dayLabels[index]}</b><span>{format(fromDateKey(day.date), 'dd.MM.')}</span></time><i aria-label={day.status}>{day.status === 'done' ? <Check /> : day.status === 'sick' || day.status === 'injured' ? <ShieldCheck /> : null}</i></div>
          <p>{automatic ? day.automaticLabels.join(', ') : day.status === 'done' ? 'Manuell erledigt' : day.status === 'sick' ? 'Krank' : day.status === 'injured' ? 'Verletzt' : day.status === 'future' ? 'Noch nicht verfügbar' : day.status === 'inactive' ? 'Ziel nicht aktiv' : 'Offen'}</p>
          {automatic && <small>Automatisch erkannt</small>}
          {day.status !== 'future' && day.status !== 'inactive' && <select aria-label={`Status für ${dayLabels[index]}`} value={day.adjustment ?? 'open'} onChange={(event) => change(day.date, event.target.value as WeeklyGoalAdjustmentStatus | 'open')}>
            <option value="open">Offen</option><option value="done">Erledigt</option><option value="sick">Krank</option><option value="injured">Verletzt</option>
          </select>}
        </article>
      })}</div>
      <p className="weekly-modal-note">Automatische Einheiten zählen pro Tag nur einmal. Krank und verletzt gelten als entschuldigt, nicht als Training.</p>
    </div>
  </div>, document.body)
}

type FormState = { name: string; targetCount: string; sourceType: WeeklyGoalSourceType; gymTemplateIds: string[]; runEnvironment: 'any' | 'indoor' | 'outdoor'; color: string; icon: WeeklyGoalIcon; startDate: string }
const blankForm = (): FormState => ({ name: '', targetCount: '3', sourceType: 'gym', gymTemplateIds: [], runEnvironment: 'any', color: '#c6ff3d', icon: 'gym', startDate: todayKey() })

export function WeeklyGoalsManager({ data, onChange }: { data: AppData; onChange: (data: AppData) => void }) {
  const [editing, setEditing] = useState<WeeklyGoal | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(blankForm)
  const formDialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const closeForm = () => setEditing(null)
  useEffect(() => {
    if (!editing) return
    const returnFocus = returnFocusRef.current
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    formDialogRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeForm(); return }
      if (event.key !== 'Tab' || !formDialogRef.current) return
      const focusable = [...formDialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')]
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.body.style.overflow = before
      document.removeEventListener('keydown', keydown)
      returnFocus?.focus()
    }
  }, [editing])
  const open = (goal?: WeeklyGoal) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    if (!goal) { setForm(blankForm()); setEditing('new'); return }
    const current = weeklyGoalCurrentDefinition(goal, todayKey())!
    setForm({ name: current.name, targetCount: String(current.targetCount), sourceType: current.sourceType, gymTemplateIds: current.gymTemplateIds ?? [], runEnvironment: current.runEnvironment ?? 'any', color: current.color, icon: current.icon, startDate: goal.startDate })
    setEditing(goal)
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    const name = form.name.trim(), targetCount = Number(form.targetCount)
    if (!name || !Number.isInteger(targetCount) || targetCount < 1 || targetCount > 7 || form.startDate > todayKey()) return
    const previousDefinition = editing !== 'new' && editing ? weeklyGoalCurrentDefinition(editing, todayKey()) : undefined
    const previousTemplateNames = new Map((previousDefinition?.gymTemplateIds ?? []).map((id, index) => [id, previousDefinition?.gymTemplateNames?.[index]]))
    const templateNames = new Map(data.gymTemplates.map((template) => [template.id, template.name]))
    const definitionBase: Omit<WeeklyGoalDefinition, 'effectiveFrom' | 'effectiveTo'> = {
      name, targetCount, sourceType: form.sourceType,
      ...(form.sourceType === 'gym' ? {
        gymTemplateIds: form.gymTemplateIds,
        gymTemplateNames: form.gymTemplateIds.map((id) => templateNames.get(id) ?? previousTemplateNames.get(id)).filter((value): value is string => value !== undefined),
      } : {}),
      ...(form.sourceType === 'run' ? { runEnvironment: form.runEnvironment } : {}),
      color: form.color, icon: form.sourceType === 'gym' ? 'gym' : form.sourceType === 'run' ? 'run' : 'calendar',
      active: editing === 'new' ? true : editing ? weeklyGoalCurrentDefinition(editing, todayKey())?.active ?? editing.active : true,
      countingMode: 'unique-days',
    }
    let goal: WeeklyGoal
    if (editing === 'new') {
      const effectiveFrom = toDateKey(startOfISOWeek(fromDateKey(form.startDate)))
      goal = { id: makeId('weekly-goal'), ...definitionBase, createdAt: todayKey(), startDate: effectiveFrom, definitions: [{ ...definitionBase, effectiveFrom }] }
    } else if (editing) {
      goal = closeAndAppendWeeklyDefinition(editing, definitionBase, toDateKey(startOfISOWeek(fromDateKey(todayKey()))))
    } else return
    onChange({ ...data, weeklyGoals: [...(data.weeklyGoals ?? []).filter((item) => item.id !== goal.id), goal] })
    closeForm()
  }
  const toggle = (goal: WeeklyGoal) => {
    const current = weeklyGoalCurrentDefinition(goal, todayKey())!
    const next = closeAndAppendWeeklyDefinition(goal, { ...current, active: !current.active }, toDateKey(startOfISOWeek(fromDateKey(todayKey()))))
    onChange({ ...data, weeklyGoals: (data.weeklyGoals ?? []).map((item) => item.id === goal.id ? next : item) })
  }
  return <section className="weekly-goals-manager" aria-labelledby="weekly-goals-title">
    <header className="section-title"><div><p>Montag bis Sonntag</p><h2 id="weekly-goals-title">Wochenziele</h2></div><button type="button" className="primary-button compact-button" onClick={() => open()}><Plus /> Hinzufügen</button></header>
    <div className="weekly-manage-list">{(data.weeklyGoals ?? []).map((goal) => <article className={!goal.active ? 'paused' : ''} key={goal.id}>
      <span style={{ color: goal.color }}><WeeklyIcon icon={goal.icon} /></span><div><strong>{goal.name}</strong><small>{goal.targetCount}× pro Woche · {goal.sourceType === 'gym' ? 'GYM' : goal.sourceType === 'run' ? 'Laufen' : 'Manuell'}{!goal.active ? ' · pausiert' : ''}</small></div>
      <div><button type="button" className="mini-action" aria-label={`${goal.name} bearbeiten`} onClick={() => open(goal)}><Pencil /></button><button type="button" className="mini-action" aria-label={goal.active ? `${goal.name} pausieren` : `${goal.name} fortsetzen`} onClick={() => toggle(goal)}>{goal.active ? <Pause /> : <Play />}</button></div>
    </article>)}</div>
    {(data.weeklyGoals ?? []).length === 0 && <p className="quiet-copy">Noch keine Wochenziele angelegt.</p>}
    {editing && createPortal(<div className="weekly-modal-backdrop" onMouseDown={closeForm}><div className="weekly-goal-form-card" ref={formDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="weekly-form-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p>Wochenziel</p><h2 id="weekly-form-title">{editing === 'new' ? 'Neu anlegen' : 'Bearbeiten'}</h2></div><button type="button" className="mini-action" aria-label="Schließen" onClick={closeForm}><X /></button></header>
      <form onSubmit={save}>
        <label><span>Name</span><input required maxLength={50} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="z. B. 3× GYM" /></label>
        <div className="weekly-form-row"><label><span>Häufigkeit</span><input type="number" min="1" max="7" required value={form.targetCount} onChange={(event) => setForm({ ...form, targetCount: event.target.value })} /></label><label><span>Quelle</span><select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value as WeeklyGoalSourceType })}><option value="gym">GYM</option><option value="run">Laufen</option><option value="manual">Manuell</option></select></label></div>
        {form.sourceType === 'gym' && <fieldset><legend>Einheiten</legend><label className="check-option"><input type="checkbox" checked={form.gymTemplateIds.length === 0} onChange={() => setForm({ ...form, gymTemplateIds: [] })} /> Alle Einheiten</label>{data.gymTemplates.map((template) => <label className="check-option" key={template.id}><input type="checkbox" checked={form.gymTemplateIds.includes(template.id)} onChange={() => setForm({ ...form, gymTemplateIds: form.gymTemplateIds.includes(template.id) ? form.gymTemplateIds.filter((id) => id !== template.id) : [...form.gymTemplateIds, template.id] })} /> {template.name}</label>)}</fieldset>}
        {form.sourceType === 'run' && <label><span>Laufart</span><select value={form.runEnvironment} onChange={(event) => setForm({ ...form, runEnvironment: event.target.value as FormState['runEnvironment'] })}><option value="any">Indoor & Outdoor</option><option value="indoor">Nur Indoor</option><option value="outdoor">Nur Outdoor</option></select></label>}
        {editing === 'new' && <label><span>Beginndatum</span><input type="date" max={todayKey()} required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /><small>Das Ziel gilt ab Montag dieser Kalenderwoche.</small></label>}
        <fieldset><legend>Farbe</legend><div className="color-row">{colors.map((color) => <button type="button" aria-label={`Farbe ${color}`} aria-pressed={form.color === color} className={form.color === color ? 'selected' : ''} style={{ background: color }} onClick={() => setForm({ ...form, color })} key={color} />)}</div></fieldset>
        <button type="submit" className="primary-button full"><Check /> Speichern</button>
      </form>
    </div></div>, document.body)}
  </section>
}

export function WeeklyGoalInsights({ data, period, anchor }: { data: AppData; period: Period; anchor: Date }) {
  const { start, end } = periodBounds(period, anchor, true)
  const today = todayKey()
  const weeks = weeklyGoalWeeksBetween(start, end, toDateKey(end) === today)
  const rows = (data.weeklyGoals ?? []).map((goal) => {
    const results = weeks.map((week) => evaluateWeeklyGoal(data, goal, week, today)).filter((result) => result.status !== 'inactive' && result.status !== 'future')
    const fulfilled = results.filter((result) => result.status === 'fulfilled').length
    const excused = results.filter((result) => result.status === 'excused').length
    const failed = results.filter((result) => result.status === 'failed').length
    const open = results.filter((result) => result.status === 'open' || result.status === 'partial').length
    const decided = fulfilled + failed
    return { goal, presentation: results.at(-1)?.definition ?? goal, fulfilled, excused, failed, open, rate: decided ? Math.round((fulfilled / decided) * 100) : 0 }
  }).filter((row) => row.fulfilled + row.excused + row.failed + row.open > 0)
  if (!rows.length) return null
  return <section className="weekly-insights" aria-labelledby="weekly-insights-title"><header className="section-title"><div><p>Wochenziele</p><h2 id="weekly-insights-title">Wochenbilanz</h2></div><CalendarDays /></header><div>{rows.map((row) => <article key={row.goal.id}><span style={{ color: row.presentation.color }}><WeeklyIcon icon={row.presentation.icon} /></span><div><strong>{row.presentation.name}</strong><small><i className="fulfilled" /> {row.fulfilled} erfüllt <i className="excused" /> {row.excused} entschuldigt <i className="failed" /> {row.failed} verfehlt {row.open > 0 && <>· {row.open} offen</>}</small></div><b>{row.rate}%</b></article>)}</div><p className="weekly-insight-note">Die Quote zählt nur echte Erfüllungen; entschuldigte Wochen bleiben separat.</p></section>
}
