import { useMemo, useState } from 'react'
import type { Version } from '../../../../domain/entities/content'
import { compareText } from '../../../../domain/entities/versionComparison'

export function useVersionComparisonViewModel(versions: Version[], scope: string) {
  const [selection, setSelection] = useState({ scope, beforeId: '', afterId: '' })
  const before = selection.scope === scope ? versions.find(v => v.id === selection.beforeId) : undefined
  const after = selection.scope === scope ? versions.find(v => v.id === selection.afterId) : undefined
  if (selection.scope !== scope || selection.beforeId !== (before?.id ?? '') || selection.afterId !== (after?.id ?? '')) {
    setSelection({ scope, beforeId: before?.id ?? '', afterId: after?.id ?? '' })
  }
  const setBeforeId = (beforeId: string) => setSelection(current => ({ ...current, beforeId }))
  const setAfterId = (afterId: string) => setSelection(current => ({ ...current, afterId }))
  const comparison = useMemo(() => before && after && before.id !== after.id ? {
    title: compareText(before.title, after.title), body: compareText(before.body, after.body),
  } : null, [before, after])
  const changed = comparison && [...comparison.title.parts, ...comparison.body.parts].some(p => p.kind !== 'same')
  return { before, after, comparison, changed, setBeforeId, setAfterId }
}
