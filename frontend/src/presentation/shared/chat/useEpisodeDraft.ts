import { appContainer } from '../../../app/appContainer'
import { useAsyncData } from '../useAsyncData'

/**
 * 부분 수정 구간 고르기(#497)가 보여 줄 반영 회차의 작업 초안. episode가 null이면 읽지 않는다(`idle`).
 * 읽는 중·실패는 실제 결과대로 알리고(`loading`·`failed`) 실패를 빈 초안으로 바꾸지 않는다. retry로 다시 읽는다.
 */
export function useEpisodeDraft(workId: string, episode: number | null) {
  const episodes = appContainer.resolve('episodeUseCase')
  const { data, isLoading, retry } = useAsyncData(
    async (signal) => (episode === null ? null : (await episodes.writingEpisode(workId, episode, signal)).draft),
    [episodes, workId, episode],
  )
  const draft = data ?? null
  return { status: episode === null ? 'idle' : isLoading ? 'loading' : draft ? 'ready' : 'failed', draft, retry } as const
}
