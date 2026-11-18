import { expect, it } from 'vitest'

import { relationAnchor, relationHistoryLine, relationName, relationNote, showsParagraph } from './relationParagraph'

it('관계 문단의 앵커는 문단을 가진 카드 id와 관계 id로 정해져 같은 관계라도 카드마다 다르다', () => {
  expect(relationAnchor('card-a', 'r-1')).toBe('rel-card-a-r-1')
  expect(relationAnchor('card-b', 'r-1')).not.toBe(relationAnchor('card-a', 'r-1'))
})

it('단방향 관계는 보내는 쪽에만 문단이고 받는 쪽은 링크뿐이며 대칭·방향 없음·미상은 양쪽이 문단이다', () => {
  expect([true, false].map((sends) => showsParagraph('directed', sends))).toEqual([true, false])
  for (const direction of ['symmetric', null, undefined] as const) expect([true, false].map((sends) => showsParagraph(direction, sends))).toEqual([true, true])
})

it('「동일 인물」의 관계명은 저장된 label과 상관없이 늘 동일 인물이고 그 밖은 label이다', () => {
  expect(relationName('identity', '승상 · 동일 인물 · 홍길동')).toBe('동일 인물')
  expect(relationName('identity', '')).toBe('동일 인물')
  expect([relationName('structural', '스승'), relationName(undefined, '스승'), relationName('emotional', ''), relationName(null, '')]).toEqual(['스승', '스승', '', ''])
})

it('부가 표시는 구조·감정 관계, 대칭·방향 미상, 부정된 관계만 적고 단방향·확인된 관계·「동일 인물」의 종류와 방향은 적지 않는다', () => {
  const note = (category: Parameters<typeof relationNote>[0]['category'], direction: Parameters<typeof relationNote>[0]['direction'], polarity?: 'asserted' | 'denied' | null) => relationNote({ category, direction, polarity })
  expect(note('emotional', 'symmetric', 'denied')).toBe('감정 관계 · 대칭 관계 · 부정된 관계')
  expect(note('structural', null, 'asserted')).toBe('구조 관계 · 방향 미상')
  expect([note(undefined, undefined), note(undefined, null)]).toEqual(['방향 미상', '방향 미상'])
  expect(note(undefined, 'directed', 'asserted')).toBe('')
  expect(note('identity', 'directed', 'asserted')).toBe('')
  expect(note('identity', 'directed', 'denied')).toBe('부정된 관계')
})
it('관계 이력은 회차 순서대로 한 줄이고 관계명이 같은 연속 변화는 처음 회차만 남기며 바뀐 적이 없으면 비어 있다', () => {
  const at = (episode: number, label: string) => ({ episode, label, body: '' })
  expect(relationHistoryLine('structural', [at(1, '경계'), at(3, '보호')])).toBe('경계(1화) → 보호(3화)')
  expect(relationHistoryLine('emotional', [at(1, '경계'), at(2, '경계'), at(5, '신뢰')])).toBe('경계(1화) → 신뢰(5화)')
  expect(relationHistoryLine('structural', [at(1, '경계'), at(3, '경계')])).toBe('') // 이름이 그대로면 보일 변화가 없다
  expect([relationHistoryLine('structural', []), relationHistoryLine('structural', undefined), relationHistoryLine(null, [at(1, '경계')])]).toEqual(['', '', ''])
  expect(relationHistoryLine('identity', [at(2, '가'), at(4, '나')])).toBe('') // 「동일 인물」은 늘 같은 이름이다
})
