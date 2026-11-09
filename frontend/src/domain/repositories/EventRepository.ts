import type { EventInput, OperationsEvent } from '../entities/operations'

/** 운영 이벤트 API 계약(69). 독자 조회는 인증 없이, 관리자 CRUD는 회원 Bearer와 events 권한으로 호출합니다. */
export interface EventRepository {
  listPublic(): Promise<OperationsEvent[]>
  /** 없는 이벤트(404)는 null입니다. */
  getPublic(id: string): Promise<OperationsEvent | null>
  listAdmin(): Promise<OperationsEvent[]>
  create(input: EventInput): Promise<OperationsEvent>
  /** 전체 수정이며 null인 기간은 비웁니다. */
  update(id: string, input: EventInput): Promise<OperationsEvent>
  remove(id: string): Promise<void>
}
