import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../testLocks'
import { login } from '../api/auth'
import { HttpEpisodeRepository } from '../content/HttpEpisodeRepository'
import { HttpStoryPlanRepository } from './HttpStoryPlanRepository'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'csrf' })
    : Response.json({ accessToken: 'bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: '작가', operator: false } })))
  await login('writer@example.invalid', 'password')
})
afterEach(() => vi.unstubAllGlobals())
const input = { kind: 'plot' as const, parentId: null, title: '플롯', content: '', episodeNumber: null, characterIds: [], placeIds: [] }
const plan = { ...input, id: 'p', workId: 'w', revision: 1, episodeMissing: false }

describe('계획 HTTP 계약', () => {
  it('인증·CSRF·revision을 유지해 생성·조회·수정·삭제한다', async () => {
    const fetcher = vi.fn().mockImplementation(async (_url, init) => init.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(plan))
    const repo = new HttpStoryPlanRepository(new HttpEpisodeRepository(fetcher), fetcher)
    await repo.save('w', input)
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/works/w/story-plans', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer bearer', 'X-CSRF-TOKEN': 'csrf' }) }))
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ ...input, revision: 0 })
    await repo.read('w', 'p')
    await repo.save('w', input, plan)
    expect(JSON.parse(fetcher.mock.calls[2][1].body).revision).toBe(1)
    await repo.remove('w', plan)
    expect(fetcher.mock.lastCall?.[0]).toBe('/api/v1/works/w/story-plans/p?revision=1')
  })
  it('기존 설정집·회차 조회를 재사용하고 초안은 선택지에서 제외한다', async () => {
    const setting = { id: 'c', versionId: 'v', name: '리안', content: '인물', category: '인물', tags: [], visibility: 'private', fromEpisode: 1, toEpisode: null, knownBy: [], evidence: '' }
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/world') ? Response.json({ id: 'w', name: '설정집', revision: 0, mode: 'own', basis: null, draft: null, drafts: [{ ...setting, id: 'draft' }], settings: [setting], history: [setting], sourceToken: 't', changes: [] }) : Response.json([]))
    const repo = new HttpStoryPlanRepository(new HttpEpisodeRepository(fetcher), fetcher)
    expect(await repo.references('w')).toEqual({ characters: [{ id: 'c', name: '리안' }], places: [], episodes: [] })
    expect(fetcher.mock.calls.map(c => c[0]).sort()).toEqual(['/api/v1/works/w/episodes', '/api/v1/works/w/world'])
  })
  it('실패·잘못된 응답·취소를 성공이나 메모리 데이터로 바꾸지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: '편집 충돌' }, { status: 409 }))
    const repo = new HttpStoryPlanRepository(new HttpEpisodeRepository(fetcher), fetcher)
    await expect(repo.save('w', input, plan)).rejects.toThrow('편집 충돌')
    fetcher.mockResolvedValue(Response.json({ wrong: true }))
    await expect(repo.list('w')).rejects.toThrow(/응답/)
    const abort = new AbortController()
    fetcher.mockImplementation(async (_url, init) => { abort.abort(); if (init.signal.aborted) throw new DOMException('Aborted', 'AbortError'); return Response.json([]) })
    await expect(repo.list('w', abort.signal)).rejects.toThrow()
  })
})
