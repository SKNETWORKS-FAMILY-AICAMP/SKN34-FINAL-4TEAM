import type { OperationsWork } from '../entities/operationsWork'

/** 운영 작품 API 계약(74). 관리자 Bearer와 works 권한으로 호출하며, 필터·검색·정렬은 받은 전체 목록에서 화면이 계산합니다. */
export interface OperationsWorkRepository {
  list(): Promise<OperationsWork[]>
  setRestriction(id: string, restricted: boolean): Promise<void>
}
