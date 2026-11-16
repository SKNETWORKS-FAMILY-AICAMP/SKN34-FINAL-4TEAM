import type { WorldReview } from '../entities/worldReview'
import type { WorldReviewRepository } from '../repositories/WorldReviewRepository'

export class WorldReviewUseCase {
  private readonly repository: WorldReviewRepository
  constructor(repository: WorldReviewRepository) { this.repository = repository }

  /** 설정집 AI 검토를 요청한다. 설정 본문을 OpenAI로 보내므로 동의 없이는 서버를 부르지 않는다(서버도 동의 없는 요청은 422로 거절한다). */
  async review(worldId: string, consent: boolean, signal?: AbortSignal): Promise<WorldReview> {
    if (!consent) throw new Error('설정집을 OpenAI로 보내고 API 비용이 드는 데 동의해야 검토할 수 있어요.')
    return this.repository.review(worldId, signal)
  }
}
