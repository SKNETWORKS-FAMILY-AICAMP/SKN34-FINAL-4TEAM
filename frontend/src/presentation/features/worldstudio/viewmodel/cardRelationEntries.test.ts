import { expect, it } from 'vitest'
import { cardLinkMarkdown } from '../../../../domain/entities/cardLinks'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { cardRelationEntries } from './cardRelationEntries'

const card = (title: string, section: 'people' | 'places' = 'people') => { const row = newSetting(section); row.item.title = title; return row }

it('이 카드를 끝점으로 하는 관계(이름·시작 회차)와 본문 링크로 이어진 카드를 관계도 입력으로 바꾼다', () => {
  const [hero, father, port, stranger] = [card('길동'), card('홍문'), card('항구', 'places'), card('남')]
  hero.item.text = '아버지 ' + cardLinkMarkdown(port.item.id, '항구') + '에 산다.'
  let rows = [hero, father, port, stranger]
  rows = putRelation(rows, { subjectId: hero.item.id, targetId: father.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '아버지', fromEpisode: 2 })
  rows = putRelation(rows, { subjectId: stranger.item.id, targetId: hero.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '모름' })
  rows = putRelation(rows, { subjectId: stranger.item.id, targetId: father.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '이 카드와 무관' })
  const entries = cardRelationEntries(rows, hero.item.id)
  expect(entries.map((e) => [e.otherTitle, e.otherKind, e.steps])).toEqual([
    ['홍문', '인물', [{ name: '아버지', episode: 2 }]],
    ['남', '인물', [{ name: '모름', episode: null }]], // 받는 쪽도 이 카드의 관계다
    ['항구', '장소', [{ name: '본문 링크', episode: null }]], // 본문 링크
  ])
  expect(entries[2].id.startsWith('link:')).toBe(true)
})

it('양 끝 카드가 없거나(지워진 설정) 승인하지 않은 관계는 뺀다', () => {
  const [a, b] = [card('가'), card('나')]
  const rows = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '관계' })
  expect(cardRelationEntries(rows.filter((s) => s.item.id !== b.item.id), a.item.id)).toEqual([])
  const pending = rows.map((s) => (s.item.kind === 'relation' ? { ...s, item: { ...s.item, decision: 'candidate' as never } } : s))
  expect(cardRelationEntries(pending, a.item.id)).toEqual([])
})

it('본문 링크의 대상 카드가 지워졌으면 그 항목은 없다(없는 카드를 유형으로 읽다가 터지지 않는다)', () => {
  const [a, gone] = [card('가'), card('나')]
  a.item.text = cardLinkMarkdown(gone.item.id, '나')
  expect(cardRelationEntries([a], a.item.id)).toEqual([])
})
