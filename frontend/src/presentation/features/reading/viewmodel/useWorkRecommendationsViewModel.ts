import { appContainer } from '../../../../app/appContainer'
import type { Work } from '../../../../domain/entities/work'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 소설 상세의 추천(같은 작가의 다른 작품·비슷한 작품). 두 검색은 UseCase가 병렬로 보내고 실패는 섹션별로 알립니다.
 * 작품이 바뀌면 이전 목록을 감추고 다시 읽으며, 화면을 떠나거나 작품이 바뀌면 진행 중 요청을 취소합니다(useAsyncData가 넘기는 signal).
 */
export function useWorkRecommendationsViewModel(work: Work, readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const { data, retry } = useAsyncData((signal) => readingUseCase.recommendWorks(work, signal), [readingUseCase, work.id])
  /** undefined: 불러오는 중 */
  return { recommendations: data, retry }
}
