import { appContainer } from '../../../../app/appContainer'
import { REPORT_STATUS_LABEL, type FeedbackReport, type SettableReportStatus } from '../../../../domain/entities/feedbackReport'
import type { FeedbackReportUseCase } from '../../../../domain/usecases/FeedbackReportUseCase'
import { useReportSender } from '../../../shared/feedbackReports/useReportSender'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 작가 피드백함의 실제 작품 제보(기능 23): 내가 소유한 작품들의 제보를 읽고 확인·답변(공개 여부)·처리 상태 변경을 보냅니다.
 * 권한은 서버가 검사하며 화면은 서버가 준 owner 표시만 따릅니다. 쓰기는 한 번에 하나만 보내고 성공하면 서버 값으로 목록을 다시 읽습니다.
 * workId를 주면(작품 관리 화면의 '받은 피드백') 서버에 그 작품의 제보만 묻습니다. 주지 않으면 내 모든 작품입니다.
 */
export function useFeedbackReportInboxViewModel(workId?: string, useCase: FeedbackReportUseCase = appContainer.resolve('feedbackReportUseCase')) {
  const { data, isError, retry } = useAsyncData(() => useCase.listInbox(workId), [useCase, workId])
  const { busy, send, notice } = useReportSender(retry)
  return {
    /** undefined: 불러오는 중이거나 첫 조회 실패(isError) */
    reports: data,
    isError, retry, busy,
    /** 마지막 처리 결과. key가 제보 id라서 화면이 그 제보 카드 안에 완료·실패를 남긴다. */
    notice,
    check: (r: FeedbackReport) => send(() => useCase.check(r), '확인했어요', r.id),
    answer: (r: FeedbackReport, body: string, isPublic: boolean) => send(() => useCase.answer(r, body, isPublic), isPublic ? '공개 답변을 남겼어요' : '비공개 답변을 남겼어요', r.id),
    setStatus: (r: FeedbackReport, status: SettableReportStatus) => send(() => useCase.setStatus(r, status), `처리 상태를 바꿨어요 · ${REPORT_STATUS_LABEL[status]}`, r.id),
  }
}
