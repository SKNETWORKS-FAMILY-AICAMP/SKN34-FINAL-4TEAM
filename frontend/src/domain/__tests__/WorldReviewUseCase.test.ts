import { describe, expect, it, vi } from 'vitest'

import type { WorldReview } from '../entities/worldReview'
import type { WorldReviewRepository } from '../repositories/WorldReviewRepository'
import { WorldReviewUseCase } from '../usecases/WorldReviewUseCase'

const review: WorldReview = { reviewedCards: 2, totalCards: 2, findings: [], reviewedAt: new Date('2026-11-19T03:25:41Z'), basis: {} }
const fake = () => ({
  review: vi.fn(async (_world: string, _signal?: AbortSignal): Promise<WorldReview> => review),
  latest: vi.fn(async (_world: string, _signal?: AbortSignal): Promise<WorldReview | null> => review),
}) satisfies WorldReviewRepository

describe('설정집 AI 검토 요청', () => {
  it('OpenAI 전송에 동의했을 때만 저장소로 보내고 결과를 그대로 돌려준다', async () => {
    const repo = fake()
    const controller = new AbortController()
    await expect(new WorldReviewUseCase(repo).review('world-1', true, controller.signal)).resolves.toBe(review)
    expect(repo.review).toHaveBeenCalledWith('world-1', controller.signal)
  })

  it('동의하지 않았으면 저장소를 부르지 않고 이유를 던진다', async () => {
    const repo = fake()
    await expect(new WorldReviewUseCase(repo).review('world-1', false)).rejects.toThrow('동의')
    expect(repo.review).not.toHaveBeenCalled()
  })
})

describe('설정집 AI 검토의 마지막 결과 읽기(#555)', () => {
  it('동의 없이 저장소의 마지막 검토를 그대로 돌려준다(읽기만 하고 설정을 OpenAI로 보내지 않는다)', async () => {
    const repo = fake()
    const controller = new AbortController()
    await expect(new WorldReviewUseCase(repo).latest('world-1', controller.signal)).resolves.toBe(review)
    expect(repo.latest).toHaveBeenCalledWith('world-1', controller.signal)
    expect(repo.review).not.toHaveBeenCalled()
  })

  it('저장된 검토가 없으면 null을 그대로 돌려주고, 저장소의 실패는 던진다', async () => {
    const repo = fake()
    repo.latest.mockResolvedValueOnce(null)
    await expect(new WorldReviewUseCase(repo).latest('world-1')).resolves.toBeNull()
    repo.latest.mockRejectedValueOnce(new Error('서버가 응답하지 않아요.'))
    await expect(new WorldReviewUseCase(repo).latest('world-1')).rejects.toThrow('서버가 응답하지 않아요.')
  })
})
