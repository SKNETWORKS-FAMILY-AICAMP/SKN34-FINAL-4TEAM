import type { Comment, InboxItem, ReaderReport, ReviewItem } from '../../domain/entities/feedback'
import type { AppNotification } from '../../domain/entities/notification'
import type { Theme } from '../../domain/entities/work'
import type { FeedbackRepository } from '../../domain/repositories/FeedbackRepository'
import type { NotificationRepository } from '../../domain/repositories/NotificationRepository'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../../domain/repositories/WorkRepository'
import { SEED_COMMENTS, seedNotifications, seedWorks, seedWorlds } from './seed'

/** 목업처럼 브라우저 메모리에만 있는 데모 상태. 새로고침하면 시드로 돌아갑니다. */
export function createMockDb() {
  return {
    works: seedWorks(),
    worlds: seedWorlds(),
    progress: { last: { guunmong: 2, starlight: 1 }, read: { guunmong: [1, 2], starlight: [1] }, seen: {}, liked: {} } as ReadingProgress,
    notifications: seedNotifications() as AppNotification[],
    comments: {} as Record<string, Comment[]>,
    cmLiked: {} as Record<string, boolean>,
    reports: [] as ReaderReport[],
    inbox: [] as InboxItem[],
    reviewQueue: [] as ReviewItem[],
  }
}
export type MockDb = ReturnType<typeof createMockDb>

// 화면이 반환값을 고쳐도 정본이 바뀌지 않도록 복사본을 돌려줍니다.
const copy = async <T>(value: T) => structuredClone(value)

export class InMemoryWorkRepository implements WorkRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  listWorks() { return copy(this.db.works) }
  listWorlds() { return copy(this.db.worlds) }
}

export class InMemoryReadingRepository implements ReadingRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  getProgress() { return copy(this.db.progress) }
  async markSeen(workId: string) { this.db.progress.seen[workId] = true }
  async saveProgress(progress: ReadingProgress) { this.db.progress = structuredClone(progress) }
}

export class InMemoryFeedbackRepository implements FeedbackRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  listComments(theme: Theme, key: string) { return copy([...(SEED_COMMENTS[theme] ?? []), ...(this.db.comments[key] ?? [])]) }
  async addComment(key: string, comment: Comment) { (this.db.comments[key] ??= []).push(structuredClone(comment)) }
  listCommentLikes() { return copy(this.db.cmLiked) }
  async toggleCommentLike(key: string) { this.db.cmLiked[key] = !this.db.cmLiked[key] }
  async addReport(report: ReaderReport) { this.db.reports.unshift(structuredClone(report)) }
  async addInbox(item: InboxItem) { this.db.inbox.unshift(structuredClone(item)) }
  async addReview(item: ReviewItem) { this.db.reviewQueue.unshift(structuredClone(item)) }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  list() { return copy(this.db.notifications) }
}
