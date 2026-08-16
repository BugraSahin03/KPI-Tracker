export function parseDecimalInput(value: string): number | undefined {
  const normalized = value.trim().replace(',', '.')
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function formatDecimalInput(value: number | undefined): string {
  return value === undefined ? '' : value.toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 3 })
}
