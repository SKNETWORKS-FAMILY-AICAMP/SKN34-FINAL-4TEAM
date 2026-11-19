// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../app/store'
import type { AppNotification, NotificationPage } from '../../domain/entities/notification'
import type { ShellUseCase } from '../../domain/usecases/ShellUseCase'
import { sessionActions } from './session/sessionSlice'
import { useMcpChangeWatch } from './useMcpChangeWatch'

afterEach(cleanup)

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const T0 = '2026-11-19T03:00:00Z'
const T1 = '2026-11-19T03:00:05Z'
const T2 = '2026-11-19T03:00:09Z'
const aiTool = (createdAt: string, over: Partial<AppNotification> = {}): AppNotification => ({
  id: `n-${createdAt}`, kind: 'ai-tool', summary: 'AI가 MCP로 작품을 수정했어요', targetType: 'work', targetId: 'w1', createdAt, read: false, ...over,
})
/** 요청이 끝나고 그 응답을 처리할 때까지(마이크로태스크 포함) 기다린다. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

/** 알림 한 쪽은 `notices.items`를 바꿔 정하고, 알림 스트림 신호(noticeVersion)는 store로 올린다. 화면을 연 직후의 첫 조회(기준선)까지 끝낸 상태로 돌려준다. */
async function setup(initial: AppNotification[], loggedIn = true) {
  const store = createAppStore(loggedIn ? { role: 'user' } : {})
  const notices = { items: initial }
  const listNotifications = vi.fn(async (_cursor?: string | null, _signal?: AbortSignal): Promise<NotificationPage> => ({ items: notices.items, nextCursor: null }))
  const shell = { listNotifications } as unknown as ShellUseCase
  const reload = vi.fn(async () => true)
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  const hook = renderHook(
    (props: { targetId: string; dirty: boolean }) => useMcpChangeWatch({ targetType: 'work', targetId: props.targetId, dirty: props.dirty, reload }, shell),
    { wrapper, initialProps: { targetId: 'w1', dirty: false } },
  )
  await settle()
  /** 신호 하나를 보내고 그 알림 조회의 처리가 끝날 때까지 기다린다. */
  const signal = async () => {
    act(() => { store.dispatch(sessionActions.noticeSignal()) })
    await settle()
  }
  return { store, notices, listNotifications, reload, hook, signal }
}

it('화면을 열 때 최근 알림 한 쪽(20개)을 읽어 기준선으로 삼고, 이미 있던 알림으로는 다시 불러오지 않는다', async () => {
  const s = await setup([aiTool(T0)])
  expect(s.listNotifications).toHaveBeenCalledTimes(1)
  expect(s.listNotifications).toHaveBeenCalledWith(null, expect.any(AbortSignal))
  await s.signal()
  expect(s.listNotifications).toHaveBeenCalledTimes(2)
  expect(s.reload).not.toHaveBeenCalled()
  expect(s.hook.result.current.stale).toBe(false)
})

it('로그인하지 않았으면 알림을 읽지 않는다', async () => {
  const s = await setup([aiTool(T0)], false)
  await s.signal()
  expect(s.listNotifications).not.toHaveBeenCalled()
})

it('신호 뒤 열린 대상의 더 늦은 AI·외부 도구 변경 알림이 보이고 저장하지 않은 수정이 없으면 바로 다시 불러온다', async () => {
  const s = await setup([aiTool(T0)])
  s.notices.items = [aiTool(T1), aiTool(T0)]
  await s.signal()
  expect(s.reload).toHaveBeenCalledTimes(1)
  expect(s.hook.result.current.stale).toBe(false)
  // 같은 알림으로 다시 신호가 와도 기준선이 옮겨 갔으니 한 번만 읽는다.
  await s.signal()
  expect(s.reload).toHaveBeenCalledTimes(1)
})

it('저장하지 않은 수정이 있으면 다시 불러오지 않고 배너만 켜고, 배너의 다시 불러오기는 다시 읽은 뒤 배너를 끈다', async () => {
  const s = await setup([])
  s.hook.rerender({ targetId: 'w1', dirty: true })
  s.notices.items = [aiTool(T1)]
  await s.signal()
  expect(s.reload).not.toHaveBeenCalled()
  expect(s.hook.result.current.stale).toBe(true)
  await act(async () => { await s.hook.result.current.reload() })
  expect(s.reload).toHaveBeenCalledTimes(1)
  expect(s.hook.result.current.stale).toBe(false)
})

it('자동으로 다시 읽지 못하면(진행 중인 저장 등) 배너로 알리고, 배너에서 다시 읽으면 배너를 끈다', async () => {
  const s = await setup([])
  s.reload.mockResolvedValueOnce(false)
  s.notices.items = [aiTool(T1)]
  await s.signal()
  expect(s.hook.result.current.stale).toBe(true)
  await act(async () => { await s.hook.result.current.reload() })
  expect(s.reload).toHaveBeenCalledTimes(2)
  expect(s.hook.result.current.stale).toBe(false)
})

it('다른 대상이나 운영자 조치 같은 다른 분류의 알림으로는 다시 불러오지 않는다', async () => {
  const s = await setup([aiTool(T0)])
  s.notices.items = [aiTool(T2, { kind: 'result' }), aiTool(T2, { targetId: 'other' }), aiTool(T2, { targetType: 'world' }), aiTool(T0)]
  await s.signal()
  expect(s.reload).not.toHaveBeenCalled()
  expect(s.hook.result.current.stale).toBe(false)
})

it('알림 조회가 실패하면 화면 오류로 만들지 않고 다음 신호에서 이어 간다', async () => {
  const s = await setup([aiTool(T0)])
  s.listNotifications.mockRejectedValueOnce(new Error('network'))
  await s.signal()
  expect(s.reload).not.toHaveBeenCalled()
  expect(s.hook.result.current.stale).toBe(false)
  s.notices.items = [aiTool(T1), aiTool(T0)]
  await s.signal()
  expect(s.reload).toHaveBeenCalledTimes(1)
})

it('로그아웃하면 진행 중인 알림 조회를 취소하고 늦게 온 응답으로는 다시 불러오지 않는다', async () => {
  const s = await setup([aiTool(T0)])
  const late = deferred<NotificationPage>()
  let requestSignal: AbortSignal | undefined
  s.listNotifications.mockImplementationOnce((_cursor, signal) => { requestSignal = signal; return late.promise })
  act(() => { s.store.dispatch(sessionActions.noticeSignal()) })
  await waitFor(() => expect(requestSignal).toBeDefined())
  act(() => { s.store.dispatch(sessionActions.logout()) })
  expect(requestSignal?.aborted).toBe(true)
  await act(async () => { late.resolve({ items: [aiTool(T1)], nextCursor: null }) })
  await settle()
  expect(s.reload).not.toHaveBeenCalled()
})

it('화면을 떠나면 진행 중인 알림 조회를 취소한다', async () => {
  const s = await setup([])
  let requestSignal: AbortSignal | undefined
  s.listNotifications.mockImplementationOnce((_cursor, signal) => { requestSignal = signal; return new Promise<NotificationPage>(() => {}) })
  act(() => { s.store.dispatch(sessionActions.noticeSignal()) })
  await waitFor(() => expect(requestSignal).toBeDefined())
  s.hook.unmount()
  expect(requestSignal?.aborted).toBe(true)
})

it('대상이 바뀌면 그 대상의 처음 읽은 값이 새 기준선이라 옛 알림으로는 다시 불러오지 않고, 배너도 지운다', async () => {
  const s = await setup([aiTool(T0), aiTool(T2, { targetId: 'w2' })])
  s.hook.rerender({ targetId: 'w1', dirty: true })
  s.notices.items = [aiTool(T1), aiTool(T2, { targetId: 'w2' }), aiTool(T0)]
  await s.signal()
  expect(s.hook.result.current.stale).toBe(true)
  s.hook.rerender({ targetId: 'w2', dirty: false })
  await settle()
  expect(s.hook.result.current.stale).toBe(false)
  expect(s.reload).not.toHaveBeenCalled()
  s.notices.items = [aiTool('2026-11-19T03:01:00Z', { targetId: 'w2' }), aiTool(T2, { targetId: 'w2' }), aiTool(T1), aiTool(T0)]
  await s.signal()
  expect(s.reload).toHaveBeenCalledTimes(1)
})

it('다시 불러오는 동안 또 바뀌면 끝난 뒤 한 번 더 불러온다(연속 저장의 마지막 값을 놓치지 않는다)', async () => {
  const s = await setup([])
  const first = deferred<boolean>()
  s.reload.mockImplementationOnce(() => first.promise)
  s.notices.items = [aiTool(T1)]
  await s.signal()
  expect(s.reload).toHaveBeenCalledTimes(1)
  s.notices.items = [aiTool(T2), aiTool(T1)]
  await s.signal()
  expect(s.reload).toHaveBeenCalledTimes(1) // 아직 읽는 중이라 끝나기를 기다린다
  await act(async () => { first.resolve(true) })
  await settle()
  expect(s.reload).toHaveBeenCalledTimes(2)
  expect(s.hook.result.current.stale).toBe(false)
})
