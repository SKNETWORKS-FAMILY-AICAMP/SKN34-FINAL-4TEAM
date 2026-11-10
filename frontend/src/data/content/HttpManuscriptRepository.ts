import { z } from 'zod'
import type { ManuscriptDownload, ManuscriptExportQuery, ManuscriptImportItem } from '../../domain/entities/manuscript'
import type { ManuscriptRepository } from '../../domain/repositories/ManuscriptRepository'
import { assertAuthVersion, authVersion, protectedRequest } from '../api/auth'
import { csrf } from '../api/csrf'

const count = z.number().int().nonnegative()
const previewEpisode = z.object({ title: z.string(), from: count, to: z.number().int().positive(), charCount: count, excerpt: z.string(), imageCount: count, warnings: z.array(z.string()) })
const preview = z.object({ format: z.enum(['txt', 'epub']), unit: z.enum(['line', 'chapter']), unitCount: count, existingEpisodeCount: count, episodes: z.array(previewEpisode) })
const summary = z.object({
  succeeded: count, failed: count,
  results: z.array(z.object({ number: z.number().int().positive(), title: z.string(), status: z.enum(['created', 'versioned', 'partial', 'failed']), reason: z.string().nullable(), missingImages: count })),
})
// 50MB 파일을 두 번 올릴 수 있어 일반 요청보다 길게 기다린다.
const TIMEOUT = 120000
const FAILURE: Record<number, string> = {
  404: '작품을 찾을 수 없어요. 내 작품을 다시 선택해 주세요.',
  413: '파일이 너무 커요. TXT는 10MB, EPUB은 50MB 이하만 올릴 수 있어요.',
}
const worksPath = (workId: string) => `/api/v1/works/${encodeURIComponent(workId)}`

/** 서버가 정한 파일명(filename*)만 쓰되 경로 구분자와 파일명에 쓸 수 없는 문자는 `_`로 바꾼다. */
function filenameOf(header: string | null, format: string) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1]
  let name = ''
  try { name = encoded ? decodeURIComponent(encoded) : '' } catch { /* 잘못된 인코딩이면 기본 이름을 쓴다 */ }
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || `원고.${format}`
}

export class HttpManuscriptRepository implements ManuscriptRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }
  private async request(path: string, method: 'GET' | 'POST', body?: FormData, signal?: AbortSignal) {
    const version = authVersion()
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT)
    const headers: Record<string, string> = {}
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = await csrf(requestSignal)
    const fetcher = this.fetcher ?? fetch
    const response = await protectedRequest(path, { method, body, headers, signal: requestSignal }, version, false, { fetcher, allowHttpError: true })
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(await response.json().catch(() => undefined))
      throw new Error(error.success ? error.data.detail : FAILURE[response.status] ?? '요청을 처리하지 못했어요. 입력과 서버 상태를 확인해 주세요.')
    }
    return response
  }
  private async upload<T>(schema: z.ZodType<T>, path: string, body: FormData, signal?: AbortSignal) {
    const version = authVersion()
    const value: unknown = await (await this.request(path, 'POST', body, signal)).json().catch(() => undefined)
    assertAuthVersion(version)
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error('서버 응답 형식을 확인할 수 없어요.')
    return parsed.data
  }
  preview(workId: string, file: File, signal?: AbortSignal) {
    const form = new FormData()
    form.append('file', file)
    return this.upload(preview, `${worksPath(workId)}/manuscript-imports/preview`, form, signal)
  }
  confirm(workId: string, file: File, rightsConfirmed: boolean, items: ManuscriptImportItem[], signal?: AbortSignal) {
    const form = new FormData()
    form.append('file', file)
    form.append('request', new Blob([JSON.stringify({ rightsConfirmed, items })], { type: 'application/json' }))
    return this.upload(summary, `${worksPath(workId)}/manuscript-imports`, form, signal)
  }
  async exportManuscript(workId: string, query: ManuscriptExportQuery, signal?: AbortSignal): Promise<ManuscriptDownload> {
    const version = authVersion()
    const params = new URLSearchParams({ format: query.format, source: query.source })
    if (query.episode !== undefined) params.set('episode', String(query.episode))
    const response = await this.request(`${worksPath(workId)}/manuscript-export?${params}`, 'GET', undefined, signal)
    const blob = await response.blob()
    assertAuthVersion(version)
    if (!blob.size) throw new Error('내보낼 파일 응답을 확인할 수 없어요.')
    return { blob, filename: filenameOf(response.headers.get('Content-Disposition'), query.format) }
  }
}
