export const DEFAULT_TIME_ZONE = 'Europe/Berlin'

export function normalizeTimeZone(value: string) {
  const timeZone = value.trim()
  if (!timeZone) throw new Error('PACE_TIME_ZONE muss eine gültige IANA-Zeitzone sein.')
  try {
    return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone
  } catch {
    throw new Error('PACE_TIME_ZONE muss eine gültige IANA-Zeitzone sein.')
  }
}

export function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
