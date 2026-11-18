import type { StudioSetting } from './studioWorld'
import { isFreeRelation, relationDefinitions, type RelationInput } from './studioRelations'

export type RelationGroup = 'fact' | 'emotion' | 'identity'
export type RelationDirection = 'mutual' | 'forward' | 'reverse'

/** 적용 전 입력과 처음 열었을 때의 기준값. 저장하는 SettingItem에는 포함하지 않습니다. */
export type RelationDraftRow = {
  key: string
  group: RelationGroup
  value: RelationInput
  baseline?: RelationInput
}

export function newRelationDraftRow(
  group: RelationGroup,
  subjectId: string,
  targetId: string,
): RelationDraftRow {
  return {
    key: crypto.randomUUID(),
    group,
    value: {
      subjectId,
      targetId,
      predicate: group === 'fact' ? 'custom_relation' : group === 'emotion' ? 'custom_emotion' : 'identity_of',
      polarity: 'asserted',
    },
  }
}

const groupOf = (predicate: string | null | undefined): RelationGroup => {
  const group = relationDefinitions[predicate ?? '']?.group
  return group === 'emotion' || group === 'identity' ? group : 'fact'
}

export function createPairRelationDraft(
  settings: StudioSetting[],
  source: string,
  target: string,
): RelationDraftRow[] {
  const rows: RelationDraftRow[] = settings
    .filter(({ item }) =>
      item.kind === 'relation' && (
        item.subjectId === source && item.targetId === target ||
        item.subjectId === target && item.targetId === source
      )
    )
    .map(({ item }) => ({
      key: item.id,
      group: groupOf(item.predicate),
      value: { ...item },
      baseline: { ...item },
    }))
  if (!rows.some((row) => row.group === 'fact')) {
    rows.push(newRelationDraftRow('fact', source, target))
  }
  for (const [from, to] of [[source, target], [target, source]]) {
    if (!rows.some((row) => row.group === 'emotion' && row.value.subjectId === from)) {
      rows.push(newRelationDraftRow('emotion', from, to))
    }
  }
  return rows
}

export function relationDirection(value: RelationInput, source: string): RelationDirection {
  return relationDefinitions[value.predicate ?? '']?.symmetric
    ? 'mutual'
    : value.subjectId === source
    ? 'forward'
    : 'reverse'
}

export function relationTextPatch(
  value: RelationInput,
  group: RelationGroup,
  text: string,
): Partial<RelationInput> {
  return {
    text,
    predicate: group === 'emotion'
      ? 'custom_emotion'
      : relationDefinitions[value.predicate ?? '']?.symmetric
      ? 'custom_relation'
      : 'custom_relation_directed',
  }
}

export function relationDirectionPatch(
  value: RelationInput,
  direction: RelationDirection,
  source: string,
  target: string,
): Partial<RelationInput> {
  const symmetric = !!relationDefinitions[value.predicate ?? '']?.symmetric
  return {
    predicate: direction === 'mutual'
      ? 'custom_relation'
      : isFreeRelation(value.predicate) || symmetric
      ? 'custom_relation_directed'
      : value.predicate,
    subjectId: direction === 'reverse' ? target : source,
    targetId: direction === 'reverse' ? source : target,
  }
}

export function relationDraftChanges(
  rows: RelationDraftRow[],
): (RelationInput & { baseline?: RelationInput })[] {
  return rows
    .filter((row) => row.value.id || row.value.text?.trim() || row.group === 'identity')
    .map((row) => row.baseline ? { ...row.value, baseline: row.baseline } : row.value)
}

export function removeRelationDraftRow(
  draft: { rows: RelationDraftRow[]; removed: string[] },
  row: RelationDraftRow,
) {
  return {
    rows: draft.rows.filter((candidate) => candidate.key !== row.key),
    removed: row.value.id ? [...draft.removed, row.value.id] : draft.removed,
  }
}

/** 비교 기준은 패널을 연 순간이며 미적용 입력을 원문 그대로 보존합니다. */
// 입력했다가 모두 지운 빈 설명('')은 처음의 빈 값(undefined)과 같은 상태로 비교한다.
const comparable = (value: RelationInput) => JSON.stringify({ ...value, text: value.text || undefined })

export function hasRelationDraftChanges(
  initial: RelationDraftRow[],
  rows: RelationDraftRow[],
  removed: string[],
): boolean {
  const normalized = (list: RelationDraftRow[]) =>
    JSON.stringify(list.map((row) => ({ ...row, value: { ...row.value, text: row.value.text || undefined } })))
  return removed.length > 0 || normalized(initial) !== normalized(rows)
}

/** 일부만 작성한 새 행을 적용 과정에서 조용히 버리지 않습니다. */
export function hasIncompleteRelationDraft(initial: RelationDraftRow[], rows: RelationDraftRow[]): boolean {
  return rows.some((row) => {
    if (row.value.id || row.value.text?.trim() || row.group === 'identity') return false
    const original = initial.find((candidate) => candidate.key === row.key)
    return !original || comparable(original.value) !== comparable(row.value)
  })
}

/** 「동일 인물」의 본체로 고른 카드가 [bodyId]일 때의 끝점이다. 본체가 아닌 다른 카드가 다른 이름(주체)이 된다. */
export function identityBodyPatch(bodyId: string, source: string, target: string): Partial<RelationInput> {
  return { subjectId: bodyId === source ? target : source, targetId: bodyId }
}

/**
 * 「동일 인물」을 새로 쓰거나 바꾸거나 끝내는 적용인지(처음 [initial]에서 [rows]·[removed]로). 그런 저장은 관계 기준 회차가 있어야 한다(서버도 회차 없는 저장을 422로 거절한다).
 * 그대로 둔 행은 회차를 다시 정하지 않아도 된다.
 */
export function identityNeedsEpisode(initial: RelationDraftRow[], rows: RelationDraftRow[], removed: string[]): boolean {
  return rows.some((row) => row.group === 'identity' && (!row.baseline || comparable(row.baseline) !== comparable(row.value))) ||
    initial.some((row) => row.group === 'identity' && !!row.value.id && removed.includes(row.value.id))
}

/** 카드가 '작가 전용'(공개 회차도 없고 공개 카드도 아님)인지. 본체가 작가 전용이면 인물 지식에 시점 제한이 없어 다른 인물이 본체를 알 수 있다(DEC-53). */
export const isAuthorOnly = (setting: Pick<StudioSetting, 'revealFromEpisode' | 'visibility'> | undefined): boolean =>
  !!setting && !setting.revealFromEpisode && setting.visibility !== 'public'
