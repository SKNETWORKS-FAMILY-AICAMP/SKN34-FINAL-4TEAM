import type { CreditBalance, CreditHistoryItem } from '../entities/creditLedger'

/** 로그인한 회원 본인의 크레딧 원장 조회 계약. 데모 AI 차감 상태(`CreditRepository`)와 구분합니다. */
export interface CreditLedgerRepository {
  balance(signal?: AbortSignal): Promise<CreditBalance>
  history(signal?: AbortSignal): Promise<CreditHistoryItem[]>
}
