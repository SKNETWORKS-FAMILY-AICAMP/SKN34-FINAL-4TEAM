import { appContainer } from '../../../../app/appContainer'
import type { OperationsEpisode } from '../../../../domain/entities/operationsWork'
import type { OperationsWorkUseCase } from '../../../../domain/usecases/OperationsWorkUseCase'
import type { OperationsWorldUseCase } from '../../../../domain/usecases/OperationsWorldUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

/** 회차 제한 조치 키: 작품·번호마다 따로라 같은 회차에는 두 요청이 동시에 나가지 않는다. */
export const episodeKey = (workId: string, number: number) => `episode:${workId}:${number}`

/**
 * 작품 상세 드로어(결정 C): 작품의 회차 목록(번호·제목·발행 상태·제한·상속)과 연결된 세계관을 읽고 회차 제한·해제를 요청합니다.
 * 연결 세계관은 운영 세계관 목록의 `linkedWorkId`로 찾습니다(1:1). 변경은 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회를 한곳에서 합니다.
 */
export function useWorkDetailViewModel(
  workId: string,
  mutate: AdminMutate,
  useCase: OperationsWorkUseCase = appContainer.resolve('operationsWorkUseCase'),
  worldUseCase: OperationsWorldUseCase = appContainer.resolve('operationsWorldUseCase'),
) {
  const episodes = useAsyncData(() => useCase.episodes(workId), [useCase, workId])
  const worlds = useAsyncData(() => worldUseCase.list(), [worldUseCase])
  return {
    episodes,
    worlds,
    restrict: (episode: OperationsEpisode, restricted: boolean) => mutate(
      episodeKey(workId, episode.number),
      restricted ? `${episode.number}화를 운영 제한했어요.` : `${episode.number}화의 운영 제한을 해제했어요.`,
      () => useCase.setEpisodeRestriction(workId, episode.number, restricted),
    ),
  }
}
