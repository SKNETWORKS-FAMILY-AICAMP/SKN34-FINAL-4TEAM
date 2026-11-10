import { appContainer } from '../../../../app/appContainer'
import type { FeedbackReportUseCase } from '../../../../domain/usecases/FeedbackReportUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 실제 작품 회차의 제보 목록(기능 23): 공개 제보와 작가의 공개 답변이 있는 제보(원문 숨김)이고, 로그인하면 내 비공개 제보(작가면 모든 제보)까지 읽습니다.
 * 회차가 바뀌면 이전 목록을 감추고 다시 읽으며(로그인·로그아웃도 같음), refresh는 이 회차에 제보를 보낸 뒤 호출 측이 올리는 값이라 이전 목록을 유지한 채 다시 읽습니다.
 */
export function useEpisodeFeedbackReportsViewModel(workId: string, n: number, refresh: number, useCase: FeedbackReportUseCase = appContainer.resolve('feedbackReportUseCase')) {
  const { data, isError, retry } = useAsyncData(() => useCase.listEpisode(workId, n), [useCase, workId, n], [refresh])
  /** undefined: 불러오는 중이거나 첫 조회 실패(isError) */
  return { reports: data, isError, retry }
}
