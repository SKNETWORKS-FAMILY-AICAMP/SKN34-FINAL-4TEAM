import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { login } from './auth'
import { HttpCreditLedgerRepository } from './HttpCreditLedgerRepository'

type Call = [string, { method?: string; headers: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const balanceBody = { total: 40.5, items: [{ kind: 'reward', remaining: 10.5, expiresAt: '2026-12-01T00:00:00Z' }, { kind: 'signup-trial', remaining: 30, expiresAt: '2026-12-10T01:00:00.123456Z' }] }
const historyBody = { items: [{ type: 'spend', kind: 'reward', amount: 5, occurredAt: '2026-11-10T01:00:00Z' }, { type: 'grant', kind: 'signup-trial', amount: 30, occurredAt: '2026-11-10T00:00:00Z' }] }

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'n-csrf' }) : Response.json({ accessToken: 'n-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: false } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpCreditLedgerRepository', () => {
  it('잔액은 Bearer로 조회하고 합계·지급분별 남은 양·소멸 시각을 그대로 돌려준다', async () => {
    const fetcher = vi.fn(async () => Response.json(balanceBody))
    expect(await new HttpCreditLedgerRepository(fetcher).balance()).toEqual(balanceBody)
    const [url, init] = callsOf(fetcher)[0]
    expect(url).toBe('/api/v1/me/credits')
    expect(init.headers.Authorization).toBe('Bearer n-bearer')
  })

  it('내역은 지급·사용·소멸 항목 목록으로 돌려준다', async () => {
    const fetcher = vi.fn(async () => Response.json(historyBody))
    expect(await new HttpCreditLedgerRepository(fetcher).history()).toEqual(historyBody.items)
    expect(callsOf(fetcher)[0][0]).toBe('/api/v1/me/credits/history')
  })

  it('형식이 다른 응답은 거부한다', async () => {
    await expect(new HttpCreditLedgerRepository(vi.fn().mockResolvedValue(Response.json({ items: [] }))).balance()).rejects.toThrow()
    await expect(new HttpCreditLedgerRepository(vi.fn().mockResolvedValue(Response.json({ total: 1, items: [{ kind: 'reward', remaining: 1, expiresAt: 'tomorrow' }] }))).balance()).rejects.toThrow()
    await expect(new HttpCreditLedgerRepository(vi.fn().mockResolvedValue(Response.json({ items: [{ ...historyBody.items[0], type: 'refund' }] }))).history()).rejects.toThrow()
  })

  it('서버 오류(500)는 실패로 알린다', async () => {
    const repo = new HttpCreditLedgerRepository(vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    await expect(repo.balance()).rejects.toThrow()
    await expect(repo.history()).rejects.toThrow()
  })
})
