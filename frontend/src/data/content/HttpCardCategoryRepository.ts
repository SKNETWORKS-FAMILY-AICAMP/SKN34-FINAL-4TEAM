import { z } from 'zod'

import type { CardCategory } from '../../domain/entities/cardCategory'
import type { CardCategoryRepository } from '../../domain/repositories/CardCategoryRepository'

/** 카드 카테고리 한 줄(계약: `{code, name, icon, position, active}`, 목록은 맨 배열). 아이콘은 없거나 비어 올 수 있어 null로 통일한다. 운영 응답도 이 행을 넓혀 쓴다. */
export const cardCategoryRow = z.object({
  code: z.string().min(1), name: z.string().min(1), icon: z.string().nullish().transform((value) => value || null), position: z.number().int(), active: z.boolean(),
})

const FORMAT = '서버 응답 형식을 확인할 수 없어요.'

/**
 * 공개 카드 카테고리 목록(`GET /public/card-categories`). 누구나 읽는 공개 GET이라 Bearer·CSRF 없이 보낸다.
 * 숨긴 카테고리까지 `active` 플래그와 함께 position 순서로 오고, 실패·형식 오류는 빈 목록으로 숨기지 않고 던진다.
 */
export class HttpCardCategoryRepository implements CardCategoryRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  async list(signal?: AbortSignal): Promise<CardCategory[]> {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
    const response = await (this.fetcher ?? fetch)('/api/v1/public/card-categories', { method: 'GET', credentials: 'same-origin', signal: requestSignal })
    if (!response.ok) throw new Error('카드 카테고리를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    const parsed = z.array(cardCategoryRow).safeParse(await response.json().catch(() => undefined))
    if (!parsed.success) throw new Error(FORMAT)
    return parsed.data
  }
}
