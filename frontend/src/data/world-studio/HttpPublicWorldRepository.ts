import { z } from 'zod'

import { PUBLIC_WORLD_GENRES, type PublicWorld, type PublicWorldPage, type PublicWorldSummary } from '../../domain/entities/publicWorld'
import type { CardType } from '../../domain/entities/studioCards'
import type { PublicWorldQuery, PublicWorldRepository } from '../../domain/repositories/PublicWorldRepository'

const id = z.string().min(1)
const count = z.number().int().nonnegative()
const instant = z.iso.datetime({ offset: true })
const genre = z.enum(PUBLIC_WORLD_GENRES).nullable()
const cardType: z.ZodType<CardType> = z.enum(['character', 'location', 'organization', 'ability', 'object', 'rule', 'event', 'other'])

const summary: z.ZodType<PublicWorldSummary> = z.object({
  id, name: z.string(), description: z.string(), genre, authorNickname: z.string(), cardCount: count, relationshipCount: count, publishedAt: instant, hasCover: z.boolean().default(false),
})
const worldPage: z.ZodType<PublicWorldPage> = z.object({ items: z.array(summary), page: count, size: z.number().int().positive(), total: count })
const world: z.ZodType<PublicWorld> = z.object({
  id, name: z.string(), description: z.string(), genre, authorNickname: z.string(), publishedAt: instant, hasCover: z.boolean().default(false), revisionNo: z.number().int().positive(),
  cards: z.array(z.object({ id, title: z.string(), text: z.string(), cardType, aliases: z.array(z.string()), tags: z.array(z.string()) })),
  relationships: z.array(z.object({ id, sourceCardId: id, targetCardId: id, label: z.string() })),
  relationshipStatus: z.enum(['current', 'unavailable']),
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

  async list({ genre: code, page, size }: PublicWorldQuery, signal?: AbortSignal) {
    const params = new URLSearchParams()
    if (code) params.set('genre', code)
    params.set('page', String(page))
    params.set('size', String(size))
    return this.parse(await this.request(`?${params}`, signal), worldPage)
  }

  async get(worldId: string, signal?: AbortSignal) {
    const response = await this.request(`/${encodeURIComponent(worldId)}`, signal)
    if (response.status === 404 || response.status === 400) return undefined // 400은 UUID 형식이 아닌 id(없는 세계관)다
    const found = await this.parse(response, world)
    if (found.id.toLowerCase() !== worldId.toLowerCase()) throw new Error(FORMAT) // 주소는 대문자 UUID여도 서버는 소문자로 답한다
    return found
  }
}
