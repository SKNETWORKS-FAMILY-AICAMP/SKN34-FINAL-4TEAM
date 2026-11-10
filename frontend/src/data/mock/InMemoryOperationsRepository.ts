import type { OperationsEvent, OperationsNotice } from '../../domain/entities/operations'
import type { OperationsRepository } from '../../domain/repositories/OperationsRepository'

/** 새로고침하면 비워지는 운영 전용 데모. 기존 createMockDb/Account의 정본은 건드리지 않습니다. */
export class InMemoryOperationsRepository implements OperationsRepository {
  private readonly notices = new Map<string, OperationsNotice>()
  private readonly events = new Map<string, OperationsEvent>()

  async listNotices() { return structuredClone([...this.notices.values()]) }
  async saveNotice(row: OperationsNotice) { this.notices.set(row.id, structuredClone(row)) }
  async deleteNotice(id: string) { this.notices.delete(id) }
  async listEvents() { return structuredClone([...this.events.values()]) }
  async saveEvent(row: OperationsEvent) { this.events.set(row.id, structuredClone(row)) }
  async deleteEvent(id: string) { this.events.delete(id) }
}
