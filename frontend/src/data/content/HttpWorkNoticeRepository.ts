import { z } from 'zod'

import type { WorkNotice, WorkNoticeInput } from '../../domain/entities/workNotice'
import type { WorkNoticeRepository } from '../../domain/repositories/WorkNoticeRepository'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'

const notice: z.ZodType<WorkNotice> = z.object({
  id: z.string(), workId: z.string(), category: z.enum(['info', 'hiatus', 'event']), title: z.string(), body: z.string(), pinned: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
})
const notices = z.object({ items: z.array(notice) })

const all = (workId: string) => `/works/${encodeURIComponent(workId)}/notices`
const one = (workId: string, noticeId: string) => `${all(workId)}/${encodeURIComponent(noticeId)}`

/**
 * 작품 소식 API([계약](../../../../docs/design/work-notice-contract.md)). Bearer·CSRF·오류 문구·응답 검증은 HttpEpisodeRepository.request를 그대로 쓴다.
 * 공개 목록(`/public/works/{id}/notices`)은 익명 읽기라 로그인 상태여도 Bearer 없이 보내고, 쓰기는 회원 인증과 CSRF를 싣는다.
 */
export class HttpWorkNoticeRepository implements WorkNoticeRepository {
  private readonly api: HttpEpisodeRepository
  constructor(fetcher?: typeof fetch) { this.api = new HttpEpisodeRepository(fetcher) }

  async list(workId: string, signal?: AbortSignal) { return (await this.api.request(`/public${all(workId)}`, notices, 'GET', undefined, signal)).items }
  create(workId: string, input: WorkNoticeInput, signal?: AbortSignal) { return this.api.request(all(workId), notice, 'POST', input, signal) }
  update(workId: string, noticeId: string, input: WorkNoticeInput, signal?: AbortSignal) { return this.api.request(one(workId, noticeId), notice, 'PUT', input, signal) }
  remove(workId: string, noticeId: string, signal?: AbortSignal) { return this.api.request(one(workId, noticeId), z.undefined(), 'DELETE', undefined, signal) }
}
