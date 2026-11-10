import { z } from 'zod'

import { OperationsError, type NoticeInput } from '../../domain/entities/operations'
import type { NoticeRepository } from '../../domain/repositories/NoticeRepository'
import { read, send } from './operationsApi'

const instant = z.string().datetime({ offset: true })
const notice = z.object({ id: z.string(), title: z.string(), body: z.string(), createdAt: instant, updatedAt: instant })
const items = z.object({ items: z.array(notice) }).transform((v) => v.items)
const ADMIN = '/admin/notices'
const PUBLIC = '/api/v1/operations/public/notices'
const enc = encodeURIComponent

async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await response.json().catch(() => undefined))
  if (!parsed.success) throw new OperationsError('서버 응답 형식을 확인할 수 없어요.')
  return parsed.data
}
/** 독자 공개 API는 로그인 없이 읽는 GET뿐이라 Bearer·CSRF 없이 상대 경로로 보냅니다. */
const readPublic = (fetcher: typeof fetch | undefined, path: string) => (fetcher ?? fetch)(PUBLIC + path, { signal: AbortSignal.timeout(15000) })
const unavailable = () => new OperationsError('공지를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')

/** 관리자 요청은 operationsApi의 회원 Bearer 요청·오류 문구를 그대로 쓰고, 독자 요청만 인증 없이 보냅니다. */
export class HttpNoticeRepository implements NoticeRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  // ponytail: 서버가 최신 100개까지만 준다(계약). 공지가 늘면 page 쿼리와 '더 보기' UI를 추가한다.
  list() { return read(this.fetcher, ADMIN, items) }
  async create(input: NoticeInput) { return parse(await send(this.fetcher, ADMIN, 'POST', input), notice) }
  async update(id: string, input: NoticeInput) { return parse(await send(this.fetcher, `${ADMIN}/${enc(id)}`, 'PUT', input), notice) }
  async delete(id: string) { await send(this.fetcher, `${ADMIN}/${enc(id)}`, 'DELETE') }

  async listPublic() {
    const response = await readPublic(this.fetcher, '')
    if (!response.ok) throw unavailable()
    return parse(response, items)
  }
  async getPublic(id: string) {
    const response = await readPublic(this.fetcher, `/${enc(id)}`)
    // 서버는 없는 공지를 404, 형식이 틀린 id(옛 `?id=1` 링크 등)를 400으로 답한다. 둘 다 '없음'이고 그 밖의 실패는 거부한다.
    if (response.status === 404 || response.status === 400) return null
    if (!response.ok) throw unavailable()
    return parse(response, notice)
  }
}
