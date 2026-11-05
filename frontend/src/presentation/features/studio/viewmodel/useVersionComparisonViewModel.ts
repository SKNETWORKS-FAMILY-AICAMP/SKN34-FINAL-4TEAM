import { useMemo, useState } from 'react'
import type { Version } from '../../../../domain/entities/content'
import { compareText } from '../../../../domain/entities/versionComparison'

export function useVersionComparisonViewModel(versions: Version[]) {
  const [beforeId, setBeforeId] = useState('')
  const [afterId, setAfterId] = useState('')
  const before = versions.find(v => v.id === beforeId), after = versions.find(v => v.id === afterId)
  const comparison = useMemo(() => before && after && before.id !== after.id ? {
    title: compareText(before.title, after.title), body: compareText(before.body, after.body),
  } : null, [before, after])
  const changed = comparison && [...comparison.title.parts, ...comparison.body.parts].some(p => p.kind !== 'same')
  return { before, after, comparison, changed, setBeforeId, setAfterId }
}
