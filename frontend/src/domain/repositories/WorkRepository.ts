import type { Draft } from '../entities/draft'
import type { Work } from '../entities/work'
import type { World } from '../entities/world'

/** 작품·회차·Fork 정본 저장소 계약. 메서드는 HTTP 구현으로 바꿀 수 있게 비동기로 둡니다. */
export interface WorkRepository {
  listWorks(): Promise<Work[]>
  listWorlds(): Promise<World[]>
  /** 같은 id가 있으면 바꾸고 없으면 추가합니다. */
  saveWork(work: Work): Promise<void>
  /** 작성 중인 회차 초안 (키: 작품 id 또는 `${id}:ep:${n}`) */
  getDraft(key: string): Promise<Draft | undefined>
  saveDraft(key: string, draft: Draft): Promise<void>
  deleteDraft(key: string): Promise<void>
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
