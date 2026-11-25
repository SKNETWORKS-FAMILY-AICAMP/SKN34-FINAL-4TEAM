import type { OperationsFeedbackReportPage, OperationsFeedbackReportQuery } from '../entities/operationsFeedbackReport'

/** 운영 독자 제보 열람 API 계약(#750). 관리자 Bearer와 feedback 권한으로 읽기만 하며, 처리(확인·답변·상태 변경)는 작가의 몫이라 쓰기가 없습니다. */
export interface OperationsFeedbackReportRepository {
  list(query: OperationsFeedbackReportQuery): Promise<OperationsFeedbackReportPage>
}
