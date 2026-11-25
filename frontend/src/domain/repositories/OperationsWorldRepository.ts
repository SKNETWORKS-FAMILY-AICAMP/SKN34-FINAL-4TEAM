import type { OperationsWorld } from '../entities/operationsWorld'

/** 운영 세계관 API 계약. 관리자 Bearer와 works 권한으로 호출하며, 필터·검색은 받은 전체 목록에서 화면이 계산한다. */
export interface OperationsWorldRepository {
  list(): Promise<OperationsWorld[]>
  /** 제한(PUT)·해제(DELETE). 변경 응답은 쓰지 않고 화면이 목록을 다시 읽는다. */
  setRestriction(worldId: string, restricted: boolean): Promise<void>
}
