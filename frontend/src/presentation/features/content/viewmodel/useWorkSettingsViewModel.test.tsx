// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { WorkSettings, WritingMode } from '../../../../domain/entities/operatingSettings'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { useWorkSettingsViewModel } from './useWorkSettingsViewModel'

afterEach(cleanup)

const defaults = { worldUpdateMode: 'manual', proofreadingMode: 'review', autoserialState: 'off' } as const
const settingsOf = (writingMode: WritingMode | null, revision = writingMode ? 1 : 0): WorkSettings => {
  const current = writingMode ? { revision, writingMode, changedAt: '2026-11-22T03:00:00Z' } : { revision: 0 as const, writingMode: null, changedAt: null }
  return { ...defaults, current, history: writingMode ? [{ revision, writingMode, changedAt: current.changedAt! }] : [] }
}
/** saved: 서버에 저장된 집필 방식. 저장 응답은 고른 방식을 새 버전으로 돌려준다(저장 요청은 거절하려면 reject를 준다). */
const setup = async (saved: WritingMode | null, reject?: Error) => {
  const api = {
    workSettings: vi.fn().mockResolvedValue(settingsOf(saved)),
    updateWorkSettings: vi.fn(async (_id: string, revision: number, mode: WritingMode) => { if (reject) throw reject; return settingsOf(mode, revision + 1) }),
  }
  const onSaved = vi.fn()
  const hook = renderHook(() => useWorkSettingsViewModel('w', api as unknown as EpisodeUseCase, onSaved))
  await waitFor(() => expect(hook.result.current.settings).toBeDefined())
  return { api, onSaved, ...hook }
}

// 계약 'AI 자율 집필 선택 경고': 집필 방식을 AI 자율 집필로 저장할 때 확인을 거친다(경고일 뿐 저장을 막지 않는다).
it.each<[string, WritingMode | null]>([['저장한 방식이 없으면', null], ['직접 집필이면', 'direct'], ['AI 협업 집필이면', 'assisted']])('%s AI 자율 집필 저장은 곧바로 보내지 않고 먼저 확인을 요청한다', async (_name, saved) => {
  const { api, result } = await setup(saved)
  expect(result.current.confirming).toBe(false)
  act(() => result.current.selectMode('autonomous'))
  await act(() => result.current.save())
  expect(result.current.confirming).toBe(true)
  expect(api.updateWorkSettings).not.toHaveBeenCalled()
  expect(result.current.saving).toBe(false)
})

it('계속 저장하면 그때 고른 방식을 저장하고 확인을 닫으며 저장 완료를 알리고 호출 측에 알린다', async () => {
  const { api, onSaved, result } = await setup('assisted')
  act(() => result.current.selectMode('autonomous'))
  await act(() => result.current.save())
  await act(() => result.current.confirmSave())
  expect(api.updateWorkSettings).toHaveBeenCalledTimes(1)
  expect(api.updateWorkSettings).toHaveBeenCalledWith('w', 1, 'autonomous', expect.any(AbortSignal))
  expect(result.current.confirming).toBe(false)
  expect(result.current.notice).toBe('집필 방식을 저장했어요.')
  expect(result.current.settings?.current.writingMode).toBe('autonomous')
  expect(onSaved).toHaveBeenCalledTimes(1)
})

it('취소하면 저장하지 않고 확인만 닫으며, 고른 값은 그대로라 다시 저장을 누르면 확인을 다시 본다', async () => {
  const { api, onSaved, result } = await setup('direct')
  act(() => result.current.selectMode('autonomous'))
  await act(() => result.current.save())
  act(() => result.current.cancelConfirm())
  expect(result.current.confirming).toBe(false)
  expect(result.current.mode).toBe('autonomous')
  expect(result.current.canSave).toBe(true)
  expect(api.updateWorkSettings).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
  await act(() => result.current.save())
  expect(result.current.confirming).toBe(true)
})

it.each<[string, WritingMode | null, WritingMode]>([
  ['직접 집필으로', 'assisted', 'direct'],
  ['AI 협업 집필으로', null, 'assisted'],
  ['켜져 있던 AI 자율 집필을 끄려고 직접 집필으로', 'autonomous', 'direct'],
  ['켜져 있던 AI 자율 집필을 끄려고 AI 협업 집필으로', 'autonomous', 'assisted'],
])('%s 바꾸는 저장은 확인 없이 바로 저장한다', async (_name, saved, next) => {
  const { api, result } = await setup(saved)
  act(() => result.current.selectMode(next))
  await act(() => result.current.save())
  expect(result.current.confirming).toBe(false)
  expect(api.updateWorkSettings).toHaveBeenCalledWith('w', saved ? 1 : 0, next, expect.any(AbortSignal))
})

it('이미 AI 자율 집필인 작품은 같은 값이라 저장할 수 없고 확인도 열리지 않는다', async () => {
  const { api, result } = await setup('autonomous')
  expect(result.current.mode).toBe('autonomous')
  expect(result.current.canSave).toBe(false)
  await act(() => result.current.save())
  expect(result.current.confirming).toBe(false)
  expect(api.updateWorkSettings).not.toHaveBeenCalled()
  // 다른 방식을 골랐다가 저장 전에 AI 자율 집필로 되돌려도 저장값과 같아 확인 없이 잠긴 채다.
  act(() => result.current.selectMode('direct'))
  act(() => result.current.selectMode('autonomous'))
  await act(() => result.current.save())
  expect(result.current.confirming).toBe(false)
  expect(api.updateWorkSettings).not.toHaveBeenCalled()
})

it('확인이 떠 있는 동안 저장을 다시 불러도 요청은 없고, 확인이 열려 있지 않을 때 계속 저장을 불러도 아무것도 보내지 않는다', async () => {
  const { api, result } = await setup('direct')
  await act(() => result.current.confirmSave()) // 열린 확인이 없다
  expect(api.updateWorkSettings).not.toHaveBeenCalled()
  act(() => result.current.selectMode('autonomous'))
  await act(() => result.current.confirmSave()) // 저장을 누르기 전이다
  expect(api.updateWorkSettings).not.toHaveBeenCalled()
  await act(() => result.current.save())
  await act(() => result.current.save())
  expect(result.current.confirming).toBe(true)
  expect(api.updateWorkSettings).not.toHaveBeenCalled()
})

it('계속 저장이 서버에 거절되면 확인은 닫히고 서버 문구를 알리며 호출 측에는 알리지 않는다', async () => {
  const { onSaved, result } = await setup('direct', new Error('집필 방식을 저장할 수 없어요.'))
  act(() => result.current.selectMode('autonomous'))
  await act(() => result.current.save())
  await act(() => result.current.confirmSave())
  expect(result.current.confirming).toBe(false)
  expect(result.current.error).toBe('집필 방식을 저장할 수 없어요.')
  expect(result.current.mode).toBe('autonomous')
  expect(onSaved).not.toHaveBeenCalled()
})
