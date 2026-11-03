import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../testLocks'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'
import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import { login, refresh } from '../api/auth'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'content-csrf' })
    : Response.json({ accessToken: 'content-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })))
  await login('writer@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('content authentication bridge', () => {
  it('sends the memory bearer and same-origin credentials on private GET without a csrf request', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([]))
    await new HttpEpisodeRepository(fetcher).list()
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works', expect.objectContaining({
      credentials: 'same-origin', headers: expect.objectContaining({ Authorization: 'Bearer content-bearer' }),
    }))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['POST', 'PUT'])('adds csrf and bearer to %s without losing the injected fetcher', async method => {
    const value = { title: '제목', body: '본문', revision: 1 }
    const fetcher = vi.fn().mockResolvedValue(method === 'PUT' ? Response.json(value) : Response.json({
      id: 'w', title: '제목', summary: '', visibility: 'private', allowFork: false, source: null, episodes: [], draft: value,
    }))
    const repo = new HttpEpisodeRepository(fetcher)
    if (method === 'PUT') await repo.save('w', value)
    else await repo.create('제목', '')
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      method, credentials: 'same-origin', signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: 'Bearer content-bearer', 'X-CSRF-TOKEN': 'content-csrf' }),
    }))
  })
  it('preserves caller cancellation and refreshes a private 401 through the existing auth flow', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json([]))
    await new HttpEpisodeRepository(fetcher).list(controller.signal)
    expect(fetcher).toHaveBeenCalledTimes(2)
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal
    controller.abort()
    expect(signal.aborted).toBe(true)
  })
  it('keeps public GET anonymous even without a memory token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
    await refresh().catch(() => {})
    const fetcher = vi.fn().mockResolvedValue(Response.json([]))
    await new HttpEpisodeRepository(fetcher).publicList()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].credentials).toBe('same-origin')
    expect(new Headers(fetcher.mock.calls[0][1].headers).has('Authorization')).toBe(false)
    expect(new Headers(fetcher.mock.calls[0][1].headers).has('X-CSRF-TOKEN')).toBe(false)
  })
})

describe('episode API boundary', () => {
  it.each([404,502,504])('handles non-JSON gateway errors (%s)', async status => {
    const repo = new HttpEpisodeRepository(vi.fn().mockResolvedValue(new Response('<html>error</html>', {status})))
    await expect(repo.list()).rejects.toThrow('요청을 처리하지 못했어요.')
  })
  it('rejects an empty successful response with a readable error', async () => {
    const repo = new HttpEpisodeRepository(vi.fn().mockResolvedValue(new Response('')))
    await expect(repo.list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })
  it('does not bind the native fetch function to the repository instance', async () => {
    const fetcher = vi.fn(function(this: unknown) {
      if (this !== undefined) throw new Error('Illegal invocation')
      return Promise.resolve(new Response('[]'))
    })
    await expect(new HttpEpisodeRepository(fetcher).list()).resolves.toEqual([])
  })
  it('rejects malformed server data instead of showing success', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'bad' }])))
    await expect(new HttpEpisodeRepository(fetcher).list()).rejects.toThrow('응답')
  })
  it('preserves actionable 409 errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({detail: '최신 원고를 불러와 주세요'}), {status:409}))
    await expect(new HttpEpisodeRepository(fetcher).save('w', {title:'제목',body:'원고',revision:1})).rejects.toThrow('최신 원고')
  })
  it('cannot publish blank text or without rights confirmation', async () => {
    const repo = new HttpEpisodeRepository(vi.fn())
    const send = vi.spyOn(repo, 'publish')
    const useCase = new EpisodeUseCase(repo)
    await expect(useCase.publish('w', {title:'제목',body:' ',revision:1}, true, false)).rejects.toThrow('원고')
    await expect(useCase.publish('w', {title:'제목',body:'본문',revision:1}, false, false)).rejects.toThrow('권리')
    expect(send).not.toHaveBeenCalled()
  })
})

it('public browsing never exposes an editable owner draft', async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify([{id:'p',title:'공개',summary:'',visibility:'public',allowFork:true,allowForkPublication:true,source:null,episodes:[],draft:null}])))
 const rows=await new HttpEpisodeRepository(fetcher).publicList()
 expect(rows[0].readOnly).toBe(true)
 expect(rows[0].draft.body).toBe('')
 expect(fetcher.mock.calls[0][0]).toBe('/api/v1/public/works')
})
