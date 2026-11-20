import { z } from 'zod'

import type { PublicWorld, PublicWorldCardHit, PublicWorldCardPage, PublicWorldPage, PublicWorldSummary } from '../../domain/entities/publicWorld'
import type { CardType } from '../../domain/entities/studioCards'
import type { PublicWorldCardQuery, PublicWorldQuery, PublicWorldRepository } from '../../domain/repositories/PublicWorldRepository'

const id = z.string().min(1)
const count = z.number().int().nonnegative()
const instant = z.iso.datetime({ offset: true })
// 장르 코드(`genre-01` …)다. 이름은 UseCase가 공개 장르 목록으로 찾는다(DEC-56).
const genre = z.string().min(1).nullable()
const cardType: z.ZodType<CardType> = z.enum(['character', 'location', 'organization', 'ability', 'object', 'rule', 'event', 'other'])
// 카드 대표 이미지 id(#401). 이 필드를 주기 전 응답과 이미지 없는 카드는 null이다.
const imageId = z.string().min(1).nullable().default(null)
// 관계의 회차 이력(DEC-54 2단계): 기준 회차까지의 변화. 이 필드를 주기 전 응답에는 없다(없는 대로 둔다).
const relationHistory = z.array(z.object({ episode: z.number().int().positive(), label: z.string(), body: z.string() })).optional()
// 연결된 공개 소설(#329). 이 필드를 주기 전 응답과 연결 없음·비공개 소설은 null이다.
const linkedWork = z.object({ id, title: z.string(), authorNickname: z.string(), hasCover: z.boolean() }).nullable().default(null)

const summary: z.ZodType<PublicWorldSummary> = z.object({
  id, name: z.string(), description: z.string(), genre, authorNickname: z.string(), cardCount: count, relationshipCount: count.nullable(), publishedAt: instant, hasCover: z.boolean().default(false),
})
const worldPage: z.ZodType<PublicWorldPage> = z.object({ items: z.array(summary), page: count, size: z.number().int().positive(), total: count })
// 설정 카드 검색 결과(#505): 본문 없이 카드와 속한 세계관만 준다.
const cardHit: z.ZodType<PublicWorldCardHit> = z.object({ worldId: id, worldName: z.string(), cardId: id, title: z.string(), cardType, aliases: z.array(z.string()), tags: z.array(z.string()), imageId })
const cardPage: z.ZodType<PublicWorldCardPage> = z.object({ items: z.array(cardHit), page: count, size: z.number().int().positive(), total: count })
const world: z.ZodType<PublicWorld> = z.object({
  id, name: z.string(), description: z.string(), genre, authorNickname: z.string(), publishedAt: instant, hasCover: z.boolean().default(false), revisionNo: z.number().int().positive(),
  cards: z.array(z.object({ id, title: z.string(), text: z.string(), cardType, aliases: z.array(z.string()), tags: z.array(z.string()), imageId })),
  relationships: z.array(z.object({ id, sourceCardId: id, targetCardId: id, label: z.string(), category: z.enum(['structural', 'emotional', 'identity']).nullable().optional(), direction: z.enum(['directed', 'symmetric']).nullable().optional(), body: z.string().nullable().optional(), polarity: z.enum(['asserted', 'denied']).nullable().optional(), history: relationHistory })),
  relationshipStatus: z.enum(['current', 'unavailable']),
  linkedWork,
})

const FORMAT = '서버 응답 형식을 확인할 수 없어요.'

/**
 * 공개 세계관 읽기 API([계약](../../../../docs/design/public-world-contract.md)). 누구나 읽는 공개 GET이라 Bearer·CSRF 없이 보내고
 * (HttpEpisodeRepository의 공개 읽기와 같은 방식), 비공개·없는 세계관(404, UUID 형식이 아닌 id는 400)은 오류가 아니라 undefined로 돌려준다.
 */
export class HttpPublicWorldRepository implements PublicWorldRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  private request(path: string, signal?: AbortSignal) {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
    const fetcher = this.fetcher ?? fetch
    return fetcher('/api/v1/public/world-studios' + path, { method: 'GET', credentials: 'same-origin', signal: requestSignal })
  }

  private async parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(value)
      throw new Error(error.success ? error.data.detail : '요청을 처리하지 못했어요. 입력과 서버 상태를 확인해 주세요.')
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error(FORMAT)
    return parsed.data
  }

  async list({ genre: code, q, page, size }: PublicWorldQuery, signal?: AbortSignal) {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (code) params.set('genre', code)
    params.set('page', String(page))
    params.set('size', String(size))
    return this.parse(await this.request(`?${params}`, signal), worldPage)
  }

  async searchCards({ q, page, size }: PublicWorldCardQuery, signal?: AbortSignal) {
    const params = new URLSearchParams({ q, page: String(page), size: String(size) })
    return this.parse(await this.request(`/cards?${params}`, signal), cardPage)
  }

  async get(worldId: string, signal?: AbortSignal) {
    const response = await this.request(`/${encodeURIComponent(worldId)}`, signal)
    if (response.status === 404 || response.status === 400) return undefined // 400은 UUID 형식이 아닌 id(없는 세계관)다
    const found = await this.parse(response, world)
    if (found.id.toLowerCase() !== worldId.toLowerCase()) throw new Error(FORMAT) // 주소는 대문자 UUID여도 서버는 소문자로 답한다
    return found
  }
}
