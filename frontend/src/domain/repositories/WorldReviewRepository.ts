import type { WorldReview } from '../entities/worldReview'

export interface WorldReviewRepository {
  /** 저장된 현재 초안을 AI가 검토한 결과. 서버가 저장한 초안을 읽어 보내므로 화면의 저장하지 않은 변경은 닿지 않는다. 결과는 저장하지 않는다. */
  review(worldId: string, signal?: AbortSignal): Promise<WorldReview>
}
