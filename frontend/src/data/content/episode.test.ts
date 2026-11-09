import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
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

describe('설정 이력 연결', () => {
  const world = { id: 'w', name: '세계관', revision: 3, mode: 'own', basis: null, draft: null, drafts: [], settings: [], history: [], sourceToken: 't', changes: [] }
  it.each(['read', 'restore'])('이력 %s 요청에 호출자의 취소 신호를 전달한다', async action => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(world))
    const api = new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
    const controller = new AbortController()
    if (action === 'read') await api.world('w', controller.signal)
    else await api.revertSetting('w', 's', 3, 'v1', controller.signal)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(action === 'read' ? '/api/v1/works/w/world' : '/api/v1/works/w/settings/s/revert')
    if (action === 'restore') expect(JSON.parse(init.body)).toEqual({ revision: 3, versionId: 'v1' })
    controller.abort()
    expect(init.signal.aborted).toBe(true)
  })
})

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


describe('episode removal contract', () => {
  it('sends the observed revision and handles an empty deletion response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {status:204}))
    await new HttpEpisodeRepository(fetcher).deleteDraft('w',2,7)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w/episodes/2/draft?revision=7', expect.objectContaining({method:'DELETE'}))
  })
  it('validates order scope without mutating the episode', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({number:2,candidateNumbers:[2,3],reasons:[],executable:false}))
    expect((await new HttpEpisodeRepository(fetcher).orderScope('w',2)).candidateNumbers).toEqual([2,3])
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w/episodes/2/order-scope',expect.objectContaining({method:'GET'}))
  })
})


it('does not treat an unexpected successful deletion response as confirmed removal',async()=>{
  const repo=new HttpEpisodeRepository(vi.fn().mockResolvedValue(new Response('not-json',{status:200})))
  await expect(repo.deleteEpisode('w',1,0)).rejects.toThrow()
})


it('preserves the missing writing episode state from Core',async()=>{
 const value={id:'w',title:'작품',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'새 회차',body:'',revision:4},hasWritingEpisode:false}
 const repo=new HttpEpisodeRepository(vi.fn().mockResolvedValue(Response.json([value])))
 expect((await repo.list())[0].hasWritingEpisode).toBe(false)
})

describe('work update and delete', () => {
  const work = { id: 'w', title: '새 제목', summary: '소개', visibility: 'private', allowFork: false, source: null, episodes: [], draft: { title: '', body: '', revision: 0 } }
  it('puts title, summary and revision to the work and parses the response', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(work))
    const saved = await new HttpEpisodeRepository(fetcher).updateWork('w', '새 제목', '소개', 3)
    expect(saved.title).toBe('새 제목')
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ title: '새 제목', summary: '소개', revision: 3 }) }))
  })
  it('deletes a work and accepts only 204', async () => {
    const ok = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await new HttpEpisodeRepository(ok).deleteWork('w')
    expect(ok).toHaveBeenCalledWith('/api/v1/works/w', expect.objectContaining({ method: 'DELETE' }))
    await expect(new HttpEpisodeRepository(vi.fn().mockResolvedValue(Response.json({}))).deleteWork('w')).rejects.toThrow()
  })
  it('sends registration metadata only when supplied and reads it back', async () => {
    const meta = { creationType: 'ORIGINAL' as const, genres: ['판타지'], hashtags: ['회귀'], rightsConfirmed: true }
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...work, creationType: 'ORIGINAL', genres: ['판타지'], hashtags: ['회귀'] }))
    const created = await new HttpEpisodeRepository(fetcher).create('제목', '', undefined, meta)
    expect(created.genres).toEqual(['판타지'])
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works', expect.objectContaining({ body: JSON.stringify({ title: '제목', summary: '', ...meta }) }))
    const plain = vi.fn().mockResolvedValue(Response.json(work))
    await new HttpEpisodeRepository(plain).create('제목', '')
    expect(plain).toHaveBeenCalledWith('/api/v1/works', expect.objectContaining({ body: JSON.stringify({ title: '제목', summary: '' }) }))
  })
  it('validates registration and update input before calling the repository', async () => {
    const repo = { create: vi.fn(), updateWork: vi.fn() }
    const useCase = new EpisodeUseCase(repo as never)
    const ok = { creationType: 'ORIGINAL' as const, genres: ['판타지'], hashtags: [], rightsConfirmed: true }
    await expect(useCase.create('제목', '', undefined, { ...ok, genres: [] })).rejects.toThrow('장르')
    await expect(useCase.create('제목', '', undefined, { ...ok, genres: ['a', 'b', 'c'] })).rejects.toThrow('장르')
    await expect(useCase.create('제목', '', undefined, { ...ok, hashtags: Array(11).fill('x') })).rejects.toThrow('해시태그')
    await expect(useCase.create('제목', '', undefined, { ...ok, rightsConfirmed: false })).rejects.toThrow('권리')
    await expect(useCase.updateWork('w', ' ', '', 0)).rejects.toThrow('제목')
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.updateWork).not.toHaveBeenCalled()
  })
})
