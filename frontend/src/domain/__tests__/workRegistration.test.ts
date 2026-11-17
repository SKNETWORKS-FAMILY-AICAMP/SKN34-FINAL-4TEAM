import { describe, expect, it } from 'vitest'

import { canAddSuggestedTag, canPickSuggestedGenre, parseHashtags, workKindLabel } from '../entities/content'

describe('작품 등록 입력', () => {
  it('분기 작품은 서버가 내려 준 작품 유형이 ORIGINAL이어도 원작이 아니라 분기 작품으로 표시한다', () => {
    const source = { workId: 'o', title: '원작', episode: 2, version: 1, direction: '' }
    expect(workKindLabel({ creationType: 'ORIGINAL', source })).toBe('분기 작품')
    expect(workKindLabel({ creationType: undefined, source })).toBe('분기 작품')
    expect(workKindLabel({ creationType: 'ORIGINAL', source: null })).toBe('원작')
    expect(workKindLabel({ creationType: 'EXTERNAL_DERIVATIVE', source: null })).toBe('외부 2차 창작')
    expect(workKindLabel({ creationType: undefined, source: null })).toBe('')
  })

  it('해시태그 입력을 쉼표로 나누고 앞뒤 공백·#·빈 값·중복을 제거한다 (태그 안 공백은 유지)', () => {
    expect(parseHashtags(' #회귀, 성장 ,#회귀,,#복수 ')).toEqual(['회귀', '성장', '복수'])
    expect(parseHashtags('#천재 주인공, #성장')).toEqual(['천재 주인공', '성장'])
    expect(parseHashtags('   ')).toEqual([])
  })

  it('AI 추천 후보는 이미 고른 값이 아니고 한도(장르 2개·해시태그 10개) 안일 때만 담는다', () => {
    expect(canPickSuggestedGenre(['판타지', ''], '무협')).toBe(true)
    expect(canPickSuggestedGenre(['판타지', ''], '판타지')).toBe(false)
    expect(canPickSuggestedGenre(['', '무협'], '판타지')).toBe(true)
    expect(canPickSuggestedGenre(['판타지', '무협'], '로맨스')).toBe(false)
    expect(canAddSuggestedTag(['회귀'], '성장')).toBe(true)
    expect(canAddSuggestedTag(['회귀'], '회귀')).toBe(false)
    expect(canAddSuggestedTag(Array.from({ length: 10 }, (_, i) => `t${i}`), '성장')).toBe(false)
  })
})
