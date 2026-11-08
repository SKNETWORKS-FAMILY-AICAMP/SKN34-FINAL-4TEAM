import { OperationsError, type EventInput, type InquiryInput, type NoticeInput } from '../entities/operations'
import type { OperationsRepository } from '../repositories/OperationsRepository'

const newest = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
const identity = () => { const now = new Date().toISOString(); return { id: crypto.randomUUID(), createdAt: now, updatedAt: now } }
function validateText(input: NoticeInput) {
  if (!input.title.trim() || input.title.length > 200) throw new OperationsError('제목은 1~200자로 입력해 주세요.')
  validateBody(input.body)
}
function validateBody(body: string) {
  if (!body.trim() || body.length > 20000) throw new OperationsError('내용은 1~20000자로 입력해 주세요.')
}

/** 실제 API 호출·회원 신원·알림·발행 판단이 없는 독립 운영 기록 CRUD입니다. */
export class OperationsUseCase {
  private readonly repository: OperationsRepository
  constructor(repository: OperationsRepository) { this.repository = repository }

  async load() {
    const [notices, events, inquiries] = await Promise.all([this.repository.listNotices(), this.repository.listEvents(), this.repository.listInquiries()])
    return {
      notices: notices.sort(newest), events: events.sort(newest),
      inquiries: await Promise.all(inquiries.sort(newest).map(async (row) => ({ ...row, replies: (await this.repository.listReplies(row.id)).sort((a, b) => -newest(a, b)) }))),
    }
  }

  async notice(id: string) {
    const row = (await this.repository.listNotices()).find((row) => row.id === id)
    if (!row) throw new OperationsError('공지를 찾을 수 없어요. 목록을 새로고침해 주세요.')
    return row
  }
  async saveNotice(id: string | null, input: NoticeInput) {
    validateText(input)
    const row = { ...(id ? await this.notice(id) : identity()), ...input, title: input.title.trim(), updatedAt: new Date().toISOString() }
    await this.repository.saveNotice(row)
    return row
  }
  async deleteNotice(id: string) { await this.notice(id); await this.repository.deleteNotice(id) }

  async event(id: string) {
    const row = (await this.repository.listEvents()).find((row) => row.id === id)
    if (!row) throw new OperationsError('이벤트를 찾을 수 없어요. 목록을 새로고침해 주세요.')
    return row
  }
  async saveEvent(id: string | null, input: EventInput) {
    validateText(input)
    for (const value of [input.startsAt, input.endsAt]) {
      if (value !== null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))) throw new OperationsError('기간은 유효한 UTC 날짜와 시간이어야 해요.')
    }
    if (input.startsAt && input.endsAt && Date.parse(input.startsAt) > Date.parse(input.endsAt)) throw new OperationsError('종료는 시작과 같거나 늦어야 해요.')
    const row = { ...(id ? await this.event(id) : identity()), ...input, title: input.title.trim(), updatedAt: new Date().toISOString() }
    await this.repository.saveEvent(row)
    return row
  }
  async deleteEvent(id: string) { await this.event(id); await this.repository.deleteEvent(id) }

  async inquiry(id: string) {
    const row = (await this.repository.listInquiries()).find((row) => row.id === id)
    if (!row) throw new OperationsError('문의를 찾을 수 없어요. 목록을 새로고침해 주세요.')
    return row
  }
  async saveInquiry(id: string | null, input: InquiryInput) {
    validateText(input)
    if (!input.category.trim() || input.category.length > 50) throw new OperationsError('분류는 1~50자로 입력해 주세요.')
    const row = { ...(id ? await this.inquiry(id) : identity()), ...input, title: input.title.trim(), category: input.category.trim(), updatedAt: new Date().toISOString() }
    await this.repository.saveInquiry(row)
    return row
  }
  async deleteInquiry(id: string) { await this.inquiry(id); await this.repository.deleteInquiry(id) }

  async reply(inquiryId: string, id: string) {
    await this.inquiry(inquiryId)
    const row = (await this.repository.listReplies(inquiryId)).find((row) => row.id === id)
    if (!row) throw new OperationsError('답변을 찾을 수 없어요. 목록을 새로고침해 주세요.')
    return row
  }
  async saveReply(inquiryId: string, id: string | null, body: string) {
    validateBody(body)
    await this.inquiry(inquiryId)
    const row = { ...(id ? await this.reply(inquiryId, id) : identity()), inquiryId, body, updatedAt: new Date().toISOString() }
    await this.repository.saveReply(row)
    return row
  }
  async deleteReply(inquiryId: string, id: string) { await this.reply(inquiryId, id); await this.repository.deleteReply(inquiryId, id) }
}
