import { expect, it } from 'vitest'

import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { publicCardCount, publishAllCards, revealLabel, setCardReveal, visibleSelection } from './cardVisibility'

/** 카드 하나. `reveal`은 저장된 공개 회차, `visibility`는 옛 공개 값이다(둘 다 없으면 작가 전용). */
const card = (title: string, reveal?: number, visibility?: StudioSetting['visibility']): StudioSetting => {
  const row = newSetting('people')
  row.item.title = title
  return { ...row, ...(reveal !== undefined && { revealFromEpisode: reveal }), ...(visibility && { visibility }) }
}
const ids = (...rows: StudioSetting[]) => new Set(rows.map((row) => row.item.id))
const keys = (row: StudioSetting) => Object.keys(row)

it('현재 페이지에 보이는 선택만 일괄 변경한다', () => {
  const [a, b, c] = [card('가'), card('나'), card('다')]
  const chosen = visibleSelection([{ cardId: b.item.id }, { cardId: c.item.id }], ids(a, b))
  expect(chosen).toEqual([b.item.id])
  expect(setCardReveal([a, b, c], new Set(chosen), 1).map((row) => row.revealFromEpisode)).toEqual([undefined, 1, undefined])
})

it('고른 카드에 같은 회차를 정하고 visibility를 공개로 맞추며 나머지 행은 그대로 둔다', () => {
  const [a, b, c] = [card('가'), card('나'), card('다')]
  const next = setCardReveal([a, b, c], ids(a, c), 3)
  expect(next.map((row) => [row.revealFromEpisode, row.visibility])).toEqual([[3, 'public'], [undefined, undefined], [3, 'public']])
  expect(next[1]).toBe(b)
  expect(a.revealFromEpisode).toBeUndefined() // 받은 행을 고치지 않는다
})

it('이미 다른 회차가 정해진 카드도 고른 회차로 덮어 모두 같은 N화부터가 된다', () => {
  const [a, b] = [card('가', 5, 'public'), card('나', 2)]
  expect(setCardReveal([a, b], ids(a, b), 3).map((row) => [row.revealFromEpisode, row.visibility])).toEqual([[3, 'public'], [3, 'public']])
})

it('작가 전용으로 바꾸면 회차와 visibility를 모두 지운다(값이 없으면 작가 전용)', () => {
  const [a, b] = [card('가', 3, 'public'), card('나', 2, 'public')]
  const next = setCardReveal([a, b], ids(a), undefined)
  expect(keys(next[0])).not.toContain('visibility')
  expect(keys(next[0])).not.toContain('revealFromEpisode')
  expect(next[1]).toBe(b)
})

it('옛 공개 카드(공개 + 회차 없음)는 1화와 같아 그대로 두고, 다른 회차를 정하면 값을 쓴다', () => {
  const legacy = card('가', undefined, 'public')
  const settings = [legacy]
  expect(setCardReveal(settings, ids(legacy), 1)).toBe(settings) // 이미 1화부터 공개라 다시 쓰지 않는다
  const next = setCardReveal(settings, ids(legacy), 2)
  expect([next[0].revealFromEpisode, next[0].visibility]).toEqual([2, 'public'])
  const hidden = setCardReveal(settings, ids(legacy), undefined)
  expect([hidden[0].revealFromEpisode, keys(hidden[0]).includes('visibility')]).toEqual([undefined, false])
})

it('회차 값만 있고 visibility가 비공개인 옛 카드는 같은 회차를 다시 정해도 visibility를 공개로 맞춘다', () => {
  const revealOnly = card('가', 3)
  const next = setCardReveal([revealOnly], ids(revealOnly), 3)
  expect([next[0].revealFromEpisode, next[0].visibility]).toEqual([3, 'public'])
})

it('바뀐 카드가 없으면 받은 배열을 그대로 돌려줘 저장할 변경을 만들지 않는다', () => {
  const settings = [card('가', 3, 'public'), card('나')]
  expect(setCardReveal(settings, ids(settings[0]), 3)).toBe(settings)
  expect(setCardReveal(settings, ids(settings[1]), undefined)).toBe(settings)
  expect(setCardReveal(settings, new Set(['없는 카드']), 3)).toBe(settings)
})

it('관계 행은 골라도 공개 회차를 갖지 않고 공개 카드 수에도 세지 않는다', () => {
  const [a, b] = [card('가'), card('나', undefined, 'public')]
  const settings = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
  const relation = settings[2]
  expect(setCardReveal(settings, ids(relation), 2)).toBe(settings)
  expect(publicCardCount(settings)).toBe(1)
  expect(publicCardCount([...settings, { ...relation, visibility: 'public' }])).toBe(1)
  expect(publicCardCount(setCardReveal(settings, ids(a, b, relation), 1))).toBe(2)
  expect(publicCardCount([])).toBe(0)
})

it('공개 카드 수는 유효 공개 회차가 있는 카드를 센다(회차 값만 있는 옛 카드도 공개다)', () => {
  expect(publicCardCount([card('가'), card('나', undefined, 'public'), card('다', 3), card('라', 2, 'public')])).toBe(3)
})

it('전체 공개는 설정집의 카드 모두에 같은 회차를 정하고 집필 메모·관계는 건드리지 않으며, 이미 모두 그 회차면 받은 배열 그대로다', () => {
  const [a, b] = [card('가'), card('나', undefined, 'public')]
  const note = newSetting('notes')
  const settings = putRelation([a, b, note], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
  const all = publishAllCards(settings, 1)
  expect(all.map((row) => row.visibility)).toEqual(['public', 'public', undefined, undefined])
  expect(all.map((row) => row.revealFromEpisode)).toEqual([1, undefined, undefined, undefined]) // 옛 공개 카드는 이미 1화부터라 다시 쓰지 않는다
  expect(all[1]).toBe(b)
  expect(publishAllCards(all, 1)).toBe(all)
  // 다른 회차를 고르면 옛 공개 카드까지 모두 그 회차로 바뀐다.
  expect(publishAllCards(all, 4).map((row) => row.revealFromEpisode)).toEqual([4, 4, undefined, undefined])
})

it('공개 설정을 글자로: 작가 전용, 미연결 세계관의 1화는 공개, 그 밖은 N화부터', () => {
  expect([revealLabel(undefined, true), revealLabel(undefined, false)]).toEqual(['작가 전용', '작가 전용'])
  expect([revealLabel(1, false), revealLabel(1, true)]).toEqual(['공개', '1화부터'])
  expect([revealLabel(3, false), revealLabel(3, true)]).toEqual(['3화부터', '3화부터'])
})
