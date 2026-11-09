import { OperationsError, type EventInput, type NoticeInput } from '../entities/operations'
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

/** 실제 API 호출·회원 신원·알림·발행 판단이 없는 독립 공지·이벤트 기록 CRUD입니다. */
export class OperationsUseCase {
  private readonly repository: OperationsRepository
  constructor(repository: OperationsRepository) { this.repository = repository }

  async load() {
    const [notices, events] = await Promise.all([this.repository.listNotices(), this.repository.listEvents()])
    return { notices: notices.sort(newest), events: events.sort(newest) }
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
}
