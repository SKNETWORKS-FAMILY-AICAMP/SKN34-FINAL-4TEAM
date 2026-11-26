// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import type { AppNotification, NotificationPage } from '../../../domain/entities/notification'
import type { ShellUseCase } from '../../../domain/usecases/ShellUseCase'
import { sessionActions } from '../session/sessionSlice'
import { useNativeAppBridge } from './useNativeAppBridge'

afterEach(() => { cleanup(); delete window.ReactNativeWebView })

const notice = (id: string, over: Partial<AppNotification> = {}): AppNotification => ({
  id, kind: 'creation', summary: id, targetType: 'work', targetId: 'w1', createdAt: '2026-11-26T01:00:00Z', read: false, ...over,
})
const user = (id: string) => ({ id, email: `${id}@example.invalid`, nickname: 'U', operator: false })
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

/** 앱 안(브리지 있음)이면 postMessage를 기록하고, 앱 밖이면 브리지가 없다. 알림 목록 첫 쪽은 `page.items`로 정한다. */
function setup({ inApp = true, loggedIn = true } = {}) {
  const store = createAppStore(loggedIn ? { role: 'user', memberId: 'u1' } : {})
  const page = { items: [notice('a')] }
  const listNotifications = vi.fn(async (_cursor?: string | null, _signal?: AbortSignal): Promise<NotificationPage> => ({ items: page.items, nextCursor: null }))
  const shell = { listNotifications } as unknown as ShellUseCase
  const postMessage = vi.fn()
  const bridge = inApp ? { postMessage } : undefined
  const getBridge = () => bridge
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  const hook = renderHook(() => useNativeAppBridge(shell, getBridge), { wrapper })
  const sent = () => postMessage.mock.calls.map(([data]) => JSON.parse(data as string) as { type: string; userId?: string; items?: { id: string }[] })
  const signal = async () => { act(() => { store.dispatch(sessionActions.noticeSignal()) }); await settle() }
  return { store, page, listNotifications, postMessage, sent, signal, hook }
}

it('앱 밖(브라우저)에서는 로그인해도 알림 목록을 읽지 않고 아무 메시지도 보내지 않는다', async () => {
  const s = setup({ inApp: false })
  await settle()
  await s.signal()
  act(() => { s.store.dispatch(sessionActions.logout()) })
  await settle()
  expect(s.listNotifications).not.toHaveBeenCalled()
  expect(s.postMessage).not.toHaveBeenCalled()
})

it('앱 안에서 로그인한 상태면 알림 목록 첫 쪽을 읽어 회원 id와 함께 앱에 보낸다', async () => {
  const s = setup()
  await settle()
  expect(s.listNotifications).toHaveBeenCalledTimes(1)
  expect(s.listNotifications).toHaveBeenCalledWith(null, expect.any(AbortSignal))
  expect(s.sent()).toEqual([{ type: 'storyfork.notifications', userId: 'u1', items: [expect.objectContaining({ id: 'a', summary: 'a' })] }])
})

it('알림 변경 신호(SSE)마다 다시 읽어 새 목록을 보낸다', async () => {
  const s = setup()
  await settle()
  s.page.items = [notice('b'), notice('a')]
  await s.signal()
  expect(s.listNotifications).toHaveBeenCalledTimes(2)
  expect(s.sent().map((m) => m.items?.map((i) => i.id))).toEqual([['a'], ['b', 'a']])
})

it('로그인하지 않았으면 읽지도 보내지도 않다가, 로그인하면 보낸다', async () => {
  const s = setup({ loggedIn: false })
  await s.signal()
  expect(s.listNotifications).not.toHaveBeenCalled()
  act(() => { s.store.dispatch(sessionActions.login(user('u1'))) })
  await settle()
  expect(s.sent().map((m) => [m.type, m.userId])).toEqual([['storyfork.notifications', 'u1']])
})

it('목록 읽기가 실패하면 조용히 넘어가고(메시지 없음) 다음 신호에 다시 읽는다', async () => {
  const s = setup()
  await settle()
  s.postMessage.mockClear()
  s.listNotifications.mockRejectedValueOnce(new Error('network'))
  await s.signal()
  expect(s.postMessage).not.toHaveBeenCalled()
  await s.signal()
  expect(s.sent()).toHaveLength(1)
})

it('로그아웃하면 앱에 로그아웃을 알리고, 그 뒤 신호에는 읽지 않는다', async () => {
  const s = setup()
  await settle()
  s.postMessage.mockClear()
  s.listNotifications.mockClear()
  act(() => { s.store.dispatch(sessionActions.logout()) })
  await settle()
  expect(s.sent()).toEqual([{ type: 'storyfork.logout' }])
  await s.signal()
  expect(s.listNotifications).not.toHaveBeenCalled()
})

it('계정을 바꾸면 이전 계정의 로그아웃을 먼저 알리고 새 계정의 목록을 보낸다', async () => {
  const s = setup()
  await settle()
  s.postMessage.mockClear()
  act(() => { s.store.dispatch(sessionActions.login(user('u2'))) })
  await settle()
  expect(s.sent().map((m) => [m.type, m.userId])).toEqual([['storyfork.logout', undefined], ['storyfork.notifications', 'u2']])
})

it('더 새 신호가 와서 취소된 이전 조회의 늦은 응답은 보내지 않는다', async () => {
  const s = setup()
  await settle()
  s.postMessage.mockClear()
  const slow = deferred<NotificationPage>()
  s.listNotifications.mockImplementationOnce(() => slow.promise)
  act(() => { s.store.dispatch(sessionActions.noticeSignal()) })
  s.page.items = [notice('new')]
  await s.signal()
  slow.resolve({ items: [notice('old')], nextCursor: null })
  await settle()
  expect(s.sent().map((m) => m.items?.map((i) => i.id))).toEqual([['new']])
})

it('기본 브리지는 앱이 주입한 window.ReactNativeWebView다', async () => {
  const postMessage = vi.fn()
  window.ReactNativeWebView = { postMessage }
  const store = createAppStore({ role: 'user', memberId: 'u1' })
  const shell = { listNotifications: vi.fn(async () => ({ items: [notice('a')], nextCursor: null })) } as unknown as ShellUseCase
  renderHook(() => useNativeAppBridge(shell), { wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider> })
  await settle()
  expect(postMessage).toHaveBeenCalledTimes(1)
  expect(JSON.parse(postMessage.mock.calls[0][0] as string)).toMatchObject({ type: 'storyfork.notifications', userId: 'u1' })
})
