// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import type { StreamOptions } from '../../../data/api/notificationStream'
import { sessionActions } from '../session/sessionSlice'
import { useNotificationStream } from './useNotificationStream'

const opened: { options: StreamOptions; close: ReturnType<typeof vi.fn> }[] = []
vi.mock('../../../data/api/notificationStream', () => ({
  openNotificationStream: (options: StreamOptions) => { const close = vi.fn(); opened.push({ options, close }); return close },
}))

function Probe() { useNotificationStream(); return null }
const setup = () => {
  const store = createAppStore()
  render(<Provider store={store}><Probe /></Provider>)
  return store
}
const user = (email: string) => ({ id: email, email, nickname: 'U', operator: false })

afterEach(() => { cleanup(); opened.length = 0 })

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
