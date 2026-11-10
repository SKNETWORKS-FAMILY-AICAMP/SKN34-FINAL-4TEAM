import type { FeedbackReport, FeedbackReportKind, FeedbackReportStatus, FeedbackReportVisibility } from '../entities/feedbackReport'

/** 제보 저장소 계약([기능 23](../../../../docs/design/feedback-report-suggestion-contract.md)). 모든 호출은 Content 공개 API다. */
export interface FeedbackReportRepository {
  create(workId: string, episode: number, input: { kind: FeedbackReportKind; body: string; quote?: string; visibility: FeedbackReportVisibility }): Promise<FeedbackReport>
  /** 회차의 제보. 익명은 공개 제보와 공개 답변이 있는 제보(원문 숨김)만 받는다. */
  listEpisode(workId: string, episode: number): Promise<FeedbackReport[]>
  /** 내가 남긴 모든 제보 */
  listMine(): Promise<FeedbackReport[]>
  /** 내가 소유한 모든 작품의 제보 */
  listInbox(): Promise<FeedbackReport[]>
  /** 제보자만. 철회한 뒤에도 바꿀 수 있다. */
  setVisibility(workId: string, reportId: string, visibility: FeedbackReportVisibility): Promise<FeedbackReport>
  /** 제보자만, 철회 전에만. 원문은 바뀌지 않고 정정 기록이 더해진다. */
  correct(workId: string, reportId: string, body: string): Promise<FeedbackReport>
  /** 제보자만, 한 번만 */
  withdraw(workId: string, reportId: string): Promise<FeedbackReport>
  /** 작품 소유자만. 이미 확인했어도 성공한다(멱등). */
  check(workId: string, reportId: string): Promise<FeedbackReport>
  /** 작품 소유자만 */
  answer(workId: string, reportId: string, input: { body: string; isPublic: boolean }): Promise<FeedbackReport>
  /** 작품 소유자만. 확인 전으로 되돌릴 수 없다. */
  setStatus(workId: string, reportId: string, status: FeedbackReportStatus): Promise<FeedbackReport>
}
