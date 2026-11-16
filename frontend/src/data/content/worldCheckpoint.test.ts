import { afterEach, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login } from '../api/auth'
import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'

afterEach(() => vi.unstubAllGlobals())

it('작품 세계관 체크포인트를 생성하고 저장된 스냅샷을 상세 조회한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'content-csrf' })
    : Response.json({ accessToken: 'content-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })))
  await login('writer@example.invalid', 'test-password')
  const summary = { id: 'cp1', createdAt: '2026-11-10T02:00:00Z' }
  const detail = { ...summary, settings: [{
    id: 'r', versionId: 'v1', name: '도시 규칙', content: '저장된 내용', category: '규칙',
    tags: [], visibility: 'private', fromEpisode: 1, toEpisode: null, knownBy: [], evidence: '',
  }] }
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(detail))
    .mockResolvedValueOnce(Response.json([summary])).mockResolvedValueOnce(Response.json(detail))
  const api = new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
  const signal = new AbortController()

  expect(await api.createWorldCheckpoint('work', signal.signal)).toEqual(detail)
  expect(await api.worldCheckpoints('work', signal.signal)).toEqual([summary])
  expect(await api.worldCheckpoint('work', 'cp1', signal.signal)).toEqual(detail)
  expect(fetcher.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
    ['/api/v1/works/work/world/checkpoints', 'POST'],
    ['/api/v1/works/work/world/checkpoints', 'GET'],
    ['/api/v1/works/work/world/checkpoints/cp1', 'GET'],
  ])
  signal.abort()
  expect(fetcher.mock.calls[2][1].signal.aborted).toBe(true)
})
