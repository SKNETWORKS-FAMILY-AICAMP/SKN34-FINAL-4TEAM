import { z } from 'zod'

import { OperationsError, type EventInput } from '../../domain/entities/operations'
import type { EventRepository } from '../../domain/repositories/EventRepository'
import { send } from './operationsApi'

const instant = z.string().datetime({ offset: true })
const event = z.object({ id: z.string(), title: z.string(), body: z.string(), startsAt: instant.nullable(), endsAt: instant.nullable(), createdAt: instant, updatedAt: instant })
const events = z.object({ items: z.array(event) }).transform((value) => value.items)
const id = encodeURIComponent
const LOAD_FAILED = '이벤트를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'

async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await response.json().catch(() => undefined))
  if (!parsed.success) throw new OperationsError('서버 응답 형식을 확인할 수 없어요.')
  return parsed.data
}

/** 운영 이벤트 API. 독자 조회(/public)는 인증 없이, 관리자 경로는 기존 운영 요청(회원 Bearer)으로 호출합니다. */
export class HttpEventRepository implements EventRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  private publicGet(path: string): Promise<Response> {
    return (this.fetcher ?? fetch)('/api/v1/operations/public/events' + path, { signal: AbortSignal.timeout(15000) })
  }

  async listPublic() {
    const response = await this.publicGet('')
    if (!response.ok) throw new OperationsError(LOAD_FAILED)
    return parse(response, events)
  }
  async getPublic(eventId: string) {
    const response = await this.publicGet('/' + id(eventId))
    if (response.status === 404) return null
    if (!response.ok) throw new OperationsError(LOAD_FAILED)
    return parse(response, event)
  }
  async listAdmin() { return parse(await send(this.fetcher, '/admin/events'), events) }
  async create(input: EventInput) { return parse(await send(this.fetcher, '/admin/events', 'POST', input), event) }
  async update(eventId: string, input: EventInput) { return parse(await send(this.fetcher, `/admin/events/${id(eventId)}`, 'PUT', input), event) }
  async remove(eventId: string) { await send(this.fetcher, `/admin/events/${id(eventId)}`, 'DELETE') }
}
