import { OperationsError, orNullIfForbidden } from '../entities/operations'
import { CREDIT_AMOUNT_MAX, CREDIT_REASON_MAX, type CreditChange, type MemberCredits } from '../entities/operationsCredit'
import type { OperationsCreditRepository } from '../repositories/OperationsCreditRepository'

/** 서버 검증(금액 정수 1~100,000, 사유 앞뒤 공백 제거 후 1~200자)을 보내기 전에 안내하려고 확인합니다. 최종 검증은 서버가 합니다. */
function checked(amount: number, reason: string): CreditChange {
  if (!Number.isInteger(amount) || amount < 1 || amount > CREDIT_AMOUNT_MAX) throw new OperationsError('금액은 1~100,000 사이의 정수로 입력해 주세요.')
  const trimmed = reason.trim()
  if (!trimmed || trimmed.length > CREDIT_REASON_MAX) throw new OperationsError('사유는 1~200자로 입력해 주세요.')
  return { amount, reason: trimmed }
}

/** 운영 크레딧(DEC-57): 회원 잔액·내역 조회와 수동 지급·회수. 요청 중복 방지 키가 없어 중복 방지는 화면의 버튼 잠금이 맡습니다. */
export class OperationsCreditUseCase {
  private readonly repository: OperationsCreditRepository
  constructor(repository: OperationsCreditRepository) { this.repository = repository }

  /** 크레딧 운영 권한이 없으면(403) 실패가 아니라 null이라, 화면이 다시 불러오기 대신 필요한 권한을 안내합니다. */
  member(memberId: string): Promise<MemberCredits | null> { return orNullIfForbidden(this.repository.member(memberId)) }
  async grant(memberId: string, amount: number, reason: string) { await this.repository.grant(memberId, checked(amount, reason)) }
  async revoke(memberId: string, amount: number, reason: string) { await this.repository.revoke(memberId, checked(amount, reason)) }
}
