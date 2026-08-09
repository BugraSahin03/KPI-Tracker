import {
  Activity,
  BarChart3,
  Beef,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  Dumbbell,
  Flame,
  Footprints,
  History,
  Medal,
  Moon,
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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
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
import { calculateStats, dayGoalProgress, goalsForDate, sortBodyMetricsNewestFirst, statusFor } from './lib/stats'
import { loadData, makeId, setEntryStatus, STORAGE_KEY, toggleGoalActive } from './lib/storage'
import { DEFAULT_PROFILE_ID, type AppData, type BodyMetric, type DataMutation, type Goal, type GoalIcon, type GoalStatus, type Period, type Profile, type ProfileId } from './types'
import { createDemoData } from './lib/demo'
import { api, ApiError, type GoogleHealthStatus } from './lib/api'
import { applyPendingMutations, loadPendingMutations, persistPendingMutations, type PendingMutation } from './lib/pendingMutations'
import GymView from './GymView'

type Tab = 'today' | 'gym' | 'insights' | 'goals' | 'body'

const periodNames: Record<Period, string> = {
  week: 'Woche',
  month: 'Monat',
  year: 'Jahr',
}

const goalColors = ['#c6ff3d', '#4dc5ff', '#a78bfa', '#ff9f43', '#ff607f']
const PROFILE_STORAGE_KEY = 'pace-active-profile-v1'
const DEMO_PROFILE_STORAGE_KEY = 'pace-demo-active-profile-v1'
const BUILTIN_PROFILES: Profile[] = [
  { id: 'profile-bugra', name: 'Bugra', initial: 'B', color: '#c6ff3d' },
  { id: 'profile-sena', name: 'Sena', initial: 'S', color: '#a78bfa' },
]

function emptyData(): AppData {
  return { version: 3, goals: [], entries: [], bodyMetrics: [], gymTemplates: [], gymSessions: [] }
}

function storedProfile(key: string): ProfileId {
  try {
    const value = localStorage.getItem(key)
    return value === 'profile-sena' ? value : DEFAULT_PROFILE_ID
  } catch { return DEFAULT_PROFILE_ID }
}

function ProfileSwitcher({ profile, profiles, onSelect }: { profile: Profile; profiles: Profile[]; onSelect: (id: ProfileId) => void }) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-active="true"]')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const items = [...dialogRef.current.querySelectorAll<HTMLButtonElement>('button')]
      if (!items.length) return
      const first = items[0]!, last = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [open])
  return <div className="profile-switcher">
    <button ref={triggerRef} type="button" className="profile-trigger" aria-label={`Profil: ${profile.name}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span className="profile-avatar" style={{ '--profile-color': profile.color } as CSSProperties}>{profile.initial}</span>
      <span>{profile.name}</span><ChevronDown aria-hidden="true" />
    </button>
    {open && createPortal(<div className="profile-backdrop" onMouseDown={() => { setOpen(false); triggerRef.current?.focus() }}>
      <div ref={dialogRef} className="profile-menu" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div><strong id="profile-dialog-title">Profil wählen</strong><button type="button" className="mini-action" aria-label="Schließen" onClick={() => { setOpen(false); triggerRef.current?.focus() }}><X /></button></div>
        <div className="profile-options" aria-label="Profile">
          {profiles.map((item) => <button key={item.id} type="button" data-active={item.id === profile.id} aria-current={item.id === profile.id ? 'true' : undefined} aria-label={item.id === profile.id ? `${item.name} – aktuelles Profil` : `Zu ${item.name} wechseln`} onClick={() => { onSelect(item.id); setOpen(false); triggerRef.current?.focus() }}>
            <span className="profile-avatar" style={{ '--profile-color': item.color } as CSSProperties}>{item.initial}</span><span><strong>{item.name}</strong><small>{item.id === profile.id ? 'Aktiv' : 'Wechseln'}</small></span>{item.id === profile.id && <Check />}
          </button>)}
        </div>
        <p>Kein Login – beide Profile sind auf diesem Gerät zugänglich.</p>
      </div>
    </div>, document.body)}
  </div>
}

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

function DemoBanner() {
  return (
    <aside className="demo-banner" aria-label="Demo-Modus aktiv">
      <Sparkles size={17} aria-hidden="true" />
      <p>
        <strong>Demo-Daten</strong>
        <span>Änderungen werden nicht gespeichert.</span>
      </p>
      <a href={window.location.pathname}>Normaler Modus</a>
    </aside>
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
  forceDisabled = false,
}: {
  date: Date
  data: AppData
  onSelect: (date: string) => void
  muted?: boolean
  forceDisabled?: boolean
}) {
  const key = toDateKey(date)
  const future = forceDisabled || isAfter(date, new Date())
  const progress = dayGoalProgress(data, key)
  const hasGoals = !future && progress.total > 0
  const partial = hasGoals && progress.done > 0 && progress.done < progress.total
  const progressClass = !hasGoals
    ? 'open'
    : progress.done === progress.total
      ? 'done'
      : progress.done === 0
        ? 'failed'
        : 'partial'
  const progressLabel = future
    ? 'noch nicht verfügbar'
    : progress.total === 0
      ? 'keine aktiven Ziele'
      : `${progress.done} von ${progress.total} Zielen erfüllt`
  const progressStyle = partial
    ? ({ '--goal-progress': `${progress.ratio * 100}%` } as CSSProperties)
    : undefined
  return (
    <button
      type="button"
      className={`day-tile ${progressClass} ${muted ? 'muted' : ''} ${key === todayKey() ? 'today' : ''}`}
      style={progressStyle}
      onClick={() => onSelect(key)}
      disabled={future}
      aria-label={`${format(date, 'd. MMMM yyyy', { locale: de })}: ${progressLabel}`}
    >
      <span>{format(date, 'd')}</span>
      {partial
        ? <small className="progress-badge" aria-hidden="true">{progress.done}/{progress.total}</small>
        : <i className="status-dot" aria-hidden="true" />}
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
  const futurePeriod = start > new Date()
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
            forceDisabled={futurePeriod}
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
    <div className="calendar-panel week-calendar">
      <div className="weekday-row" aria-hidden="true">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="week-grid" role="group" aria-label={periodLabel('week', anchor)}>
        {dateRange(start, end).map((key) => (
          <DayTile key={key} date={fromDateKey(key)} data={data} onSelect={onSelect} />
        ))}
      </div>
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
                <YearDayTile key={key} dateKey={key} data={data} onSelect={onSelect} />
              ))}
            </div>
          </div>
        )
      })}
      <div className="legend">
        <span><i className="done" /> Erfüllt</span>
        <span><i className="partial" /> Teilweise</span>
        <span><i className="failed" /> Verfehlt</span>
        <span><i className="open" /> Offen</span>
      </div>
    </div>
  )
}

function YearDayTile({
  dateKey,
  data,
  onSelect,
}: {
  dateKey: string
  data: AppData
  onSelect: (date: string) => void
}) {
  const date = fromDateKey(dateKey)
  const future = isAfter(date, new Date())
  const progress = dayGoalProgress(data, dateKey)
  const hasGoals = !future && progress.total > 0
  const progressClass = !hasGoals
    ? 'open'
    : progress.done === progress.total
      ? 'done'
      : progress.done === 0
        ? 'failed'
        : 'partial'
  const progressLabel = future
    ? 'noch nicht verfügbar'
    : progress.total === 0
      ? 'keine aktiven Ziele'
      : `${progress.done} von ${progress.total} Zielen erfüllt`

  return (
    <button
      type="button"
      className={progressClass}
      style={progressClass === 'partial'
        ? ({ '--goal-progress': `${progress.ratio * 100}%` } as CSSProperties)
        : undefined}
      aria-label={`${formatShortDate(dateKey)}: ${progressLabel}`}
      onClick={() => onSelect(dateKey)}
      disabled={future}
    />
  )
}

function HistoryView({
  data,
  onSelectDay,
  period,
  anchor,
  onPeriodChange,
  onAnchorChange,
}: {
  data: AppData
  onSelectDay: (date: string) => void
  period: Period
  anchor: Date
  onPeriodChange: (period: Period) => void
  onAnchorChange: (anchor: Date) => void
}) {
  const move = (direction: number) => {
    onAnchorChange(
      period === 'week'
        ? addWeeks(anchor, direction)
        : period === 'month'
          ? addMonths(anchor, direction)
          : addYears(anchor, direction),
    )
  }

  const select = (date: string) => {
    onSelectDay(date)
  }

  return (
    <section className="view">
      <PageIntro eyebrow="Dein Rhythmus" title="Verlauf" />
      <PeriodControl value={period} onChange={onPeriodChange} />
      <DateStepper
        label={periodLabel(period, anchor)}
        onPrevious={() => move(-1)}
        onNext={() => move(1)}
        onToday={() => onAnchorChange(new Date())}
        isCurrent={
          period === 'year'
            ? anchor.getFullYear() === new Date().getFullYear()
            : period === 'week'
              ? isSameISOWeek(anchor, new Date())
              : isSameMonth(anchor, new Date())
        }
        nextDisabled={periodBounds(period, anchor).start > new Date()}
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

function InsightsView({ data, period, anchor }: { data: AppData; period: Period; anchor: Date }) {
  const stats = useMemo(() => calculateStats(data, period, anchor), [data, period, anchor])
  const isCurrent =
    period === 'year'
      ? anchor.getFullYear() === new Date().getFullYear()
      : period === 'week'
        ? isSameISOWeek(anchor, new Date())
        : isSameMonth(anchor, new Date())
  return (
    <section className="view">
      <PageIntro eyebrow="Was funktioniert" title="Insights" />
      <article className="insight-hero">
        <div>
          <p>Erfüllungsquote</p>
          <h2>{periodLabel(period, anchor)}</h2>
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
          <p>{isCurrent ? 'Aktuelle Serie' : 'Serie am Periodenende'}</p>
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

function AnalysisView({ data, onSelectDay }: { data: AppData; onSelectDay: (date: string) => void }) {
  const [period, setPeriod] = useState<Period>('month')
  const [anchor, setAnchor] = useState(new Date())

  return (
    <div className="analysis-combined" aria-label="Analyse">
      <HistoryView
        data={data}
        onSelectDay={onSelectDay}
        period={period}
        anchor={anchor}
        onPeriodChange={setPeriod}
        onAnchorChange={setAnchor}
      />
      <InsightsView data={data} period={period} anchor={anchor} />
    </div>
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
  allowIntegration = true,
}: {
  data: AppData
  onChange: (data: AppData) => void
  allowIntegration?: boolean
}) {
  const [date, setDate] = useState(todayKey())
  const [weight, setWeight] = useState('')
  const [muscle, setMuscle] = useState('')
  const [editingMetricId, setEditingMetricId] = useState<string | null>(null)
  const [integration, setIntegration] = useState<GoogleHealthStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const metrics = sortBodyMetricsNewestFirst(data.bodyMetrics)
  const latestWeight = metrics.find((metric) => metric.weightKg !== undefined)?.weightKg
  const weightTrend = metricTrend(metrics, 'weightKg')
  const muscleTrend = metricTrend(metrics, 'muscleMassKg')

  useEffect(() => {
    if (!allowIntegration) return
    api.googleHealthStatus().then(setIntegration).catch(() => setIntegration(null))
  }, [allowIntegration])

  const disconnect = async () => {
    if (!window.confirm('Google Health wirklich trennen? Bereits importierte Messungen bleiben erhalten.')) return
    try {
      await api.disconnectGoogleHealth()
      setIntegration(await api.googleHealthStatus())
    } catch (error) {
      setIntegration((current) => current ? { ...current, lastSyncError: error instanceof Error ? error.message : 'Trennen fehlgeschlagen.' } : current)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!weight && !muscle) return
    const existing = editingMetricId
      ? data.bodyMetrics.find((metric) => metric.id === editingMetricId)
      : undefined
    const metric: BodyMetric = {
      ...existing,
      id: existing?.id ?? makeId('body'),
      date,
      weightKg: weight ? Number(weight.replace(',', '.')) : existing?.weightKg,
      muscleMassKg: muscle ? Number(muscle.replace(',', '.')) : existing?.muscleMassKg,
      source: existing?.source === 'google-health' ? 'mixed' : (existing?.source ?? 'manual'),
      measuredAt: existing?.measuredAt,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    onChange({
      ...data,
      bodyMetrics: existing
        ? data.bodyMetrics.map((item) => item.id === existing.id ? metric : item)
        : [...data.bodyMetrics, metric],
    })
    setWeight('')
    setMuscle('')
    setEditingMetricId(null)
  }

  return (
    <section className="view">
      <PageIntro eyebrow="Dein Fortschritt" title="Körper" />
      {integration && (
        <div className="info-banner integration-banner">
          <CircleGauge aria-hidden="true" />
          <p>
            <strong>Google Health</strong>
            <span>
              {!integration.configured
                ? 'Auf dem Server noch nicht konfiguriert.'
                : integration.connected
                  ? `Verbunden · Sync alle ${integration.pollingMinutes} Min.`
                  : 'Bereit zum Verbinden.'}
            </span>
            {integration.lastSyncAt && <small>Letzter Sync: {new Date(integration.lastSyncAt).toLocaleString('de-DE')}</small>}
            {integration.lastSyncError && <small className="integration-error">{integration.lastSyncError}</small>}
          </p>
          {integration.configured && !integration.connected && (
            <a className="outline-button" href="/api/integrations/google-health/connect">Verbinden</a>
          )}
          {integration.connected && (
            <div className="integration-actions">
              <button
                type="button"
                className="outline-button"
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true)
                  try {
                    await api.syncGoogleHealth()
                    window.location.reload()
                  } catch (error) {
                    setIntegration((current) => current ? { ...current, lastSyncError: error instanceof Error ? error.message : 'Sync fehlgeschlagen.' } : current)
                  } finally { setSyncing(false) }
                }}
              >{syncing ? 'Synchronisiert …' : 'Jetzt synchronisieren'}</button>
              <a href="/api/integrations/google-health/connect">Neu verbinden</a>
              <button type="button" className="link-button danger" onClick={() => void disconnect()}>Trennen</button>
            </div>
          )}
        </div>
      )}
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
        <div className="section-title">
          <div>
            <p>{editingMetricId ? 'Ausgewählte Messung' : 'Neue Messung'}</p>
            <h2>{editingMetricId ? 'Werte ergänzen' : 'Werte eintragen'}</h2>
          </div>
          {editingMetricId ? (
            <button type="button" className="mini-action" aria-label="Auswahl aufheben" onClick={() => setEditingMetricId(null)}><X /></button>
          ) : <Dumbbell />}
        </div>
        <label>
          <span>Datum</span>
          <input type="date" required max={todayKey()} value={date} onChange={(event) => setDate(event.target.value)} />
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
            <div className="metric-values">
              <span>{metric.weightKg ? `${metric.weightKg.toLocaleString('de-DE')} kg` : '–'}</span>
              <span>{metric.muscleMassKg ? `${metric.muscleMassKg.toLocaleString('de-DE')} kg Muskel` : '–'}</span>
              {metric.bodyFatPercent !== undefined && <small>{metric.bodyFatPercent.toLocaleString('de-DE')} % Fett</small>}
            </div>
            <div className="metric-actions">
              <button
                type="button"
                className="mini-action"
                aria-label={`${metric.weightKg?.toLocaleString('de-DE') ?? 'Messung'} vom ${formatShortDate(metric.date)} ergänzen`}
                onClick={() => {
                  setEditingMetricId(metric.id)
                  setDate(metric.date)
                  setWeight('')
                  setMuscle('')
                }}
              >
                <Pencil />
              </button>
              <button
                type="button"
                className="mini-action danger"
                aria-label={`${metric.weightKg?.toLocaleString('de-DE') ?? 'Messung'} vom ${formatShortDate(metric.date)} löschen`}
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
            </div>
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
  { id: 'gym', label: 'GYM', icon: Dumbbell },
  { id: 'insights', label: 'Analyse', icon: BarChart3 },
  { id: 'goals', label: 'Ziele', icon: Settings2 },
  { id: 'body', label: 'Körper', icon: Scale },
]

function App() {
  const [isDemo] = useState(
    () => new URLSearchParams(window.location.search).get('demo') === '1',
  )
  const preferenceKey = isDemo ? DEMO_PROFILE_STORAGE_KEY : PROFILE_STORAGE_KEY
  const [activeProfileId, setActiveProfileId] = useState<ProfileId>(() => storedProfile(preferenceKey))
  const [profiles, setProfiles] = useState<Profile[]>(BUILTIN_PROFILES)
  const [initialPendingMutations] = useState<PendingMutation[]>(() => isDemo ? [] : loadPendingMutations())
  const [initialDemoData] = useState<Record<ProfileId, AppData>>(() => ({ 'profile-bugra': createDemoData(), 'profile-sena': emptyData() }))
  const demoDataRef = useRef(initialDemoData)
  const [data, setData] = useState<AppData | null>(() => isDemo ? initialDemoData[activeProfileId] : null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [pendingMutationCount, setPendingMutationCount] = useState(initialPendingMutations.length)
  const [googleHealthEnabled, setGoogleHealthEnabled] = useState(false)
  const revisionRef = useRef(0)
  const pendingMutationsRef = useRef<PendingMutation[]>(initialPendingMutations)
  const activeProfileRef = useRef(activeProfileId)
  const loadSequenceRef = useRef(0)
  const processingMutationsRef = useRef(false)
  const processMutationsRef = useRef<() => void>(() => undefined)
  const [tab, setTab] = useState<Tab>('today')
  const [gymEditorDirty, setGymEditorDirty] = useState(false)
  const [selectedDate, setSelectedDate] = useState(todayKey())

  const processMutations = useCallback(async () => {
    if (processingMutationsRef.current || isDemo) return
    processingMutationsRef.current = true
    let failed = false
    let rejectedMessage: string | null = null
    try {
      while (pendingMutationsRef.current.length) {
        const queued = pendingMutationsRef.current[0]!
        let saved = false
        let lastError: unknown
        for (let attempt = 0; attempt < 3 && !saved; attempt++) {
          try {
            const envelope = await api.mutate(queued.profileId, queued.mutation)
            revisionRef.current = Math.max(revisionRef.current, envelope.revision)
            saved = true
          } catch (error) {
            lastError = error
            if (isPermanentMutationError(error)) break
            if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)))
          }
        }
        if (!saved && isPermanentMutationError(lastError)) {
          pendingMutationsRef.current.shift()
          persistPendingMutations(pendingMutationsRef.current)
          setPendingMutationCount(pendingMutationsRef.current.length)
          rejectedMessage = `Speichern abgelehnt: ${lastError.message} Die Änderung wurde zurückgesetzt.`
          continue
        }
        if (!saved) throw lastError
        pendingMutationsRef.current.shift()
        persistPendingMutations(pendingMutationsRef.current)
        setPendingMutationCount(pendingMutationsRef.current.length)
      }
      const requestedProfile = activeProfileRef.current
      const envelope = await api.load(requestedProfile)
      if (requestedProfile === activeProfileRef.current && envelope.revision >= revisionRef.current) {
        revisionRef.current = envelope.revision
        setData(applyPendingMutations(envelope.data, pendingMutationsRef.current, requestedProfile))
      }
      setServerError(rejectedMessage)
    } catch (error) {
      failed = true
      setServerError(`${error instanceof Error ? error.message : 'Speichern fehlgeschlagen.'}${pendingMutationsRef.current.length ? ' Deine Änderung bleibt vorgemerkt.' : ''}`)
    } finally {
      processingMutationsRef.current = false
      if (!failed && pendingMutationsRef.current.length) processMutationsRef.current()
    }
  }, [isDemo])

  useEffect(() => {
    processMutationsRef.current = () => { void processMutations() }
  }, [processMutations])

  useEffect(() => {
    activeProfileRef.current = activeProfileId
    try { localStorage.setItem(preferenceKey, activeProfileId) } catch { /* preference is optional */ }
  }, [activeProfileId, preferenceKey])

  useEffect(() => {
    if (isDemo) return
    const sequence = ++loadSequenceRef.current
    const load = async () => {
      try {
        let envelope = await api.load(activeProfileId)
        const localRaw = localStorage.getItem(STORAGE_KEY)
        const alreadyHandled = localStorage.getItem('pace-server-import-v1')
        if (activeProfileId === DEFAULT_PROFILE_ID && localRaw && !alreadyHandled) {
          const local = loadData()
          const wantsImport = window.confirm('Auf diesem Gerät wurden lokale Pace-Daten gefunden. Sollen sie einmalig sicher auf den Server übertragen werden? Die lokale Kopie bleibt als Backup erhalten.')
          if (wantsImport) {
            try {
              envelope = await api.importLocal(DEFAULT_PROFILE_ID, local)
              localStorage.setItem(`pace-local-backup-${new Date().toISOString()}`, localRaw)
              localStorage.setItem('pace-server-import-v1', 'imported')
            } catch (error) {
              if (error instanceof ApiError && error.status === 409) localStorage.setItem('pace-server-import-v1', 'skipped-conflict')
              setServerError(error instanceof Error ? error.message : 'Lokaler Import fehlgeschlagen.')
            }
          } else {
            localStorage.setItem('pace-server-import-v1', 'declined')
          }
        }
        if (sequence === loadSequenceRef.current && activeProfileId === activeProfileRef.current) {
          if (envelope.revision < revisionRef.current) return
          revisionRef.current = envelope.revision
          setGoogleHealthEnabled(Boolean(envelope.features?.googleHealth))
          if (Array.isArray(envelope.profiles) && envelope.profiles.length) setProfiles(envelope.profiles)
          setData(applyPendingMutations(envelope.data, pendingMutationsRef.current, activeProfileId))
          if (pendingMutationsRef.current.length) processMutationsRef.current()
        }
      } catch (error) {
        if (sequence === loadSequenceRef.current) setServerError(error instanceof Error ? error.message : 'Pace-Server nicht erreichbar.')
      }
    }
    load()
  }, [activeProfileId, isDemo])

  const commitData = (next: AppData) => {
    if (!data) return false
    if (isDemo) {
      demoDataRef.current[activeProfileId] = next
      setData(next)
      return true
    }
    const mutation = deriveMutation(data, next)
    if (!mutation) {
      setServerError('Diese Änderung konnte nicht eindeutig gespeichert werden. Es wurden keine Serverdaten verändert.')
      return false
    }
    pendingMutationsRef.current.push({ profileId: activeProfileId, mutation })
    if (!persistPendingMutations(pendingMutationsRef.current)) {
      pendingMutationsRef.current.pop()
      setServerError('Die Änderung konnte auf diesem Gerät nicht sicher vorgemerkt werden. Bitte prüfe den Browserspeicher und versuche es erneut.')
      return false
    }
    setPendingMutationCount(pendingMutationsRef.current.length)
    setData(next)
    void processMutations()
    return true
  }

  const updateStatus = (goalId: string, status: GoalStatus) => {
    if (selectedDate > todayKey()) return
    if (!data) return
    commitData({ ...data, entries: setEntryStatus(data.entries, goalId, selectedDate, status) })
  }

  const openDay = (date: string) => {
    setSelectedDate(date)
    setTab('today')
  }

  const changeTab = (next: Tab) => {
    if (next === tab) return
    if (gymEditorDirty && tab === 'gym' && !window.confirm('Ungespeicherte Änderungen am Trainingsplan verwerfen?')) return
    setGymEditorDirty(false)
    setTab(next)
  }

  const changeProfile = (next: ProfileId) => {
    if (next === activeProfileId) return
    if (gymEditorDirty && !window.confirm('Ungespeicherte Änderungen am Trainingsplan verwerfen und Profil wechseln?')) return
    setGymEditorDirty(false)
    setSelectedDate(todayKey())
    setTab('today')
    setServerError(null)
    activeProfileRef.current = next
    setActiveProfileId(next)
    if (isDemo) setData(demoDataRef.current[next])
    else setData(null)
  }

  if (!data) {
    return (
      <div className="app-shell server-state">
        <Brand />
        {serverError ? (
          <><h1>Pace ist nicht erreichbar</h1><p>{serverError}</p><button className="primary-button" onClick={() => window.location.reload()}>Erneut versuchen</button></>
        ) : <><span className="loading-pulse" /><p>Daten werden geladen …</p></>}
      </div>
    )
  }

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? BUILTIN_PROFILES.find((profile) => profile.id === activeProfileId)!

  return (
    <div className="app-shell">
      <aside className="desktop-rail">
        <Brand />
        <ProfileSwitcher profile={activeProfile} profiles={profiles} onSelect={changeProfile} />
        <nav aria-label="Hauptnavigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                type="button"
                className={tab === item.id ? 'active' : ''}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => changeTab(item.id)}
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
        <div className="mobile-brand"><Brand /><ProfileSwitcher profile={activeProfile} profiles={profiles} onSelect={changeProfile} /></div>
        <div className="content">
          {isDemo && <DemoBanner />}
          {serverError && !isDemo && <aside className="error-banner" role="alert">{serverError}<button type="button" onClick={() => pendingMutationCount ? void processMutations() : window.location.reload()}>{pendingMutationCount ? 'Erneut speichern' : 'Neu laden'}</button></aside>}
          {tab === 'today' && (
            <TodayView data={data} selectedDate={selectedDate} onDate={setSelectedDate} onStatus={updateStatus} onOpenGoals={() => changeTab('goals')} />
          )}
          {tab === 'gym' && <GymView key={activeProfileId} data={data} onChange={commitData} draftStorageKey={isDemo ? `pace-gym-demo-draft-v2-${activeProfileId}` : activeProfileId === DEFAULT_PROFILE_ID ? 'pace-gym-active-draft-v1' : `pace-gym-active-draft-v2-${activeProfileId}`} onEditorDirtyChange={setGymEditorDirty} />}
          {tab === 'insights' && <AnalysisView data={data} onSelectDay={openDay} />}
          {tab === 'goals' && <GoalsView data={data} onChange={commitData} />}
          {tab === 'body' && <BodyView data={data} onChange={commitData} allowIntegration={googleHealthEnabled && !isDemo} />}
        </div>
      </main>
      <nav className="bottom-nav" aria-label="Hauptnavigation">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button type="button" className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => changeTab(item.id)} key={item.id}>
              <Icon aria-hidden="true" /><span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default App

function mutationId() {
  return `mutation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function isPermanentMutationError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && ![409, 429].includes(error.status)
}

function deriveMutation(current: AppData, next: AppData): DataMutation | null {
  const removedTemplate = current.gymTemplates.find((template) => !next.gymTemplates.some((item) => item.id === template.id))
  if (removedTemplate) return { id: mutationId(), kind: 'gym.template.delete', templateId: removedTemplate.id }
  const changedTemplate = next.gymTemplates.find((template) => JSON.stringify(template) !== JSON.stringify(current.gymTemplates.find((item) => item.id === template.id)))
  if (changedTemplate) return { id: mutationId(), kind: 'gym.template.upsert', template: changedTemplate }
  const removedSession = current.gymSessions.find((session) => !next.gymSessions.some((item) => item.id === session.id))
  if (removedSession) return { id: mutationId(), kind: 'gym.session.delete', sessionId: removedSession.id }
  const completedSession = next.gymSessions.find((session) => !current.gymSessions.some((item) => item.id === session.id))
  if (completedSession) return { id: mutationId(), kind: 'gym.session.complete', session: completedSession }
  const removedGoal = current.goals.find((goal) => !next.goals.some((item) => item.id === goal.id))
  if (removedGoal) return { id: mutationId(), kind: 'goal.delete', goalId: removedGoal.id }
  const changedGoal = next.goals.find((goal) => JSON.stringify(goal) !== JSON.stringify(current.goals.find((item) => item.id === goal.id)))
  if (changedGoal) return { id: mutationId(), kind: 'goal.upsert', goal: changedGoal }
  const removedMetric = current.bodyMetrics.find((metric) => !next.bodyMetrics.some((item) => item.id === metric.id))
  if (removedMetric) return { id: mutationId(), kind: 'body.delete', metricId: removedMetric.id }
  const changedMetric = next.bodyMetrics.find((metric) => JSON.stringify(metric) !== JSON.stringify(current.bodyMetrics.find((item) => item.id === metric.id)))
  if (changedMetric) return { id: mutationId(), kind: 'body.upsert', metric: changedMetric }
  const keys = new Set([...current.entries, ...next.entries].map((entry) => `${entry.goalId}\0${entry.date}`))
  for (const key of keys) {
    const [goalId, date] = key.split('\0')
    const before = current.entries.find((entry) => entry.goalId === goalId && entry.date === date)
    const after = next.entries.find((entry) => entry.goalId === goalId && entry.date === date)
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      return { id: mutationId(), kind: 'entry.set', entry: after ?? { goalId, date, status: 'open', updatedAt: new Date().toISOString() } }
    }
  }
  return null
}
