import type { CreditChange, MemberCredits } from '../entities/operationsCredit'

/** 운영 크레딧 API 계약(DEC-57). 정본은 Core이고 운영 서비스가 중계합니다. 권한은 운영자 + `credits`입니다. */
export interface OperationsCreditRepository {
  member(memberId: string): Promise<MemberCredits>
  /** 성공(201)만 알리고, 갱신된 잔액은 화면이 `member`로 다시 읽습니다. */
  grant(memberId: string, input: CreditChange): Promise<void>
  /** 쓸 수 있는 잔액을 넘으면 서버가 409로 거절합니다. */
  revoke(memberId: string, input: CreditChange): Promise<void>
}
