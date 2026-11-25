import type { OperationsFeedbackReportQuery } from '../entities/operationsFeedbackReport'
import type { OperationsFeedbackReportRepository } from '../repositories/OperationsFeedbackReportRepository'

/** 운영자의 독자 제보 열람(#750). 권한 검사·정렬·상태 필터·삭제된 작품 제외는 서버가 합니다. */
export class OperationsFeedbackReportUseCase {
  private readonly repository: OperationsFeedbackReportRepository
  constructor(repository: OperationsFeedbackReportRepository) { this.repository = repository }

  list(query: OperationsFeedbackReportQuery) { return this.repository.list(query) }
}
