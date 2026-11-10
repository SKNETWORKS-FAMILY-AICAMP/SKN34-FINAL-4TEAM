import { z } from 'zod'

import type { WorkInterestRepository } from '../../domain/repositories/WorkInterestRepository'
import { authVersion, protectedRequest } from '../api/auth'
import { csrf } from '../api/csrf'

const interests = z.object({ workIds: z.array(z.string()) })

/** 인증된 Content API(`/api/v1/works/interests`·`/works/{id}/interest`) 구현. 데모 데이터는 섞지 않습니다. */
export class HttpWorkInterestRepository implements WorkInterestRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  private async request(path: string, method: string) {
    const version = authVersion()
    const signal = AbortSignal.timeout(15000)
    const headers: Record<string, string> = {}
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = await csrf(signal)
    const response = await protectedRequest(path, { method, headers, signal }, version, false, { fetcher: this.fetcher, allowHttpError: true })
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(await response.json().catch(() => undefined))
      throw new Error(error.success ? error.data.detail : '관심 작품 요청을 처리하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.')
    }
    return response
  }

  async list() {
    const parsed = interests.safeParse(await (await this.request('/api/v1/works/interests', 'GET')).json().catch(() => undefined))
    if (!parsed.success) throw new Error('서버 응답 형식을 확인할 수 없어요.')
    return parsed.data.workIds
  }

  async add(workId: string) { await this.request(`/api/v1/works/${encodeURIComponent(workId)}/interest`, 'PUT') }
  async remove(workId: string) { await this.request(`/api/v1/works/${encodeURIComponent(workId)}/interest`, 'DELETE') }
}
