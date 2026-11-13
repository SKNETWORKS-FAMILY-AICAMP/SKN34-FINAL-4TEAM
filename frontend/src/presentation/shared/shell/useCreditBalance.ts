import { appContainer } from '../../../app/appContainer'
import type { CreditLedgerUseCase } from '../../../domain/usecases/CreditLedgerUseCase'
import { useAsyncData } from '../useAsyncData'

type CreditBalanceState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; total: number }

/**
 * 계정 메뉴의 '보유 크레딧' 줄. 메뉴가 열릴 때 Core 크레딧 잔액만 읽고, 메뉴가 닫혀 화면에서 사라지면 요청을 취소한다.
 * 읽지 못하면 failed라 화면이 0으로 채우지 않는다(잔액 0은 ready로 구분된다). `--mode mockup`은 같은 UseCase가 데모 잔액을 돌려준다.
 */
export function useCreditBalance(creditLedger: Pick<CreditLedgerUseCase, 'balance'> = appContainer.resolve('creditLedgerUseCase')): CreditBalanceState {
  const { data, isError } = useAsyncData((signal) => creditLedger.balance(signal), [creditLedger])
  return data ? { status: 'ready', total: data.total } : isError ? { status: 'failed' } : { status: 'loading' }
}
