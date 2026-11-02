import type { Inquiry } from '../../domain/entities/account'
import type { AdminState } from '../../domain/entities/admin'
import type { CharacterChat, ChatLine } from '../../domain/entities/chat'
import type { DemoCredits } from '../../domain/entities/credit'
import type { Draft } from '../../domain/entities/draft'
import type { Comment, InboxItem, ReaderReport, ReviewItem } from '../../domain/entities/feedback'
import type { AppNotification } from '../../domain/entities/notification'
import type { Theme, Work } from '../../domain/entities/work'
import type { World } from '../../domain/entities/world'
import type { AdminRepository } from '../../domain/repositories/AdminRepository'
import type { CreditRepository } from '../../domain/repositories/CreditRepository'
import type { FeedbackRepository } from '../../domain/repositories/FeedbackRepository'
import type { ChatRepository } from '../../domain/repositories/ChatRepository'
import type { InquiryRepository } from '../../domain/repositories/InquiryRepository'
import type { NotificationPrefs, NotificationRepository } from '../../domain/repositories/NotificationRepository'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../../domain/repositories/WorkRepository'
import type { WorldRepository } from '../../domain/repositories/WorldRepository'
import { SEED_COMMENTS, seedAdmin, seedNotifications, seedWorks, seedWorlds } from './seed'

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
    inq: [] as Inquiry[],
    comments: {} as Record<string, Comment[]>,
    cmLiked: {} as Record<string, boolean>,
    reports: [] as ReaderReport[],
    inbox: [] as InboxItem[],
    reviewQueue: [] as ReviewItem[],
    drafts: {} as Record<string, Draft>,
    admin: seedAdmin(),
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
  listDrafts() { return copy(this.db.drafts) }
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

export class InMemoryInquiryRepository implements InquiryRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  list() { return copy(this.db.inq) }
  async add(inquiry: Inquiry) { this.db.inq.unshift(structuredClone(inquiry)) }
  async save(inquiry: Inquiry) { replace(this.db.inq, inquiry) }
}

const COMMENT_WORK: Record<string, [string, string]> = { hanji: ['guunmong', '구운몽'], star: ['starlight', '별빛 서약의 탑'], neon: ['postman', '회색 도시'] }

export class InMemoryAdminRepository implements AdminRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  get() { return copy(this.db.admin) }
  async save(state: AdminState) { this.db.admin = structuredClone(state) }
  /** 목업 adminExtra()의 A.comments: 시드 댓글 + 회차 키(작품 id + 회차)로 찾은 브라우저 댓글 */
  async listComments(works: Work[]) {
    const ids = works.map((w) => w.id).sort((a, b) => b.length - a.length)
    return [
      ...Object.entries(COMMENT_WORK).flatMap(([theme, [workId, work]]) => (SEED_COMMENTS[theme] ?? []).map(([author, text, likes], i) => ({ id: theme + '-' + i, work, workId, author, text, likes }))),
      ...Object.entries(this.db.comments).flatMap(([key, items]) => {
        const id = ids.find((x) => key.startsWith(x)), w = works.find((x) => x.id === id)
        return w ? items.map(([author, text, likes], i) => ({ id: `runtime-${w.id}-${key.slice(w.id.length)}-${i}`, work: w.title, workId: w.id, author, text, likes })) : []
      }),
    ]
  }
}
