import { useState } from 'react'

import {
  createPairRelationDraft,
  newRelationDraftRow,
  type RelationDirection,
  relationDirection,
  relationDirectionPatch,
  relationDraftChanges,
  type RelationDraftRow,
  type RelationGroup,
  relationTextPatch,
  removeRelationDraftRow,
} from '../../../../domain/entities/relationDraft'
import type { RelationInput } from '../../../../domain/entities/studioRelations'
import type { StudioSetting } from '../../../../domain/entities/studioWorld'

type PairEditor = {
  editing: { settings: StudioSetting[] } | null
  applyRelations: (changes: RelationInput[], removed: string[]) => boolean
}

/** 열린 패널의 입력은 재조회로 덮어쓰지 않고, 최초 baseline을 기존 Domain 검증으로 전달합니다. */
export function useRelationPairViewModel(
  studio: PairEditor,
  source: string,
  target: string,
  onClose: () => void,
) {
  const [draft, setDraft] = useState(() => ({
    rows: createPairRelationDraft(studio.editing!.settings, source, target),
    removed: [] as string[],
  }))
  const [initial] = useState(draft)
  const [error, setError] = useState('')
  const change = (key: string, patch: Partial<RelationInput>) => {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.key === key ? { ...row, value: { ...row.value, ...patch } } : row
      ),
    }))
    setError('')
  }
  return {
    ...draft,
    dirty: draft !== initial,
    error,
    change,
    direction: (row: RelationDraftRow) => relationDirection(row.value, source),
    write: (row: RelationDraftRow, text: string) =>
      change(row.key, relationTextPatch(row.value, row.group, text)),
    setDirection: (row: RelationDraftRow, direction: RelationDirection) =>
      change(row.key, relationDirectionPatch(row.value, direction, source, target)),
    reverse: (row: RelationDraftRow) =>
      change(row.key, { subjectId: row.value.targetId, targetId: row.value.subjectId }),
    add: (group: RelationGroup, from: string, to: string) =>
      setDraft((current) => ({
        ...current,
        rows: [...current.rows, newRelationDraftRow(group, from, to)],
      })),
    remove: (row: RelationDraftRow) => setDraft((current) => removeRelationDraftRow(current, row)),
    apply: () => {
      const changes = relationDraftChanges(draft.rows)
      if (!changes.length && !draft.removed.length) {
        setError('실제 관계나 감정을 하나 이상 선택해 주세요.')
        return
      }
      if (studio.applyRelations(changes, draft.removed)) onClose()
      else setError('적용하지 못했습니다. 중복된 관계와 연결 대상, 이름·설명을 확인해 주세요.')
    },
  }
}
