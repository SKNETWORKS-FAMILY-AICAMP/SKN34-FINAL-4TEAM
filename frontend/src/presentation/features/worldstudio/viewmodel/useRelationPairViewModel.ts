import { useEffect, useRef, useState } from 'react'

import {
  createPairRelationDraft,
  hasRelationDraftChanges,
  hasIncompleteRelationDraft,
  identityBodyPatch,
  identityNeedsEpisode,
  isAuthorOnly,
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
import { cardTypeOf } from '../../../../domain/entities/studioCards'
import type { RelationInput } from '../../../../domain/entities/studioRelations'
import type { StudioSetting } from '../../../../domain/entities/studioWorld'

const IDENTITY_EPISODE_ERROR = '「동일 인물」은 관계 기준 회차를 정해야 저장돼요. 이 패널을 닫고 위의 "관계 기준" 칸에서 회차를 정한 뒤 다시 열어 주세요.'

type PairEditor = {
  /** 「동일 인물」을 기록할 회차(#485): 소설을 연결한 세계관은 정한 관계 기준 회차(정하지 않았으면 null), 연결하지 않은 세계관은 1이다. */
  identityEpisode: number | null
  editing: { settings: StudioSetting[] } | null
  applyRelations: (changes: RelationInput[], removed: string[]) => boolean
  setRelationDirty: (value: boolean) => void
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
  const initialRows = useRef(draft.rows)
  const originalRows = useRef(draft.rows)
  const changed = hasRelationDraftChanges(initialRows.current, draft.rows, draft.removed)
  const { setRelationDirty } = studio
  useEffect(() => { setRelationDirty(changed) }, [changed, setRelationDirty])
  useEffect(() => () => setRelationDirty(false), [setRelationDirty])
  const [error, setError] = useState('')
  // 「동일 인물」은 인물 카드끼리만 이을 수 있다(서버도 거절한다).
  const identityAllowed = [source, target].every((id) => {
    const item = studio.editing!.settings.find((s) => s.item.id === id)?.item
    return !!item && cardTypeOf(item) === 'character'
  })
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
    dirty: changed,
    error,
    identityAllowed,
    change,
    direction: (row: RelationDraftRow) => relationDirection(row.value, source),
    write: (row: RelationDraftRow, text: string) =>
      change(row.key, relationTextPatch(row.value, row.group, text)),
    setDirection: (row: RelationDraftRow, direction: RelationDirection) =>
      change(row.key, relationDirectionPatch(row.value, direction, source, target)),
    setBody: (row: RelationDraftRow, bodyId: string) => change(row.key, identityBodyPatch(bodyId, source, target)),
    /** 이 「동일 인물」의 본체 카드가 '작가 전용'인지(다른 인물이 본체를 알 수 있다고 경고한다). */
    bodyAuthorOnly: (row: RelationDraftRow) => isAuthorOnly(studio.editing!.settings.find((s) => s.item.id === row.value.targetId)),
    reverse: (row: RelationDraftRow) =>
      change(row.key, { subjectId: row.value.targetId, targetId: row.value.subjectId }),
    add: (group: RelationGroup, from: string, to: string) => {
      const row = newRelationDraftRow(group, from, to)
      originalRows.current = [...originalRows.current, row]
      setDraft((current) => ({ ...current, rows: [...current.rows, row] }))
    },
    remove: (row: RelationDraftRow) => setDraft((current) => removeRelationDraftRow(current, row)),
    apply: () => {
      if (hasIncompleteRelationDraft(originalRows.current, draft.rows)) {
        setError('입력 중인 관계의 설명을 적거나 해당 행을 삭제해 주세요.')
        return
      }
      if (identityNeedsEpisode(initialRows.current, draft.rows, draft.removed) && studio.identityEpisode === null) {
        setError(IDENTITY_EPISODE_ERROR)
        return
      }
      const changes = relationDraftChanges(draft.rows)
      if (!changes.length && !draft.removed.length) {
        setError('실제 관계나 감정을 하나 이상 선택해 주세요.')
        return
      }
      if (studio.applyRelations(changes, draft.removed)) onClose()
      else setError('적용하지 못했어요. 중복된 관계와 연결 대상, 이름·설명을 확인해 주세요.')
    },
  }
}
