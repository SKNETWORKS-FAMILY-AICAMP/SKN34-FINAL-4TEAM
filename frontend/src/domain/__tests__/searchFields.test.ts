import { describe, expect, it } from 'vitest'

import { matchW, SEARCH_FIELDS, SEARCH_SORTS, type Work } from '../entities/work'

const work = (over: Partial<Work>) => ({ id: 'w', title: '달빛 정원', author: '윤서하', genre: '판타지', tags: [], hash: ['#회귀'], ...over }) as Work

describe('검색 계약의 범위·정렬', () => {
  it('범위는 전체·제목·작가·태그·장르이고 정렬은 최신·조회 순이다(서버 계약)', () => {
    expect(SEARCH_FIELDS.map(([k]) => k)).toEqual(['all', 'title', 'author', 'tag', 'genre'])
    expect(SEARCH_SORTS.map(([k]) => k)).toEqual(['latest', 'view'])
  })

  it('메모리 검색(목업)은 작가 범위에서 작가명만, 전체 범위에서는 제목·작가·태그를 본다', () => {
    const w = work({})
    expect(matchW(w, '윤서', 'author', [w])).toBe(true)
    expect(matchW(w, '정원', 'author', [w])).toBe(false)
    expect(matchW(w, '윤서', 'all', [w])).toBe(true)
    expect(matchW(w, '윤서', 'title', [w])).toBe(false)
  })
})
