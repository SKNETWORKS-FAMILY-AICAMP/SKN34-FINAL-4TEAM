import { appContainer } from '../../../../app/appContainer'
import type { PublicationEvent, Work } from '../../../../domain/entities/content'
import type { EditSuggestionUseCase } from '../../../../domain/usecases/EditSuggestionUseCase'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type { FeedbackReportUseCase } from '../../../../domain/usecases/FeedbackReportUseCase'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 독자 지표(좋아요·누적 회원 조회). 비공개 작품은 'before'(공개 전), 집계가 없으면 null이다: 모르는 값을 0으로 채우지 않는다. */
export type ReaderMetrics = { likes: number; views: number } | 'before' | null

type Services = {
  reading: Pick<ReadingUseCase, 'readerStats'>
  episodes: Pick<EpisodeUseCase, 'history'>
  reports: Pick<FeedbackReportUseCase, 'listInbox'>
  suggestions: Pick<EditSuggestionUseCase, 'inbox'>
}

/**
 * 작품 관리 개요 대시보드의 조회. 구획(독자 지표·최근 발행 이력·받은 피드백)마다 따로 읽어, 한 구획이 실패해도 그 구획 안에서만 알리고 다른 구획은 그대로 보인다.
 * 서버가 없는 시연(mockup)은 독자 지표를 읽지 않고(집계 없음) 서버 수정 제안도 부르지 않는다(WorkManagement의 받은 피드백 탭과 같다).
 * 발행 이력은 이력 탭과 같은 조회(저장본 본문이 함께 오므로 무겁다)에서 최신 5건만 쓴다.
 * ponytail: 저장본이 많은 작품에서 개요 첫 로딩이 무거울 수 있다. 느려지면 발행 이력만 주는 API를 서버에 둔다.
 */
export function useWorkDashboard(work: Pick<Work, 'id' | 'visibility'>, mockup: boolean, use: Partial<Services> = {}) {
  const reading = use.reading ?? appContainer.resolve('readingUseCase')
  const episodes = use.episodes ?? appContainer.resolve('episodeUseCase')
  const reports = use.reports ?? appContainer.resolve('feedbackReportUseCase')
  const suggestions = use.suggestions ?? appContainer.resolve('editSuggestionUseCase')

  const reader = useAsyncData<ReaderMetrics>(
    async (signal) => (work.visibility !== 'public' ? 'before' : mockup ? null : reading.readerStats(work.id, signal)),
    [reading, work.id, work.visibility, mockup],
  )
  const publications = useAsyncData<PublicationEvent[]>(async (signal) => {
    const { publicationHistory } = await episodes.history(work.id, signal)
    if (!publicationHistory) throw new Error('발행 이력 응답을 확인할 수 없어요.')
    // 최신 5건만 보인다.
    return [...publicationHistory].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 5)
  }, [episodes, work.id])
  const feedback = useAsyncData<number>(async () => {
    const [reported, suggested] = await Promise.all([reports.listInbox(work.id), mockup ? [] : suggestions.inbox(work.id)])
    return reported.length + suggested.length
  }, [reports, suggestions, work.id, mockup])

  return { reader, publications, feedback }
}
