export type RepTarget = { min: number; max?: number }

export function parseRepTarget(value: string): RepTarget | undefined {
  const normalized = value.trim().replace(/[–—]/g, '-')
  const match = normalized.match(/^(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/)
  if (!match) return undefined
  const min = Number(match[1])
  const max = match[2] === undefined ? undefined : Number(match[2])
  if (!Number.isInteger(min) || min < 1 || min > 100 || (max !== undefined && (!Number.isInteger(max) || max < min || max > 100))) return undefined
  return max === undefined || max === min ? { min } : { min, max }
}

export function formatRepTarget(min: number, max?: number) {
  return max === undefined || max === min ? String(min) : `${min}–${max}`
}
