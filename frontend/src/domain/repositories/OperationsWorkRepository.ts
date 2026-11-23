import type { ForkIntegrity, OperationsEpisode, OperationsWork } from '../entities/operationsWork'

/** 운영 작품 API 계약(74). 관리자 Bearer와 works 권한으로 호출하며, 필터·검색·정렬은 받은 전체 목록에서 화면이 계산합니다. */
export interface OperationsWorkRepository {
  list(): Promise<OperationsWork[]>
  forkIntegrity(id: string): Promise<ForkIntegrity>
  setRestriction(id: string, restricted: boolean): Promise<void>
  /** 작품 상세 드로어의 회차 목록(본문 없음, 번호순). */
  episodes(workId: string): Promise<OperationsEpisode[]>
  /** 회차 운영 제한·해제. 상속 회차는 서버가 409로 거절한다. */
  setEpisodeRestriction(workId: string, number: number, restricted: boolean): Promise<void>
}
