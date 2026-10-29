import type { World } from '../entities/world'

/** 세계관 정본 저장소 계약 */
export interface WorldRepository {
  list(): Promise<World[]>
  /** 같은 id가 있으면 바꾸고 없으면 추가합니다. */
  save(world: World): Promise<void>
  remove(id: string): Promise<void>
}
