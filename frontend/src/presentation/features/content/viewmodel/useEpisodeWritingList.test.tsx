// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEpisodeViewModel } from './useEpisodeViewModel'
import type { Work, WritingEpisode } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const WORLD = '0b0f6f0e-3a51-4d6b-9a39-1f4f2b6d0a01'
const work: Work = {
  id: 'w1', title: '작품', summary: '', visibility: 'public', allowFork: false, allowForkPublication: false, source: null,
  episodes: [], draft: { title: '새 회차', body: '', revision: 1 }, revision: 1,
}
const row = (number: number): WritingEpisode => ({
  number, draft: { title: `${number}화`, body: '', revision: 0 }, versions: [], publishedVersionId: null, inherited: false,
  updatedAt: null, checkpointStatus: 'none', checkpoints: [], publicationStatus: 'draft', hasDraft: true,
})

/** api 대역은 렌더 밖에서 한 번만 만든다(훅이 api가 바뀌면 다시 조회한다). */
async function open(api: object) {
  const hook = renderHook(() => useEpisodeViewModel('w1', api as unknown as EpisodeUseCase, { upload: vi.fn() }))
  await act(async () => {})
  return hook.result
}

it('열린 작품의 초안 목록은 읽는 동안 null, 읽으면 rows, 읽지 못하면 error로 보인다', async () => {
  let finish!: (rows: WritingEpisode[]) => void
  const api = { list: vi.fn().mockResolvedValue([work]), writingList: vi.fn(() => new Promise<WritingEpisode[]>((resolve) => { finish = resolve })) }
  const result = await open(api)
  expect(api.writingList).toHaveBeenCalledWith('w1', expect.any(AbortSignal))
  expect(result.current.writing).toBeNull()
  await act(async () => { finish([row(1)]) })
  expect(result.current.writing).toEqual({ id: 'w1', rows: [row(1)] })

  const failing = await open({ list: vi.fn().mockResolvedValue([work]), writingList: vi.fn().mockRejectedValue(new Error('서버 오류')) })
  expect(failing.current.writing).toEqual({ id: 'w1', error: '초안 목록을 불러오지 못했어요.' })
})

it('작품 정보·분기 정책·세계관 연결을 저장해 작품이 바뀌어도 무거운 초안 목록은 다시 읽지 않는다', async () => {
  const renamed: Work = { ...work, title: '새 제목', revision: 2 }
  const api = {
    list: vi.fn().mockResolvedValue([work]),
    writingList: vi.fn().mockResolvedValue([row(1)]),
    updateWork: vi.fn().mockResolvedValue(renamed),
    policy: vi.fn().mockResolvedValue({ ...renamed, allowFork: true, revision: 3 }),
    linkWorldStudio: vi.fn().mockResolvedValue({ workId: 'w1', worldId: WORLD }),
  }
  const result = await open(api)
  expect(api.writingList).toHaveBeenCalledTimes(1)
  await act(async () => { await result.current.updateWork('새 제목', '') })
  await act(async () => { await result.current.policy(true, false) })
  await act(async () => { await result.current.linkWorld(WORLD) })
  expect(result.current.active?.title).toBe('새 제목')
  expect(result.current.active?.worldStudioId).toBe(WORLD)
  expect(api.writingList).toHaveBeenCalledTimes(1)
  expect(result.current.writing?.rows).toEqual([row(1)])
})

it('최신 데이터를 다시 불러오면(reload) 초안 목록도 새로 읽어 바뀐 회차를 보인다', async () => {
  const api = { list: vi.fn().mockResolvedValue([work]), writingList: vi.fn().mockResolvedValueOnce([row(1)]).mockResolvedValueOnce([row(1), row(2)]) }
  const result = await open(api)
  expect(result.current.writing?.rows).toEqual([row(1)])
  await act(async () => { await result.current.reload() })
  expect(api.writingList).toHaveBeenCalledTimes(2)
  expect(result.current.writing?.rows).toEqual([row(1), row(2)])
})

it('포크 공개를 중단해 작품을 다시 읽을 때도 초안 목록을 새로 읽는다', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const fork: Work = { ...work, source: { workId: 'o1', title: '원작', episode: 2, version: 7, direction: '다른 결말' } }
  const api = { list: vi.fn().mockResolvedValue([fork]), writingList: vi.fn().mockResolvedValue([row(3)]), stopForkPublication: vi.fn().mockResolvedValue(undefined) }
  const result = await open(api)
  await act(async () => { await result.current.stopFork() })
  expect(api.stopForkPublication).toHaveBeenCalledWith('w1')
  expect(api.writingList).toHaveBeenCalledTimes(2)
})
