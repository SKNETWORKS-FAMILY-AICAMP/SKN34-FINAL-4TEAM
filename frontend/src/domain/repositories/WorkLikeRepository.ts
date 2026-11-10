/** 작품 좋아요 상태: likes는 공개 수, liked는 현재 회원이 눌렀는지 */
export type WorkLikeState = { likes: number; liked: boolean }

/**
 * 공개 작품 좋아요 계약(docs/design/reading-management-contract.md 21-A). 로그인한 회원만 호출하며
 * 누르기·취소는 멱등이고 서버가 확정한 상태를 돌려준다.
 */
export interface WorkLikeRepository {
  /** 현재 회원의 좋아요 상태(공개 상세의 likes·liked). 공개 작품이 아니면(비공개·운영 제한·없음) null이다. */
  read(workId: string): Promise<WorkLikeState | null>
  like(workId: string): Promise<WorkLikeState>
  unlike(workId: string): Promise<WorkLikeState>
}
