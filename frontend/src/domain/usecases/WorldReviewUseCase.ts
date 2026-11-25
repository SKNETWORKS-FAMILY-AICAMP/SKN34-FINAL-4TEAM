import type { DocFill } from '../entities/characterDocs'
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

  /** 인물 카드의 비어 있는 IDENTITY·SOUL을 원고로 채우는 제안을 요청한다(#847). 원고 일부를 OpenAI로 보내므로 동의 없이는 서버를 부르지 않는다(서버도 동의 없는 요청은 422로 거절한다). */
  async suggestDocs(worldId: string, cardId: string, consent: boolean, signal?: AbortSignal): Promise<DocFill> {
    if (!consent) throw new Error('원고 일부를 OpenAI로 보내고 API 비용이 드는 데 동의해야 제안받을 수 있어요.')
    return this.repository.suggestDocs(worldId, cardId, signal)
  }

  /** 서버가 저장한 마지막 검토(#555). 읽기만 하므로 동의는 필요 없고, 저장된 검토가 없으면 null이다. */
  latest(worldId: string, signal?: AbortSignal): Promise<WorldReview | null> {
    return this.repository.latest(worldId, signal)
  }
}
