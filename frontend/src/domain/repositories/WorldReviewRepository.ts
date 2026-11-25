import type { DocFill } from '../entities/characterDocs'
import type { WorldReview } from '../entities/worldReview'

export interface WorldReviewRepository {
  /** 저장된 현재 초안을 AI가 검토한 결과(서버가 세계관마다 마지막 하나를 저장한다). 서버가 저장한 초안을 읽어 보내므로 화면의 저장하지 않은 변경은 닿지 않는다. */
  review(worldId: string, signal?: AbortSignal): Promise<WorldReview>
  /** 서버가 저장한 마지막 검토(#555). 저장된 검토가 없으면 null이고, 그 밖의 실패는 던진다(없음으로 바꾸지 않는다). */
  latest(worldId: string, signal?: AbortSignal): Promise<WorldReview | null>
  /** 인물 카드 하나의 비어 있는 IDENTITY·SOUL을 연결된 소설의 저장 원고 문장으로 채우는 제안(#847). 서버가 저장한 카드를 읽고 아무것도 저장하지 않는다. 근거를 찾지 못하면 줄이 없는 제안이다. */
  suggestDocs(worldId: string, cardId: string, signal?: AbortSignal): Promise<DocFill>
}
