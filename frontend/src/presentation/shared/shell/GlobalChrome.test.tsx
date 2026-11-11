// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { Link, MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import { scrollToSpy } from '../../../test/scrollToSpy'
import { GlobalChrome } from './GlobalChrome'
import { ThemeButton } from './ThemeButton'

function renderChrome(path = '/', theme?: 'light' | 'dark', ui: Parameters<typeof createAppStore>[1] = {}) {
  const store = createAppStore({}, { theme: theme ?? null, ...ui })
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

it('경로와 검색 조건이 바뀌면 맨 위로 이동하고 해시만 바뀌면 유지한다', () => {
  render(<Provider store={createAppStore()}><MemoryRouter initialEntries={['/search?q=old']} useTransitions={false}>
    <GlobalChrome />
    <Link to="/search?q=new">검색 조건 변경</Link>
    <Link to="/rank?q=new">경로 변경</Link>
    <Link to="/rank?q=new#weekly">해시 변경</Link>
  </MemoryRouter></Provider>)
  expect(scrollToSpy).toHaveBeenCalledExactlyOnceWith({ top: 0 })
  fireEvent.click(screen.getByRole('link', { name: '검색 조건 변경' }))
  expect(scrollToSpy).toHaveBeenCalledTimes(2)
  expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0 })
  fireEvent.click(screen.getByRole('link', { name: '경로 변경' }))
  expect(scrollToSpy).toHaveBeenCalledTimes(3)
  expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0 })
  fireEvent.click(screen.getByRole('link', { name: '해시 변경' }))
  expect(scrollToSpy).toHaveBeenCalledTimes(3)
})

it('운영 화면에는 화면 ID 표시·토글 없이 테마 전환을 제공한다', () => {
  vi.stubEnv('DEV', false)
  const { store } = renderChrome('/', 'light')
  expect(document.getElementById('sid')).toBeNull()
  expect(screen.queryByRole('button', { name: /화면 ID/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다크 모드로' }))
  expect(store.getState().ui.theme).toBe('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(screen.getByRole('button', { name: '라이트 모드로' })).toBeTruthy()
})

it('개발 화면의 화면 ID 표시·토글을 보존하고 숨긴 맨 위로 버튼은 Tab 대상에서 제외한다', () => {
  vi.stubEnv('DEV', true)
  vi.stubGlobal('scrollY', 0)
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
  expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
  vi.stubGlobal('scrollY', 0)
  fireEvent.scroll(window)
  expect(screen.queryByRole('button', { name: '맨 위로' })).toBeNull()
})

it('줄어든 모션 설정에서 맨 위로 이동은 애니메이션을 요청하지 않는다', () => {
  vi.stubGlobal('scrollY', 0)
  vi.stubGlobal('matchMedia', vi.fn((query: string) => Object.assign(new EventTarget(), { matches: query === '(prefers-reduced-motion: reduce)' })))
  renderChrome()
  vi.stubGlobal('scrollY', 700)
  fireEvent.scroll(window)
  fireEvent.click(screen.getByRole('button', { name: '맨 위로' }))
  expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' })
})

it.each([false, true])('맨 위로 이동 중에는 버튼을 숨기기 전에 포커스를 해제한다 (모션 줄이기: %s)', (reduced) => {
  vi.stubGlobal('scrollY', 700)
  vi.stubGlobal('matchMedia', vi.fn((query: string) => Object.assign(new EventTarget(), { matches: reduced && query === '(prefers-reduced-motion: reduce)' })))
  renderChrome()
  const top = screen.getByRole('button', { name: '맨 위로' })
  act(() => top.focus())
  const blur = vi.fn(() => expect(top.hidden).toBe(false))
  top.addEventListener('blur', blur)
  fireEvent.click(top)
  expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  vi.stubGlobal('scrollY', 600)
  fireEvent.scroll(window)
  expect(blur).toHaveBeenCalledOnce()
  expect(document.activeElement).not.toBe(top)
  expect(top.hidden).toBe(true)
  expect(top.tabIndex).toBe(-1)
})

it('맨 위로 버튼을 숨겨도 다른 컨트롤의 키보드 포커스는 유지한다', () => {
  vi.stubGlobal('scrollY', 700)
  renderChrome('/', 'light')
  const theme = screen.getByRole('button', { name: '다크 모드로' })
  act(() => theme.focus())
  vi.stubGlobal('scrollY', 600)
  fireEvent.scroll(window)
  expect(document.activeElement).toBe(theme)
  expect(screen.queryByRole('button', { name: '맨 위로' })).toBeNull()
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
  expect(store.getState().ui.theme).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(remove).toHaveBeenCalledWith('change', add.mock.calls[0][1])
  act(() => { media.matches = false; media.dispatchEvent(new Event('change')); media.matches = true; media.dispatchEvent(new Event('change')) })
  expect(screen.getByRole('button', { name: '다크 모드로' })).toBeTruthy()
  expect(store.getState().ui.theme).toBe('light')
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

const STUDIO = '/studio/6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'

it('집필실(U13)에서는 오른쪽 아래 화면 ID·테마 버튼을 숨기고 화면 ID 표시줄은 그대로 둔다', () => {
  vi.stubEnv('DEV', true)
  renderChrome(STUDIO, 'light', { screen: { base: 'U13', sheet: null } })
  expect(document.querySelector('.screen-controls')).toBeNull()
  expect(screen.queryByRole('button', { name: /화면 ID/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /모드로/ })).toBeNull()
  expect(document.getElementById('sid')!.hidden).toBe(false)
})

it.each([
  ['집필실 화면 ID가 남아 있어도 스튜디오가 아닌 경로', '/lib?tab=write', 'U13'],
  ['스튜디오 경로의 다른 화면(플롯)', `${STUDIO}?view=narrative`, 'U40'],
  ['데모 집필실', '/studio/starlight', 'U17'],
])('%s에서는 떠 있는 버튼을 그대로 둔다', (_name, path, base) => {
  vi.stubEnv('DEV', true)
  renderChrome(path, 'light', { screen: { base, sheet: null } })
  expect(screen.getByRole('button', { name: '화면 ID 끄기' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '다크 모드로' })).toBeTruthy()
})
