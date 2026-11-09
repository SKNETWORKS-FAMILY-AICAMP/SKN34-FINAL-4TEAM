import type { OperationsEvent, OperationsNotice } from '../entities/operations'

/** 회원 화면·고객지원 문의와 섞지 않는 운영 공지·이벤트 기록 저장소입니다. */
export interface OperationsRepository {
  listNotices(): Promise<OperationsNotice[]>
  saveNotice(row: OperationsNotice): Promise<void>
  deleteNotice(id: string): Promise<void>
  listEvents(): Promise<OperationsEvent[]>
  saveEvent(row: OperationsEvent): Promise<void>
  deleteEvent(id: string): Promise<void>
}
