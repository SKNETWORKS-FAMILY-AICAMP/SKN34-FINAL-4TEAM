import { OperationsError, type OperationsEvent, type OperationsInquiry, type OperationsNotice, type OperationsReply } from '../../domain/entities/operations'
import type { OperationsRepository } from '../../domain/repositories/OperationsRepository'

/** 새로고침하면 비워지는 운영 전용 데모. 기존 createMockDb/Account의 정본은 건드리지 않습니다. */
export class InMemoryOperationsRepository implements OperationsRepository {
  private readonly notices = new Map<string, OperationsNotice>()
  private readonly events = new Map<string, OperationsEvent>()
  private readonly inquiries = new Map<string, OperationsInquiry>()
  private readonly replies = new Map<string, OperationsReply>()

  async listNotices() { return structuredClone([...this.notices.values()]) }
  async saveNotice(row: OperationsNotice) { this.notices.set(row.id, structuredClone(row)) }
  async deleteNotice(id: string) { this.notices.delete(id) }
  async listEvents() { return structuredClone([...this.events.values()]) }
  async saveEvent(row: OperationsEvent) { this.events.set(row.id, structuredClone(row)) }
  async deleteEvent(id: string) { this.events.delete(id) }
  async listInquiries() { return structuredClone([...this.inquiries.values()]) }
  async saveInquiry(row: OperationsInquiry) { this.inquiries.set(row.id, structuredClone(row)) }
  async deleteInquiry(id: string) {
    if ([...this.replies.values()].some((row) => row.inquiryId === id)) throw new OperationsError('답변을 모두 삭제한 뒤 문의를 삭제해 주세요.')
    this.inquiries.delete(id)
  }
  async listReplies(inquiryId: string) { return structuredClone([...this.replies.values()].filter((row) => row.inquiryId === inquiryId)) }
  async saveReply(row: OperationsReply) {
    if (!this.inquiries.has(row.inquiryId)) throw new OperationsError('문의를 찾을 수 없어요. 목록을 새로고침해 주세요.')
    const previous = this.replies.get(row.id)
    if (previous && previous.inquiryId !== row.inquiryId) throw new OperationsError('답변을 찾을 수 없어요. 목록을 새로고침해 주세요.')
    this.replies.set(row.id, structuredClone(row))
  }
  async deleteReply(inquiryId: string, id: string) {
    if (this.replies.get(id)?.inquiryId !== inquiryId) throw new OperationsError('답변을 찾을 수 없어요. 목록을 새로고침해 주세요.')
    this.replies.delete(id)
  }
}
