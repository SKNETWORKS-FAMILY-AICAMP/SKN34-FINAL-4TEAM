import { WITHDRAWAL_REASON_MAX, type WithdrawalState } from '../entities/withdrawal'
import type { WithdrawalRepository } from '../repositories/WithdrawalRepository'

/** 계정 > 프로필의 회원탈퇴(UC-22 A3): 30일 유예 탈퇴 요청, 유예 상태 조회, 유예 중 복구. */
export class WithdrawalUseCase {
  private readonly repository: WithdrawalRepository
  constructor(repository: WithdrawalRepository) { this.repository = repository }

  status(signal?: AbortSignal): Promise<WithdrawalState> { return this.repository.status(signal) }

  /** 비밀번호는 필수이고 사유는 앞뒤 공백을 지워 비어 있으면 보내지 않습니다. 형식이 맞지 않으면 서버에 보내지 않습니다. */
  request(password: string, reason: string): Promise<WithdrawalState> {
    if (!password) return Promise.reject(new Error('비밀번호를 입력해 주세요.'))
    const trimmed = reason.trim()
    if (trimmed.length > WITHDRAWAL_REASON_MAX) return Promise.reject(new Error(`탈퇴 사유는 ${WITHDRAWAL_REASON_MAX}자까지 쓸 수 있어요.`))
    return this.repository.request(password, trimmed || null)
  }

  restore(): Promise<void> { return this.repository.restore() }
}
