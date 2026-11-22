// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../app/store'
import { SerialUseCase } from '../../domain/usecases/SerialUseCase'
import { fakeSerialRepo, settings } from '../../test/serialFixtures'
import { useSerialLock } from './useSerialLock'

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

/** 같은 스토어·UseCase를 렌더마다 다시 만들지 않는다(다시 만들면 읽기가 되풀이된다). */
const setup = (workId: string | null = 'w1', repo = fakeSerialRepo({ saved: settings({ enabled: true }) })) => {
  const store = createAppStore()
  const useCase = new SerialUseCase(repo)
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  return { repo, ...renderHook(() => useSerialLock(workId ?? undefined, useCase), { wrapper }) }
}

it('AI 집필이 켜져 있으면 잠그고, 읽는 동안에는 잠그지 않는다', async () => {
  const hook = setup()
  expect(hook.result.current.locked).toBe(false)
  await waitFor(() => expect(hook.result.current.locked).toBe(true))
  expect(hook.repo.settings).toHaveBeenCalledWith('w1', expect.any(AbortSignal))
})

it('꺼져 있으면 잠그지 않는다', async () => {
  const hook = setup('w1', fakeSerialRepo({ saved: settings({ enabled: false }) }))
  await waitFor(() => expect(hook.repo.settings).toHaveBeenCalled())
  await act(async () => {})
  expect(hook.result.current.locked).toBe(false)
})

it('읽지 못하면 잠그지 않고 서버의 409에 맡긴다', async () => {
  const repo = fakeSerialRepo()
  repo.settings.mockRejectedValue(new Error('설정 서버 오류'))
  const hook = setup('w1', repo)
  await waitFor(() => expect(repo.settings).toHaveBeenCalled())
  await act(async () => {})
  expect(hook.result.current.locked).toBe(false)
})

it('다시 읽다 실패하면 이전에 읽은 켜짐 값에 기대지 않고 잠그지 않는다', async () => {
  const repo = fakeSerialRepo({ saved: settings({ enabled: true }) })
  const hook = setup('w1', repo)
  await waitFor(() => expect(hook.result.current.locked).toBe(true))
  repo.settings.mockRejectedValue(new Error('설정 서버 오류'))
  act(() => hook.result.current.reread())
  await waitFor(() => expect(hook.result.current.locked).toBe(false))
})

it('작품이 아직 없거나 서버가 없는 시연(목업)에서는 읽지 않는다', async () => {
  const none = setup(null)
  await act(async () => {})
  expect(none.repo.settings).not.toHaveBeenCalled()
  cleanup()
  vi.stubEnv('MODE', 'mockup')
  const demo = setup()
  await act(async () => {})
  expect(demo.repo.settings).not.toHaveBeenCalled()
  expect(demo.result.current.locked).toBe(false)
})

it('reread는 서버 값을 다시 읽어 AI 집필 탭의 저장(켜기·끄기)을 따라간다', async () => {
  const repo = fakeSerialRepo({ saved: settings({ enabled: false }) })
  const hook = setup('w1', repo)
  await waitFor(() => expect(repo.settings).toHaveBeenCalledTimes(1))
  repo.settings.mockResolvedValue(settings({ enabled: true }))
  act(() => hook.result.current.reread())
  await waitFor(() => expect(hook.result.current.locked).toBe(true))
  repo.settings.mockResolvedValue(settings({ enabled: false }))
  act(() => hook.result.current.reread())
  await waitFor(() => expect(hook.result.current.locked).toBe(false))
  expect(repo.settings).toHaveBeenCalledTimes(3)
})
