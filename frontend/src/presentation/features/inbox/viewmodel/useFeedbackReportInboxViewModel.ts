import { appContainer } from '../../../../app/appContainer'
import { REPORT_STATUS_LABEL, type FeedbackReport, type SettableReportStatus } from '../../../../domain/entities/feedbackReport'
import type { FeedbackReportUseCase } from '../../../../domain/usecases/FeedbackReportUseCase'
import { useReportSender } from '../../../shared/feedbackReports/useReportSender'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 작가 피드백함의 실제 작품 제보(기능 23): 내가 소유한 작품들의 제보를 읽고 확인·답변(공개 여부)·처리 상태 변경을 보냅니다.
 * 권한은 서버가 검사하며 화면은 서버가 준 owner 표시만 따릅니다. 쓰기는 한 번에 하나만 보내고 성공하면 서버 값으로 목록을 다시 읽습니다.
 */
export function useFeedbackReportInboxViewModel(useCase: FeedbackReportUseCase = appContainer.resolve('feedbackReportUseCase')) {
  const { data, isError, retry } = useAsyncData(() => useCase.listInbox(), [useCase])
  const { busy, send } = useReportSender(retry)
  return {
    /** undefined: 불러오는 중이거나 첫 조회 실패(isError) */
    reports: data,
    isError, retry, busy,
    check: (r: FeedbackReport) => send(() => useCase.check(r), '확인했어요'),
    answer: (r: FeedbackReport, body: string, isPublic: boolean) => send(() => useCase.answer(r, body, isPublic), isPublic ? '공개 답변을 남겼어요' : '비공개 답변을 남겼어요'),
    setStatus: (r: FeedbackReport, status: SettableReportStatus) => send(() => useCase.setStatus(r, status), `처리 상태를 바꿨어요 · ${REPORT_STATUS_LABEL[status]}`),
  }
}
