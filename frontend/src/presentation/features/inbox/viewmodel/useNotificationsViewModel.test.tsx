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
import { useNotificationsViewModel } from './useNotificationsViewModel'

afterEach(cleanup)

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j })
  return { promise, resolve, reject }
}
const n = (id: string, createdAt = `2026-11-05T03:00:${String(id.charCodeAt(0) - 97).padStart(2, '0')}Z`): AppNotification => ({ id, kind: 'creation', summary: id, targetType: null, targetId: null, createdAt, read: false })
const page = (ids: string[], nextCursor: string | null = null): NotificationPage => ({ items: ids.map((id) => n(id)), nextCursor })
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
  return { hook, pending, markAll, signal, shell }
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

it('#145 최신 SSE 재조회가 실패하면 먼저 요청한 성공 응답을 반영한다', async () => {
  const { hook, pending, signal } = setup(page(['d', 'c']))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  signal()
  signal()
  await act(async () => { pending[1].response.reject(new Error('조회 실패')) })
  expect(ids(hook.result.current.items)).toEqual(['d', 'c'])
  await act(async () => { pending[0].response.resolve(page(['e', 'd'])) })

  expect(ids(hook.result.current.items)).toEqual(['e', 'd'])
})

it('#144 모두 읽음 대기 중 더 보기로 추가된 과거 알림도 성공하면 읽음이다', async () => {
  const { hook, pending, markAll } = setup(page(['c', 'b'], 'below-b'))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  let done!: Promise<void>
  act(() => { done = hook.result.current.markAll() })
  act(() => { void hook.result.current.loadMore() })
  await act(async () => { pending[0].response.resolve(page(['a'])) })
  expect(hook.result.current.items.every((item) => !item.read)).toBe(true)
  await act(async () => { markAll.resolve(); await done })

  expect(hook.result.current.items.map((item) => [item.id, item.read])).toEqual([['c', true], ['b', true], ['a', true]])
})

it('#144 성공한 모두 읽음 뒤 늦은 SSE 응답은 나노초 경계 안의 읽음을 되돌리지 않는다', async () => {
  const upTo = '2026-11-05T03:00:02.123456789Z'
  const first = { items: [n('b', upTo), n('a')], nextCursor: null }
  const { hook, pending, markAll, signal, shell } = setup(first)
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  signal()
  let done!: Promise<void>
  act(() => { done = hook.result.current.markAll() })
  expect(shell.markAllRead).toHaveBeenCalledWith(upTo)
  await act(async () => { markAll.resolve(); await done })
  await act(async () => { pending[0].response.resolve({ items: [n('e', '2026-11-05T03:00:02.123456790Z'), ...first.items], nextCursor: null }) })

  expect(hook.result.current.items.map((item) => [item.id, item.read])).toEqual([['e', false], ['b', true], ['a', true]])
})

it('#144 성공한 모두 읽음 뒤 늦은 더 보기 응답의 과거 알림도 읽음이다', async () => {
  const { hook, pending, markAll } = setup(page(['c', 'b'], 'below-b'))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  act(() => { void hook.result.current.loadMore() })
  let done!: Promise<void>
  act(() => { done = hook.result.current.markAll() })
  await act(async () => { markAll.resolve(); await done })
  await act(async () => { pending[0].response.resolve(page(['a'])) })

  expect(hook.result.current.items.map((item) => [item.id, item.read])).toEqual([['c', true], ['b', true], ['a', true]])
  expect(hook.result.current.nextCursor).toBeNull()
})

it('#144 모두 읽음 실패는 현재 목록과 이후 재조회 알림을 읽음으로 바꾸지 않는다', async () => {
  const { hook, pending, markAll, signal } = setup(page(['c', 'b']))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  let done!: Promise<void>
  act(() => { done = hook.result.current.markAll() })
  signal()
  await act(async () => { markAll.reject(new Error('읽음 실패')); await done })
  expect(hook.result.current.items.every((item) => !item.read)).toBe(true)
  await act(async () => { pending[0].response.resolve(page(['e', 'c', 'b', 'a'])) })

  expect(hook.result.current.items).toHaveLength(4)
  expect(hook.result.current.items.every((item) => !item.read)).toBe(true)
})

it('조작 실패는 어디서 실패했는지와 함께 남겨 화면이 그 자리에서 알리게 하고, 다음 조작을 시작하면 지운다', async () => {
  const { hook, markAll, shell } = setup(page(['c', 'b']))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))
  expect(hook.result.current.failure).toBeNull()

  let done!: Promise<void>
  act(() => { done = hook.result.current.markAll() })
  await act(async () => { markAll.reject(new Error('읽음 실패')); await done })
  expect(hook.result.current.failure).toEqual({ at: 'all', msg: '모두 읽음 처리하지 못했어요. 다시 시도해 주세요.' })

  const [c] = hook.result.current.items
  let finish!: (error: Error) => void
  Object.assign(shell, { removeNotification: vi.fn(() => new Promise<void>((_, reject) => { finish = reject })) })
  let removed!: Promise<boolean>
  act(() => { removed = hook.result.current.remove(c) })
  expect(hook.result.current.failure).toBeNull()
  await act(async () => { finish(new Error('삭제 실패')); expect(await removed).toBe(false) })
  expect(hook.result.current.failure).toEqual({ at: 'row:c', msg: '알림을 삭제하지 못했어요. 다시 시도해 주세요.' })
  expect(ids(hook.result.current.items)).toEqual(['c', 'b'])
})

it('수신 설정 저장과 더 보기 실패도 각각의 자리로 남긴다', async () => {
  const { hook, pending, shell } = setup(page(['c', 'b'], 'below-b'))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))
  Object.assign(shell, { savePrefs: vi.fn(() => Promise.reject(new Error('저장 실패'))) })
  await act(async () => { await hook.result.current.setPref('read', false) })
  expect(hook.result.current.failure).toEqual({ at: 'prefs', msg: '알림 설정을 저장하지 못했어요. 다시 시도해 주세요.' })
  expect(hook.result.current.prefs).toEqual({ read: true, creator: true })

  let more!: Promise<void>
  act(() => { more = hook.result.current.loadMore() })
  await act(async () => { pending[0].response.reject(new Error('조회 실패')); await more })
  expect(hook.result.current.failure).toEqual({ at: 'more', msg: '알림을 더 불러오지 못했어요. 다시 시도해 주세요.' })
  expect(hook.result.current.loadingMore).toBe(false)
})

it('#145 재시도 전 SSE 응답은 새 목록을 덮지 않는다', async () => {
  const { hook, pending, signal } = setup(page(['d', 'c']))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  signal()
  act(() => { hook.result.current.retry() })
  await act(async () => { pending[1].response.resolve(page(['h', 'g'])) })
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))
  await act(async () => { pending[0].response.resolve(page(['e', 'd'])) })

  expect(ids(hook.result.current.items)).toEqual(['h', 'g'])
})

it('#144 재시도 전 모두 읽음 성공은 새 수명의 알림을 변경하지 않는다', async () => {
  const { hook, pending, markAll } = setup(page(['c', 'b']))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))

  let done!: Promise<void>
  act(() => { done = hook.result.current.markAll() })
  act(() => { hook.result.current.retry() })
  await act(async () => { pending[0].response.resolve(page(['c', 'b'])) })
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))
  await act(async () => { markAll.resolve(); await done })

  expect(hook.result.current.items.every((item) => !item.read)).toBe(true)
})
