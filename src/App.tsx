import {
  Activity,
  BarChart3,
  Beef,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  Dumbbell,
  Flame,
  Footprints,
  History,
  Medal,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Scale,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
  Waves,
  X,
  Zap,
} from 'lucide-react'
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfMonth,
  format,
  getISODay,
  isAfter,
  isSameISOWeek,
  isSameMonth,
  startOfMonth,
} from 'date-fns'
import { de } from 'date-fns/locale'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import './App.css'
import {
  dateRange,
  formatDayTitle,
  formatShortDate,
  fromDateKey,
  periodBounds,
  periodLabel,
  toDateKey,
  todayKey,
} from './lib/date'
import { calculateStats, dayStatus, goalsForDate, statusFor } from './lib/stats'
import { loadData, makeId, saveData, setEntryStatus, toggleGoalActive } from './lib/storage'
import type { AppData, BodyMetric, Goal, GoalIcon, GoalStatus, Period } from './types'

type Tab = 'today' | 'history' | 'insights' | 'goals' | 'body'

const periodNames: Record<Period, string> = {
  week: 'Woche',
  month: 'Monat',
  year: 'Jahr',
}

const goalColors = ['#c6ff3d', '#4dc5ff', '#a78bfa', '#ff9f43', '#ff607f']

function GoalGlyph({ icon, size = 24 }: { icon: GoalIcon; size?: number }) {
  if (icon === 'protein') return <Beef size={size} aria-hidden="true" />
  if (icon === 'water') return <Waves size={size} aria-hidden="true" />
  if (icon === 'activity') return <Footprints size={size} aria-hidden="true" />
  if (icon === 'sleep') return <Moon size={size} aria-hidden="true" />
  return <Zap size={size} aria-hidden="true" />
}

function Brand() {
  return (
    <div className="brand" aria-label="Pace">
      <span className="brand-mark">
        <Activity size={19} aria-hidden="true" />
      </span>
      <span>PACE</span>
    </div>
  )
}

function PageIntro({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string
  title: string
  action?: React.ReactNode
}) {
  return (
    <header className="page-intro">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  )
}

function PeriodControl({
  value,
  onChange,
}: {
  value: Period
  onChange: (period: Period) => void
}) {
  return (
    <div className="segmented" aria-label="Zeitraum">
      {(Object.keys(periodNames) as Period[]).map((period) => (
        <button
          type="button"
          className={value === period ? 'active' : ''}
          aria-pressed={value === period}
          onClick={() => onChange(period)}
          key={period}
        >
          {periodNames[period]}
        </button>
      ))}
    </div>
  )
}

function DateStepper({
  label,
  onPrevious,
  onNext,
  onToday,
  isCurrent,
  nextDisabled = false,
}: {
  label: string
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
  isCurrent: boolean
  nextDisabled?: boolean
}) {
  return (
    <div className="date-stepper">
      <button type="button" className="icon-button" onClick={onPrevious} aria-label="Zurück">
        <ChevronLeft aria-hidden="true" />
      </button>
      <button type="button" className="date-label" onClick={onToday}>
        <span>{label}</span>
        {!isCurrent && <small>Zu heute</small>}
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={onNext}
        aria-label="Weiter"
        disabled={nextDisabled}
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  )
}

function StatusButton({
  selected,
  kind,
  onClick,
  label,
}: {
  selected: boolean
  kind: 'done' | 'failed'
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      className={`status-button ${kind} ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {kind === 'done' ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
      <span>{label}</span>
    </button>
  )
}

function GoalCard({
  goal,
  status,
  onStatus,
}: {
  goal: Goal
  status: GoalStatus
  onStatus: (status: GoalStatus) => void
}) {
  const style = { '--goal-color': goal.color } as CSSProperties
  return (
    <article className={`goal-card status-${status}`} style={style}>
      <div className="goal-card-top">
        <span className="goal-icon">
          <GoalGlyph icon={goal.icon} />
        </span>
        <div className="goal-main">
          <p>{goal.name}</p>
          <strong>
            {new Intl.NumberFormat('de-DE').format(goal.target)}
            <small>{goal.unit}</small>
          </strong>
        </div>
        <span className={`status-dot ${status}`}>
          {status === 'done' ? <Check size={17} /> : status === 'failed' ? <X size={17} /> : null}
        </span>
      </div>
      <div className="status-actions">
        <StatusButton
          selected={status === 'done'}
          kind="done"
          label="Erfüllt"
          onClick={() => onStatus(status === 'done' ? 'open' : 'done')}
        />
        <StatusButton
          selected={status === 'failed'}
          kind="failed"
          label="Nicht geschafft"
          onClick={() => onStatus(status === 'failed' ? 'open' : 'failed')}
        />
      </div>
      {status !== 'open' && (
        <button type="button" className="reset-button" onClick={() => onStatus('open')}>
          <RotateCcw size={14} aria-hidden="true" />
          Zurücksetzen
        </button>
      )}
    </article>
  )
}

function TodayView({
  data,
  selectedDate,
  onDate,
  onStatus,
  onOpenGoals,
}: {
  data: AppData
  selectedDate: string
  onDate: (date: string) => void
  onStatus: (goalId: string, status: GoalStatus) => void
  onOpenGoals: () => void
}) {
  const goals = goalsForDate(data, selectedDate)
  const done = goals.filter((goal) => statusFor(data, goal.id, selectedDate) === 'done').length
  const progress = goals.length ? Math.round((done / goals.length) * 100) : 0
  const selected = fromDateKey(selectedDate)

  return (
    <section className="view today-view">
      <PageIntro
        eyebrow={format(selected, 'EEEE', { locale: de })}
        title={formatDayTitle(selectedDate)}
        action={
          <div className="day-score" aria-label={`${progress} Prozent erledigt`}>
            <strong>{progress}</strong>
            <span>%</span>
          </div>
        }
      />
      <DateStepper
        label={format(selected, 'd. MMMM yyyy', { locale: de })}
        onPrevious={() => onDate(toDateKey(addDays(selected, -1)))}
        onNext={() => onDate(toDateKey(addDays(selected, 1)))}
        onToday={() => onDate(todayKey())}
        isCurrent={selectedDate === todayKey()}
        nextDisabled={selectedDate >= todayKey()}
      />
      <div className="goal-stack">
        {goals.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            status={statusFor(data, goal.id, selectedDate)}
            onStatus={(status) => onStatus(goal.id, status)}
          />
        ))}
        {goals.length === 0 && (
          <div className="empty-state">
            <Target aria-hidden="true" />
            <h2>Keine Ziele aktiv</h2>
            <p>Lege dein erstes tägliches Ziel an.</p>
            <button type="button" className="primary-button" onClick={onOpenGoals}>
              <Plus size={18} /> Ziel anlegen
            </button>
          </div>
        )}
      </div>
      {goals.length > 0 && (
        <div className="completion-strip">
          <div>
            <span>Tagesfortschritt</span>
            <strong>
              {done}/{goals.length}
            </strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>
            {progress === 100
              ? 'Starker Tag. Alle Ziele im grünen Bereich.'
              : `${goals.length - done} ${goals.length - done === 1 ? 'Ziel' : 'Ziele'} noch offen.`}
          </p>
        </div>
      )}
    </section>
  )
}

function DayTile({
  date,
  data,
  onSelect,
  muted = false,
}: {
  date: Date
  data: AppData
  onSelect: (date: string) => void
  muted?: boolean
}) {
  const key = toDateKey(date)
  const future = isAfter(date, new Date())
  const status = future ? 'open' : dayStatus(data, key)
  return (
    <button
      type="button"
      className={`day-tile ${status} ${muted ? 'muted' : ''} ${key === todayKey() ? 'today' : ''}`}
      onClick={() => onSelect(key)}
      disabled={future}
      aria-label={`${format(date, 'd. MMMM yyyy', { locale: de })}: ${
        status === 'done' ? 'erfüllt' : status === 'failed' ? 'fehlgeschlagen' : 'offen'
      }`}
    >
      <span>{format(date, 'd')}</span>
      <i aria-hidden="true" />
    </button>
  )
}

function MonthCalendar({
  anchor,
  data,
  onSelect,
}: {
  anchor: Date
  data: AppData
  onSelect: (date: string) => void
}) {
  const start = startOfMonth(anchor)
  const offset = getISODay(start) - 1
  const dates = dateRange(addDays(start, -offset), addDays(endOfMonth(anchor), 7 - getISODay(endOfMonth(anchor))))
  return (
    <div className="calendar-panel">
      <div className="weekday-row" aria-hidden="true">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="month-grid">
        {dates.map((key) => (
          <DayTile
            key={key}
            date={fromDateKey(key)}
            data={data}
            onSelect={onSelect}
            muted={!isSameMonth(fromDateKey(key), anchor)}
          />
        ))}
      </div>
    </div>
  )
}

function WeekCalendar({
  anchor,
  data,
  onSelect,
}: {
  anchor: Date
  data: AppData
  onSelect: (date: string) => void
}) {
  const { start, end } = periodBounds('week', anchor)
  return (
    <div className="week-list">
      {dateRange(start, end).map((key) => {
        const date = fromDateKey(key)
        const future = key > todayKey()
        const status = future ? 'open' : dayStatus(data, key)
        const goals = goalsForDate(data, key)
        const done = goals.filter((goal) => statusFor(data, goal.id, key) === 'done').length
        return (
          <button
            type="button"
            className={`week-row ${status}`}
            onClick={() => onSelect(key)}
            disabled={future}
            key={key}
          >
            <span className="week-date">
              <small>{format(date, 'EEE', { locale: de })}</small>
              <strong>{format(date, 'dd')}</strong>
            </span>
            <span className="week-progress">
              <strong>{key === todayKey() ? 'Heute' : format(date, 'd. MMMM', { locale: de })}</strong>
              <small>
                {done} von {goals.length} erfüllt
              </small>
            </span>
            <span className="week-indicator">
              {status === 'done' ? <Check /> : status === 'failed' ? <X /> : <MoreHorizontal />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function YearCalendar({
  anchor,
  data,
  onSelect,
}: {
  anchor: Date
  data: AppData
  onSelect: (date: string) => void
}) {
  const months = Array.from({ length: 12 }, (_, index) => new Date(anchor.getFullYear(), index, 1))
  return (
    <div className="year-heatmap">
      <div className="heatmap-days" aria-hidden="true">
        <span />
        {[1, 5, 10, 15, 20, 25, 31].map((day) => (
          <span key={day} style={{ gridColumn: day + 1 }}>
            {day}
          </span>
        ))}
      </div>
      {months.map((month) => {
        const keys = dateRange(startOfMonth(month), endOfMonth(month))
        return (
          <div className="heatmap-row" key={month.toISOString()}>
            <strong>{format(month, 'MMM', { locale: de })}</strong>
            <div className="heatmap-cells">
              {keys.map((key) => (
                <button
                  type="button"
                  className={isAfter(fromDateKey(key), new Date()) ? 'open' : dayStatus(data, key)}
                  aria-label={`${formatShortDate(key)} öffnen`}
                  onClick={() => onSelect(key)}
                  disabled={isAfter(fromDateKey(key), new Date())}
                  key={key}
                />
              ))}
            </div>
          </div>
        )
      })}
      <div className="legend">
        <span><i className="done" /> Erfüllt</span>
        <span><i className="failed" /> Verfehlt</span>
        <span><i className="open" /> Offen</span>
      </div>
    </div>
  )
}

function HistoryView({
  data,
  onSelectDay,
}: {
  data: AppData
  onSelectDay: (date: string) => void
}) {
  const [period, setPeriod] = useState<Period>('month')
  const [anchor, setAnchor] = useState(new Date())

  const move = (direction: number) => {
    setAnchor((current) =>
      period === 'week'
        ? addWeeks(current, direction)
        : period === 'month'
          ? addMonths(current, direction)
          : addYears(current, direction),
    )
  }

  const select = (date: string) => {
    onSelectDay(date)
  }

  return (
    <section className="view">
      <PageIntro eyebrow="Dein Rhythmus" title="Verlauf" />
      <PeriodControl value={period} onChange={setPeriod} />
      <DateStepper
        label={periodLabel(period, anchor)}
        onPrevious={() => move(-1)}
        onNext={() => move(1)}
        onToday={() => setAnchor(new Date())}
        isCurrent={
          period === 'year'
            ? anchor.getFullYear() === new Date().getFullYear()
            : period === 'week'
              ? isSameISOWeek(anchor, new Date())
              : isSameMonth(anchor, new Date())
        }
      />
      {period === 'week' ? (
        <WeekCalendar anchor={anchor} data={data} onSelect={select} />
      ) : period === 'month' ? (
        <MonthCalendar anchor={anchor} data={data} onSelect={select} />
      ) : (
        <YearCalendar anchor={anchor} data={data} onSelect={select} />
      )}
      <p className="history-hint">Tippe auf einen Tag, um ihn zu bearbeiten.</p>
    </section>
  )
}

function Ring({ value }: { value: number }) {
  const degrees = value * 3.6
  return (
    <div
      className="rate-ring"
      style={{ '--rate': `${degrees}deg` } as CSSProperties}
      role="img"
      aria-label={`${value} Prozent Erfüllungsquote`}
    >
      <div>
        <strong>{value}</strong>
        <span>%</span>
      </div>
    </div>
  )
}

function InsightsView({ data }: { data: AppData }) {
  const [period, setPeriod] = useState<Period>('month')
  const stats = useMemo(() => calculateStats(data, period), [data, period])
  return (
    <section className="view">
      <PageIntro eyebrow="Was funktioniert" title="Insights" />
      <PeriodControl value={period} onChange={setPeriod} />
      <article className="insight-hero">
        <div>
          <p>Erfüllungsquote</p>
          <h2>{periodNames[period]} im Blick</h2>
          <span>
            {stats.done} von {stats.total} Check-ins
          </span>
        </div>
        <Ring value={stats.rate} />
      </article>
      <div className="stat-pair">
        <article className="stat-card">
          <span className="stat-icon"><Flame /></span>
          <div><strong>{stats.currentStreak}</strong><small>Tage</small></div>
          <p>Aktuelle Serie</p>
        </article>
        <article className="stat-card">
          <span className="stat-icon purple"><Trophy /></span>
          <div><strong>{stats.bestStreak}</strong><small>Tage</small></div>
          <p>Beste Serie</p>
        </article>
      </div>
      <div className="section-title">
        <div><p>Nach Ziel</p><h2>Deine Quoten</h2></div>
        <BarChart3 aria-hidden="true" />
      </div>
      <div className="goal-rates">
        {stats.perGoal.map(({ goal, done, total, rate }) => (
          <article className="goal-rate" key={goal.id}>
            <span className="mini-goal-icon" style={{ color: goal.color }}>
              <GoalGlyph icon={goal.icon} size={20} />
            </span>
            <div className="rate-copy">
              <div><strong>{goal.name}</strong><span>{done}/{total}</span></div>
              <div className="rate-track"><span style={{ width: `${rate}%`, background: goal.color }} /></div>
            </div>
            <strong className="rate-number">{rate}%</strong>
          </article>
        ))}
      </div>
      {stats.total === 0 && (
        <div className="empty-state compact">
          <Sparkles />
          <h2>Noch keine Daten</h2>
          <p>Deine ersten Check-ins machen den Trend sichtbar.</p>
        </div>
      )}
    </section>
  )
}

interface GoalFormValue {
  name: string
  unit: string
  target: string
  icon: GoalIcon
  color: string
}

function GoalForm({
  goal,
  onSave,
  onCancel,
}: {
  goal?: Goal
  onSave: (value: GoalFormValue) => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  )
  const [value, setValue] = useState<GoalFormValue>({
    name: goal?.name ?? '',
    unit: goal?.unit ?? '',
    target: goal ? String(goal.target) : '',
    icon: goal?.icon ?? 'custom',
    color: goal?.color ?? goalColors[0],
  })
  useEffect(() => {
    const returnFocus = returnFocusRef.current
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      returnFocus?.focus()
    }
  }, [onCancel])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave(value)
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-form-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div><p className="eyebrow">Tägliches Ziel</p><h2 id="goal-form-title">{goal ? 'Ziel bearbeiten' : 'Neues Ziel'}</h2></div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Schließen"><X /></button>
        </div>
        <form onSubmit={submit} className="form-stack">
          <label>
            <span>Name</span>
            <input
              autoFocus
              required
              pattern=".*\\S.*"
              title="Bitte einen Namen eingeben."
              maxLength={40}
              value={value.name}
              onChange={(event) => setValue({ ...value, name: event.target.value })}
              placeholder="z. B. Schritte"
            />
          </label>
          <div className="form-row">
            <label>
              <span>Zielwert</span>
              <input
                required
                type="number"
                min="0.01"
                step="any"
                inputMode="decimal"
                value={value.target}
                onChange={(event) => setValue({ ...value, target: event.target.value })}
                placeholder="10000"
              />
            </label>
            <label>
              <span>Einheit</span>
              <input
                required
                maxLength={8}
                pattern=".*\\S.*"
                title="Bitte eine Einheit eingeben."
                value={value.unit}
                onChange={(event) => setValue({ ...value, unit: event.target.value })}
                placeholder="Stk."
              />
            </label>
          </div>
          <fieldset>
            <legend>Icon</legend>
            <div className="choice-row">
              {(['protein', 'water', 'activity', 'sleep', 'custom'] as GoalIcon[]).map((icon) => (
                <button
                  type="button"
                  aria-label={`Icon ${icon}`}
                  aria-pressed={value.icon === icon}
                  className={value.icon === icon ? 'selected' : ''}
                  onClick={() => setValue({ ...value, icon })}
                  key={icon}
                >
                  <GoalGlyph icon={icon} />
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Farbe</legend>
            <div className="color-row">
              {goalColors.map((color) => (
                <button
                  type="button"
                  aria-label={`Farbe ${color}`}
                  aria-pressed={value.color === color}
                  className={value.color === color ? 'selected' : ''}
                  style={{ background: color }}
                  onClick={() => setValue({ ...value, color })}
                  key={color}
                />
              ))}
            </div>
          </fieldset>
          <button className="primary-button full" type="submit">
            <Check size={19} /> {goal ? 'Änderungen speichern' : 'Ziel anlegen'}
          </button>
        </form>
      </section>
    </div>
  )
}

function GoalsView({
  data,
  onChange,
}: {
  data: AppData
  onChange: (data: AppData) => void
}) {
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)
  const save = (value: GoalFormValue) => {
    const parsedTarget = Number(value.target.replace(',', '.'))
    const name = value.name.trim()
    const unit = value.unit.trim()
    if (!name || !unit || !Number.isFinite(parsedTarget) || parsedTarget <= 0) return
    if (editing === 'new') {
      const startDate = todayKey()
      onChange({
        ...data,
        goals: [
          ...data.goals,
          {
            id: makeId('goal'),
            name,
            unit,
            target: parsedTarget,
            icon: value.icon,
            color: value.color,
            active: true,
            createdAt: startDate,
            activityPeriods: [{ start: startDate }],
          },
        ],
      })
    } else if (editing) {
      onChange({
        ...data,
        goals: data.goals.map((goal) =>
          goal.id === editing.id
            ? {
                ...goal,
                name,
                unit,
                target: parsedTarget,
                icon: value.icon,
                color: value.color,
              }
            : goal,
        ),
      })
    }
    setEditing(null)
  }

  const remove = (goal: Goal) => {
    if (!window.confirm(`„${goal.name}“ wirklich löschen? Zugehörige Check-ins werden ebenfalls entfernt.`)) return
    onChange({
      ...data,
      goals: data.goals.filter((item) => item.id !== goal.id),
      entries: data.entries.filter((entry) => entry.goalId !== goal.id),
    })
  }

  return (
    <section className="view">
      <PageIntro
        eyebrow="Dein System"
        title="Ziele"
        action={
          <button type="button" className="round-action" onClick={() => setEditing('new')} aria-label="Ziel hinzufügen">
            <Plus />
          </button>
        }
      />
      <div className="info-banner">
        <CircleGauge aria-hidden="true" />
        <p>Aktive Ziele erscheinen jeden Tag auf deinem Dashboard.</p>
      </div>
      <div className="manage-list">
        {data.goals.map((goal) => (
          <article className={`manage-goal ${goal.active ? '' : 'inactive'}`} key={goal.id}>
            <span className="manage-icon" style={{ color: goal.color }}>
              <GoalGlyph icon={goal.icon} />
            </span>
            <div>
              <strong>{goal.name}</strong>
              <span>{goal.target} {goal.unit} · {goal.active ? 'Aktiv' : 'Pausiert'}</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={goal.active}
                aria-label={`${goal.name} aktiv`}
                onChange={() =>
                  onChange({
                    ...data,
                    goals: data.goals.map((item) =>
                      item.id === goal.id ? toggleGoalActive(item) : item,
                    ),
                  })
                }
              />
              <span />
            </label>
            <button type="button" className="mini-action" onClick={() => setEditing(goal)} aria-label={`${goal.name} bearbeiten`}>
              <Pencil />
            </button>
            <button type="button" className="mini-action danger" onClick={() => remove(goal)} aria-label={`${goal.name} löschen`}>
              <Trash2 />
            </button>
          </article>
        ))}
      </div>
      <button type="button" className="outline-button full" onClick={() => setEditing('new')}>
        <Plus size={19} /> Neues Tagesziel
      </button>
      {editing && (
        <GoalForm goal={editing === 'new' ? undefined : editing} onSave={save} onCancel={() => setEditing(null)} />
      )}
    </section>
  )
}

function metricTrend(metrics: BodyMetric[], key: 'weightKg' | 'muscleMassKg') {
  const values = metrics
    .filter((metric) => metric[key] !== undefined)
    .slice(0, 2)
    .map((metric) => metric[key] as number)
  if (values.length < 2) return null
  return Math.round((values[0] - values[1]) * 10) / 10
}

function BodyView({
  data,
  onChange,
}: {
  data: AppData
  onChange: (data: AppData) => void
}) {
  const [date, setDate] = useState(todayKey())
  const [weight, setWeight] = useState('')
  const [muscle, setMuscle] = useState('')
  const metrics = [...data.bodyMetrics].sort((a, b) => b.date.localeCompare(a.date))
  const latestWeight = metrics.find((metric) => metric.weightKg !== undefined)?.weightKg
  const weightTrend = metricTrend(metrics, 'weightKg')
  const muscleTrend = metricTrend(metrics, 'muscleMassKg')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!weight && !muscle) return
    const existing = data.bodyMetrics.find((metric) => metric.date === date)
    const metric: BodyMetric = {
      id: existing?.id ?? makeId('body'),
      date,
      weightKg: weight ? Number(weight.replace(',', '.')) : existing?.weightKg,
      muscleMassKg: muscle ? Number(muscle.replace(',', '.')) : existing?.muscleMassKg,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    onChange({
      ...data,
      bodyMetrics: [...data.bodyMetrics.filter((item) => item.date !== date), metric],
    })
    setWeight('')
    setMuscle('')
  }

  return (
    <section className="view">
      <PageIntro eyebrow="Dein Fortschritt" title="Körper" />
      <article className="body-hero">
        <Scale aria-hidden="true" />
        <div><p>Letztes Gewicht</p><h2>{latestWeight ? `${latestWeight.toLocaleString('de-DE')} kg` : 'Noch offen'}</h2></div>
        {weightTrend !== null && (
          <span className={weightTrend <= 0 ? 'positive' : ''}>
            {weightTrend <= 0 ? <TrendingDown /> : <TrendingUp />}
            {Math.abs(weightTrend).toLocaleString('de-DE')} kg
          </span>
        )}
      </article>
      <form className="metric-form" onSubmit={submit}>
        <div className="section-title"><div><p>Messung</p><h2>Werte eintragen</h2></div><Dumbbell /></div>
        <label>
          <span>Datum</span>
          <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <div className="form-row">
          <label>
            <span>Gewicht (kg)</span>
            <input type="number" min="1" max="500" step="0.1" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="82,4" />
          </label>
          <label>
            <span>Muskelmasse (kg)</span>
            <input type="number" min="1" max="300" step="0.1" inputMode="decimal" value={muscle} onChange={(event) => setMuscle(event.target.value)} placeholder="60,2" />
          </label>
        </div>
        <button type="submit" className="primary-button full"><Plus size={18} /> Messung speichern</button>
      </form>
      <div className="metric-summary">
        <article>
          <span>Gewicht</span>
          <strong>{metrics.find((metric) => metric.weightKg)?.weightKg?.toLocaleString('de-DE') ?? '–'} <small>kg</small></strong>
        </article>
        <article>
          <span>Muskelmasse</span>
          <strong>{metrics.find((metric) => metric.muscleMassKg)?.muscleMassKg?.toLocaleString('de-DE') ?? '–'} <small>kg</small></strong>
          {muscleTrend !== null && <em>{muscleTrend > 0 ? '+' : ''}{muscleTrend} kg</em>}
        </article>
      </div>
      <div className="section-title history-title"><div><p>Zuletzt</p><h2>Messverlauf</h2></div><History /></div>
      <div className="metric-list">
        {metrics.slice(0, 8).map((metric) => (
          <article key={metric.id}>
            <time dateTime={metric.date}>{formatShortDate(metric.date)}</time>
            <span>{metric.weightKg ? `${metric.weightKg.toLocaleString('de-DE')} kg` : '–'}</span>
            <span>{metric.muscleMassKg ? `${metric.muscleMassKg.toLocaleString('de-DE')} kg Muskel` : '–'}</span>
            <button
              type="button"
              className="mini-action danger"
              aria-label={`Messung vom ${formatShortDate(metric.date)} löschen`}
              onClick={() => {
                if (!window.confirm(`Messung vom ${formatShortDate(metric.date)} wirklich löschen?`)) return
                onChange({
                  ...data,
                  bodyMetrics: data.bodyMetrics.filter((item) => item.id !== metric.id),
                })
              }}
            >
              <Trash2 />
            </button>
          </article>
        ))}
        {metrics.length === 0 && <p className="quiet-copy">Noch keine Messungen gespeichert.</p>}
      </div>
      <p className="future-note">Bereit für einen späteren Renpho-Import.</p>
    </section>
  )
}

const navItems: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'today', label: 'Heute', icon: Target },
  { id: 'history', label: 'Verlauf', icon: CalendarDays },
  { id: 'insights', label: 'Analyse', icon: BarChart3 },
  { id: 'goals', label: 'Ziele', icon: Settings2 },
  { id: 'body', label: 'Körper', icon: Scale },
]

function App() {
  const [data, setData] = useState<AppData>(() => loadData())
  const [tab, setTab] = useState<Tab>('today')
  const [selectedDate, setSelectedDate] = useState(todayKey())

  useEffect(() => {
    saveData(data)
  }, [data])

  const updateStatus = (goalId: string, status: GoalStatus) => {
    if (selectedDate > todayKey()) return
    setData((current) => ({
      ...current,
      entries: setEntryStatus(current.entries, goalId, selectedDate, status),
    }))
  }

  const openDay = (date: string) => {
    setSelectedDate(date)
    setTab('today')
  }

  return (
    <div className="app-shell">
      <aside className="desktop-rail">
        <Brand />
        <nav aria-label="Hauptnavigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                type="button"
                className={tab === item.id ? 'active' : ''}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => setTab(item.id)}
                key={item.id}
              >
                <Icon aria-hidden="true" /><span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="rail-quote"><Medal /><p>Konstanz schlägt Perfektion.</p></div>
      </aside>
      <main>
        <div className="mobile-brand"><Brand /><span>{format(new Date(), 'd. MMM', { locale: de })}</span></div>
        <div className="content">
          {tab === 'today' && (
            <TodayView data={data} selectedDate={selectedDate} onDate={setSelectedDate} onStatus={updateStatus} onOpenGoals={() => setTab('goals')} />
          )}
          {tab === 'history' && <HistoryView data={data} onSelectDay={openDay} />}
          {tab === 'insights' && <InsightsView data={data} />}
          {tab === 'goals' && <GoalsView data={data} onChange={setData} />}
          {tab === 'body' && <BodyView data={data} onChange={setData} />}
        </div>
      </main>
      <nav className="bottom-nav" aria-label="Hauptnavigation">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button type="button" className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)} key={item.id}>
              <Icon aria-hidden="true" /><span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default App
