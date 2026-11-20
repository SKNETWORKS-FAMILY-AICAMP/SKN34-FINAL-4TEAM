import { z } from 'zod'

import type { Genre } from '../../domain/entities/genre'
import type { GenreRepository } from '../../domain/repositories/GenreRepository'

/** 장르 한 줄(계약: `{code, name, emoji, featured}`, 목록은 배열). 아이콘은 없거나 비어 올 수 있어 null로 통일한다. 운영 장르 응답도 이 행을 넓혀 쓴다. */
export const genreRow = z.object({ code: z.string().min(1), name: z.string().min(1), emoji: z.string().nullish().transform((value) => value || null), featured: z.boolean() })

const FORMAT = '서버 응답 형식을 확인할 수 없어요.'

/**
 * 공개 장르 목록(`GET /public/genres`, [계약](../../../../docs/design/genre-management-contract.md)). 누구나 읽는 공개 GET이라 Bearer·CSRF 없이 보낸다.
 * 활성 장르만 표시 순서대로 오고, 실패·형식 오류는 빈 목록으로 숨기지 않고 던진다.
 */
export class HttpGenreRepository implements GenreRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  async list(signal?: AbortSignal): Promise<Genre[]> {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
    const response = await (this.fetcher ?? fetch)('/api/v1/public/genres', { method: 'GET', credentials: 'same-origin', signal: requestSignal })
    if (!response.ok) throw new Error('장르를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    const parsed = z.array(genreRow).safeParse(await response.json().catch(() => undefined))
    if (!parsed.success) throw new Error(FORMAT)
    return parsed.data
  }
}
