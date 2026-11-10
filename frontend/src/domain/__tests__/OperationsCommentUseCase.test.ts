import { describe, expect, it } from 'vitest'

import type { OperationsComment } from '../entities/operationsComment'
import type { OperationsCommentRepository } from '../repositories/OperationsCommentRepository'
import { OperationsCommentUseCase } from '../usecases/OperationsCommentUseCase'

const row: OperationsComment = {
  commentId: 'c1', workId: 'w1', workTitle: '별빛 서약의 탑', episodeNumber: 2, authorId: 'u1', authorName: '연화',
  body: '첫 감상', likeCount: 3, hidden: false, createdAt: '2026-11-09T01:00:00Z',
}

/** 호출 인자만 기록하는 Fake Repository */
function setup() {
  const calls: [string, ...unknown[]][] = []
  const repository: OperationsCommentRepository = {
    list: async () => { calls.push(['list']); return [row] },
    hide: async (id) => { calls.push(['hide', id]) },
    unhide: async (id) => { calls.push(['unhide', id]) },
  }
  return { calls, uc: new OperationsCommentUseCase(repository) }
}

describe('OperationsCommentUseCase (75 운영 댓글 조회·조치)', () => {
  it('댓글 목록은 Repository 결과를 그대로 돌려준다', async () => {
    const { uc, calls } = setup()
    expect(await uc.list()).toEqual([row])
    expect(calls).toEqual([['list']])
  })

  it('숨김과 게시 복구는 같은 댓글 id로 Repository에 위임한다', async () => {
    const { uc, calls } = setup()
    await uc.hide('c1')
    await uc.unhide('c1')
    expect(calls).toEqual([['hide', 'c1'], ['unhide', 'c1']])
  })
})
