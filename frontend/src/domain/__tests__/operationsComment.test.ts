import { describe, expect, it } from 'vitest'

import { commentWorkOptions, filterOperationsComments, type OperationsComment } from '../entities/operationsComment'

const row = (patch: Partial<OperationsComment> = {}): OperationsComment => ({
  commentId: 'c1', workId: 'w1', workTitle: '별빛 서약의 탑', episodeNumber: 1, authorId: 'u1', authorName: '연화',
  body: '첫 감상', likeCount: 0, hidden: false, createdAt: '2026-11-09T01:00:00Z', ...patch,
})
const ids = (rows: OperationsComment[]) => rows.map((r) => r.commentId)

describe('commentWorkOptions (75 운영 댓글 작품 필터 선택지)', () => {
  it('댓글이 있는 작품을 작품명 가나다순으로 한 번씩만 보여 준다', () => {
    const rows = [row({ commentId: 'a', workId: 'w2', workTitle: '해바라기' }), row({ commentId: 'b', workId: 'w1', workTitle: '가을 편지' }), row({ commentId: 'c', workId: 'w2', workTitle: '해바라기' })]
    expect(commentWorkOptions(rows)).toEqual([['w1', '가을 편지'], ['w2', '해바라기']])
  })

  it('제목이 같은 서로 다른 작품은 작품 id를 붙여 구분한다', () => {
    const rows = [row({ workId: 'w1', workTitle: '달빛' }), row({ workId: 'w2', workTitle: '달빛' }), row({ workId: 'w3', workTitle: '별빛' })]
    expect(commentWorkOptions(rows)).toEqual([['w1', '달빛 · w1'], ['w2', '달빛 · w2'], ['w3', '별빛']])
  })

  it('댓글이 없으면 선택지도 없다', () => {
    expect(commentWorkOptions([])).toEqual([])
  })
})

describe('filterOperationsComments (75 운영 댓글 필터·검색·정렬)', () => {
  const rows = [
    row({ commentId: 'a', workId: 'w1', workTitle: '별빛 서약의 탑', authorName: '연화', body: '반전이 좋아요', likeCount: 3, createdAt: '2026-11-09T01:00:00Z' }),
    row({ commentId: 'b', workId: 'w2', workTitle: 'Moon Library', authorName: 'Haneul', body: '욕설이 섞인 댓글', likeCount: 9, hidden: true, createdAt: '2026-11-08T01:00:00Z' }),
    row({ commentId: 'c', workId: 'w1', workTitle: '별빛 서약의 탑', authorName: '하늘', body: '다음 화 기대돼요', likeCount: 3, createdAt: '2026-11-09T05:00:00Z' }),
  ]
  const all = { workId: 'all', query: '', sort: 'likes' }

  it('작품 필터는 all이면 전체, 작품 id면 그 작품의 댓글만 남긴다', () => {
    expect(ids(filterOperationsComments(rows, all))).toHaveLength(3)
    expect(ids(filterOperationsComments(rows, { ...all, workId: 'w2' }))).toEqual(['b'])
    expect(ids(filterOperationsComments(rows, { ...all, workId: 'none' }))).toEqual([])
  })

  it('검색은 댓글 내용·작품명·작성자를 대소문자 구분 없이 찾고 숨김 댓글 원문도 찾는다', () => {
    const find = (query: string) => ids(filterOperationsComments(rows, { ...all, query }))
    expect(find('반전')).toEqual(['a'])
    expect(find('moon library')).toEqual(['b'])
    expect(find('HANEUL')).toEqual(['b'])
    expect(find('욕설')).toEqual(['b'])
    expect(find('별빛')).toEqual(['c', 'a'])
    expect(find('없는 말')).toEqual([])
    expect(find('')).toHaveLength(3)
  })

  it('작품 필터와 검색은 함께 적용한다', () => {
    expect(ids(filterOperationsComments(rows, { workId: 'w1', query: '하늘', sort: 'likes' }))).toEqual(['c'])
  })

  it('공감 많은순은 공감이 같으면 최신 댓글을 먼저 보인다', () => {
    expect(ids(filterOperationsComments(rows, all))).toEqual(['b', 'c', 'a'])
  })

  it('공감 적은순도 공감이 같으면 최신 댓글을 먼저 보인다', () => {
    expect(ids(filterOperationsComments(rows, { ...all, sort: 'likesAsc' }))).toEqual(['c', 'a', 'b'])
  })

  it('작성 시각은 시간대 오프셋을 반영해 비교한다', () => {
    // 11-09T10:00+09:00은 01:00Z라서 11-09T05:00Z보다 오래된 댓글이다.
    const tied = [row({ commentId: 'old', createdAt: '2026-11-09T10:00:00+09:00' }), row({ commentId: 'new', createdAt: '2026-11-09T05:00:00Z' })]
    expect(ids(filterOperationsComments(tied, all))).toEqual(['new', 'old'])
  })

  it('입력 목록은 바꾸지 않는다', () => {
    const before = ids(rows)
    filterOperationsComments(rows, { ...all, sort: 'likesAsc' })
    expect(ids(rows)).toEqual(before)
  })
})
