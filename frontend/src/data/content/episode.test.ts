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

it('원고 Q&A에 기준 판본, 동의와 회원 인증을 보내고 근거 부족을 반환한다', async () => {
  const response = {
    status: 'insufficient', claims: [], sources: [],
    gaps: [{ code: 'NO_EVIDENCE', detail: '근거를 찾지 못했어요.' }],
    coverage: { expected: [{ number: 2, versionId: 'v2' }], withVerifiedExcerpt: [], withoutVerifiedExcerpt: [{ number: 2, versionId: 'v2' }] },
  }
  const fetcher = vi.fn().mockResolvedValue(Response.json(response))
  const api = new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
  const controller = new AbortController()
  const input = { episode: 2, episodeVersionId: 'v2', question: '누가 왔나요?', consent: true, target: 'manuscript' } as const
  expect(await api.askStoryContext('fork/id', input, false, controller.signal)).toEqual(response)
  const [url, request] = fetcher.mock.calls[0]
  expect(url).toBe('/api/v1/public/works/fork%2Fid/context/qa')
  expect(request.method).toBe('POST')
  expect(request.headers).toMatchObject({ Authorization: 'Bearer content-bearer', 'X-CSRF-TOKEN': 'content-csrf' })
  expect(JSON.parse(request.body)).toEqual(input)
  controller.abort()
  expect(request.signal.aborted).toBe(true)
})

it('작가 Q&A는 소유자 API를 호출하고 현재 관계 출처를 보존한다', async () => {
  const graphSource = { id: 'edge', kind: 'relationship', workId: 'w', sourceWorkId: null, episode: 2,
    worldId: 'db2f4ac5-f2b8-4ed2-9812-d5a03596558b', relationshipId: 'f73810ec-561c-49b3-8e29-9f9adca5a98a',
    graphVersion: 7, title: '리안 → 카엘', quote: '동맹' }
  const fetcher = vi.fn().mockResolvedValue(Response.json({
    status: 'answered', claims: [], sources: [graphSource], gaps: [],
    coverage: { expected: [], withVerifiedExcerpt: [], withoutVerifiedExcerpt: [] },
  }))
  const api = new HttpEpisodeRepository(fetcher)
  const answer = await api.askStoryContext('w', { episode: 2, episodeVersionId: 'v2', question: '둘은 무슨 관계인가요?', consent: true, target: 'relationship' }, true)
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/works/w/context/qa')
  expect(answer.sources).toEqual([graphSource])
})

describe('회차 예약 발행', () => {
  const path = '/api/v1/works/w/episodes/2/publication-schedules'
  const scheduledAt = '2099-11-10T01:30:00.000Z'
  const schedule = { id: 's1', versionId: 'v1', scheduledAt, status: 'pending', revision: 0, completedAt: null, failureReason: null }

  it('예약과 실행 결과를 조회하고 취소 신호를 전달한다', async () => {
    const failed = { ...schedule, id: 'old', status: 'failed', completedAt: scheduledAt, failureReason: '공개 제한 중이에요.' }
    const fetcher = vi.fn().mockResolvedValue(Response.json([schedule, failed]))
    const api = new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
    const controller = new AbortController()
    expect(await api.publicationSchedules('w', 2, controller.signal)).toEqual([schedule, failed])
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe(path)
    controller.abort()
    expect(request.signal.aborted).toBe(true)
  })

  it.each(['POST', 'PUT'])('%s로 한국 시각과 고정 저장 버전을 전송한다', async method => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(schedule))
    const api = new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
    await api.savePublicationSchedule('w', 2, 'v1', '2099-11-10T10:30', true, method === 'PUT' ? schedule : undefined)
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe(method === 'PUT' ? path + '/s1' : path)
    expect(request.method).toBe(method)
    expect(JSON.parse(request.body)).toEqual({ versionId: 'v1', scheduledAt, rightsConfirmed: true, ...(method === 'PUT' ? { revision: 0 } : {}) })
  })

  it('권리 확인과 유효한 미래 시각이 필요하다', async () => {
    const fetcher = vi.fn()
    const api = new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
    await expect(api.savePublicationSchedule('w', 2, 'v1', '2099-11-10T10:30', false)).rejects.toThrow('공개 권리')
    await expect(api.savePublicationSchedule('w', 2, 'v1', '2000-11-10T10:30', true)).rejects.toThrow('미래')
    await expect(api.savePublicationSchedule('w', 2, 'v1', '2099-02-30T10:30', true)).rejects.toThrow('시각')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('예약 수정 번호로 취소하고 서버가 거절하면 오류를 반환한다', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ detail: '이미 실행한 예약이에요.' }, { status: 409 }))
    const api = new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
    await expect(api.cancelPublicationSchedule('w', 2, schedule)).resolves.toBeUndefined()
    expect(fetcher.mock.calls[0]).toEqual([path + '/s1?revision=0', expect.objectContaining({ method: 'DELETE' })])
    await expect(api.cancelPublicationSchedule('w', 2, schedule)).rejects.toThrow('이미 실행한 예약이에요.')
  })
})

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
      id: 'w', title: '제목', summary: '', visibility: 'private', allowFork: false, source: null, episodes: [], draft: value, revision: 0,
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
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify([{id:'p',title:'공개',summary:'',visibility:'public',allowFork:true,allowForkPublication:true,source:null,episodes:[],draft:null,revision:0}])))
 const rows=await new HttpEpisodeRepository(fetcher).publicList()
 expect(rows[0].readOnly).toBe(true)
 expect(rows[0].draft.body).toBe('')
 expect(fetcher.mock.calls[0][0]).toBe('/api/v1/public/works')
})


describe('episode removal contract', () => {
  it('sends a whole episode deletion with bearer, CSRF and the observed revision', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {status:204}))
    await expect(new HttpEpisodeRepository(fetcher).deleteEpisode('w',2,7)).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w/episodes/2?revision=7', expect.objectContaining({
      method:'DELETE',
      headers:expect.objectContaining({Authorization:'Bearer content-bearer','X-CSRF-TOKEN':'content-csrf'}),
    }))
  })
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
 const value={id:'w',title:'작품',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'새 회차',body:'',revision:4},hasWritingEpisode:false,revision:0}
 const repo=new HttpEpisodeRepository(vi.fn().mockResolvedValue(Response.json([value])))
 expect((await repo.list())[0].hasWritingEpisode).toBe(false)
})

describe('work update and delete', () => {
  const work = { id: 'w', title: '새 제목', summary: '소개', visibility: 'private', allowFork: false, source: null, episodes: [], draft: { title: '', body: '', revision: 0 }, revision: 0 }
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

describe('episode checkpoints (DEC-43)', () => {
  const version = { id: 'v1', title: '1화', body: '원고', revision: 1, episode: 1, savedAt: '2026-11-01T00:00:00Z' }
  const episode = { number: 1, draft: { title: '1화', body: '원고', revision: 4 }, versions: [version], publishedVersionId: 'v2', inherited: false, updatedAt: null, checkpointStatus: 'content_only' }
  const checkpoints = [{ versionId: 'v1', publishedAt: '2026-11-01T00:01:00Z', active: false }, { versionId: 'v2', publishedAt: '2026-11-02T00:00:00Z', active: true }]
  it('reads each writing episode with its published checkpoints', async () => {
    const rows = await new HttpEpisodeRepository(vi.fn().mockResolvedValue(Response.json([{ ...episode, checkpoints }]))).writingList('w')
    expect(rows[0].checkpoints).toEqual(checkpoints)
  })
  it('rejects a response that omits checkpoints instead of assuming there are none', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([episode]))
    await expect(new HttpEpisodeRepository(fetcher).writingList('w')).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })
  it('rejects a malformed checkpoint instead of showing it', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ ...episode, checkpoints: [{ versionId: 'v1', active: true }] }]))
    await expect(new HttpEpisodeRepository(fetcher).writingList('w')).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })
  it('reverts by publishing the earlier checkpoint through the existing publish endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...episode, publishedVersionId: 'v1', checkpoints: checkpoints.map(c => ({ ...c, active: c.versionId === 'v1' })) }))
    const reverted = await new EpisodeUseCase(new HttpEpisodeRepository(fetcher)).publishEpisode('w', 1, 4, 'v1', true)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/v1/works/w/episodes/1/publish')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ revision: 4, versionId: 'v1', rightsConfirmed: true })
    expect(reverted.checkpoints.map(c => [c.versionId, c.active])).toEqual([['v1', true], ['v2', false]])
  })
})

describe('회차 공개 상태와 발행 이력', () => {
  const episode = {number:2,draft:{title:'2화',body:'초안',revision:5},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[],publicationStatus:'suspended'}
  it.each([false,true])('공개 상태 %s 변경에 revision과 권리 확인을 보내고 상태를 반환한다', async visible => {
    const fetcher=vi.fn().mockResolvedValue(Response.json(episode))
    const api=new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
    const controller=new AbortController()
    const result=await api.setPublicationVisibility('w',2,4,visible,visible,controller.signal)
    expect(result.publicationStatus).toBe('suspended')
    const [url,init]=fetcher.mock.calls[0]
    expect(url).toBe('/api/v1/works/w/episodes/2/visibility')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({revision:4,visible,rightsConfirmed:visible})
    controller.abort();expect(init.signal.aborted).toBe(true)
  })
  it('권리 확인 없는 재공개는 전송하지 않는다', async () => {
    const fetcher=vi.fn()
    const api=new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
    await expect(api.setPublicationVisibility('w',2,4,true,false)).rejects.toThrow('권리')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('발행 사건 목록을 보존하고 조회 취소 신호를 연결한다', async () => {
    const publicationHistory=['publish','replace','unpublish','republish'].map(action=>({episode:2,versionId:'v',publishedAt:'2026-11-09T00:00:00Z',action}))
    const fetcher=vi.fn().mockResolvedValue(Response.json({versions:[],proposals:[],publicationHistory}))
    const controller=new AbortController()
    const result=await new EpisodeUseCase(new HttpEpisodeRepository(fetcher)).history('w',controller.signal)
    expect(result.publicationHistory).toEqual(publicationHistory)
    controller.abort();expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })
})


it('공개 중단 후 서버가 지정한 다음 작성 회차 번호를 유지한다',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json([{id:'w',title:'작품',summary:'',visibility:'public',allowFork:false,source:null,episodes:[],draft:{title:'3화',body:'',revision:3},writingEpisodeNumber:3,revision:0}]))
  expect((await new HttpEpisodeRepository(fetcher).list())[0].writingEpisodeNumber).toBe(3)
})

it('stops Fork publication through its dedicated authenticated command', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  await new HttpEpisodeRepository(fetcher).stopForkPublication('fork-id')
  expect(fetcher).toHaveBeenCalledWith('/api/v1/works/fork-id/fork-publication', expect.objectContaining({ method: 'DELETE' }))
})

it('서버가 항상 보내는 작품 revision이 없는 응답은 거절한다', async () => {
  const value = { id: 'w', title: '작품', summary: '', visibility: 'private', allowFork: false, source: null, episodes: [], draft: { title: '새 회차', body: '', revision: 4 } }
  await expect(new HttpEpisodeRepository(vi.fn().mockResolvedValue(Response.json([value]))).list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
})
