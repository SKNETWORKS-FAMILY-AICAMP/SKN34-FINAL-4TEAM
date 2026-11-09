import { z } from 'zod'
import type { WorkLikeRepository, WorkLikeState } from '../../domain/repositories/WorkLikeRepository'
import { authVersion, protectedRequest } from '../api/auth'
import { csrf } from '../api/csrf'

const likeState = z.object({ likes: z.number().int().nonnegative(), liked: z.boolean() })

/** 공개 작품 좋아요(Content). 내 좋아요 여부는 Bearer가 있어야 오므로 공개 상세도 인증 요청으로 읽는다. */
export class HttpWorkLikeRepository implements WorkLikeRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }
  private async send(url: string, method: string) {
    const generation = authVersion()
    const timeout = AbortSignal.timeout(30000)
    const headers: Record<string, string> = {}
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = await csrf(timeout)
    return protectedRequest(url, { method, headers, signal: timeout }, generation, false, { fetcher: this.fetcher, allowHttpError: true })
  }
  private async state(response: Response): Promise<WorkLikeState> {
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(value)
      throw new Error(error.success ? error.data.detail : '좋아요를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
    const parsed = likeState.safeParse(value)
    if (!parsed.success) throw new Error('좋아요 서버 응답 형식을 확인할 수 없어요.')
    return parsed.data
  }
  async read(workId: string) {
    const response = await this.send(`/api/v1/public/works/${encodeURIComponent(workId)}`, 'GET')
    return response.status === 404 ? null : this.state(response)
  }
  async like(workId: string) { return this.state(await this.send(`/api/v1/works/${encodeURIComponent(workId)}/like`, 'PUT')) }
  async unlike(workId: string) { return this.state(await this.send(`/api/v1/works/${encodeURIComponent(workId)}/like`, 'DELETE')) }
}
