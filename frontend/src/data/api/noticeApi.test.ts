import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { OperationsError } from '../../domain/entities/operations'
import { login } from './auth'
import { HttpNoticeRepository } from './noticeApi'

const id = '3f2b8c1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
const notice = { id, title: '점검 안내', body: '첫 줄\n둘째 줄', createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T01:00:00.123456Z' }
const page = { items: [notice], page: 0, size: 100, totalElements: 1, totalPages: 1 }
type Call = [string, { method?: string; body?: string; headers?: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const ok = (value: unknown, status = 200) => vi.fn(async () => Response.json(value, { status }))
const empty = (status: number) => vi.fn(async () => new Response(null, { status }))

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'o-csrf' }) : Response.json({ accessToken: 'o-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: true } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpNoticeRepository 관리자 요청', () => {
  it('목록은 Bearer로 조회하고 items만 돌려준다', async () => {
    const fetcher = ok(page)
    expect(await new HttpNoticeRepository(fetcher).list()).toEqual([notice])
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/admin/notices')
    expect(init.method).toBe('GET')
    expect(init.headers?.Authorization).toBe('Bearer o-bearer')
  })

  it('등록은 POST, 수정은 PUT으로 제목·본문만 JSON으로 보내고 응답 공지를 돌려준다', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => Response.json(notice, { status: init?.method === 'POST' ? 201 : 200 }))
    const repo = new HttpNoticeRepository(fetcher)
    const input = { title: '점검 안내', body: '첫 줄\n둘째 줄' }
    expect(await repo.create(input)).toEqual(notice)
    expect(await repo.update('a b', input)).toEqual(notice)
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body, init.headers?.['Content-Type'], init.headers?.Authorization])).toEqual([
      ['/api/v1/operations/admin/notices', 'POST', JSON.stringify(input), 'application/json', 'Bearer o-bearer'],
      ['/api/v1/operations/admin/notices/a%20b', 'PUT', JSON.stringify(input), 'application/json', 'Bearer o-bearer'],
    ])
  })

  it('삭제는 DELETE이고 204를 성공으로 본다', async () => {
    const fetcher = empty(204)
    await new HttpNoticeRepository(fetcher).delete('a b')
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method])).toEqual([['/api/v1/operations/admin/notices/a%20b', 'DELETE']])
  })

  it('응답 형식이 계약과 다르면 성공으로 숨기지 않고 거부한다', async () => {
    const malformed = '서버 응답 형식을 확인할 수 없어요.'
    await expect(new HttpNoticeRepository(ok({ items: [{ ...notice, createdAt: '어제' }] })).list()).rejects.toThrow(new OperationsError(malformed))
    await expect(new HttpNoticeRepository(ok({ items: 'x' })).list()).rejects.toThrow(malformed)
    await expect(new HttpNoticeRepository(ok({}, 201)).create({ title: '제목', body: '본문' })).rejects.toThrow(malformed)
    await expect(new HttpNoticeRepository(vi.fn(async () => new Response('not json', { status: 200 }))).update(id, { title: '제목', body: '본문' })).rejects.toThrow(malformed)
  })

  it.each([
    [400, '입력값을 확인해 주세요.'],
    [403, '이 작업을 할 권한이 없어요.'],
    [404, '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'],
    [500, '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ])('%s 응답은 빈 목록·성공으로 숨기지 않고 안내 오류로 바꾼다', async (status, message) => {
    const repo = new HttpNoticeRepository(vi.fn(async () => Response.json({ code: 'X', message: 'internal' }, { status })))
    await expect(repo.list()).rejects.toThrow(new OperationsError(message))
    await expect(repo.create({ title: '제목', body: '본문' })).rejects.toThrow(new OperationsError(message))
    await expect(repo.update(id, { title: '제목', body: '본문' })).rejects.toThrow(new OperationsError(message))
    await expect(repo.delete(id)).rejects.toThrow(new OperationsError(message))
  })
})

describe('HttpNoticeRepository 독자 요청(인증 없음)', () => {
  it('목록·상세는 로그인한 상태에서도 Authorization 없이 상대 경로 GET으로 조회한다', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).endsWith('/public/notices') ? page : notice))
    const repo = new HttpNoticeRepository(fetcher)
    expect(await repo.listPublic()).toEqual([notice])
    expect(await repo.getPublic('a b')).toEqual(notice)
    const calls = callsOf(fetcher)
    expect(calls.map(([url]) => url)).toEqual(['/api/v1/operations/public/notices', '/api/v1/operations/public/notices/a%20b'])
    for (const [, init] of calls) {
      expect(init.method ?? 'GET').toBe('GET')
      expect(init.body).toBeUndefined()
      expect(Object.keys(init.headers ?? {}).map((name) => name.toLowerCase())).not.toContain('authorization')
    }
  })

  it('전역 fetch도 같은 방식으로 쓴다', async () => {
    const fetcher = ok(page)
    vi.stubGlobal('fetch', fetcher)
    expect(await new HttpNoticeRepository().listPublic()).toEqual([notice])
    expect(callsOf(fetcher)[0][0]).toBe('/api/v1/operations/public/notices')
  })

  it('없는 공지(404)와 형식이 틀린 id(400)는 null, 그 밖의 실패는 오류로 알린다', async () => {
    expect(await new HttpNoticeRepository(empty(404)).getPublic(id)).toBeNull()
    expect(await new HttpNoticeRepository(empty(400)).getPublic('1')).toBeNull()
    for (const status of [403, 500, 502]) {
      await expect(new HttpNoticeRepository(empty(status)).getPublic(id)).rejects.toThrow(new OperationsError('공지를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'))
    }
  })

  it('목록 실패와 형식 오류는 빈 목록으로 숨기지 않고 거부한다', async () => {
    await expect(new HttpNoticeRepository(empty(500)).listPublic()).rejects.toThrow(new OperationsError('공지를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'))
    await expect(new HttpNoticeRepository(empty(404)).listPublic()).rejects.toThrow(OperationsError)
    await expect(new HttpNoticeRepository(ok({ items: [{ id }] })).listPublic()).rejects.toThrow(new OperationsError('서버 응답 형식을 확인할 수 없어요.'))
    await expect(new HttpNoticeRepository(ok(notice)).getPublic(id)).resolves.toEqual(notice)
    await expect(new HttpNoticeRepository(ok({ ...notice, body: 1 })).getPublic(id)).rejects.toThrow(new OperationsError('서버 응답 형식을 확인할 수 없어요.'))
  })
})
