// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEpisodeViewModel } from './useEpisodeViewModel'
import type { Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

afterEach(cleanup)

const work: Work = {
  id: 'w1', title: '제목', summary: '소개', visibility: 'private', allowFork: false, allowForkPublication: false, source: null,
  episodes: [], draft: { title: '새 회차', body: '', revision: 1 }, revision: 1,
}

function open(api: object) {
  return renderHook(() => useEpisodeViewModel('w1', api as unknown as EpisodeUseCase, { upload: vi.fn() }))
}

it('추천을 받으면 열린 작품 id로 요청하고 후보를 돌려준다 (작품은 저장하지 않는다)', async () => {
  const api = {
    list: vi.fn().mockResolvedValue([work]),
    suggestWorkTags: vi.fn().mockResolvedValue({ genres: ['판타지'], hashtags: ['회귀', '성장'] }),
    updateWork: vi.fn(),
  }
  const { result } = open(api)
  await act(async () => {})
  let found: unknown = null
  await act(async () => { found = await result.current.suggestTags() })
  expect(api.suggestWorkTags).toHaveBeenCalledWith('w1', expect.any(AbortSignal))
  expect(found).toEqual({ genres: ['판타지'], hashtags: ['회귀', '성장'] })
  expect(api.updateWork).not.toHaveBeenCalled()
  expect(result.current.error).toBe('')
})

it('추천에 실패하면 null을 돌려주고 서버 사유를 오류로 알린다', async () => {
  const api = {
    list: vi.fn().mockResolvedValue([work]),
    suggestWorkTags: vi.fn().mockRejectedValue(new Error('발행된 회차가 있어야 추천할 수 있어요.')),
  }
  const { result } = open(api)
  await act(async () => {})
  let found: unknown = 'x'
  await act(async () => { found = await result.current.suggestTags() })
  expect(found).toBeNull()
  expect(result.current.error).toBe('발행된 회차가 있어야 추천할 수 있어요.')
})

it('추천 중 화면을 떠나면 요청을 취소하고 결과·오류를 남기지 않는다', async () => {
  let signal: AbortSignal | undefined
  const api = {
    list: vi.fn().mockResolvedValue([work]),
    suggestWorkTags: vi.fn((_: string, s: AbortSignal) => {
      signal = s
      return new Promise((_resolve, reject) => s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }),
  }
  const { result, unmount } = open(api)
  await act(async () => {})
  let pending: Promise<unknown> = Promise.resolve()
  act(() => { pending = result.current.suggestTags() })
  unmount()
  expect(signal?.aborted).toBe(true)
  await expect(pending).resolves.toBeNull()
})
