import type { Work } from '../entities/work'
import type { World } from '../entities/world'

/** 작품·회차·Fork 정본 저장소 계약. 메서드는 HTTP 구현으로 바꿀 수 있게 비동기로 둡니다. */
export interface WorkRepository {
  listWorks(): Promise<Work[]>
  listWorlds(): Promise<World[]>
}

/** 독자 한 명의 읽기 기록 */
export type ReadingProgress = {
  /** 작품별 마지막으로 연 회차 */
  last: Record<string, number>
  read: Record<string, number[]>
  /** 홈 포크 링에서 본 작품 */
  seen: Record<string, boolean>
  liked: Record<string, boolean>
}

export interface ReadingRepository {
  getProgress(): Promise<ReadingProgress>
  markSeen(workId: string): Promise<void>
  saveProgress(progress: ReadingProgress): Promise<void>
}
