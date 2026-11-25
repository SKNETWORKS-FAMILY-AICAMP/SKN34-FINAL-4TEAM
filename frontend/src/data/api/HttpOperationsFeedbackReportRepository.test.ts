import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { OperationsError, OperationsForbidden } from '../../domain/entities/operations'
import { login } from './auth'
import { HttpOperationsFeedbackReportRepository } from './HttpOperationsFeedbackReportRepository'

type Call = [string, { method?: string; body?: string; headers: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const ok = (value: unknown, status = 200) => vi.fn(async () => Response.json(value, { status }))
const fail = (status: number, body: unknown = { code: 'X', message: 'Request failed.' }) => vi.fn(async () => Response.json(body, { status }))
const FORMAT = '서버 응답 형식을 확인할 수 없어요.'

const item = {
  id: 'r1', workId: 'w1', workTitle: '별빛 서약의 탑', episodeNumber: 3, kind: 'typo', body: '3화 둘째 줄에 오탈자가 있어요', quote: '별빛이 쏟아지는 밤',
  visibility: 'private', status: 'unchecked', reporterName: '연화', withdrawn: false, createdAt: '2026-11-20T01:02:03Z',
}
const wire = { items: [item, { ...item, id: 'r2', kind: 'story', quote: null, visibility: 'public', status: 'resolved', withdrawn: true }], page: 0, size: 20, totalElements: 41, totalPages: 3 }

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'f-csrf' }) : Response.json({ accessToken: 'f-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: true } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpOperationsFeedbackReportRepository (#750 운영자의 독자 제보 열람)', () => {
  it('운영 API를 Bearer로 읽고 제보 한 쪽을 검증해 전체 건수를 total로 돌려준다', async () => {
    const fetcher = ok(wire)
    expect(await new HttpOperationsFeedbackReportRepository(fetcher).list({ page: 0, status: null })).toEqual({
      items: wire.items, page: 0, size: 20, total: 41,
    })
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/feedback-reports?page=0&size=20')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer f-bearer')
  })

  it('상태 조건은 고른 때만 query로 보내고 쪽은 0부터다', async () => {
    const fetcher = ok({ ...wire, items: [], page: 2, totalElements: 41 })
    await new HttpOperationsFeedbackReportRepository(fetcher).list({ page: 2, status: 'checked' })
    expect(callsOf(fetcher)[0][0]).toBe('/api/v1/operations/feedback-reports?page=2&size=20&status=checked')
  })

  it('응답 모양이 다르면 빈 목록으로 숨기지 않고 거부한다', async () => {
    const bad = [
      { ...wire, items: [{ ...item, status: 'held' }] },
      { ...wire, items: [{ ...item, kind: 'rant' }] },
      { ...wire, items: [{ ...item, createdAt: '어제' }] },
      { ...wire, items: [{ ...item, episodeNumber: 0 }] },
      { ...wire, items: [{ ...item, reporterName: undefined }] },
      { ...wire, items: 'none' },
      { items: wire.items, page: 0, size: 20 },
    ]
    for (const body of bad) await expect(new HttpOperationsFeedbackReportRepository(ok(body)).list({ page: 0, status: null })).rejects.toThrow(FORMAT)
  })

  it('권한이 없으면(403) OperationsForbidden이고 연결 실패(502)는 반영되지 않았다는 안내 오류다', async () => {
    await expect(new HttpOperationsFeedbackReportRepository(fail(403)).list({ page: 0, status: null })).rejects.toThrow(OperationsForbidden)
    await expect(new HttpOperationsFeedbackReportRepository(fail(502, { code: 'UPSTREAM_FAILED', message: 'Upstream request failed.' })).list({ page: 0, status: null }))
      .rejects.toThrow(OperationsError)
  })
})
