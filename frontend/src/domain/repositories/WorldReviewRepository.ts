import type { WorldReview } from '../entities/worldReview'

export interface WorldReviewRepository {
  /** 저장된 현재 초안을 AI가 검토한 결과(서버가 세계관마다 마지막 하나를 저장한다). 서버가 저장한 초안을 읽어 보내므로 화면의 저장하지 않은 변경은 닿지 않는다. */
  review(worldId: string, signal?: AbortSignal): Promise<WorldReview>
  /** 서버가 저장한 마지막 검토(#555). 저장된 검토가 없으면 null이고, 그 밖의 실패는 던진다(없음으로 바꾸지 않는다). */
  latest(worldId: string, signal?: AbortSignal): Promise<WorldReview | null>
}
