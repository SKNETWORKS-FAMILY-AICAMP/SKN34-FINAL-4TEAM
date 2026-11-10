import { OperationsError, type NoticeInput, type OperationsNotice } from '../../domain/entities/operations'
import type { NoticeRepository } from '../../domain/repositories/NoticeRepository'

const missing = () => new OperationsError('공지를 찾을 수 없어요. 목록을 새로고침해 주세요.')
const newest = (a: OperationsNotice, b: OperationsNotice) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)

/** `--mode mockup`·테스트 fixture용 공지 저장소. 서버 저장은 없고 새로고침하면 `initial`로 돌아간다. */
export class InMemoryNoticeRepository implements NoticeRepository {
  private readonly rows: Map<string, OperationsNotice>
  constructor(initial: OperationsNotice[] = []) { this.rows = new Map(initial.map((row) => [row.id, structuredClone(row)])) }

  async list() { return structuredClone([...this.rows.values()].sort(newest)) }
  async create(input: NoticeInput) {
    const now = new Date().toISOString()
    const row = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    this.rows.set(row.id, row)
    return structuredClone(row)
  }
  async update(id: string, input: NoticeInput) {
    const row = this.rows.get(id)
    if (!row) throw missing()
    const next = { ...row, ...input, updatedAt: new Date().toISOString() }
    this.rows.set(id, next)
    return structuredClone(next)
  }
  async delete(id: string) { if (!this.rows.delete(id)) throw missing() }
  listPublic() { return this.list() }
  async getPublic(id: string) { return structuredClone(this.rows.get(id) ?? null) }
}
