import { appContainer } from '../../../../app/appContainer'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 자기 세계관이 없는 Fork가 이어받는 원작 세계관(읽기 전용, #365·#583)을 읽는다. 상한 회차는 서버가 Fork 기준 회차로 정하므로 upto를 보내지 않는다.
 * 이어받는 것이 없으면 data가 null이고, 읽지 못한 것은 isError로 따로 알려 빈 상태와 구분한다. 요청 취소·늦은 응답 무시는 useAsyncData가 맡는다.
 * Fork이면서 자기 세계관이 없을 때만 부른다(연결하면 부른 쪽이 사라져 다시 읽지 않고, 연결을 풀면 새로 읽는다).
 */
export function useInheritedWorld(workId: string, useCase: Pick<EpisodeUseCase, 'inheritedWorld'> = appContainer.resolve('episodeUseCase')) {
  return useAsyncData((signal) => useCase.inheritedWorld(workId, undefined, signal), [useCase, workId])
}
