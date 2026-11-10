import { describe, expect, it } from 'vitest'

import { parseHashtags, workMetaLabel } from '../entities/content'

describe('작품 등록 입력', () => {
  it('해시태그 입력을 쉼표로 나누고 앞뒤 공백·#·빈 값·중복을 제거한다 (태그 안 공백은 유지)', () => {
    expect(parseHashtags(' #회귀, 성장 ,#회귀,,#복수 ')).toEqual(['회귀', '성장', '복수'])
    expect(parseHashtags('#천재 주인공, #성장')).toEqual(['천재 주인공', '성장'])
    expect(parseHashtags('   ')).toEqual([])
  })

  it('작품 유형·장르·해시태그를 한 줄 표시로 만든다', () => {
    expect(workMetaLabel({ creationType: 'EXTERNAL_DERIVATIVE', genres: ['판타지', 'SF'], hashtags: ['회귀'] })).toBe('외부 2차 창작 · 판타지 · SF · #회귀')
    expect(workMetaLabel({ creationType: 'ORIGINAL', genres: [], hashtags: [] })).toBe('원작')
    expect(workMetaLabel({})).toBe('')
  })
})
