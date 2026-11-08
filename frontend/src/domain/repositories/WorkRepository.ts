import type { Draft } from '../entities/draft'
import type { Work } from '../entities/work'
import type { World } from '../entities/world'

export const AGGREGATE_WRITE_UNSUPPORTED = '이 화면의 일괄 저장은 지원하지 않아요. 정본 집필실(/content 또는 작품의 집필실)에서 저장·발행해 주세요.'
export const FEEDBACK_UNAVAILABLE = '이 작품의 댓글·피드백·신고 기능은 아직 연결되지 않았어요. 접수하거나 저장하지 않았어요.'

/** 작품·회차·Fork 정본 저장소 계약. 메서드는 HTTP 구현으로 바꿀 수 있게 비동기로 둡니다. */
export interface WorkRepository {
  listWorks(): Promise<Work[]>
  listWorlds(): Promise<World[]>
  readWorld(work: Work, episode: number): Promise<Work>
  createFork(id: string, episode: number, title: string, direction: string): Promise<{ id: string }>
  /** 같은 id가 있으면 바꾸고 없으면 추가합니다. */
  saveWork(work: Work): Promise<void>
  /** 작성 중인 회차 초안 (키: 작품 id 또는 `${id}:ep:${n}`) */
  getDraft(key: string): Promise<Draft | undefined>
  listDrafts(): Promise<Record<string, Draft>>
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
