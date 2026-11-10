import { appContainer } from '../../../../app/appContainer'
import type { FeedbackReport, FeedbackReportVisibility } from '../../../../domain/entities/feedbackReport'
import type { FeedbackReportUseCase } from '../../../../domain/usecases/FeedbackReportUseCase'
import { useReportSender } from '../../../shared/feedbackReports/useReportSender'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 내 제보(기능 23): 내가 남긴 모든 제보를 읽고 공개 범위 변경·정정·철회를 보냅니다.
 * 쓰기는 한 번에 하나만 보내고 성공하면 서버 값으로 목록을 다시 읽습니다. 입력 거절·서버 거절은 안내만 하며 입력은 호출 측이 그대로 둡니다.
 */
export function useMyFeedbackReportsViewModel(useCase: FeedbackReportUseCase = appContainer.resolve('feedbackReportUseCase')) {
  const { data, isError, retry } = useAsyncData(() => useCase.listMine(), [useCase])
  const { busy, send } = useReportSender(retry)
  return {
    /** undefined: 불러오는 중이거나 첫 조회 실패(isError) */
    reports: data,
    isError, retry, busy,
    // 공개로 바꾸는 것만 한 번 묻는다(노출을 줄이는 비공개 전환과 달리 되돌릴 수 없는 노출이다).
    setVisibility: async (r: FeedbackReport, visibility: FeedbackReportVisibility) =>
      (visibility === 'private' || window.confirm('제보를 공개할까요? 공개하면 다른 독자도 회차 하단에서 볼 수 있어요.')) && send(() => useCase.setVisibility(r, visibility), visibility === 'public' ? '공개 제보로 바꿨어요' : '비공개 제보로 바꿨어요'),
    correct: (r: FeedbackReport, body: string) => send(() => useCase.correct(r, body), '정정을 남겼어요'),
    withdraw: async (r: FeedbackReport) => window.confirm('제보를 철회할까요? 철회해도 작가에게는 철회됨으로 남아요.') && send(() => useCase.withdraw(r), '제보를 철회했어요'),
  }
}
