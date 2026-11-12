import { expect, it } from 'vitest'

import type { PublicWorld, PublicWorldCard, PublicWorldSummary } from '../../domain/entities/publicWorld'
import { cardTypeOf, cardTypes } from '../../domain/entities/studioCards'
import { relationLabel } from '../../domain/entities/studioRelations'
import { newSetting, type StudioSetting } from '../../domain/entities/studioWorld'
import { appendImported, importableWorlds, importCards } from './importCards'

const publicCard = (id: string, title: string, cardType: PublicWorldCard['cardType'] = 'character'): PublicWorldCard => ({ id, title, text: `${title} 본문`, cardType, aliases: [`${title} 별칭`], tags: ['태그'] })
const source = (over: Partial<PublicWorld> = {}): PublicWorld => ({
  id: 'world-src', name: '원본 세계', description: '', genre: null, authorNickname: '원작자', publishedAt: '2026-11-12T00:00:00Z', revisionNo: 4,
  cards: [publicCard('a', '가람'), publicCard('b', '나래'), publicCard('c', '항구', 'location')],
  relationships: [
    { id: 'r1', sourceCardId: 'a', targetCardId: 'b', label: '스승과 제자' },
    { id: 'r2', sourceCardId: 'a', targetCardId: 'c', label: '고향' },
  ],
  relationshipStatus: 'current', ...over,
})
const pick = (...ids: string[]) => new Set(ids)

it('고른 공개 카드만 새 id의 설정으로 복사하고 제목·본문·유형·별칭·태그를 지킨다', () => {
  const { cards } = importCards(source(), pick('a', 'c'), false)
  expect(cards.map((s) => [s.item.title, s.item.text, cardTypeOf(s.item), s.aliases, s.tags])).toEqual([
    ['가람', '가람 본문', 'character', ['가람 별칭'], ['태그']], ['항구', '항구 본문', 'location', ['항구 별칭'], ['태그']],
  ])
  const ids = cards.map((s) => s.item.id)
  expect(new Set([...ids, 'a', 'c']).size).toBe(4) // 원본 id를 쓰지 않고 서로도 다르다
  expect(cards.every((s) => s.item.authorText === s.item.text && s.item.origin === 'author_addition' && s.item.decision === 'approved')).toBe(true) // 작가가 직접 쓴 카드와 같은 모양
})

it('카드 유형 여덟 가지를 그대로 옮긴다(사건은 역사 영역)', () => {
  const world = source({ cards: cardTypes.map((type) => publicCard(type.id, type.label, type.id)), relationships: [] })
  const { cards } = importCards(world, pick(...cardTypes.map((type) => type.id)), false)
  expect(cards.map((s) => cardTypeOf(s.item))).toEqual(cardTypes.map((type) => type.id))
  expect(cards.find((s) => s.item.kind === 'event')?.item.category).toBe('history')
})

it('출처(원본 세계관·작가·확정 버전·원본 카드)를 기록하고 비공개·독자 공개 회차 없음으로 시작한다', () => {
  const [card] = importCards(source(), pick('b'), true).cards
  expect(card.importedFrom).toEqual({ worldId: 'world-src', worldName: '원본 세계', authorNickname: '원작자', revisionNo: 4, cardId: 'b' })
  expect(Object.keys(card)).not.toContain('visibility')
  expect(Object.keys(card)).not.toContain('revealFromEpisode')
})

it('관계는 포함을 골랐을 때만, 양 끝을 모두 가져온 것만 새 카드 id로 이어 복사한다', () => {
  expect(importCards(source(), pick('a', 'b', 'c'), false).relations).toEqual([])
  const { cards, relations } = importCards(source(), pick('a', 'b'), true) // 항구(c)는 가져오지 않아 '고향' 관계는 빠진다
  const [a, b] = cards.map((s) => s.item.id)
  expect(relations).toEqual([{ subjectId: a, targetId: b, predicate: 'custom_relation_directed', polarity: 'asserted', title: '스승과 제자', text: '스승과 제자' }])
  expect(importCards(source(), pick('a'), true).relations).toEqual([])
})

it('같은 두 카드의 같은 이름 관계는 한 번만, 자기 자신을 잇는 관계는 버리고, 이름이 빈 관계는 이름 없이 넘긴다', () => {
  const world = source({ relationships: [
    { id: 'r1', sourceCardId: 'a', targetCardId: 'b', label: '동료' }, { id: 'r2', sourceCardId: 'a', targetCardId: 'b', label: '동료' },
    { id: 'r3', sourceCardId: 'a', targetCardId: 'a', label: '자신' }, { id: 'r4', sourceCardId: 'b', targetCardId: 'a', label: '  ' },
  ] })
  const { cards, relations } = importCards(world, pick('a', 'b'), true)
  const [a, b] = cards.map((s) => s.item.id)
  expect(relations).toEqual([
    { subjectId: a, targetId: b, predicate: 'custom_relation_directed', polarity: 'asserted', title: '동료', text: '동료' },
    { subjectId: b, targetId: a, predicate: 'custom_relation_directed', polarity: 'asserted' },
  ])
})

it('가져올 세계관 목록에서 대상 세계관 자신은 뺀다', () => {
  const worlds = ['mine', 'other', 'another'].map((id) => ({ id, name: id }) as PublicWorldSummary)
  expect(importableWorlds(worlds, 'mine').map((w) => w.id)).toEqual(['other', 'another'])
  expect(importableWorlds(worlds, 'none')).toHaveLength(3)
})

const mine = (title: string): StudioSetting => {
  const row = newSetting('people')
  row.item.title = title
  return row
}

it('가져온 카드와 관계를 초안 끝에 더하고 관계는 기존 관계 형식의 사용자 정의 방향 관계가 된다', () => {
  const draft = [mine('기존 인물')]
  const imported = importCards(source(), pick('a', 'b'), true)
  const next = appendImported(draft, imported)
  expect(next.slice(0, 3)).toEqual([...draft, ...imported.cards])
  const relation = next[3].item
  expect([relation.kind, relation.subjectId, relation.targetId, relation.predicate, relationLabel(relation), relation.title]).toEqual(['relation', imported.cards[0].item.id, imported.cards[1].item.id, 'custom_relation_directed', '스승과 제자', '스승과 제자'])
  expect(draft).toHaveLength(1) // 받은 초안은 그대로다
})

it('서버 한도(설정 카드 1,000개)를 넘기면 더하지 않고 몇 개까지 가져올 수 있는지 알린다', () => {
  const draft = Array.from({ length: 999 }, (_, n) => mine(`인물 ${n}`))
  const one = importCards(source(), pick('a'), false), two = importCards(source(), pick('a', 'b'), false)
  expect(appendImported(draft, one)).toHaveLength(1000)
  expect(() => appendImported(draft, two)).toThrow('설정 카드는 1,000개까지 저장할 수 있어요. 지금은 1개까지 가져올 수 있어요.')
  expect(() => appendImported([...draft, mine('마지막')], one)).toThrow('설정 카드는 1,000개까지 저장할 수 있어요. 더 가져오려면 설정을 먼저 정리해 주세요.')
})
