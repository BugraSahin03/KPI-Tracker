import {
  addDays,
  endOfISOWeek,
  endOfMonth,
  endOfYear,
  format,
  getISOWeek,
  getISOWeekYear,
  isSameDay,
  parseISO,
  startOfISOWeek,
  startOfMonth,
  startOfYear,
} from 'date-fns'
import { de } from 'date-fns/locale'
import type { Period } from '../types.js'

export const toDateKey = (date: Date) => format(date, 'yyyy-MM-dd')
export const fromDateKey = (key: string) => parseISO(key)
export const todayKey = () => toDateKey(new Date())

export function formatDayTitle(key: string) {
  const date = fromDateKey(key)
  if (isSameDay(date, new Date())) return 'Heute'
  return format(date, 'EEEE, d. MMMM', { locale: de })
}

export function formatShortDate(key: string) {
  return format(fromDateKey(key), 'dd.MM.yy')
}

export function dateRange(start: Date, end: Date) {
  const result: string[] = []
  let current = start
  while (current <= end) {
    result.push(toDateKey(current))
    current = addDays(current, 1)
  }
  return result
}

export function periodBounds(period: Period, anchor: Date, capAtToday = false) {
  const start =
    period === 'week'
      ? startOfISOWeek(anchor)
      : period === 'month'
        ? startOfMonth(anchor)
        : startOfYear(anchor)
  let end =
    period === 'week'
      ? endOfISOWeek(anchor)
      : period === 'month'
        ? endOfMonth(anchor)
        : endOfYear(anchor)
  const now = new Date()
  if (capAtToday && end > now) end = now
  return { start, end }
}

export function periodLabel(period: Period, anchor: Date) {
  if (period === 'week') {
    const { start, end } = periodBounds(period, anchor)
    return `KW ${getISOWeek(anchor)} · ${format(start, 'dd. MMM', { locale: de })} – ${format(end, 'dd. MMM', { locale: de })} ${getISOWeekYear(anchor)}`
  }
  if (period === 'month') return format(anchor, 'MMMM yyyy', { locale: de })
  return format(anchor, 'yyyy')
}
