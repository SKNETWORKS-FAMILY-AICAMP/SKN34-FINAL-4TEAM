import { describe, expect, it } from 'vitest'

import {
  createPairRelationDraft,
  newRelationDraftRow,
  relationDirection,
  relationDirectionPatch,
  relationDraftChanges,
  relationTextPatch,
  removeRelationDraftRow,
} from '../entities/relationDraft'
import {
  applyRelationChanges,
  editStudioSetting,
  putRelation,
  type RelationInput,
} from '../entities/studioRelations'
import { newSetting } from '../entities/studioWorld'

const input = (predicate: string): RelationInput => ({
  subjectId: 'a',
  targetId: 'b',
  predicate,
  polarity: 'asserted',
})
const pair = () => {
  const a = newSetting('people'), b = newSetting('people')
  a.item.title = '가람'
  b.item.title = '나래'
  return [a, b]
}

describe('pair relationship drafts', () => {
  it('starts with one mutual fact and two independent emotion directions', () => {
    const rows = createPairRelationDraft([], 'a', 'b')
    expect(
      rows.map(({ group, value }) => [group, value.subjectId, value.targetId, value.predicate]),
    ).toEqual([
      ['fact', 'a', 'b', 'custom_relation'],
      ['emotion', 'a', 'b', 'custom_emotion'],
      ['emotion', 'b', 'a', 'custom_emotion'],
    ])
    expect(new Set(rows.map(({ key }) => key)).size).toBe(3)
    expect(relationDraftChanges(rows)).toEqual([])
  })

  it('keeps all existing pair rows, legacy predicates and baselines without mutating saved settings', () => {
    const [a, b] = pair()
    let settings = putRelation([a, b], {
      ...input('friend_of'),
      subjectId: a.item.id,
      targetId: b.item.id,
    })
    settings = putRelation(settings, {
      ...input('trusts'),
      subjectId: b.item.id,
      targetId: a.item.id,
    })
    const before = structuredClone(settings)
    const rows = createPairRelationDraft(settings, a.item.id, b.item.id)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      key: settings[2].item.id,
      group: 'fact',
      value: settings[2].item,
      baseline: settings[2].item,
    })
    expect(rows[1]).toMatchObject({
      group: 'emotion',
      value: { predicate: 'trusts', subjectId: b.item.id },
    })
    expect(rows[2]).toMatchObject({
      group: 'emotion',
      value: { subjectId: a.item.id, targetId: b.item.id },
    })
    rows[0].value.text = '패널에서 수정한 원문'
    expect(rows[0].baseline?.text).toBe(before[2].item.text)
    expect(settings).toEqual(before)
  })

  it('treats unknown legacy predicates as facts and excludes unrelated pairs', () => {
    const [a, b] = pair()
    const settings = putRelation([a, b], {
      ...input('friend_of'),
      subjectId: b.item.id,
      targetId: a.item.id,
    })
    settings[2].item.predicate = 'legacy_unknown'
    expect(createPairRelationDraft(settings, a.item.id, b.item.id)[0]).toMatchObject({
      group: 'fact',
      value: { predicate: 'legacy_unknown' },
    })
    expect(createPairRelationDraft(settings, a.item.id, 'other').every((row) => !row.value.id))
      .toBe(true)
  })

  it('preserves legacy directed predicates until prose or mutual direction explicitly replaces them', () => {
    expect(relationDirection(input('friend_of'), 'a')).toBe('mutual')
    expect(relationDirection(input('parent_of'), 'a')).toBe('forward')
    expect(relationDirection(input('parent_of'), 'b')).toBe('reverse')
    expect(relationDirectionPatch(input('parent_of'), 'reverse', 'a', 'b')).toEqual({
      predicate: 'parent_of',
      subjectId: 'b',
      targetId: 'a',
    })
    expect(relationDirectionPatch(input('friend_of'), 'forward', 'a', 'b').predicate).toBe(
      'custom_relation_directed',
    )
    expect(relationDirectionPatch(input('parent_of'), 'mutual', 'a', 'b').predicate).toBe(
      'custom_relation',
    )
    expect(relationTextPatch(input('friend_of'), 'fact', '동료')).toEqual({
      text: '동료',
      predicate: 'custom_relation',
    })
    expect(relationTextPatch(input('parent_of'), 'fact', '부모')).toEqual({
      text: '부모',
      predicate: 'custom_relation_directed',
    })
    expect(relationTextPatch(input('trusts'), 'emotion', '믿지만 두렵다')).toEqual({
      text: '믿지만 두렵다',
      predicate: 'custom_emotion',
    })
  })

  it('includes existing rows and nonblank new prose, retaining their original baseline', () => {
    const existing = {
      key: 'saved',
      group: 'fact' as const,
      value: { ...input('parent_of'), id: 'saved' },
      baseline: input('parent_of'),
    }
    const blank = newRelationDraftRow('fact', 'a', 'b')
    const emotion = newRelationDraftRow('emotion', 'b', 'a')
    emotion.value.text = '  반대 방향만 작성  '
    expect(relationDraftChanges([existing, blank, emotion])).toEqual([
      { ...existing.value, baseline: existing.baseline },
      emotion.value,
    ])
  })

  it('only schedules persisted rows for removal and keeps other rows intact', () => {
    const existing = {
      key: 'saved',
      group: 'fact' as const,
      value: { ...input('friend_of'), id: 'saved' },
    }
    const blank = newRelationDraftRow('emotion', 'a', 'b')
    const draft = { rows: [existing, blank], removed: [] as string[] }
    expect(removeRelationDraftRow(draft, blank)).toEqual({ rows: [existing], removed: [] })
    expect(removeRelationDraftRow(draft, existing)).toEqual({ rows: [blank], removed: ['saved'] })
    expect(draft.rows).toHaveLength(2)
  })

  it('passes unchanged baselines to domain validation so stale edits reject without losing either draft', () => {
    const [a, b] = pair()
    const settings = putRelation([a, b], {
      ...input('friend_of'),
      subjectId: a.item.id,
      targetId: b.item.id,
    })
    const rows = createPairRelationDraft(settings, a.item.id, b.item.id)
    rows[2].value.text = '반대 방향의 새 감정'
    const changes = relationDraftChanges(rows)
    const latest = editStudioSetting(settings, a.item.id, { title: '가람 수정' })
    const before = structuredClone(latest), draft = structuredClone(changes)
    expect(() => applyRelationChanges(latest, changes, [])).toThrow(/다른.*변경/)
    expect(latest).toEqual(before)
    expect(changes).toEqual(draft)
    expect(applyRelationChanges(structuredClone(settings), changes, [])).toHaveLength(4)
  })
})
