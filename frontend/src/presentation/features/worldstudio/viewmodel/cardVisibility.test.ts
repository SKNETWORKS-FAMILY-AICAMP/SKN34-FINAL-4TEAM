import { expect, it } from 'vitest'

import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { publicCardCount, publishAllCards, setCardVisibility } from './cardVisibility'

const card = (title: string, visibility?: StudioSetting['visibility']): StudioSetting => {
  const row = newSetting('people')
  row.item.title = title
  return visibility ? { ...row, visibility } : row
}
const ids = (...rows: StudioSetting[]) => new Set(rows.map((row) => row.item.id))

it('고른 카드만 공개로 바꾸고 나머지 행은 그대로 둔다', () => {
  const [a, b, c] = [card('가'), card('나'), card('다')]
  const next = setCardVisibility([a, b, c], ids(a, c), 'public')
  expect(next.map((row) => row.visibility)).toEqual(['public', undefined, 'public'])
  expect(next[1]).toBe(b)
  expect(a.visibility).toBeUndefined() // 받은 행을 고치지 않는다
})

it('비공개로 바꾸면 값을 지운다(값이 없으면 비공개)', () => {
  const [a, b] = [card('가', 'public'), card('나', 'public')]
  const next = setCardVisibility([a, b], ids(a), 'private')
  expect(Object.keys(next[0])).not.toContain('visibility')
  expect(next[1]).toBe(b)
})

it('바뀐 카드가 없으면 받은 배열을 그대로 돌려줘 저장할 변경을 만들지 않는다', () => {
  const settings = [card('가', 'public'), card('나')]
  expect(setCardVisibility(settings, ids(settings[0]), 'public')).toBe(settings)
  expect(setCardVisibility(settings, ids(settings[1]), 'private')).toBe(settings)
  expect(setCardVisibility(settings, new Set(['없는 카드']), 'public')).toBe(settings)
})

it('관계 행은 골라도 공개 범위를 갖지 않고 공개 카드 수에도 세지 않는다', () => {
  const [a, b] = [card('가'), card('나', 'public')]
  const settings = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
  const relation = settings[2]
  expect(setCardVisibility(settings, ids(relation), 'public')).toBe(settings)
  expect(publicCardCount(settings)).toBe(1)
  expect(publicCardCount([...settings, { ...relation, visibility: 'public' }])).toBe(1)
  expect(publicCardCount(setCardVisibility(settings, ids(a, b, relation), 'public'))).toBe(2)
  expect(publicCardCount([])).toBe(0)
})

it('전체 공개는 설정집의 카드만 공개로 바꾸고 집필 메모·관계는 건드리지 않으며, 이미 모두 공개면 받은 배열 그대로다', () => {
  const [a, b] = [card('가'), card('나', 'public')]
  const note = newSetting('notes')
  const settings = putRelation([a, b, note], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
  const all = publishAllCards(settings)
  expect(all.map((row) => row.visibility)).toEqual(['public', 'public', undefined, undefined])
  expect(publishAllCards(all)).toBe(all)
})
