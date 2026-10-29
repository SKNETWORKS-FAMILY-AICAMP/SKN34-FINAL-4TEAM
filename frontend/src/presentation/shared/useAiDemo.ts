import { appContainer } from '../../app/appContainer'
import { useAppDispatch } from '../../app/store'
import type { CreditUseCase } from '../../domain/usecases/CreditUseCase'
import { toast } from './events'
import { sessionActions } from './session/sessionSlice'

/** 목업 aiDemo(task, cost, approved): 예시 비용 확인 → 데모 크레딧 차감. 실제 AI 호출·과금은 없습니다. */
export function useAiDemo(creditUseCase: CreditUseCase = appContainer.resolve('creditUseCase')) {
  const dispatch = useAppDispatch()
  return async (task: string, cost: number, approved = false) => {
    const { credits } = await creditUseCase.get()
    if (credits < cost) { toast('데모 크레딧이 부족해 실행할 수 없어요'); return false }
    if (!approved && !window.confirm(`${task} · 예시 비용 ${cost} 크레딧 · 데모 잔액 ${credits}. 실제 요금은 미정이며 실제 차감은 없어요. 계속할까요?`)) return false
    const r = await creditUseCase.spend(task, cost)
    dispatch(sessionActions.dataChanged())
    if (r === 'fail') toast('AI 데모 작업에 실패했어요. 자동 재시도하지 않습니다. 다시 요청할 수 있어요')
    if (r === 'short') toast('데모 크레딧이 부족해 실행할 수 없어요')
    return r === 'ok'
  }
}
