import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { FeedbackReportStatus } from '../../../../domain/entities/feedbackReport'
import type { OperationsFeedbackReportUseCase } from '../../../../domain/usecases/OperationsFeedbackReportUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 제보·문의 탭의 '작가 검토 제보'(#750): 운영자가 독자 제보를 최신순으로 한 쪽씩 읽기만 합니다(처리는 작가의 몫이라 조치가 없습니다).
 * 서버가 없는 `--mode mockup`은 UseCase가 null이라 null을 돌려주고, 화면은 기존 메모리 데모 표를 그대로 둡니다.
 */
export function useFeedbackReportsViewModel(useCase: OperationsFeedbackReportUseCase | null = appContainer.resolve('operationsFeedbackReportUseCase')) {
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState<FeedbackReportStatus | null>(null)
  const reports = useAsyncData(async () => useCase?.list({ page, status }), [useCase, page, status])
  if (!useCase) return null
  // 조건을 바꾸면 첫 쪽부터 다시 읽습니다.
  return { ...reports, page, status, setPage, setStatus: (value: FeedbackReportStatus | null) => { setStatus(value); setPage(0) } }
}
