// @vitest-environment jsdom
// 채팅(AI)이 계획을 저장한 뒤의 재조회(#637): 저장하지 않은 입력이 없으면 바로 다시 읽고, 있으면 확인 창 없이 입력을 지킨다.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { StoryPlan } from '../../../domain/entities/storyPlan'
import type { StoryPlanUseCase } from '../../../domain/usecases/StoryPlanUseCase'
import { useStoryPlanViewModel } from './useStoryPlanViewModel'

vi.mock('../../../app/appContainer', () => ({ appContainer: { resolve: () => ({}) } }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const scene = (title: string): StoryPlan => ({ id: 's1', workId: 'w', kind: 'scene', parentId: 'p1', title, content: '', episodeNumber: 2, characterIds: [], placeIds: [], revision: 1, episodeMissing: false })
const fake = (...lists: StoryPlan[][]) => {
  const list = vi.fn()
  lists.forEach((rows) => list.mockResolvedValueOnce(rows))
  return { list, references: vi.fn().mockResolvedValue({ episodes: [], characters: [], places: [] }) }
}
const mount = async (api: ReturnType<typeof fake>) => {
  const view = renderHook(() => useStoryPlanViewModel('w', false, api as unknown as StoryPlanUseCase, true))
  await waitFor(() => expect(view.result.current.ready).toBe(true))
  return view
}

it('AI가 계획을 저장하면 저장하지 않은 입력이 없을 때 확인 없이 최신 계획을 다시 읽고 시작 양식 갱신 신호를 올린다', async () => {
  const confirm = vi.spyOn(window, 'confirm')
  const api = fake([scene('옛 제목')], [scene('새 제목')])
  const { result } = await mount(api)
  expect(result.current.plans[0].title).toBe('옛 제목')
  act(() => result.current.reloadAfterAi())
  await waitFor(() => expect(result.current.plans[0].title).toBe('새 제목'))
  expect(result.current.version).toBe(1)
  expect(result.current.error).toBe('')
  expect(confirm).not.toHaveBeenCalled()
})

it('저장하지 않은 입력이 있으면 확인 창 없이 입력을 지키고 다시 불러오라고 알리며 시작 양식은 다시 읽게 하고 시작은 잠근다', async () => {
  const confirm = vi.spyOn(window, 'confirm')
  const api = fake([scene('옛 제목')], [scene('새 제목')])
  const { result } = await mount(api)
  act(() => result.current.create('p1', 2))
  act(() => result.current.change({ title: '내가 쓰던 제목' }))
  expect(result.current.dirty).toBe(true)
  act(() => result.current.reloadAfterAi())
  expect(confirm).not.toHaveBeenCalled()
  expect(result.current.editor?.value.title).toBe('내가 쓰던 제목')
  expect(result.current.version).toBe(1)
  expect(result.current.error).toContain('AI가 계획을 바꿨어요')
  expect(result.current.startBlocker).not.toBe('')
  expect(api.list).toHaveBeenCalledTimes(1)
  // 안내의 다시 불러오기는 기존 reload라 입력을 버리는 확인을 거친다.
  confirm.mockReturnValue(false)
  act(() => result.current.reload())
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(result.current.plans[0].title).toBe('옛 제목')
})
