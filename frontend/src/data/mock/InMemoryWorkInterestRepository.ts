import type { WorkInterestRepository } from '../../domain/repositories/WorkInterestRepository'

/** 서버 없는 시연(`--mode mockup`)·테스트용 관심 작품 저장소. 새로 고치면 초기화되고 계정에 저장되지 않습니다. */
export class InMemoryWorkInterestRepository implements WorkInterestRepository {
  /** 최근 등록순(앞이 가장 최근) */
  private ids: string[] = []
  async list() { return [...this.ids] }
  async add(workId: string) { if (!this.ids.includes(workId)) this.ids.unshift(workId) }
  async remove(workId: string) { this.ids = this.ids.filter((id) => id !== workId) }
}
