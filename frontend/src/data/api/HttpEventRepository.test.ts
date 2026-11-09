import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { OperationsError } from '../../domain/entities/operations'
import { login } from './auth'
import { HttpEventRepository } from './HttpEventRepository'

const ID = '0b6f3e5a-2c9d-4c0e-9a55-1f6f6d1f7a01'
const event = {
  id: ID, title: '가을 이벤트', body: '첫 줄\n둘째 줄', startsAt: '2026-11-08T00:00:00Z', endsAt: null,
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T01:00:00.123456Z',
}
const list = { items: [event], page: 0, size: 100, totalElements: 1, totalPages: 1 }
type Call = [string, { method?: string; body?: string; headers?: Record<string, string>; credentials?: string }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const ok = (value: unknown, status = 200) => vi.fn(async () => Response.json(value, { status }))
const empty = (status: number) => vi.fn(async () => new Response(null, { status }))

afterEach(() => vi.unstubAllGlobals())

// 로그인하기 전(이 파일에서 가장 먼저 실행)에는 Bearer가 없다. 독자 조회는 그래도 열려야 한다.
describe('HttpEventRepository 독자 공개 API (비로그인)', () => {
  it('로그인 없이 목록과 상세를 인증 헤더 없이 GET으로 읽는다', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => Response.json(String(url).endsWith(ID) ? event : list))
    const repo = new HttpEventRepository(fetcher)
    expect(await repo.listPublic()).toEqual([event])
    expect(await repo.getPublic(ID)).toEqual(event)
    const [[listUrl, listInit], [detailUrl, detailInit]] = callsOf(fetcher)
    expect(listUrl).toBe('/api/v1/operations/public/events')
    expect(detailUrl).toBe(`/api/v1/operations/public/events/${ID}`)
    for (const init of [listInit, detailInit]) {
      expect(init.method ?? 'GET').toBe('GET')
      expect(init.headers?.Authorization).toBeUndefined()
      expect(init.body).toBeUndefined()
    }
  })

  it('상세가 404이면 null이고, 그 밖의 실패는 없음으로 바꾸지 않는다', async () => {
    expect(await new HttpEventRepository(empty(404)).getPublic(ID)).toBeNull()
    await expect(new HttpEventRepository(empty(500)).getPublic(ID)).rejects.toThrow(OperationsError)
    await expect(new HttpEventRepository(empty(500)).listPublic()).rejects.toThrow(OperationsError)
  })

  it('응답 형식이 계약과 다르면 거부한다', async () => {
    await expect(new HttpEventRepository(ok({ items: [{ ...event, startsAt: '내일' }] })).listPublic()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    await expect(new HttpEventRepository(ok({ items: [{ ...event, title: undefined }] })).listPublic()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    await expect(new HttpEventRepository(ok({ ...event, createdAt: null })).getPublic(ID)).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    await expect(new HttpEventRepository(ok([event])).listPublic()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })
})

describe('HttpEventRepository 관리자 API (회원 Bearer)', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'e-csrf' })
      : Response.json({ accessToken: 'e-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: true } })))
    await login('u1@example.invalid', 'test-password')
  })

  it('목록은 Bearer로 admin 경로를 GET하고 응답을 검증한다', async () => {
    const fetcher = ok(list)
    expect(await new HttpEventRepository(fetcher).listAdmin()).toEqual([event])
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/admin/events')
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.headers?.Authorization).toBe('Bearer e-bearer')
  })

  it('등록은 POST로 JSON 본문을 보내고 201 응답의 이벤트를 돌려준다', async () => {
    const fetcher = ok(event, 201)
    const input = { title: '가을 이벤트', body: '첫 줄\n둘째 줄', startsAt: '2026-11-08T00:00:00.000Z', endsAt: null }
    expect(await new HttpEventRepository(fetcher).create(input)).toEqual(event)
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/admin/events')
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(input) })
    expect(init.headers).toMatchObject({ Authorization: 'Bearer e-bearer', 'Content-Type': 'application/json' })
  })

  it('전체 수정은 PUT으로 비운 기간(null)까지 그대로 보낸다', async () => {
    const fetcher = ok({ ...event, startsAt: null })
    const input = { title: '수정', body: '본문', startsAt: null, endsAt: null }
    expect(await new HttpEventRepository(fetcher).update('a b/1', input)).toEqual({ ...event, startsAt: null })
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/admin/events/a%20b%2F1')
    expect(init).toMatchObject({ method: 'PUT', body: JSON.stringify(input) })
  })

  it('삭제는 DELETE이며 204를 성공으로 본다', async () => {
    const fetcher = empty(204)
    await new HttpEventRepository(fetcher).remove(ID)
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe(`/api/v1/operations/admin/events/${ID}`)
    expect(init.method).toBe('DELETE')
    expect(init.headers?.Authorization).toBe('Bearer e-bearer')
  })

  it('등록·수정 응답이 이벤트 형식이 아니면 저장 성공으로 취급하지 않는다', async () => {
    const input = { title: '가을', body: '본문', startsAt: null, endsAt: null }
    await expect(new HttpEventRepository(ok({ id: ID }, 201)).create(input)).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    await expect(new HttpEventRepository(ok({}, 200)).update(ID, input)).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it.each([
    [400, '입력값을 확인해 주세요.'],
    [403, '이 작업을 할 권한이 없어요.'],
    [404, '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'],
    [500, '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ])('%s 응답은 성공으로 숨기지 않고 안내 오류로 바꾼다', async (status, message) => {
    const input = { title: '가을', body: '본문', startsAt: null, endsAt: null }
    const failing = () => new HttpEventRepository(vi.fn(async () => Response.json({ code: 'X', message: 'internal' }, { status })))
    await expect(failing().create(input)).rejects.toThrow(new OperationsError(message))
    await expect(failing().update(ID, input)).rejects.toThrow(new OperationsError(message))
    await expect(failing().remove(ID)).rejects.toThrow(new OperationsError(message))
    await expect(failing().listAdmin()).rejects.toThrow(new OperationsError(message))
  })
})
