// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { AppNotification, NotificationPage } from '../../../../domain/entities/notification'
import type { ShellUseCase } from '../../../../domain/usecases/ShellUseCase'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useNotificationsViewModel } from './useInboxViewModel'

afterEach(cleanup)

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const n = (id: string): AppNotification => ({ id, kind: 'creation', summary: id, targetType: null, targetId: null, createdAt: '2026-11-05T03:00:00Z', read: false })
const page = (ids: string[], nextCursor: string | null = null): NotificationPage => ({ items: ids.map(n), nextCursor })
const ids = (items: AppNotification[]) => items.map((i) => i.id)

/** 첫 조회만 바로 답하고, 그 뒤 조회는 테스트가 응답 순서를 직접 정하도록 대기시킵니다. */
function setup(first: NotificationPage) {
  const store = createAppStore()
  const pending: { cursor: string | null | undefined; response: ReturnType<typeof deferred<NotificationPage>> }[] = []
  const markAll = deferred<void>()
  let initial = true
  const shell = {
    listNotifications: vi.fn((cursor?: string | null) => {
      if (initial && cursor == null) { initial = false; return Promise.resolve(first) }
      const response = deferred<NotificationPage>()
      pending.push({ cursor, response })
      return response.promise
    }),
    getPrefs: vi.fn(() => Promise.resolve({ read: true, creator: true })),
    markAllRead: vi.fn(() => markAll.promise),
  } as unknown as ShellUseCase
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const hook = renderHook(() => useNotificationsViewModel(shell), { wrapper })
  const signal = () => act(() => { store.dispatch(sessionActions.noticeSignal()) })
  return { hook, pending, markAll, signal }
}

it('#144 모두 읽음 응답을 기다리는 동안 SSE로 들어온 새 알림은 응답 뒤에도 미읽음으로 남는다', async () => {
  const { hook, pending, markAll, signal } = setup(page(['b', 'a']))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  let done!: Promise<void>
  act(() => { done = hook.result.current.markAll() })
  signal()
  await act(async () => { pending[0].response.resolve(page(['e', 'b', 'a'])) })
  await waitFor(() => expect(ids(hook.result.current.items)).toEqual(['e', 'b', 'a']))

  await act(async () => { markAll.resolve(); await done })
  expect(hook.result.current.items.map((i) => [i.id, i.read])).toEqual([['e', false], ['b', true], ['a', true]])
})

it('#145 SSE 재조회 응답이 뒤바뀌어 와도 늦게 도착한 이전 응답이 최신 목록을 덮지 않는다', async () => {
  const { hook, pending, signal } = setup(page(['d', 'c']))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  signal()
  signal()
  expect(pending).toHaveLength(2)
  await act(async () => { pending[1].response.resolve(page(['e', 'd'])) })
  await waitFor(() => expect(ids(hook.result.current.items)).toEqual(['e', 'd']))
  await act(async () => { pending[0].response.resolve(page(['d', 'c'])) })

  expect(ids(hook.result.current.items)).toEqual(['e', 'd'])
})

it('#146 SSE로 목록 기준이 바뀐 뒤 늦게 도착한 더 보기 응답은 cursor와 목록을 덮지 않는다', async () => {
  const { hook, pending, signal } = setup(page(['c', 'b'], 'below-b'))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  act(() => { void hook.result.current.loadMore() })
  expect(pending[0].cursor).toBe('below-b')
  signal()
  await act(async () => { pending[1].response.resolve(page(['h', 'g'], 'below-g')) })
  await waitFor(() => expect(ids(hook.result.current.items)).toEqual(['h', 'g']))
  await act(async () => { pending[0].response.resolve(page(['a'], null)) })

  expect(ids(hook.result.current.items)).toEqual(['h', 'g'])
  expect(hook.result.current.nextCursor).toBe('below-g')
  expect(hook.result.current.loadingMore).toBe(false)
})
