import { expect, it } from 'vitest'

import { relationAnchor, relationName, relationNote, showsParagraph } from './relationParagraph'

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
