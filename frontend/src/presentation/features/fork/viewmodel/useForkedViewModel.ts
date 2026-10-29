import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import type { ForkUseCase } from '../../../../domain/usecases/ForkUseCase'
import { useScreenId } from '../../../shared/screenIds'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 forked(id): U10 포크 생성 완료 · 스냅샷 */
export function useForkedViewModel(id: string, forkUseCase: ForkUseCase = appContainer.resolve('forkUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const { data } = useAsyncData(() => forkUseCase.getForked(id, role), [forkUseCase, id, role])
  useScreenId(data ? 'U10' : null)
  return data
}
