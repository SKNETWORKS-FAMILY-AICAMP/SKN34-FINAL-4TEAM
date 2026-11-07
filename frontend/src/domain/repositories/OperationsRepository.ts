import type { OperationsEvent, OperationsInquiry, OperationsNotice, OperationsReply } from '../entities/operations'

/** 회원 문의·공개 게시 데모와 섞지 않는 운영 기록 저장소입니다. */
export interface OperationsRepository {
  listNotices(): Promise<OperationsNotice[]>
  saveNotice(row: OperationsNotice): Promise<void>
  deleteNotice(id: string): Promise<void>
  listEvents(): Promise<OperationsEvent[]>
  saveEvent(row: OperationsEvent): Promise<void>
  deleteEvent(id: string): Promise<void>
  listInquiries(): Promise<OperationsInquiry[]>
  saveInquiry(row: OperationsInquiry): Promise<void>
  /** 답변이 남은 문의는 삭제할 수 없습니다. */
  deleteInquiry(id: string): Promise<void>
  listReplies(inquiryId: string): Promise<OperationsReply[]>
  saveReply(row: OperationsReply): Promise<void>
  deleteReply(inquiryId: string, id: string): Promise<void>
}
