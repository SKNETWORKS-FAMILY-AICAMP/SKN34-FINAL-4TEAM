import { describe, expect, it } from 'vitest'

import { matchW, SEARCH_FIELDS, SEARCH_SORTS, SEARCH_TABS, searchTabOf, sorter, type Work } from '../entities/work'

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

describe('검색 탭 해석 (#505)', () => {
  it('탭은 전체·작품·세계관·설정 카드·캐릭터챗 순이다', () => {
    expect(SEARCH_TABS.map(([key]) => key)).toEqual(['all', 'work', 'world', 'card', 'chat'])
  })

  it('주소 type이 탭 값이면 그 탭이고, 없거나 모르는 값이면 전체 탭이다', () => {
    for (const [key] of SEARCH_TABS) expect(searchTabOf(key, false)).toBe(key)
    expect(searchTabOf(null, false)).toBe('all')
    expect(searchTabOf('', false)).toBe('all')
    expect(searchTabOf('zzz', false)).toBe('all')
  })

  it('범위(f)·정렬(sort)이 주소에 있으면(탭이 생기기 전의 작품 검색 링크) type이 없거나 모르는 값일 때 작품 탭이다', () => {
    expect(searchTabOf(null, true)).toBe('work')
    expect(searchTabOf('zzz', true)).toBe('work')
  })

  it('type이 탭 값이면 범위·정렬이 주소에 있어도 그 탭이다(전체·세계관 탭 주소가 작품 탭 값을 이어 가도 된다)', () => {
    expect(searchTabOf('all', true)).toBe('all')
    expect(searchTabOf('world', true)).toBe('world')
  })
})
