import { z } from 'zod'

import {
  FEEDBACK_REPORT_KINDS, FEEDBACK_REPORT_STATUSES,
  type FeedbackReport, type FeedbackReportKind, type FeedbackReportStatus, type FeedbackReportVisibility,
} from '../../domain/entities/feedbackReport'
import type { FeedbackReportRepository } from '../../domain/repositories/FeedbackReportRepository'
import { getAccessToken } from '../api/auth'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'

const instant = z.string().datetime({ offset: true })
const report: z.ZodType<FeedbackReport> = z.object({
  id: z.string(), workId: z.string(), workTitle: z.string(), episodeNumber: z.number().int().positive(), publishedVersionId: z.string(),
  kind: z.enum(FEEDBACK_REPORT_KINDS), body: z.string().nullable(), quote: z.string().nullable(),
  visibility: z.enum(['public', 'private']), status: z.enum(FEEDBACK_REPORT_STATUSES),
  reporterName: z.string().nullable(), mine: z.boolean(), owner: z.boolean(), authorChecked: z.boolean(), withdrawn: z.boolean(),
  amendments: z.array(z.object({ action: z.enum(['correct', 'withdraw']), body: z.string().nullable(), createdAt: instant })),
  responses: z.array(z.object({ id: z.string(), authorName: z.string(), body: z.string(), isPublic: z.boolean(), createdAt: instant })),
  createdAt: instant, updatedAt: instant,
})
const reports = z.object({ items: z.array(report) })

const episode = (id: string, n: number) => `/works/${encodeURIComponent(id)}/episodes/${n}/feedback-reports`
const one = (id: string, reportId: string, action: string) => `/works/${encodeURIComponent(id)}/feedback-reports/${encodeURIComponent(reportId)}/${action}`

/** 회차 제보 API(기능 23). Bearer·CSRF·오류 문구·응답 검증은 HttpEpisodeRepository.request를 그대로 쓴다. */
export class HttpFeedbackReportRepository implements FeedbackReportRepository {
  private readonly api: HttpEpisodeRepository
  constructor(fetcher?: typeof fetch) { this.api = new HttpEpisodeRepository(fetcher) }

  create(id: string, n: number, input: { kind: FeedbackReportKind; body: string; quote?: string; visibility: FeedbackReportVisibility }) { return this.api.request(episode(id, n), report, 'POST', input) }

  /** 공개 읽기: 로그인 상태면 Bearer를 함께 보내 내 비공개 제보와(작가면) 모든 제보를 받고, 익명이면 그냥 읽는다. */
  async listEpisode(id: string, n: number) {
    return (await this.api.request(`/public${episode(id, n)}`, reports, 'GET', undefined, undefined, !getAccessToken())).items
  }
  async listMine() { return (await this.api.request('/works/feedback-reports/mine', reports)).items }
  async listInbox(workId?: string) { return (await this.api.request(`/works/feedback-reports/inbox${workId === undefined ? '' : `?${new URLSearchParams({ workId })}`}`, reports)).items }

  setVisibility(id: string, reportId: string, visibility: FeedbackReportVisibility) { return this.api.request(one(id, reportId, 'visibility'), report, 'PUT', { visibility }) }
  correct(id: string, reportId: string, body: string) { return this.api.request(one(id, reportId, 'corrections'), report, 'POST', { body }) }
  withdraw(id: string, reportId: string) { return this.api.request(one(id, reportId, 'withdrawal'), report, 'POST') }
  check(id: string, reportId: string) { return this.api.request(one(id, reportId, 'check'), report, 'POST') }
  answer(id: string, reportId: string, input: { body: string; isPublic: boolean }) { return this.api.request(one(id, reportId, 'responses'), report, 'POST', input) }
  setStatus(id: string, reportId: string, status: FeedbackReportStatus) { return this.api.request(one(id, reportId, 'status'), report, 'PUT', { status }) }
}
