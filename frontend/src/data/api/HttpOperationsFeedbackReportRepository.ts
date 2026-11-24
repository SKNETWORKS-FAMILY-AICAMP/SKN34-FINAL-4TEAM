import { z } from 'zod'

import { FEEDBACK_REPORT_KINDS, FEEDBACK_REPORT_STATUSES } from '../../domain/entities/feedbackReport'
import {
  FEEDBACK_REPORTS_PAGE_SIZE,
  type OperationsFeedbackReport, type OperationsFeedbackReportPage, type OperationsFeedbackReportQuery,
} from '../../domain/entities/operationsFeedbackReport'
import type { OperationsFeedbackReportRepository } from '../../domain/repositories/OperationsFeedbackReportRepository'
import { read } from './operationsApi'

const report: z.ZodType<OperationsFeedbackReport> = z.object({
  id: z.string(), workId: z.string(), workTitle: z.string(), episodeNumber: z.number().int().positive(),
  kind: z.enum(FEEDBACK_REPORT_KINDS), body: z.string(), quote: z.string().nullable(), visibility: z.enum(['public', 'private']),
  status: z.enum(FEEDBACK_REPORT_STATUSES), reporterName: z.string(), withdrawn: z.boolean(), createdAt: z.string().datetime({ offset: true }),
})
// 운영 공통 쪽 응답(PageResponse)의 totalElements가 화면의 total입니다. 쪽 수(totalPages)는 화면이 건수로 계산하므로 읽지 않습니다.
const pageSchema = z.object({ items: z.array(report), page: z.number().int().nonnegative(), size: z.number().int().positive(), totalElements: z.number().int().nonnegative() })
  .transform(({ totalElements, ...rest }): OperationsFeedbackReportPage => ({ ...rest, total: totalElements }))

/** 운영 독자 제보 열람(#750): 읽기 전용이라 조회만 있고, 상태 조건은 고른 때만 query로 보냅니다. */
export class HttpOperationsFeedbackReportRepository implements OperationsFeedbackReportRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  list({ page, status }: OperationsFeedbackReportQuery): Promise<OperationsFeedbackReportPage> {
    const query = new URLSearchParams({ page: String(page), size: String(FEEDBACK_REPORTS_PAGE_SIZE), ...(status ? { status } : {}) })
    return read(this.fetcher, `/feedback-reports?${query}`, pageSchema)
  }
}
