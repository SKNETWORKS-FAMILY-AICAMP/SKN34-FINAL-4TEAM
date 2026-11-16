/** 로그인 회원의 관심 작품 저장소 계약. 대상은 공개 작품뿐이고 등록·해제는 멱등입니다. */
export interface WorkInterestRepository {
  /** 지금 공개 중인 관심 작품 id (최근 등록순) */
  list(): Promise<string[]>
  add(workId: string): Promise<void>
  remove(workId: string): Promise<void>
}
