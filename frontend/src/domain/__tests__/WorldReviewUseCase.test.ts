import { describe, expect, it, vi } from 'vitest'

import type { WorldReview } from '../entities/worldReview'
import type { WorldReviewRepository } from '../repositories/WorldReviewRepository'
import { WorldReviewUseCase } from '../usecases/WorldReviewUseCase'

const review: WorldReview = { reviewedCards: 2, totalCards: 2, findings: [] }
const fake = () => ({ review: vi.fn(async (_world: string, _signal?: AbortSignal): Promise<WorldReview> => review) }) satisfies WorldReviewRepository

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
