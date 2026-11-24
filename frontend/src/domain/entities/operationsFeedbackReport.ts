import type { FeedbackReportKind, FeedbackReportStatus, FeedbackReportVisibility } from './feedbackReport'

/**
 * 운영자의 독자 제보 열람(#750, 읽기 전용): Content가 작품을 가리지 않는 모든 독자 제보를 최신순으로 한 쪽씩 주고 운영 서비스가 그대로 중계합니다.
 * 확인·답변·상태 변경은 작가의 몫이라 운영 화면에는 조치가 없습니다. 작가용 제보(feedbackReport.ts)·목업 데모(feedback.ts)·운영 신고(report.ts)와 별개입니다.
 */
export type OperationsFeedbackReport = {
  id: string
  workId: string
  workTitle: string
  episodeNumber: number
  kind: FeedbackReportKind
  /** 비공개 제보도 운영자에게는 원문을 보여 줍니다. */
  body: string
  quote: string | null
  visibility: FeedbackReportVisibility
  status: FeedbackReportStatus
  /** 탈퇴한 회원이면 서버가 `탈퇴한 회원`으로 채웁니다. */
  reporterName: string
  /** 제보자가 철회했습니다(원문과 상태는 그대로). */
  withdrawn: boolean
  createdAt: string
}

/** page는 0부터이고 total은 상태 조건을 적용한 전체 건수입니다. */
export type OperationsFeedbackReportPage = { items: OperationsFeedbackReport[]; page: number; size: number; total: number }
export type OperationsFeedbackReportQuery = { page: number; status: FeedbackReportStatus | null }

/** 한 쪽 건수. 서버 기본값과 같지만 화면이 쪽 계산에 쓰므로 요청에 싣습니다. */
export const FEEDBACK_REPORTS_PAGE_SIZE = 20
