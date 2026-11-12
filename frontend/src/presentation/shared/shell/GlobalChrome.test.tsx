// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { Link, MemoryRouter, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import { scrollToSpy } from '../../../test/scrollToSpy'
import { toast } from '../events'
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

const Back = () => { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(-1)}>뒤로</button> }

it('다른 화면으로 넘어갈 때(경로가 바뀌는 이동)만 맨 위로 올리고, 같은 화면의 탭·필터(쿼리)·해시 변경과 뒤로 가기는 보던 위치를 건드리지 않는다', () => {
  const progress = vi.fn()
  window.addEventListener('sf-progress', progress)
  render(<Provider store={createAppStore()}><MemoryRouter initialEntries={['/lib?tab=read']} useTransitions={false}>
    <GlobalChrome />
    <Link to="/lib?tab=write">검색 조건 변경</Link>
    <Link to="/rank?q=new">경로 변경</Link>
    <Link to="/rank?q=new#weekly">해시 변경</Link>
    <Link to="/worlds" replace>대체 이동</Link>
    <Back />
  </MemoryRouter></Provider>)
  // 처음 들어온 화면(새로 고침 포함)은 브라우저가 정한 위치 그대로다.
  expect(scrollToSpy).not.toHaveBeenCalled()
  // 같은 화면의 탭·필터(쿼리): 이동 바는 보이지만 스크롤은 그대로다.
  progress.mockClear()
  fireEvent.click(screen.getByRole('link', { name: '검색 조건 변경' }))
  expect(progress).toHaveBeenCalledOnce()
  expect(scrollToSpy).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('link', { name: '경로 변경' }))
  expect(scrollToSpy).toHaveBeenCalledExactlyOnceWith({ top: 0 })
  fireEvent.click(screen.getByRole('link', { name: '해시 변경' }))
  expect(scrollToSpy).toHaveBeenCalledTimes(1)
  // 뒤로 가기(POP): 해시만 되돌아가는 이동도, 경로가 바뀌는 이동도 브라우저의 위치 복원에 맡긴다.
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
  expect(scrollToSpy).toHaveBeenCalledTimes(1)
  // 경로가 바뀌는 대체 이동(리다이렉트)은 새 화면이므로 맨 위에서 시작한다.
  fireEvent.click(screen.getByRole('link', { name: '대체 이동' }))
  expect(scrollToSpy).toHaveBeenCalledTimes(2)
  expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0 })
  window.removeEventListener('sf-progress', progress)
})

it('같은 경로라도 화면 내용이 통째로 바뀌는 쿼리(관리자 탭·공지·이벤트 글·작품 관리의 작품·검색어)가 바뀌면 맨 위로 올린다', () => {
  render(<Provider store={createAppStore()}><MemoryRouter initialEntries={['/admin?tab=users']} useTransitions={false}>
    <GlobalChrome />
    <Link to="/admin?tab=users&page=2">같은 탭의 다른 쿼리</Link>
    <Link to="/admin?tab=ai">관리자 탭</Link>
    <Link to="/me/notice">공지 목록</Link>
    <Link to="/me/notice?id=n-1">공지 글</Link>
    <Link to="/me/event?id=e-1">이벤트 글</Link>
    <Link to="/content?work=w-1">작품 관리</Link>
    <Link to="/content?work=w-2">다른 작품</Link>
    <Link to="/search?q=달">검색</Link>
    <Link to="/search?q=달&sort=popular">검색 정렬</Link>
    <Link to="/search?q=별&sort=popular">다시 검색</Link>
    <Back />
  </MemoryRouter></Provider>)
  const go = (name: string) => fireEvent.click(screen.getByRole('link', { name }))
  go('같은 탭의 다른 쿼리')
  expect(scrollToSpy).not.toHaveBeenCalled()
  go('관리자 탭')
  expect(scrollToSpy).toHaveBeenCalledTimes(1)
  go('공지 목록') // 경로가 바뀐다
  go('공지 글')
  go('이벤트 글')
  go('작품 관리')
  go('다른 작품')
  go('검색')
  expect(scrollToSpy).toHaveBeenCalledTimes(7)
  go('검색 정렬') // 정렬·필터는 같은 결과 화면이다
  expect(scrollToSpy).toHaveBeenCalledTimes(7)
  go('다시 검색')
  expect(scrollToSpy).toHaveBeenCalledTimes(8)
  expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0 })
  // 뒤로 가기로 검색어가 되돌아가도 브라우저의 위치 복원에 맡긴다.
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
  expect(scrollToSpy).toHaveBeenCalledTimes(8)
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
  ['더보기 메뉴가 없는 데모 집필실의 U13 안내 화면', '/studio/starlight', 'U13'],
])('%s에서는 떠 있는 버튼을 그대로 둔다', (_name, path, base) => {
  vi.stubEnv('DEV', true)
  renderChrome(path, 'light', { screen: { base, sheet: null } })
  expect(screen.getByRole('button', { name: '화면 ID 끄기' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '다크 모드로' })).toBeTruthy()
})

const toastNode = () => document.getElementById('toast')!

it('토스트는 role=status 노드 하나를 계속 쓰고 글자만 바꾼다 — 알림마다 노드를 갈아 끼우면 보조기기가 새 알림을 놓칠 수 있다', () => {
  renderChrome()
  const node = toastNode()
  expect([node.getAttribute('role'), node.hidden, node.textContent]).toEqual(['status', true, ''])
  act(() => { toast('다크 모드로 바꿨어요') })
  expect(toastNode()).toBe(node)
  expect([node.hidden, node.textContent]).toEqual([false, '다크 모드로 바꿨어요'])
  act(() => { toast('라이트 모드로 바꿨어요') })
  expect(toastNode()).toBe(node)
  expect([node.hidden, node.textContent]).toEqual([false, '라이트 모드로 바꿨어요'])
})

it('떠 있는 토스트의 글자가 바뀌면 같은 노드에서 등장 애니메이션만 다시 돌린다', () => {
  renderChrome()
  const animation = { cancel: vi.fn(), play: vi.fn() }
  toastNode().getAnimations = () => [animation as unknown as Animation]
  act(() => { toast('첫 알림') })
  act(() => { toast('둘째 알림') })
  expect(animation.cancel).toHaveBeenCalledTimes(2)
  expect(animation.play).toHaveBeenCalledTimes(2)
})

it('같은 문구의 알림이 다시 오면 한 번 비웠다가 다시 넣어 보조기기가 또 읽게 하고, 머무는 시간은 다시 넣은 때부터 잰다', () => {
  vi.useFakeTimers()
  try {
    renderChrome()
    act(() => { toast('저장했어요') })
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => { toast('저장했어요') })
    // 글자가 그대로면 라이브 영역이 다시 읽히지 않으므로 먼저 비운다.
    expect([toastNode().hidden, toastNode().textContent]).toEqual([true, ''])
    act(() => { vi.advanceTimersByTime(50) })
    expect([toastNode().hidden, toastNode().textContent]).toEqual([false, '저장했어요'])
    act(() => { vi.advanceTimersByTime(2599) })
    expect(toastNode().hidden).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect([toastNode().hidden, toastNode().textContent]).toEqual([true, ''])
  } finally { vi.useRealTimers() }
})

it('토스트는 글자 수에 비례한 시간만큼 머문 뒤 비우고, 그 사이 새 알림이 오면 시간을 새로 잰다', () => {
  vi.useFakeTimers()
  try {
    renderChrome()
    const long = '가'.repeat(60) // 5.8초
    act(() => { toast('짧은 알림') })
    act(() => { vi.advanceTimersByTime(2000) })
    act(() => { toast(long) })
    // 앞 알림의 2.6초가 지나도 새 알림은 남아 있다.
    act(() => { vi.advanceTimersByTime(2600) })
    expect([toastNode().hidden, toastNode().textContent]).toEqual([false, long])
    act(() => { vi.advanceTimersByTime(3199) })
    expect(toastNode().hidden).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect([toastNode().hidden, toastNode().textContent]).toEqual([true, ''])
  } finally { vi.useRealTimers() }
})

it.each([[true, ''], [false, 'translateY(-6px) scale(1.0700)']])('동작 줄이기 설정이 %s이면 마우스 근처 카드(.prox)의 변형은 %j이다 — 줄이기 설정에서는 카드를 움직이지 않는다', (reduced, transform) => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => Object.assign(new EventTarget(), { matches: reduced && query === '(prefers-reduced-motion: reduce)' })))
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => { run(0); return 1 })
  const card = document.createElement('a')
  card.className = 'prox'
  card.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect
  document.body.append(card)
  try {
    renderChrome()
    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 })
    expect(card.style.transform).toBe(transform)
  } finally { card.remove() }
})
