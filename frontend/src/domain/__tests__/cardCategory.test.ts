import { describe, expect, it } from 'vitest'

import { categoryChoices, categoryIcon, categoryName, type CardCategory } from '../entities/cardCategory'

const row = (code: string, name: string, over: Partial<CardCategory> = {}): CardCategory => ({ code, name, icon: null, position: 1, active: true, ...over })

describe('카드 카테고리 선택지(categoryChoices)', () => {
  it('활성 카테고리만 position 순서로 주고 숨긴 것은 뺀다', () => {
    const list = [row('b', '둘째', { position: 2 }), row('a', '첫째', { position: 1 }), row('h', '숨김', { position: 3, active: false })]
    expect(categoryChoices(list).map((c) => c.code)).toEqual(['a', 'b'])
  })

  it('이미 고른 값이 숨긴 카테고리면 그 값도 이름 그대로 남긴다(유지 허용)', () => {
    const list = [row('a', '첫째'), row('h', '숨김', { position: 2, active: false })]
    expect(categoryChoices(list, 'h').map((c) => c.code)).toEqual(['a', 'h'])
    expect(categoryChoices(list, 'a').map((c) => c.code)).toEqual(['a'])
  })

  it('목록에 아예 없는 값은 만들어 내지 않는다', () => {
    expect(categoryChoices([row('a', '첫째')], 'zzz').map((c) => c.code)).toEqual(['a'])
  })
})

describe('카테고리 이름·아이콘', () => {
  it('목록의 이름이 먼저고 숨긴 카테고리도 목록에 있으면 그 이름이다', () => {
    const list = [row('a', '새 이름'), row('h', '숨긴 분류', { active: false })]
    expect(categoryName(list, 'a')).toBe('새 이름')
    expect(categoryName(list, 'h')).toBe('숨긴 분류')
  })

  it('목록에 없으면 기본 8종 이름을, 그것도 아니면 코드 대신 안내 문구를 쓴다', () => {
    expect(categoryName([], 'character')).toBe('인물')
    expect(categoryName([], 'category-99')).toBe('숨긴 분류')
  })

  it('아이콘이 있으면 이름 앞에 붙인다', () => {
    expect(categoryIcon(row('a', '첫째', { icon: '📖' }))).toBe('📖 첫째')
    expect(categoryIcon(row('a', '첫째'))).toBe('첫째')
  })
})
