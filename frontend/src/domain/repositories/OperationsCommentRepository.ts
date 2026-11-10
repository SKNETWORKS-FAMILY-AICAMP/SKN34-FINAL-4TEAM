import type { OperationsComment } from '../entities/operationsComment'

/** 운영 댓글 API 계약(75). 관리자 Bearer와 comments 권한으로 호출하며, 필터·검색·정렬은 받은 전체 목록에서 화면이 계산합니다. */
export interface OperationsCommentRepository {
  list(): Promise<OperationsComment[]>
  /** 이미 숨겼어도 성공합니다(멱등). 삭제가 아니라 언제든 복구할 수 있습니다. */
  hide(id: string): Promise<void>
  /** 게시 상태여도 성공합니다(멱등). */
  unhide(id: string): Promise<void>
}
