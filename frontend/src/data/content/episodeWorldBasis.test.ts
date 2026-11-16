import { afterEach, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login } from '../api/auth'
import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'

afterEach(() => vi.unstubAllGlobals())

it('reads, lists, confirms and selects the exact sealed world revision', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'content-csrf' })
    : Response.json({ accessToken: 'content-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })))
  await login('writer@example.invalid', 'test-password')
  const worldId = '66da90c9-76a2-4eaf-b802-1c2c39c591d0'
  const revisionId = 'fe466bd8-b970-4f2a-950c-6294b997227a'
  const basis = { worldId, revisionId, revisionNo: 2, name: '도시', createdAt: '2026-11-10T00:00:00Z' }
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ revision: 0, basis: null }))
    .mockResolvedValueOnce(Response.json([basis]))
    .mockResolvedValueOnce(Response.json(basis))
    .mockResolvedValueOnce(Response.json({ revision: 1, basis }))
    .mockResolvedValueOnce(Response.json({ ...basis, cards: [
      { card: { id: worldId, title: '장소', body: '저장된 장소', lifecycle: 'active' } },
      { card: { id: revisionId, title: '이전 장소', body: '제거된 장소', lifecycle: 'removed' } },
    ] }))
  const api = new EpisodeUseCase(new HttpEpisodeRepository(fetcher))
  const signal = new AbortController()

  expect(await api.episodeWorldBasis('work', 2, signal.signal)).toEqual({ revision: 0, basis: null })
  expect(await api.worldBasisVersions(worldId)).toEqual([basis])
  expect(await api.confirmWorldBasisVersion(worldId, 7, 'save-key')).toBe(revisionId)
  expect(await api.chooseEpisodeWorldBasis('work', 2, { worldId, revisionId, revision: 0 })).toEqual({ revision: 1, basis })
  expect(await api.worldBasisCards(worldId, revisionId)).toEqual([{ id: worldId, title: '장소', body: '저장된 장소' }])
  const path = '/api/v1/works/work/episodes/2/world-basis'
  const versions = '/api/v1/world-studios/' + worldId + '/revisions'
  expect(fetcher.mock.calls.map(([url, init]) => [url, init.method, init.body && JSON.parse(init.body)])).toEqual([
    [path, 'GET', undefined], [versions, 'GET', undefined],
    [versions, 'POST', { expectedDraftRevision: 7, key: 'save-key' }],
    [path, 'PUT', { worldId, revisionId, revision: 0 }],
    [versions + '/' + revisionId, 'GET', undefined],
  ])
  signal.abort()
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
})
