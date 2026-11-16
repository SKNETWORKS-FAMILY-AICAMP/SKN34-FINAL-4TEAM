import type { AdminState } from '../../domain/entities/admin'
import type { CharacterChat, ChatLine } from '../../domain/entities/chat'
import type { DemoCredits } from '../../domain/entities/credit'
import { newEpisodeDraft, type Draft } from '../../domain/entities/draft'
import type { Comment, InboxItem, ReaderReport, ReviewItem } from '../../domain/entities/feedback'
import { OperationsError } from '../../domain/entities/operations'
import type { SupportInquiry, SupportInquiryInput, SupportInquiryStatus } from '../../domain/entities/supportInquiry'
import { makeFork, nid, type Theme, type Work } from '../../domain/entities/work'
import type { World } from '../../domain/entities/world'
import type { AdminRepository } from '../../domain/repositories/AdminRepository'
import type { CreditRepository } from '../../domain/repositories/CreditRepository'
import type { FeedbackRepository } from '../../domain/repositories/FeedbackRepository'
import type { ChatRepository } from '../../domain/repositories/ChatRepository'
import type { ReadingRecord, ReadingRecordRepository } from '../../domain/repositories/ReadingRecordRepository'
import type { SupportInquiryRepository } from '../../domain/repositories/SupportInquiryRepository'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../../domain/repositories/WorkRepository'
import type { WorldRepository } from '../../domain/repositories/WorldRepository'
/** 정본 저장소가 아닌 세션 전용 데모 상태. 운영 연결에는 샘플 원문·이용 이력을 넣지 않는다. */
export function createMockDb() {
  return {
    works: [] as Work[],
    worlds: [] as World[],
    seedComments: {} as Partial<Record<Theme, Comment[]>>,
    progress: {last:{},read:{},seen:{},liked:{}} as ReadingProgress,
    characterChats: null as CharacterChat[] | null,
    chat: {} as Record<string, ChatLine[]>,
    inq: [] as SupportInquiry[],
    comments: {} as Record<string, Comment[]>,
    cmLiked: {} as Record<string, boolean>,
    reports: [] as ReaderReport[],
    inbox: [] as InboxItem[],
    reviewQueue: [] as ReviewItem[],
    drafts: {} as Record<string, Draft>,
    admin: {profile:{nick:'',email:'',joined:''},audit:[],users:[],jobs:[],admins:[],hiddenComments:[],events:[],flagged:{id:'',title:'',owner:'',kind:'',rights:'',fork:'',reports:0,state:'',log:[]}} as AdminState,
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
  async readWorld(work: Work, _episode: number) { return structuredClone(work) }
  async createFork(id: string, episode: number, title: string, direction: string) {
    const work=this.db.works.find(w=>w.id===id)
    if(!work) throw new Error('작품을 찾을 수 없어요.')
    const fork=makeFork(work,episode,{id:nid('fork'),title,dir:direction,author:'나',owner:'me',mine:true})
    await this.saveWork(fork)
    await this.saveDraft(fork.id,newEpisodeDraft(fork))
    return {id:fork.id}
  }
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

/** 서버 독서 기록의 목업 대역: 같은 상태를 읽는 다른 목업(캐릭터챗 등)을 위해 mockDb.progress의 last·read를 정본으로 씁니다. */
export class InMemoryReadingRecordRepository implements ReadingRecordRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  /** last의 키 순서가 곧 최근 순입니다(record가 작품을 맨 앞으로 옮김). */
  async list() {
    const { last, read } = this.db.progress
    return Object.keys(last).map((workId): ReadingRecord => ({ workId, lastEpisode: last[workId], readEpisodes: [...(read[workId] ?? [])].sort((a, b) => a - b) }))
  }
  async record(workId: string, episode: number) {
    const { [workId]: _, ...others } = this.db.progress.last
    this.db.progress.last = { [workId]: episode, ...others }
    const read = (this.db.progress.read[workId] ??= [])
    if (!read.includes(episode)) read.push(episode)
  }
  async remove(workId: string) {
    delete this.db.progress.last[workId]
    delete this.db.progress.read[workId]
  }
}

export class InMemoryFeedbackRepository implements FeedbackRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  listComments(theme: Theme, key: string) { return copy([...(this.db.seedComments[theme] ?? []), ...(this.db.comments[key] ?? [])]) }
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

export class InMemoryChatRepository implements ChatRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  listChats() { return copy(this.db.characterChats) }
  async saveChats(chats: CharacterChat[]) { this.db.characterChats = structuredClone(chats) }
  getLog(key: string) { return copy(this.db.chat[key]) }
  async saveLog(key: string, log: ChatLine[]) { this.db.chat[key] = structuredClone(log) }
}

/** 서버 없는 데모(`--mode mockup`·통합 테스트)에서 운영 고객지원 문의 계약을 메모리로 흉내 냅니다. 로그인 회원은 하나뿐이라 내 문의가 곧 전체입니다. */
export class InMemorySupportInquiryRepository implements SupportInquiryRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  private find(id: string) {
    const inquiry = this.db.inq.find((x) => x.id === id)
    if (!inquiry) throw new OperationsError('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.')
    return inquiry
  }
  /** 답변 유무로 상태를 다시 계산합니다. */
  private touch(inquiry: SupportInquiry) {
    inquiry.status = inquiry.replies.length ? 'ANSWERED' : 'WAITING'
    inquiry.updatedAt = new Date().toISOString()
  }
  private reply(id: string, replyId: string) {
    const inquiry = this.find(id), reply = inquiry.replies.find((x) => x.id === replyId)
    if (!reply) throw new OperationsError('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.')
    return { inquiry, reply }
  }
  listMine() { return copy(this.db.inq) }
  async create(input: SupportInquiryInput) {
    const now = new Date().toISOString()
    this.db.inq.unshift({ id: nid('q'), memberId: 'demo-member', ...input, status: 'WAITING', createdAt: now, updatedAt: now, replies: [] })
  }
  listAll(status: SupportInquiryStatus | null) { return copy(this.db.inq.filter((x) => !status || x.status === status)) }
  async get(id: string) { return structuredClone(this.find(id)) }
  async addReply(id: string, body: string) {
    const inquiry = this.find(id), now = new Date().toISOString()
    inquiry.replies.push({ id: nid('r'), body, createdAt: now, updatedAt: now })
    this.touch(inquiry)
  }
  async updateReply(id: string, replyId: string, body: string) {
    const { inquiry, reply } = this.reply(id, replyId)
    Object.assign(reply, { body, updatedAt: new Date().toISOString() })
    this.touch(inquiry)
  }
  async deleteReply(id: string, replyId: string) {
    const { inquiry } = this.reply(id, replyId)
    inquiry.replies = inquiry.replies.filter((x) => x.id !== replyId)
    this.touch(inquiry)
  }
}

export class InMemoryAdminRepository implements AdminRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  get() { return copy(this.db.admin) }
  async save(state: AdminState) { this.db.admin = structuredClone(state) }
  /** 목업 adminExtra()의 A.comments: 시드 댓글 + 회차 키(작품 id + 회차)로 찾은 브라우저 댓글 */
  async listComments(works: Work[]) {
    const ids = works.map((w) => w.id).sort((a, b) => b.length - a.length)
    return [
      ...Object.entries(this.db.seedComments).flatMap(([theme, comments]) => {
        const work=works.find(w=>!w.parent && w.theme===theme)
        return work ? comments.map(([author,text,likes],i)=>({id:theme+'-'+i,work:work.title,workId:work.id,author,text,likes})) : []
      }),
      ...Object.entries(this.db.comments).flatMap(([key, items]) => {
        const id = ids.find((x) => key.startsWith(x)), w = works.find((x) => x.id === id)
        return w ? items.map(([author, text, likes], i) => ({ id: `runtime-${w.id}-${key.slice(w.id.length)}-${i}`, work: w.title, workId: w.id, author, text, likes })) : []
      }),
    ]
  }
}
