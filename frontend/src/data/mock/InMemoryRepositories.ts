import type { CharacterChat, ChatLine } from '../../domain/entities/chat'
import type { DemoCredits } from '../../domain/entities/credit'
import type { Draft } from '../../domain/entities/draft'
import type { Comment, InboxItem, ReaderReport, ReviewItem } from '../../domain/entities/feedback'
import type { AppNotification } from '../../domain/entities/notification'
import type { Theme, Work } from '../../domain/entities/work'
import type { World } from '../../domain/entities/world'
import type { CreditRepository } from '../../domain/repositories/CreditRepository'
import type { FeedbackRepository } from '../../domain/repositories/FeedbackRepository'
import type { ChatRepository } from '../../domain/repositories/ChatRepository'
import type { NotificationPrefs, NotificationRepository } from '../../domain/repositories/NotificationRepository'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../../domain/repositories/WorkRepository'
import type { WorldRepository } from '../../domain/repositories/WorldRepository'
import { SEED_COMMENTS, seedNotifications, seedWorks, seedWorlds } from './seed'

/** 목업처럼 브라우저 메모리에만 있는 데모 상태. 새로고침하면 시드로 돌아갑니다. */
export function createMockDb() {
  return {
    works: seedWorks(),
    worlds: seedWorlds(),
    progress: { last: { guunmong: 2, starlight: 1 }, read: { guunmong: [1, 2], starlight: [1] }, seen: {}, liked: {} } as ReadingProgress,
    notifications: seedNotifications() as AppNotification[],
    notificationPrefs: { read: true, creator: true } as NotificationPrefs,
    characterChats: null as CharacterChat[] | null,
    chat: {} as Record<string, ChatLine[]>,
    comments: {} as Record<string, Comment[]>,
    cmLiked: {} as Record<string, boolean>,
    reports: [] as ReaderReport[],
    inbox: [] as InboxItem[],
    reviewQueue: [] as ReviewItem[],
    drafts: {} as Record<string, Draft>,
    credits: { credits: 100, usage: [], failNext: false, alerts: [] } as DemoCredits,
  }
}
export type MockDb = ReturnType<typeof createMockDb>

// 화면이 반환값을 고쳐도 정본이 바뀌지 않도록 복사본을 돌려줍니다.
const copy = async <T>(value: T) => structuredClone(value)
/** 같은 id 항목을 복사본으로 바꿉니다 (없으면 그대로). */
const replace = <T extends { id: string }>(list: T[], item: T) => { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list[i] = structuredClone(item) }

export class InMemoryWorkRepository implements WorkRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  listWorks() { return copy(this.db.works) }
  listWorlds() { return copy(this.db.worlds) }
  async saveWork(work: Work) {
    const i = this.db.works.findIndex((w) => w.id === work.id)
    this.db.works.splice(i < 0 ? this.db.works.length : i, i < 0 ? 0 : 1, structuredClone(work))
  }
  getDraft(key: string) { return copy(this.db.drafts[key]) }
  async saveDraft(key: string, draft: Draft) { this.db.drafts[key] = structuredClone(draft) }
  async deleteDraft(key: string) { delete this.db.drafts[key] }
}

export class InMemoryWorldRepository implements WorldRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  list() { return copy(this.db.worlds) }
  async save(world: World) {
    const i = this.db.worlds.findIndex((w) => w.id === world.id)
    this.db.worlds.splice(i < 0 ? this.db.worlds.length : i, i < 0 ? 0 : 1, structuredClone(world))
  }
  async remove(id: string) { this.db.worlds = this.db.worlds.filter((w) => w.id !== id) }
}

export class InMemoryCreditRepository implements CreditRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  get() { return copy(this.db.credits) }
  async save(state: DemoCredits) { this.db.credits = structuredClone(state) }
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
  async countComments(prefix: string) { return Object.entries(this.db.comments).filter(([k]) => k.startsWith(prefix)).reduce((a, [, v]) => a + v.length, 0) }
  listCommentLikes() { return copy(this.db.cmLiked) }
  async toggleCommentLike(key: string) { this.db.cmLiked[key] = !this.db.cmLiked[key] }
  listReports() { return copy(this.db.reports) }
  async addReport(report: ReaderReport) { this.db.reports.unshift(structuredClone(report)) }
  listInbox() { return copy(this.db.inbox) }
  async addInbox(item: InboxItem) { this.db.inbox.unshift(structuredClone(item)) }
  async saveInbox(item: InboxItem) { replace(this.db.inbox, item) }
  async saveReport(report: ReaderReport) { replace(this.db.reports, report) }
  listReview() { return copy(this.db.reviewQueue) }
  async saveReview(item: ReviewItem) { replace(this.db.reviewQueue, item) }
  async addReview(item: ReviewItem) { this.db.reviewQueue.unshift(structuredClone(item)) }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  list() { return copy(this.db.notifications) }
  async save(list: AppNotification[]) { this.db.notifications = structuredClone(list) }
  getPrefs() { return copy(this.db.notificationPrefs) }
  async savePrefs(prefs: NotificationPrefs) { this.db.notificationPrefs = structuredClone(prefs) }
}

export class InMemoryChatRepository implements ChatRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  listChats() { return copy(this.db.characterChats) }
  async saveChats(chats: CharacterChat[]) { this.db.characterChats = structuredClone(chats) }
  getLog(key: string) { return copy(this.db.chat[key]) }
  async saveLog(key: string, log: ChatLine[]) { this.db.chat[key] = structuredClone(log) }
}
