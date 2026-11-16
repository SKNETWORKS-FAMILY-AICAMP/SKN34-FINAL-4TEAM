import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { WithdrawalConflict, WithdrawalWrongPassword } from '../../domain/repositories/WithdrawalRepository'
import { getAccessToken, login } from './auth'
import { HttpWithdrawalRepository } from './HttpWithdrawalRepository'

type Call = [string, { method?: string; headers: Record<string, string>; body?: string }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const pending = { status: 'PENDING', requestedAt: '2026-11-12T01:00:00Z', dueAt: '2026-12-12T01:00:00.123456Z' }

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'n-csrf' }) : Response.json({ accessToken: 'n-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: false } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpWithdrawalRepository', () => {
  it('상태는 Bearer로 조회하고 요청 없음·유예 중 형식만 받는다', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ status: 'NONE' })).mockResolvedValueOnce(Response.json(pending))
    const repo = new HttpWithdrawalRepository(fetcher)
    expect(await repo.status()).toEqual({ status: 'NONE' })
    expect(await repo.status()).toEqual(pending)
    const [url, init] = callsOf(fetcher)[0]
    expect(url).toBe('/api/v1/me/withdrawal')
    expect(init.headers.Authorization).toBe('Bearer n-bearer')
    await expect(new HttpWithdrawalRepository(vi.fn().mockResolvedValue(Response.json({ status: 'PENDING' }))).status()).rejects.toThrow()
  })

  it('요청은 CSRF와 함께 보내고, 받아지면(202) 이 브라우저의 접근 토큰을 지운다', async () => {
    const fetcher = vi.fn(async () => Response.json(pending, { status: 202 }))
    expect(await new HttpWithdrawalRepository(fetcher).request('pw', null)).toEqual(pending)
    const [, init] = callsOf(fetcher)[0]
    expect(init.method).toBe('POST')
    expect(init.headers['X-CSRF-TOKEN']).toBe('n-csrf')
    expect(JSON.parse(init.body!)).toEqual({ password: 'pw' })
    expect(getAccessToken()).toBeNull()
  })

  it('받아진 뒤 본문 형식이 달라도 이미 끊긴 세션의 토큰은 지운다', async () => {
    await expect(new HttpWithdrawalRepository(vi.fn(async () => Response.json({}, { status: 202 }))).request('pw', '사유')).rejects.toThrow()
    expect(getAccessToken()).toBeNull()
  })

  it('비밀번호 불일치(403)·진행 중(409)·그 밖의 실패를 구분하고 토큰은 그대로 둔다', async () => {
    await expect(new HttpWithdrawalRepository(vi.fn(async () => new Response(null, { status: 403 }))).request('x', null)).rejects.toBeInstanceOf(WithdrawalWrongPassword)
    await expect(new HttpWithdrawalRepository(vi.fn(async () => new Response(null, { status: 409 }))).request('x', null)).rejects.toBeInstanceOf(WithdrawalConflict)
    await expect(new HttpWithdrawalRepository(vi.fn(async () => new Response(null, { status: 400 }))).request('x', null)).rejects.toThrow('탈퇴를 요청하지 못했어요.')
    expect(getAccessToken()).toBe('n-bearer')
  })

  it('화면을 떠나 취소된 요청·복구는 서버에 보내지 않는다', async () => {
    const fetcher = vi.fn(async () => Response.json(pending, { status: 202 }))
    const repo = new HttpWithdrawalRepository(fetcher)
    await expect(repo.request('pw', null, AbortSignal.abort())).rejects.toThrow()
    await expect(repo.restore(AbortSignal.abort())).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe('n-bearer')
  })

  it('복구는 DELETE이고 이미 요청이 없으면(404) 성공으로, 기한이 지났으면(409) 충돌로 본다', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    await new HttpWithdrawalRepository(fetcher).restore()
    expect(callsOf(fetcher)[0][1].method).toBe('DELETE')
    await new HttpWithdrawalRepository(vi.fn(async () => new Response(null, { status: 404 }))).restore()
    await expect(new HttpWithdrawalRepository(vi.fn(async () => new Response(null, { status: 409 }))).restore()).rejects.toBeInstanceOf(WithdrawalConflict)
    await expect(new HttpWithdrawalRepository(vi.fn(async () => new Response(null, { status: 500 }))).restore()).rejects.toThrow('탈퇴 요청을 취소하지 못했어요.')
  })
})
