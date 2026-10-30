import type { Comment, InboxItem, ReaderReport, ReviewItem } from '../entities/feedback'
import type { Theme } from '../entities/work'

/** 댓글·피드백·신고 저장소 계약. key는 목업처럼 작품 ID + 회차 번호입니다. */
export interface FeedbackRepository {
  /** 테마별 예시 댓글(목업 SEED) 뒤에 이 회차 댓글을 붙여 돌려줍니다. */
  listComments(theme: Theme, key: string): Promise<Comment[]>
  addComment(key: string, comment: Comment): Promise<void>
  /** 키가 prefix로 시작하는 회차에 독자가 단 댓글 수 (예시 댓글 제외) */
  countComments(prefix: string): Promise<number>
  listCommentLikes(): Promise<Record<string, boolean>>
  toggleCommentLike(key: string): Promise<void>
  listReports(): Promise<ReaderReport[]>
  addReport(report: ReaderReport): Promise<void>
  listInbox(): Promise<InboxItem[]>
  addInbox(item: InboxItem): Promise<void>
  /** 같은 id 항목을 바꿉니다. */
  saveInbox(item: InboxItem): Promise<void>
  saveReport(report: ReaderReport): Promise<void>
  listReview(): Promise<ReviewItem[]>
  saveReview(item: ReviewItem): Promise<void>
  addReview(item: ReviewItem): Promise<void>
}
