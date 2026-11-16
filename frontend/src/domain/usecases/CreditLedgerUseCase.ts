import type { CreditOverview } from '../entities/creditLedger'
import type { CreditLedgerRepository } from '../repositories/CreditLedgerRepository'

/** 계정 > 결제 내역(U33): 보유 크레딧과 지급·사용·소멸 내역. 한쪽만 읽히면 잔액과 내역이 어긋나 보이므로 둘 다 읽혀야 성공합니다. */
export class CreditLedgerUseCase {
  private readonly repository: CreditLedgerRepository
  constructor(repository: CreditLedgerRepository) { this.repository = repository }

  async overview(signal?: AbortSignal): Promise<CreditOverview> {
    const [balance, history] = await Promise.all([this.repository.balance(signal), this.repository.history(signal)])
    return { balance, history }
  }

  /** 계정 메뉴의 '보유 크레딧' 줄: 내역 없이 잔액만 읽는다. 내역과 나란히 보이는 값이 아니라서 overview처럼 함께 읽지 않는다. */
  balance(signal?: AbortSignal) { return this.repository.balance(signal) }
}
