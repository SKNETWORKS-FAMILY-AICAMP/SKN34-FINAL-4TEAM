// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEpisodeViewModel } from './useEpisodeViewModel'
import type { Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

afterEach(cleanup)

const publicWork: Work = {
  id: 'p1', title: '공개 작품', summary: '', visibility: 'public', allowFork: true, allowForkPublication: false, source: null,
  episodes: [{ number: 1, version: 1, title: '1화', body: '본문', inherited: false }], draft: { title: '', body: '', revision: 0 }, readOnly: true, revision: 0,
}

it('작품을 열면 조회 기록을 요청하고(기록 대상 판단은 UseCase) 선택을 해제하면 요청하지 않는다', async () => {
  const api = { list: vi.fn().mockResolvedValue([]) }
  const reading = { recordViews: vi.fn().mockResolvedValue(undefined) }
  const { result } = renderHook(() => useEpisodeViewModel(api as unknown as EpisodeUseCase, { upload: vi.fn() }, reading))
  await act(async () => {})
  expect(reading.recordViews).not.toHaveBeenCalled()
  act(() => { result.current.select(publicWork) })
  expect(result.current.active?.id).toBe('p1')
  expect(reading.recordViews).toHaveBeenCalledTimes(1)
  expect(reading.recordViews).toHaveBeenCalledWith(publicWork)
  act(() => { result.current.select(null) })
  expect(result.current.active).toBeNull()
  expect(reading.recordViews).toHaveBeenCalledTimes(1)
})
