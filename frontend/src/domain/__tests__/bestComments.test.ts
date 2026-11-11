import { describe, expect, it } from 'vitest'

import { bestComments, type EpisodeComment } from '../entities/episodeComment'

const c = (id: string, likeCount: number, createdAt = '2026-11-09T01:00:00Z', extra: Partial<EpisodeComment> = {}): EpisodeComment => ({
  id, workId: 'w1', episodeNumber: 1, publishedVersionId: 'v1', authorName: '닉네임', body: '본문', quote: null, spoiler: false,
  likeCount, liked: false, mine: false, edited: false, hidden: false, createdAt, updatedAt: createdAt, ...extra,
})
const ids = (list: EpisodeComment[]) => bestComments(list).map((x) => x.id)

describe('BEST 댓글 선정', () => {
  it('좋아요 상위 3개를 좋아요 많은 순으로 뽑고 동점은 최신 댓글이 먼저다', () => {
    const list = [c('a', 2), c('b', 9), c('c', 5, '2026-11-09T02:00:00Z'), c('d', 5, '2026-11-09T03:00:00Z'), c('e', 1)]
    expect(ids(list)).toEqual(['b', 'd', 'c'])
  })

  it('좋아요가 0인 댓글은 BEST가 아니라서 3개보다 적을 수 있고 아무도 없으면 비어 있다', () => {
    expect(ids([c('a', 4), c('b', 0), c('c', 0)])).toEqual(['a'])
    expect(ids([c('a', 0)])).toEqual([])
    expect(ids([])).toEqual([])
  })

  it('운영 숨김 댓글은 뽑지 않고 다음 댓글이 올라온다', () => {
    expect(ids([c('h', 99, undefined, { hidden: true }), c('a', 3), c('b', 2), c('c', 1), c('d', 1, '2026-11-08T00:00:00Z')])).toEqual(['a', 'b', 'c'])
  })

  it('받은 목록의 순서를 바꾸지 않는다', () => {
    const list = [c('a', 1), c('b', 3)]
    bestComments(list)
    expect(list.map((x) => x.id)).toEqual(['a', 'b'])
  })
})
