// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import { GlobalChrome } from './GlobalChrome'
import { ThemeButton } from './ThemeButton'

function renderChrome(path = '/', theme?: 'light' | 'dark') {
  const store = createAppStore({ theme: theme ?? null })
  const view = render(<Provider store={store}><MemoryRouter initialEntries={[path]}><GlobalChrome /></MemoryRouter></Provider>)
  return { store, ...view }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete document.documentElement.dataset.theme })

it.each(['/login', '/me', '/me/signup', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email', '/auth/verify-email-change', '/auth/resend-verification', '/me/profile', '/me/notice'])('%s에는 입력을 가리는 고정 개발 도구가 없다', (path) => {
  vi.stubEnv('DEV', true)
  renderChrome(path)
  expect(document.querySelector('.screen-controls')).toBeNull()
  expect(document.getElementById('sid')).toBeNull()
})

it('운영 화면에는 화면 ID 표시·토글 없이 테마 전환을 제공한다', () => {
  vi.stubEnv('DEV', false)
  const { store } = renderChrome('/', 'light')
  expect(document.getElementById('sid')).toBeNull()
  expect(screen.queryByRole('button', { name: /화면 ID/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다크 모드로' }))
  expect(store.getState().session.theme).toBe('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(screen.getByRole('button', { name: '라이트 모드로' })).toBeTruthy()
})

it('개발 화면의 화면 ID 표시·토글을 보존하고 숨긴 맨 위로 버튼은 Tab 대상에서 제외한다', () => {
  vi.stubEnv('DEV', true)
  vi.stubGlobal('scrollY', 0)
  const scroll = vi.fn()
  vi.stubGlobal('scrollTo', scroll)
  renderChrome()
  expect(document.getElementById('sid')!.hidden).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '화면 ID 끄기' }))
  expect(document.getElementById('sid')!.hidden).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '화면 ID 켜기' }))
  expect(document.getElementById('sid')!.hidden).toBe(false)
  expect(screen.queryByRole('button', { name: '맨 위로' })).toBeNull()
  const top = document.getElementById('top')!
  expect(top.hidden || top.tabIndex === -1).toBe(true)
  vi.stubGlobal('scrollY', 700)
  fireEvent.scroll(window)
  fireEvent.click(screen.getByRole('button', { name: '맨 위로' }))
  expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
  vi.stubGlobal('scrollY', 0)
  fireEvent.scroll(window)
  expect(screen.queryByRole('button', { name: '맨 위로' })).toBeNull()
})

it('줄어든 모션 설정에서 맨 위로 이동은 애니메이션을 요청하지 않는다', () => {
  vi.stubGlobal('scrollY', 0)
  vi.stubGlobal('matchMedia', vi.fn((query: string) => Object.assign(new EventTarget(), { matches: query === '(prefers-reduced-motion: reduce)' })))
  const scroll = vi.fn()
  vi.stubGlobal('scrollTo', scroll)
  renderChrome()
  vi.stubGlobal('scrollY', 700)
  fireEvent.scroll(window)
  fireEvent.click(screen.getByRole('button', { name: '맨 위로' }))
  expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' })
})

it('OS 테마를 구독해 버튼을 동기화하고 수동 선택 뒤에는 구독을 정리한다', () => {
  const media = Object.assign(new EventTarget(), { matches: false })
  const add = vi.spyOn(media, 'addEventListener')
  const remove = vi.spyOn(media, 'removeEventListener')
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  const { store, unmount } = renderChrome()
  expect(screen.getByRole('button', { name: '다크 모드로' })).toBeTruthy()
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')) })
  fireEvent.click(screen.getByRole('button', { name: '라이트 모드로' }))
  expect(store.getState().session.theme).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(remove).toHaveBeenCalledWith('change', add.mock.calls[0][1])
  act(() => { media.matches = false; media.dispatchEvent(new Event('change')); media.matches = true; media.dispatchEvent(new Event('change')) })
  expect(screen.getByRole('button', { name: '다크 모드로' })).toBeTruthy()
  expect(store.getState().session.theme).toBe('light')
  unmount()
})

it('수동 테마는 OS보다 우선하며 자동 테마 구독은 unmount에서 정리한다', () => {
  const media = Object.assign(new EventTarget(), { matches: true })
  const add = vi.spyOn(media, 'addEventListener')
  const remove = vi.spyOn(media, 'removeEventListener')
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  const { unmount } = renderChrome('/', 'light')
  expect(screen.getByRole('button', { name: '다크 모드로' })).toBeTruthy()
  expect(add).not.toHaveBeenCalled()
  unmount()
  const view = render(<Provider store={createAppStore()}><ThemeButton /></Provider>)
  expect(screen.getByRole('button', { name: '라이트 모드로' })).toBeTruthy()
  view.unmount()
  expect(remove).toHaveBeenCalledWith('change', add.mock.calls[0][1])
})
