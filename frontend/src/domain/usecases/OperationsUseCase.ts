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
/** `noun`은 조사까지 쓴 대상 이름('공지를')입니다. */
function found<T extends { id: string }>(rows: T[], id: string, noun: string): T {
  const row = rows.find((row) => row.id === id)
  if (!row) throw new OperationsError(`${noun} 찾을 수 없어요. 목록을 새로고침해 주세요.`)
  return row
}

/** 실제 API 호출·회원 신원·알림·발행 판단이 없는 독립 공지·이벤트 기록 CRUD입니다. */
export class OperationsUseCase {
  private readonly repository: OperationsRepository
  constructor(repository: OperationsRepository) { this.repository = repository }

  async load() {
    const [notices, events] = await Promise.all([this.repository.listNotices(), this.repository.listEvents()])
    return { notices: notices.sort(newest), events: events.sort(newest) }
  }

  async notice(id: string) { return found(await this.repository.listNotices(), id, '공지를') }
  async saveNotice(id: string | null, input: NoticeInput) {
    validateText(input)
    const row = { ...(id ? await this.notice(id) : identity()), ...input, title: input.title.trim(), updatedAt: new Date().toISOString() }
    await this.repository.saveNotice(row)
    return row
  }
  async deleteNotice(id: string) { await this.notice(id); await this.repository.deleteNotice(id) }

  async event(id: string) { return found(await this.repository.listEvents(), id, '이벤트를') }
  async saveEvent(id: string | null, input: EventInput) {
    validateText(input)
    // 기간은 ViewModel이 toUtcFromKoreanInput으로 만든 UTC 값이라 형식은 다시 검사하지 않고 순서만 확인한다.
    if (input.startsAt && input.endsAt && Date.parse(input.startsAt) > Date.parse(input.endsAt)) throw new OperationsError('종료는 시작과 같거나 늦어야 해요.')
    const row = { ...(id ? await this.event(id) : identity()), ...input, title: input.title.trim(), updatedAt: new Date().toISOString() }
    await this.repository.saveEvent(row)
    return row
  }
  async deleteEvent(id: string) { await this.event(id); await this.repository.deleteEvent(id) }
}
