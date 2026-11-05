import { appContainer } from '../../app/appContainer'
import { useAppDispatch } from '../../app/store'
import { AI_FAIL_MSG, AI_SHORT_MSG, type CreditUseCase } from '../../domain/usecases/CreditUseCase'
import { toast } from './events'
import { sessionActions } from './session/sessionSlice'

export const confirmAi = (task: string, cost: number, credits: number) => window.confirm(`${task} · 예시 비용 ${cost} 크레딧 · 데모 잔액 ${credits}. 실제 요금은 미정이며 실제 차감은 없어요. 계속할까요?`)

/** 목업 aiDemo(task, cost, approved): 예시 비용 확인 → 데모 크레딧 차감. 실제 AI 호출·과금은 없습니다. */
export function useAiDemo(creditUseCase: CreditUseCase = appContainer.resolve('creditUseCase')) {
  const dispatch = useAppDispatch()
  return async (task: string, cost: number, approved = false) => {
    const r = await creditUseCase.spend(task, cost, (credits) => approved || confirmAi(task, cost, credits))
    if (r === 'cancel') return false
    dispatch(sessionActions.dataChanged())
    if (r === 'fail') toast(AI_FAIL_MSG)
    if (r === 'short') toast(AI_SHORT_MSG)
    return r === 'ok'
  }
}
