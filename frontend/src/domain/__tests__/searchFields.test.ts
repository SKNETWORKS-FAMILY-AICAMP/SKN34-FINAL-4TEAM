import { describe, expect, it } from 'vitest'

import { matchW, SEARCH_FIELDS, SEARCH_SORTS, sorter, type Work } from '../entities/work'

const work = (over: Partial<Work>) => ({ id: 'w', title: '달빛 정원', author: '윤서하', genre: '판타지', tags: [], hash: ['#회귀'], ...over }) as Work

describe('검색 계약의 범위·정렬', () => {
  it('범위는 전체·제목·작가·태그·장르이고 정렬은 최신·인기(like)·조회 순이다(서버 계약)', () => {
    expect(SEARCH_FIELDS.map(([k]) => k)).toEqual(['all', 'title', 'author', 'tag', 'genre'])
    expect(SEARCH_SORTS).toEqual([['latest', '최신 순'], ['like', '인기 순'], ['view', '조회 순']])
  })

  it('메모리 정렬(목업)의 like는 기존 인기 순(pop)처럼 좋아요 수 내림차순이고 view와 별개다', () => {
    const quiet = work({ id: 'quiet', likes: 900, views: 10 }), seen = work({ id: 'seen', likes: 5, views: 5000 })
    expect([seen, quiet].sort(sorter('like')).map((w) => w.id)).toEqual(['quiet', 'seen'])
    expect([quiet, seen].sort(sorter('view')).map((w) => w.id)).toEqual(['seen', 'quiet'])
  })

  it('메모리 검색(목업)은 작가 범위에서 작가명만, 전체 범위에서는 제목·작가·태그를 본다', () => {
    const w = work({})
    expect(matchW(w, '윤서', 'author', [w])).toBe(true)
    expect(matchW(w, '정원', 'author', [w])).toBe(false)
    expect(matchW(w, '윤서', 'all', [w])).toBe(true)
    expect(matchW(w, '윤서', 'title', [w])).toBe(false)
  })
})
