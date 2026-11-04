// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { World } from '../../../../domain/entities/content'
import { useSettingHistoryViewModel } from './useSettingHistoryViewModel'

afterEach(cleanup)
const setting = { id: 's', versionId: 'v', name: '규칙', content: '내용', category: '규칙' as const, tags: [], visibility: 'private' as const, fromEpisode: 1, toEpisode: null, knownBy: [], evidence: '' }
const world: World = { id: 'w', name: '세계관', revision: 3, mode: 'own', basis: null, draft: null, drafts: [], settings: [setting], history: [setting], sourceToken: 't', changes: [] }
it('복원 실패를 완료로 표시하지 않고 중복 전송을 막는다', async () => {
  let reject!: (error: Error) => void
  const api = { world: vi.fn().mockResolvedValue(world), revertSetting: vi.fn().mockImplementation(() => new Promise((_, fail) => { reject = fail })) }
  const { result } = renderHook(() => useSettingHistoryViewModel('w', api))
  await waitFor(() => expect(result.current.world).toEqual(world))
  act(() => { void result.current.restore('s', 'v'); void result.current.restore('s', 'v') })
  expect(api.revertSetting).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error('설정 충돌')) })
  expect(result.current.error).toBe('설정 충돌')
  expect(result.current.notice).toBe('')
  expect(result.current.world).toEqual(world)
})
it('작품 전환 시 이전 조회를 취소하고 늦은 응답을 무시한다', async () => {
  let finish!: (world: World) => void
  const api = { world: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ ...world, id: 'next' }), revertSetting: vi.fn() }
  const { result, rerender } = renderHook(({ id }) => useSettingHistoryViewModel(id, api), { initialProps: { id: 'old' } })
  rerender({ id: 'next' })
  await waitFor(() => expect(result.current.world?.id).toBe('next'))
  await act(async () => { finish(world) })
  expect(api.world.mock.calls[0][1].aborted).toBe(true)
  expect(result.current.world?.id).toBe('next')
})
it('복원 응답의 새 revision을 이후 복원에 사용한다', async () => {
  const api = { world: vi.fn().mockResolvedValue(world), revertSetting: vi.fn().mockResolvedValue({ ...world, revision: 4 }) }
  const { result } = renderHook(() => useSettingHistoryViewModel('w', api))
  await waitFor(() => expect(result.current.world).toEqual(world))
  await act(async () => { await result.current.restore('s', 'v') })
  expect(result.current.notice).toBe('과거 설정을 새 버전으로 복원했어요.')
  await act(async () => { await result.current.restore('s', 'v') })
  expect(api.revertSetting).toHaveBeenLastCalledWith('w', 's', 4, 'v', expect.any(AbortSignal))
})
it('기존 설정 초안이 있으면 복원 API를 호출하지 않는다', async () => {
  const api = { world: vi.fn().mockResolvedValue({ ...world, drafts: [setting] }), revertSetting: vi.fn() }
  const { result } = renderHook(() => useSettingHistoryViewModel('w', api))
  await waitFor(() => expect(result.current.world).not.toBeNull())
  await act(async () => { await result.current.restore('s', 'v') })
  expect(api.revertSetting).not.toHaveBeenCalled()
})
