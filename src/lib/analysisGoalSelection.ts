export type AnalysisGoalSelection =
  | { mode: 'all' }
  | { mode: 'custom'; goalIds: string[] }

interface StoredAnalysisGoalSelection {
  version: 1
  mode: 'all' | 'custom'
  goalIds?: string[]
}

export function analysisGoalSelectionStorageKey(profileId: string, demo = false) {
  return `pace-analysis-goals-v1-${demo ? 'demo-' : ''}${profileId}`
}

export function reconcileAnalysisGoalSelection(
  selection: AnalysisGoalSelection,
  availableGoalIds: readonly string[],
): AnalysisGoalSelection {
  if (selection.mode === 'all') return selection
  const available = new Set(availableGoalIds)
  const goalIds = selection.goalIds.filter((id, index, values) =>
    available.has(id) && values.indexOf(id) === index)

  if (goalIds.length === 0 && availableGoalIds.length > 0) return { mode: 'all' }
  // A custom selection containing every available goal is visually identical
  // to "all". Normalize it so goals created later are included as expected.
  if (goalIds.length === availableGoalIds.length) return { mode: 'all' }
  if (goalIds.length === selection.goalIds.length && goalIds.every((id, index) => id === selection.goalIds[index])) {
    return selection
  }
  return { mode: 'custom', goalIds }
}

export function selectedAnalysisGoalIds(
  selection: AnalysisGoalSelection,
  availableGoalIds: readonly string[],
) {
  const reconciled = reconcileAnalysisGoalSelection(selection, availableGoalIds)
  return reconciled.mode === 'all' ? [...availableGoalIds] : reconciled.goalIds
}

export function toggleAnalysisGoal(
  selection: AnalysisGoalSelection,
  goalId: string,
  availableGoalIds: readonly string[],
): AnalysisGoalSelection {
  const selected = selectedAnalysisGoalIds(selection, availableGoalIds)
  if (selection.mode === 'all') return { mode: 'custom', goalIds: [goalId] }
  if (!selected.includes(goalId)) {
    const goalIds = [...selected, goalId]
    return goalIds.length === availableGoalIds.length ? { mode: 'all' } : { mode: 'custom', goalIds }
  }
  if (selected.length === 1) return selection
  return { mode: 'custom', goalIds: selected.filter((id) => id !== goalId) }
}

export function loadAnalysisGoalSelection(storageKey: string): AnalysisGoalSelection {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as StoredAnalysisGoalSelection | null
    if (!parsed || parsed.version !== 1) return { mode: 'all' }
    if (parsed.mode === 'all') return { mode: 'all' }
    if (parsed.mode === 'custom' && Array.isArray(parsed.goalIds) && parsed.goalIds.every((id) => typeof id === 'string')) {
      return { mode: 'custom', goalIds: parsed.goalIds }
    }
  } catch { /* an optional preference must never block the analysis */ }
  return { mode: 'all' }
}

export function saveAnalysisGoalSelection(storageKey: string, selection: AnalysisGoalSelection) {
  const stored: StoredAnalysisGoalSelection = { version: 1, ...selection }
  try { localStorage.setItem(storageKey, JSON.stringify(stored)) } catch { /* optional preference */ }
}
