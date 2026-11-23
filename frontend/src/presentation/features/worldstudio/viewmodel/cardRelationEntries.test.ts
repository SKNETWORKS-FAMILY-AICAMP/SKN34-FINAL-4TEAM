import { expect, it } from 'vitest'
import { cardLinkMarkdown } from '../../../../domain/entities/cardLinks'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { cardRelationEntries } from './cardRelationEntries'
import type { SettingItem } from '../../../../domain/entities/studioWorld'

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

const pair = (over: Partial<SettingItem> & { predicate: string }) => {
  const [a, b] = [card('길동'), card('길현')]
  const rows = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, polarity: 'asserted', ...over })
  return cardRelationEntries(rows, a.item.id)[0].steps[0]
}

it('서버에서 읽은 자유 관계는 이름이 항목 이름(label)이고 본문은 body로 따로 둔다 — 본문이 이름으로 나오지 않는다', () => {
  expect(pair({ predicate: 'custom_relation_directed', title: '이복형', text: '길동은 초부석을 들어 올려 이복형 길현에게 보였다.', fromEpisode: 2 }))
    .toEqual({ name: '이복형', episode: 2, body: '길동은 초부석을 들어 올려 이복형 길현에게 보였다.' })
})

it('이름 없이 만든 자유 관계는 관계 문구가 이름이고 본문은 없다. 정해진 관계는 정의 이름이고 직접 쓴 설명만 본문이다', () => {
  expect(pair({ predicate: 'custom_relation_directed', text: '친구' })).toEqual({ name: '친구', episode: null })
  expect(pair({ predicate: 'friend_of' })).toEqual({ name: '친구', episode: null }) // 자동으로 지은 설명은 본문이 아니다
  expect(pair({ predicate: 'friend_of', text: '어릴 적부터 함께 자랐다.' })).toEqual({ name: '친구', episode: null, body: '어릴 적부터 함께 자랐다.' })
})
