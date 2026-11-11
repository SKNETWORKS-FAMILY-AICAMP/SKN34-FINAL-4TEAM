import { z } from 'zod'

import type { EditSuggestion } from '../../domain/entities/editSuggestion'
import type { EditSuggestionRepository } from '../../domain/repositories/EditSuggestionRepository'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'

const suggestion: z.ZodType<EditSuggestion> = z.object({
  id: z.string(), workId: z.string(), workTitle: z.string(), episodeNumber: z.number().int().positive(), publishedVersionId: z.string(),
  source: z.enum(['reader', 'ai']), proposerName: z.string(), beforeText: z.string(), afterText: z.string(),
  editedText: z.string().nullable(), reason: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected', 'held']), decisionReason: z.string().nullable(),
  applyResult: z.enum(['applied', 'failed']).nullable(), applyFailure: z.string().nullable(), appliedVersionId: z.string().nullable(),
  scope: z.enum(['auto', 'review']), scopeReasons: z.array(z.string()), mine: z.boolean(), owner: z.boolean(),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
})
const suggestions = z.object({ items: z.array(suggestion) })

const one = (workId: string, id: string) => `/works/${encodeURIComponent(workId)}/edit-suggestions/${encodeURIComponent(id)}`

/** 수정 제안 API(기능 24). Bearer·CSRF·오류 문구·응답 검증은 HttpEpisodeRepository.request를 그대로 쓴다. */
export class HttpEditSuggestionRepository implements EditSuggestionRepository {
  private readonly api: HttpEpisodeRepository
  constructor(fetcher?: typeof fetch) { this.api = new HttpEpisodeRepository(fetcher) }

  create(workId: string, episode: number, input: { beforeText: string; afterText: string; reason?: string }) {
    return this.api.request(`/works/${encodeURIComponent(workId)}/episodes/${episode}/edit-suggestions`, suggestion, 'POST', input)
  }
  async mine() { return (await this.api.request('/works/edit-suggestions/mine', suggestions)).items }
  async inbox(workId?: string) { return (await this.api.request(`/works/edit-suggestions/inbox${workId === undefined ? '' : `?${new URLSearchParams({ workId })}`}`, suggestions)).items }
  saveEditedText(workId: string, id: string, editedText: string) { return this.api.request(`${one(workId, id)}/edited-text`, suggestion, 'PUT', { editedText }) }
  approve(workId: string, id: string) { return this.api.request(`${one(workId, id)}/approval`, suggestion, 'POST') }
  reject(workId: string, id: string, reason?: string) { return this.api.request(`${one(workId, id)}/rejection`, suggestion, 'POST', reason ? { reason } : {}) }
  hold(workId: string, id: string) { return this.api.request(`${one(workId, id)}/hold`, suggestion, 'POST') }
}
