import { describe, expect, it } from 'vitest'

import { SORTS, sortsOf, sorter, type Work } from '../entities/work'

const work = (over: Partial<Work>) => ({ id: 'w', title: '가', author: '나', likes: 0, views: 0, upd: 0, ...over }) as Work
const keys = (list: readonly (readonly [string, string])[]) => list.map(([k]) => k)

describe('목록 정렬 선택지', () => {
  it('통계가 있는 작품(목업)은 최신·인기·조회 순을 고르게 한다', () => {
    expect(keys(sortsOf([work({})]))).toEqual(['new', 'pop', 'view'])
    expect(sortsOf([])).toEqual(SORTS)
  })

  it('서버 작품(statisticsSupported:false)이 있으면 만들 수 없는 지표 대신 제목·작가 순만 고르게 한다', () => {
    expect(keys(sortsOf([work({}), work({ statisticsSupported: false })]))).toEqual(['title', 'author'])
  })

  it('서버 작품은 지표 정렬 요청도 제목 순으로 정렬하고, 작가 순은 작가·제목 순이다', () => {
    const a = work({ id: 'a', title: '나', author: '다', statisticsSupported: false })
    const b = work({ id: 'b', title: '가', author: '다', statisticsSupported: false })
    const c = work({ id: 'c', title: '다', author: '가', statisticsSupported: false })
    expect([a, b, c].sort(sorter('pop')).map((w) => w.id)).toEqual(['b', 'a', 'c'])
    expect([a, b, c].sort(sorter('author')).map((w) => w.id)).toEqual(['c', 'b', 'a'])
  })
})
