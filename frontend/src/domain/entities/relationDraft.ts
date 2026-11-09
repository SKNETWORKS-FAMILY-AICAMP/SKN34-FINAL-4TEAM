import type { StudioSetting } from './studioWorld'
import { isFreeRelation, relationDefinitions, type RelationInput } from './studioRelations'

export type RelationGroup = 'fact' | 'emotion'
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
      predicate: group === 'fact' ? 'custom_relation' : 'custom_emotion',
      polarity: 'asserted',
    },
  }
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
      group: relationDefinitions[item.predicate ?? '']?.group === 'emotion' ? 'emotion' : 'fact',
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
    .filter((row) => row.value.id || row.value.text?.trim())
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
export function hasRelationDraftChanges(
  initial: RelationDraftRow[],
  rows: RelationDraftRow[],
  removed: string[],
): boolean {
  return removed.length > 0 || JSON.stringify(initial) !== JSON.stringify(rows)
}

/** 일부만 작성한 새 행을 적용 과정에서 조용히 버리지 않습니다. */
export function hasIncompleteRelationDraft(initial: RelationDraftRow[], rows: RelationDraftRow[]): boolean {
  return rows.some((row) => {
    if (row.value.id || row.value.text?.trim()) return false
    const original = initial.find((candidate) => candidate.key === row.key)
    return !original || JSON.stringify(original.value) !== JSON.stringify(row.value)
  })
}
