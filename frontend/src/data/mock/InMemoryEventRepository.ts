import { OperationsError, type EventInput, type OperationsEvent } from '../../domain/entities/operations'
import type { EventRepository } from '../../domain/repositories/EventRepository'

const missing = () => new OperationsError('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.')

/** 서버 없는 시연(`--mode mockup`)·렌더 테스트용입니다. 서버처럼 id·시각을 부여하며 새로 고치면 비워집니다. */
export class InMemoryEventRepository implements EventRepository {
  // Map은 삽입 순서를 지키고 수정해도 자리가 바뀌지 않으므로 뒤집으면 최신 등록순이다.
  private readonly rows = new Map<string, OperationsEvent>()

  async listAdmin() { return structuredClone([...this.rows.values()].reverse()) }
  listPublic() { return this.listAdmin() }
  async getPublic(id: string) { return structuredClone(this.rows.get(id)) ?? null }
  async create(input: EventInput) {
    const now = new Date().toISOString()
    const row = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    this.rows.set(row.id, row)
    return structuredClone(row)
  }
  async update(id: string, input: EventInput) {
    const current = this.rows.get(id)
    if (!current) throw missing()
    const row = { ...current, ...input, updatedAt: new Date().toISOString() }
    this.rows.set(id, row)
    return structuredClone(row)
  }
  async remove(id: string) { if (!this.rows.delete(id)) throw missing() }
}
