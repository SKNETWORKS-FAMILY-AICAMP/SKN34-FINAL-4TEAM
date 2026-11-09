import { z } from 'zod'
import type { ReadingRecord, ReadingRecordRepository } from '../../domain/repositories/ReadingRecordRepository'
import { SessionExpired } from '../../domain/repositories/ProfileRepository'
import { authVersion, protectedRequest } from '../api/auth'
import { csrf } from '../api/csrf'

// updatedAt은 화면이 쓰지 않아 검증·전달하지 않는다(Zod가 모르는 키를 버린다).
const records = z.object({ records: z.array(z.object({
  workId: z.string().min(1), lastEpisode: z.number().int().positive(), readEpisodes: z.array(z.number().int().positive()),
})) })

/** Content 독서 기록 API(GET·PUT·DELETE /api/v1/works/…/reading). 모두 본인 Bearer이며 쓰기는 CSRF를 붙인다. */
export class HttpReadingRecordRepository implements ReadingRecordRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }
  private async request(path: string, method: string) {
    const fetcher = this.fetcher ?? fetch
    const version = authVersion()
    const signal = AbortSignal.timeout(15000)
    const headers: Record<string, string> = {}
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = await csrf(signal)
    let response: Response
    try {
      response = await protectedRequest('/api/v1/works' + path, { method, headers, signal }, version, false, { fetcher, allowHttpError: true })
    } catch (error) {
      if (error instanceof SessionExpired) throw new SessionExpired('서버 인증이 필요합니다. 로그인한 뒤 다시 시도해 주세요.')
      throw error
    }
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(await response.json().catch(() => undefined))
      throw new Error(error.success ? error.data.detail : '요청을 처리하지 못했어요. 입력과 서버 상태를 확인해 주세요.')
    }
    return response
  }
  async list(): Promise<ReadingRecord[]> {
    const parsed = records.safeParse(await (await this.request('/reading', 'GET')).json().catch(() => undefined))
    if (!parsed.success) throw new Error('서버 응답 형식을 확인할 수 없어요.')
    return parsed.data.records
  }
  async record(workId: string, episode: number) {
    await this.request(`/${encodeURIComponent(workId)}/reading/${episode}`, 'PUT')
  }
  async remove(workId: string) {
    await this.request(`/${encodeURIComponent(workId)}/reading`, 'DELETE')
  }
}
