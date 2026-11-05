import { z } from 'zod'
import type { PlanInput, StoryPlan } from '../../domain/entities/storyPlan'
import type { StoryPlanRepository } from '../../domain/repositories/StoryPlanRepository'
import type { EpisodeRepository } from '../../domain/repositories/EpisodeRepository'
import { authVersion, protectedRequest } from '../api/auth'
import { csrf } from '../api/csrf'

const plan = z.object({
  id: z.string(), workId: z.string(), kind: z.enum(['plot', 'scene']), parentId: z.string().nullable(),
  title: z.string(), content: z.string(), episodeNumber: z.number().int().positive().nullable(), episodeMissing: z.boolean(),
  characterIds: z.array(z.string()), placeIds: z.array(z.string()), revision: z.number().int().nonnegative(),
})

export class HttpStoryPlanRepository implements StoryPlanRepository {
  private readonly episodes: Pick<EpisodeRepository, 'world' | 'writingList'>
  private readonly fetcher?: typeof fetch
  constructor(episodes: Pick<EpisodeRepository, 'world' | 'writingList'>, fetcher?: typeof fetch) { this.episodes = episodes; this.fetcher = fetcher }
  private path(workId: string, id?: string) { return `/api/v1/works/${encodeURIComponent(workId)}/story-plans${id ? '/' + encodeURIComponent(id) : ''}` }
  private async request<T>(url: string, schema: z.ZodType<T>, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const generation = authVersion()
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(80000)]) : AbortSignal.timeout(80000)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = await csrf(requestSignal)
    const response = await protectedRequest(url, { method, headers, signal: requestSignal, body: body === undefined ? undefined : JSON.stringify(body) }, generation, false, { fetcher: this.fetcher, allowHttpError: true })
    const value: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined)
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(value)
      throw new Error(error.success ? error.data.detail : '계획 요청을 처리하지 못했어요.')
    }
    if (method === 'DELETE' && response.status !== 204) throw new Error('삭제 완료 응답을 확인할 수 없어요. 다시 불러와 주세요.')
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error('계획 서버 응답 형식을 확인할 수 없어요.')
    return parsed.data
  }
  list(workId: string, signal?: AbortSignal) { return this.request(this.path(workId), z.array(plan), 'GET', undefined, signal) }
  read(workId: string, id: string, signal?: AbortSignal) { return this.request(this.path(workId, id), plan, 'GET', undefined, signal) }
  save(workId: string, value: PlanInput, previous?: StoryPlan, signal?: AbortSignal) {
    return this.request(this.path(workId, previous?.id), plan, previous ? 'PUT' : 'POST', { ...value, revision: previous?.revision ?? 0 }, signal)
  }
  remove(workId: string, value: StoryPlan, signal?: AbortSignal) { return this.request(`${this.path(workId, value.id)}?revision=${value.revision}`, z.undefined(), 'DELETE', undefined, signal) }
  async references(workId: string, signal?: AbortSignal) {
    const [world, episodes] = await Promise.all([this.episodes.world(workId, signal), this.episodes.writingList(workId, signal)])
    return {
      characters: world.settings.filter(s => s.category === '인물').map(s => ({ id: s.id, name: s.name })),
      places: world.settings.filter(s => s.category === '장소').map(s => ({ id: s.id, name: s.name })),
      episodes: episodes.map(e => ({ number: e.number, title: e.draft.title })),
    }
  }
}
