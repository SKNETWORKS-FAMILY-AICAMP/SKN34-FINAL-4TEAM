import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { OperationsError, OperationsForbidden, OperationsRejected } from '../../domain/entities/operations'
import { CREDIT_INSUFFICIENT_MESSAGE } from '../../domain/entities/operationsCredit'
import { login } from './auth'
import { HttpOperationsCreditRepository } from './HttpOperationsCreditRepository'

type Call = [string, { method?: string; body?: string; headers: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const ok = (value: unknown, status = 200) => vi.fn(async () => Response.json(value, { status }))
const fail = (status: number, body: unknown = { code: 'X', message: 'Request failed.' }) => vi.fn(async () => Response.json(body, { status }))
const FORMAT = '서버 응답 형식을 확인할 수 없어요.'

const balance = { total: 40.5, items: [{ kind: 'reward', remaining: 10.5, expiresAt: '2026-12-01T00:00:00Z' }, { kind: 'operator', remaining: 30, expiresAt: '2026-12-10T01:00:00.123456Z' }] }
const history = [
  { type: 'revoke', kind: 'reward', amount: 5, occurredAt: '2026-11-10T02:00:00Z' },
  { type: 'grant', kind: 'operator', amount: 30, occurredAt: '2026-11-10T01:00:00Z' },
]

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c-csrf' }) : Response.json({ accessToken: 'c-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: true } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpOperationsCreditRepository 조회', () => {
  it('회원의 잔액(종류별 포함)과 내역을 Bearer로 읽고 내역은 목록으로 펼친다', async () => {
    const fetcher = ok({ balance, history: { items: history } })
    expect(await new HttpOperationsCreditRepository(fetcher).member('m 1')).toEqual({ balance, history })
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/credits/members/m%201')
    expect(init.headers.Authorization).toBe('Bearer c-bearer')
  })

  it('응답 모양이 다르면 거부한다', async () => {
    for (const bad of [{ balance }, { balance, history }, { balance, history: { items: [{ ...history[0], type: 'refund' }] } }, { balance: { total: 1, items: [{ kind: 'reward', remaining: 1, expiresAt: 'tomorrow' }] }, history: { items: [] } }]) {
      await expect(new HttpOperationsCreditRepository(ok(bad)).member('m1')).rejects.toThrow(FORMAT)
    }
  })

  it('권한이 없으면(403) OperationsForbidden이고 회원이 없으면(404) 한국어 안내 오류다', async () => {
    await expect(new HttpOperationsCreditRepository(fail(403)).member('m1')).rejects.toThrow(OperationsForbidden)
    await expect(new HttpOperationsCreditRepository(fail(404, { code: 'NOT_FOUND', message: 'Resource not found.' })).member('m1')).rejects.toThrow(new OperationsError('회원을 찾을 수 없어요. 회원 검색으로 다시 골라 주세요.'))
  })
})

describe('HttpOperationsCreditRepository 지급·회수', () => {
  it('지급과 회수는 POST로 금액·사유를 보내고 201을 성공으로 본다(응답 본문은 쓰지 않는다)', async () => {
    const fetcher = ok({ total: 50, items: [] }, 201)
    const repo = new HttpOperationsCreditRepository(fetcher)
    await repo.grant('m 1', { amount: 500, reason: '이벤트 보상' })
    await repo.revoke('m1', { amount: 20, reason: '오지급 회수' })
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/api/v1/operations/credits/members/m%201/grants', 'POST', JSON.stringify({ amount: 500, reason: '이벤트 보상' })],
      ['/api/v1/operations/credits/members/m1/revocations', 'POST', JSON.stringify({ amount: 20, reason: '오지급 회수' })],
    ])
    expect(callsOf(fetcher)[0][1].headers.Authorization).toBe('Bearer c-bearer')
    // 본문이 없는 201도 성공이다.
    await new HttpOperationsCreditRepository(vi.fn(async () => new Response(null, { status: 201 }))).grant('m1', { amount: 1, reason: '확인' })
  })

  it('회수가 쓸 수 있는 잔액을 넘으면(409 CREDIT_INSUFFICIENT) 서버의 영문 문구 대신 정해진 한국어 안내를 보인다', async () => {
    const insufficient = fail(409, { code: 'CREDIT_INSUFFICIENT', message: 'Not enough credits.' })
    await expect(new HttpOperationsCreditRepository(insufficient).revoke('m1', { amount: 999, reason: '회수' })).rejects.toThrow(new OperationsRejected(CREDIT_INSUFFICIENT_MESSAGE))
    expect(CREDIT_INSUFFICIENT_MESSAGE).toContain('잔액')
    // 다른 409는 충돌 안내다.
    await expect(new HttpOperationsCreditRepository(fail(409, { code: 'CONFLICT', message: 'Resource conflicts with its current state.' })).grant('m1', { amount: 1, reason: '지급' })).rejects.toThrow(new OperationsError('다른 변경과 충돌했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.'))
  })

  it('422는 한글로 온 서버 안내를 그대로, 영문 고정 문구는 한국어 안내로 바꾼다', async () => {
    await expect(new HttpOperationsCreditRepository(fail(422, { code: 'INVALID_CREDIT_REQUEST', message: '금액은 1~100000이어야 해요.' })).grant('m1', { amount: 1, reason: '지급' })).rejects.toThrow(new OperationsRejected('금액은 1~100000이어야 해요.'))
    await expect(new HttpOperationsCreditRepository(fail(422, { code: 'REQUEST_FAILED', message: 'Request could not be completed.' })).grant('m1', { amount: 1, reason: '지급' })).rejects.toThrow(new OperationsError('금액(1~100,000 정수)과 사유(1~200자)를 확인해 주세요.'))
  })

  it('권한이 없으면(403) OperationsForbidden이고, 연결 실패(502)는 반영 여부를 단정하지 않고 확인 뒤 다시 시도하라고 안내한다', async () => {
    await expect(new HttpOperationsCreditRepository(fail(403)).grant('m1', { amount: 1, reason: '지급' })).rejects.toThrow(OperationsForbidden)
    const message = '연결된 서비스(Core)에서 처리하지 못했어요. 잔액·내역을 새로고침해 반영 여부를 확인한 뒤 다시 시도해 주세요.'
    await expect(new HttpOperationsCreditRepository(fail(502, { code: 'UPSTREAM_FAILED', message: 'Upstream service request failed.' })).revoke('m1', { amount: 1, reason: '회수' })).rejects.toThrow(new OperationsError(message))
  })
})
