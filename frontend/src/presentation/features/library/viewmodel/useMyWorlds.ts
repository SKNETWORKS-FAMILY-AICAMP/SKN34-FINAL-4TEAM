import { appContainer } from '../../../../app/appContainer'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 내가 만드는 세계관 목록. 세계관 작업실이 쓰는 UseCase의 목록 조회를 그대로 쓴다(새 API 없음). */
export function useMyWorlds(api: Pick<WorldStudioUseCase, 'list'> = appContainer.resolve('worldStudioUseCase')) {
  const { data, isLoading, isError, retry } = useAsyncData((signal) => api.list(signal), [api])
  return { worlds: data ?? [], loading: isLoading, error: isError, reload: retry }
}
