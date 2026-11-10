import { describe, expect, it } from 'vitest'

import { OperationsError } from '../../domain/entities/operations'
import { FeedbackUseCase } from '../../domain/usecases/FeedbackUseCase'
import { createFixtureDb } from './fixtureDb'
import { InMemoryAdminRepository, InMemoryFeedbackRepository, InMemoryWorkRepository } from './InMemoryRepositories'
import { InMemoryOperationsCommentRepository } from './InMemoryOperationsCommentRepository'

const SEED_TEXT = '돌다리 장면 묘사 최고… 성진 흔들릴 만하네'

describe('InMemoryOperationsCommentRepository (서버 없는 시연·테스트용)', () => {
  it('데모 댓글을 운영 댓글 계약 형태(작품·작성자·공감·상태)로 보여 준다', async () => {
    const rows = await new InMemoryOperationsCommentRepository(createFixtureDb()).list()
    expect(rows.find((r) => r.commentId === 'hanji-0')).toMatchObject({
      workId: 'guunmong', workTitle: '구운몽', authorName: '연화봉러', body: SEED_TEXT, likeCount: 412, hidden: false,
    })
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every((r) => r.commentId && r.authorId && !Number.isNaN(Date.parse(r.createdAt)))).toBe(true)
  })

  it('숨김은 데모 회차 뷰어에서 댓글을 빼고 게시 복구하면 되돌리며, 같은 요청을 반복해도 한 번만 반영한다', async () => {
    const db = createFixtureDb()
    const repo = new InMemoryOperationsCommentRepository(db)
    const feedback = new FeedbackUseCase(new InMemoryWorkRepository(db), new InMemoryFeedbackRepository(db), new InMemoryAdminRepository(db))
    const guunmong = db.works.find((w) => w.id === 'guunmong')!
    const readerTexts = async () => (await feedback.getComments(guunmong, 1)).comments.map((c) => c[1])
    const hidden = async () => (await repo.list()).find((r) => r.commentId === 'hanji-0')?.hidden
    expect(await readerTexts()).toContain(SEED_TEXT)
    await repo.hide('hanji-0')
    await repo.hide('hanji-0')
    expect(await hidden()).toBe(true)
    expect(db.admin.hiddenComments).toEqual(['hanji-0'])
    expect(await readerTexts()).not.toContain(SEED_TEXT)
    await repo.unhide('hanji-0')
    await repo.unhide('hanji-0')
    expect(await hidden()).toBe(false)
    expect(await readerTexts()).toContain(SEED_TEXT)
  })

  it('없는 댓글의 숨김·복구는 대상을 찾을 수 없다는 안내 오류다', async () => {
    const repo = new InMemoryOperationsCommentRepository(createFixtureDb())
    await expect(repo.hide('missing')).rejects.toThrow(OperationsError)
    await expect(repo.unhide('missing')).rejects.toThrow(OperationsError)
  })
})
