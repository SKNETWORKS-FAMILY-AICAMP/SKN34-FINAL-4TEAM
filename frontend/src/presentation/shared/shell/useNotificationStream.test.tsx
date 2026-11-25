// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import type { NotificationStreamOptions, OpenNotificationStream } from '../../../domain/entities/notificationStream'
import { sessionActions } from '../session/sessionSlice'
import { useNotificationStream } from './useNotificationStream'

const opened: { options: NotificationStreamOptions; close: ReturnType<typeof vi.fn> }[] = []
const openStream: OpenNotificationStream = (options) => {
  const close = vi.fn()
  opened.push({ options, close })
  return close
}

function Probe() { useNotificationStream(openStream); return null }
const setup = () => {
  const store = createAppStore()
  render(<Provider store={store}><Probe /></Provider>)
  return store
}
const user = (email: string) => ({ id: email, email, nickname: 'U', operator: false })

let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
const setVisibility = (next: DocumentVisibilityState) => act(() => { visibility = next; document.dispatchEvent(new Event('visibilitychange')) })
const live = () => opened.filter((o) => o.close.mock.calls.length === 0)

afterEach(() => { cleanup(); opened.length = 0; visibility = 'visible' })

it('로그인하지 않았으면 연결하지 않는다', () => {
  setup()
  expect(opened).toHaveLength(0)
})

it('로그인하면 연결하고, 신호를 받으면 noticeVersion과 연결 상태를 갱신한다', () => {
  const store = setup()
  act(() => { store.dispatch(sessionActions.login(user('a@example.invalid'))) })
  expect(opened).toHaveLength(1)
  const before = store.getState().session.noticeVersion
  act(() => { opened[0].options.onState('live'); opened[0].options.onSignal() })
  expect(store.getState().session.noticeStream).toBe('live')
  expect(store.getState().session.noticeVersion).toBe(before + 1)
})

it('로그아웃하면 연결을 닫고 상태를 비우며 이전 사용자의 배지를 다시 조회하게 한다', () => {
  const store = setup()
  act(() => { store.dispatch(sessionActions.login(user('a@example.invalid'))) })
  const before = store.getState().session.noticeVersion
  act(() => { store.dispatch(sessionActions.logout()) })
  expect(opened[0].close).toHaveBeenCalledTimes(1)
  expect(store.getState().session.noticeStream).toBe('off')
  expect(store.getState().session.noticeVersion).toBeGreaterThan(before)
  expect(opened).toHaveLength(1)
})

it('계정을 바꾸면 이전 연결을 닫고 새 연결을 연다', () => {
  const store = setup()
  act(() => { store.dispatch(sessionActions.login(user('a@example.invalid'))) })
  act(() => { store.dispatch(sessionActions.login(user('b@example.invalid'))) })
  expect(opened).toHaveLength(2)
  expect(opened[0].close).toHaveBeenCalledTimes(1)
  expect(opened[1].close).not.toHaveBeenCalled()
})

// #738 숨긴 탭은 알림 연결을 놓는다
it('탭을 숨기면 연결을 닫고, 숨긴 것만으로는 배지를 다시 조회하지 않는다', () => {
  const store = setup()
  act(() => { store.dispatch(sessionActions.login(user('a@example.invalid'))) })
  const before = store.getState().session.noticeVersion
  setVisibility('hidden')
  expect(opened[0].close).toHaveBeenCalledTimes(1)
  expect(store.getState().session.noticeStream).toBe('off')
  expect(store.getState().session.noticeVersion).toBe(before)
})

it('숨긴 탭이 다시 보이면 새로 연결한다(서버 ready 신호로 그 사이 알림을 다시 조회한다)', () => {
  const store = setup()
  act(() => { store.dispatch(sessionActions.login(user('a@example.invalid'))) })
  setVisibility('hidden')
  setVisibility('visible')
  expect(opened).toHaveLength(2)
  expect(live()).toHaveLength(1)
  const before = store.getState().session.noticeVersion
  act(() => { opened[1].options.onState('live'); opened[1].options.onSignal() })
  expect(store.getState().session.noticeVersion).toBe(before + 1)
})

it('숨겼다가 다시 보이면 새 연결이 신호를 보내기 전에도 배지를 한 번 다시 조회한다', () => {
  const store = setup()
  act(() => { store.dispatch(sessionActions.login(user('a@example.invalid'))) })
  setVisibility('hidden')
  const before = store.getState().session.noticeVersion
  setVisibility('visible')
  expect(store.getState().session.noticeVersion).toBe(before + 1)
})

it('숨긴 상태로 로그인하면 보일 때까지 연결하지 않는다', () => {
  setVisibility('hidden')
  const store = setup()
  act(() => { store.dispatch(sessionActions.login(user('a@example.invalid'))) })
  expect(opened).toHaveLength(0)
  setVisibility('visible')
  expect(opened).toHaveLength(1)
})

it('숨김·보임을 여러 번 오가도 열린 연결은 하나를 넘지 않는다', () => {
  const store = setup()
  act(() => { store.dispatch(sessionActions.login(user('a@example.invalid'))) })
  for (let i = 0; i < 5; i++) { setVisibility('hidden'); setVisibility('visible') }
  expect(live()).toHaveLength(1)
  setVisibility('hidden')
  expect(live()).toHaveLength(0)
})

it('숨긴 동안 로그아웃하면 이전 사용자의 배지를 다시 조회하게 하고, 다시 보여도 연결하지 않는다', () => {
  const store = setup()
  act(() => { store.dispatch(sessionActions.login(user('a@example.invalid'))) })
  setVisibility('hidden')
  const before = store.getState().session.noticeVersion
  act(() => { store.dispatch(sessionActions.logout()) })
  expect(store.getState().session.noticeVersion).toBeGreaterThan(before)
  const afterLogout = store.getState().session.noticeVersion
  setVisibility('visible')
  expect(opened).toHaveLength(1)
  expect(store.getState().session.noticeVersion).toBe(afterLogout)
})
