import { OperationsError, type EventInput } from '../entities/operations'
import type { EventRepository } from '../repositories/EventRepository'

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const time = (value: string | null) => value === null ? null : Date.parse(value)

/** 서버 EventService와 같은 규칙을 저장 전에 안내하려고 확인합니다(제목은 앞뒤 공백 제거). 최종 검증은 서버가 합니다. */
function checked(input: EventInput): EventInput {
  const title = input.title.trim()
  if (!title || title.length > 200 || title.includes('\u0000')) throw new OperationsError('제목은 1~200자로 입력해 주세요.')
  if (!input.body.trim() || input.body.length > 20000 || input.body.includes('\u0000')) throw new OperationsError('내용은 1~20000자로 입력해 주세요.')
  const from = time(input.startsAt), to = time(input.endsAt)
  if (from !== null && to !== null && to < from) throw new OperationsError('종료는 시작과 같거나 늦어야 해요.')
  return { ...input, title }
}

/** 운영 이벤트 안내(69): 독자 조회와 관리자 CRUD. 진행 상태는 저장하지 않고 `eventStatus`로 계산합니다. */
export class EventUseCase {
  private readonly repository: EventRepository
  constructor(repository: EventRepository) { this.repository = repository }

  listPublic() { return this.repository.listPublic() }
  /** UUID가 아닌 id(옛 데모 링크 등)는 요청 없이 없음으로 답합니다. */
  async getPublic(id: string) { return UUID.test(id) ? this.repository.getPublic(id) : null }
  listAdmin() { return this.repository.listAdmin() }
  /** id가 없으면 등록, 있으면 전체 수정입니다. */
  async save(id: string | null, input: EventInput) {
    const value = checked(input)
    return id ? this.repository.update(id, value) : this.repository.create(value)
  }
  remove(id: string) { return this.repository.remove(id) }
}
