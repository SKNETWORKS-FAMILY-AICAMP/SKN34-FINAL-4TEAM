import type { NoticeInput, OperationsNotice } from '../entities/operations'

/** 운영 공지 API 계약. 목록은 최신순이며, 관리자 요청은 회원 Bearer, 독자 조회는 인증 없이 읽는다. */
export interface NoticeRepository {
  list(): Promise<OperationsNotice[]>
  create(input: NoticeInput): Promise<OperationsNotice>
  update(id: string, input: NoticeInput): Promise<OperationsNotice>
  delete(id: string): Promise<void>
  listPublic(): Promise<OperationsNotice[]>
  /** 없는 공지는 오류가 아니라 null이다. 조회 실패는 거부한다. */
  getPublic(id: string): Promise<OperationsNotice | null>
}
