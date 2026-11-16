import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { login } from '../api/auth'
import { HttpWorkInterestRepository } from './HttpWorkInterestRepository'

type Call = [string, { method?: string; headers: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'i-csrf' }) : Response.json({ accessToken: 'i-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: false } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpWorkInterestRepository', () => {
  it('목록은 Bearer로 조회하고 서버가 준 최근 등록순 id를 그대로 돌려준다', async () => {
    const fetcher = vi.fn(async () => Response.json({ workIds: ['w2', 'w1'] }))
    expect(await new HttpWorkInterestRepository(fetcher).list()).toEqual(['w2', 'w1'])
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/works/interests')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer i-bearer')
    expect(init.headers['X-CSRF-TOKEN']).toBeUndefined()
  })

  it('형식이 다른 목록 응답은 거부한다', async () => {
    for (const body of [{ workIds: [1] }, { ids: ['w1'] }, ['w1']]) {
      await expect(new HttpWorkInterestRepository(vi.fn(async () => Response.json(body))).list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    }
  })

  it('등록은 CSRF를 보내고 작품 id를 인코딩해 PUT 한다', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    await new HttpWorkInterestRepository(fetcher).add('a/b')
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/works/a%2Fb/interest')
    expect(init.method).toBe('PUT')
    expect(init.headers['X-CSRF-TOKEN']).toBe('i-csrf')
    expect(init.headers.Authorization).toBe('Bearer i-bearer')
  })

  it('해제는 CSRF를 보내고 DELETE 한다', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    await new HttpWorkInterestRepository(fetcher).remove('w1')
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/works/w1/interest')
    expect(init.method).toBe('DELETE')
    expect(init.headers['X-CSRF-TOKEN']).toBe('i-csrf')
  })

  it('서버가 거절하면 서버 안내 문구로, 문구가 없으면 일반 안내로 실패를 알린다', async () => {
    const rejected = new HttpWorkInterestRepository(vi.fn(async () => Response.json({ detail: '공개 작품을 찾을 수 없어요.' }, { status: 404 })))
    await expect(rejected.add('w1')).rejects.toThrow('공개 작품을 찾을 수 없어요.')
    await expect(rejected.remove('w1')).rejects.toThrow('공개 작품을 찾을 수 없어요.')
    await expect(rejected.list()).rejects.toThrow('공개 작품을 찾을 수 없어요.')
    const broken = new HttpWorkInterestRepository(vi.fn(async () => new Response(null, { status: 500 })))
    await expect(broken.add('w1')).rejects.toThrow('관심 작품 요청을 처리하지 못했어요.')
  })
})
