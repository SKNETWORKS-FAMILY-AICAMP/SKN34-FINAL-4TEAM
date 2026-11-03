// @vitest-environment jsdom
import './testLocks'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { createAppStore } from './app/store'
import { LoginPage } from './presentation/features/auth/view/LoginPage'
import { RequireRole } from './presentation/shared/session/RequireRole'
import { renderApp } from './test/renderApp'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf' }))
    if (path.endsWith('/refresh')) return new Response(null, { status: 401 })
    if (path.endsWith('/logout')) return new Response(null, { status: 204 })
    const { email } = JSON.parse(String(options?.body))
    return new Response(JSON.stringify({ accessToken: 'token', user: { id: '1', email, nickname: '독자', operator: email.startsWith('admin@') } }))
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function submitLogin(email: string) {
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
}

const Where = () => <p data-testid="where">{useLocation().pathname}</p>

function renderGuarded(path: string, store = createAppStore()) {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/lib" element={<RequireRole><Where /></RequireRole>} />
          <Route path="/read/:id/:n" element={<RequireRole><Where /></RequireRole>} />
          <Route path="/admin" element={<RequireRole admin><Where /></RequireRole>} />
          <Route path="/" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
  return store
}

describe('로그인·라우트 보호 (L01, 목업 render() 보호 목록)', () => {
  it('초기 세션 복원이 실패하면 이전 사용자 세션을 해제한다', async () => {
    const store = createAppStore({ role: 'user' })
    render(<Provider store={store}><MemoryRouter><App /></MemoryRouter></Provider>)
    await waitFor(() => expect(store.getState().session.role).toBeNull())
  })

  it('비로그인 사용자를 경로별 안내와 함께 로그인으로 보내고, 로그인 후 원래 경로로 돌려보낸다', async () => {
    const store = renderGuarded('/lib?tab=write')
    await screen.findByText('내 서재는 로그인 후 볼 수 있어요.')
    expect(store.getState().session.next).toBe('/lib?tab=write')
    submitLogin('reader@example.com')
    expect(await screen.findByTestId('where')).toHaveProperty('textContent', '/lib')
    expect(store.getState().session).toMatchObject({ role: 'user', next: null, loginMsg: '' })
  })

  it('회차 뷰어는 읽기 안내를, 관리자 화면은 관리자 로그인을 요구한다', async () => {
    renderGuarded('/read/guunmong/1')
    await screen.findByText('소설을 읽으려면 로그인해 주세요.')
    cleanup()
    const store = renderGuarded('/admin', createAppStore({ role: 'user' }))
    await screen.findByText('관리자 화면은 관리자 계정으로 로그인해야 볼 수 있어요.')
    expect(screen.queryByRole('button', { name: '관리자 데모' })).toBeNull()
    submitLogin('admin@example.com')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin'))
    expect(store.getState().session.role).toBe('admin')
  })

  it('로그인 폼은 빈 값과 잘못된 이메일을 거부하고 올바르면 이메일을 기록한다', async () => {
    const store = renderGuarded('/login')
    const submit = screen.getByRole('button', { name: '로그인' })
    fireEvent.click(submit)
    expect(store.getState().session.role).toBeNull()
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'nope' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } })
    fireEvent.click(submit)
    expect(store.getState().session.role).toBeNull()
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'me@storyfork.demo' } })
    fireEvent.click(submit)
    await waitFor(() => expect(store.getState().session.role).toBe('user'))
    expect(store.getState().session.user.email).toBe('me@storyfork.demo')
    expect((await screen.findByTestId('where')).textContent).toBe('/')
  })

  it('로그인 실패를 표시하고 인증 상태를 만들지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
      ? new Response(JSON.stringify({ csrfToken: 'csrf' }))
      : new Response(null, { status: 401 })))
    const store = renderGuarded('/login')
    submitLogin('reader@example.com')
    expect((await screen.findByRole('alert')).textContent).toContain('로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.')
    expect(store.getState().session.role).toBeNull()
  })

  it.each(['busy', 'unavailable', 'failed'])('로그인 잠금 %s 실패는 자격 오류로 안내하지 않고 서버 요청을 보내지 않는다', async (reason) => {
    vi.stubGlobal('navigator', reason === 'unavailable' ? {} : { locks: {
      request: (_name: string, _options: object, callback: (lock: null) => unknown) => reason === 'busy'
        ? Promise.resolve(callback(null)) : Promise.reject(new Error('denied')),
    } })
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    const store = renderGuarded('/login')
    submitLogin('reader@example.com')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(reason === 'busy' ? '다른 탭' : '브라우저')
    expect(alert.textContent).not.toContain('이메일과 비밀번호')
    expect(mock).not.toHaveBeenCalled()
    expect(store.getState().session.role).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '로그인' }).disabled).toBe(false)
  })

  it.each(['network', '503'])('로그인 %s 실패는 비밀번호 오류로 단정하지 않는다', async (failure) => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'csrf' })
      if (failure === 'network') throw new TypeError('offline')
      return new Response(null, { status: 503 })
    }))
    const store = renderGuarded('/login')
    submitLogin('reader@example.com')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('잠시 후 다시 시도')
    expect(alert.textContent).not.toContain('이메일과 비밀번호')
    expect(store.getState().session.role).toBeNull()
  })

  it('로그인 실패 뒤 기존 가입 화면의 인증 메일 재발송으로 이동한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
    renderApp('/login')
    submitLogin('reader@example.com')
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('link', { name: '이메일 인증·확인 메일 재발송' }))
    expect(await screen.findByRole('heading', { name: '확인 메일 재발송', level: 1 })).toBeTruthy()
    expect(screen.getByRole('button', { name: '확인 메일 재발송' })).toBeTruthy()
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
  })

  it('로그인 응답이 늦게 도착해도 떠난 화면의 세션과 이동을 덮어쓰지 않는다', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    const mock = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : path.endsWith('/login') ? pending : new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', mock)
    const { store } = renderApp('/login')
    submitLogin('reader@example.com')
    await waitFor(() => expect(mock.mock.calls.some(([path]) => path.endsWith('/login'))).toBe(true))
    fireEvent.click(screen.getByRole('link', { name: '비밀번호 찾기' }))
    await screen.findByRole('heading', { name: '비밀번호 찾기' })
    await act(async () => { finish(Response.json({ accessToken: 'token', user: { id: '1', email: 'reader@example.com', nickname: '독자', operator: false } })) })
    expect(screen.getByRole('heading', { name: '비밀번호 찾기' })).toBeTruthy()
    expect(store.getState().session.role).toBeNull()
  })

  it('계정 메뉴에서 로그아웃하면 홈으로 가고 메뉴에 로그아웃이 다시 보이지 않는다 (목업 logout 케이스)', async () => {
    const { store } = renderApp('/', createAppStore({ role: 'user' }))
    fireEvent.click(screen.getByRole('button', { name: '내 계정 메뉴' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('reader@storyfork.demo')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: '로그아웃' }))
    await screen.findByText('로그아웃했어요')
    expect(store.getState().session.role).toBeNull()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '로그인·회원가입 메뉴' }))
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: '로그아웃' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('다른 탭의 계정으로 바뀐 로그아웃은 로컬 세션을 해제하고 만료를 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
      ? Response.json({ csrfToken: 'csrf' }) : new Response(null, { status: 409 })))
    const { store } = renderApp('/', createAppStore({ role: 'user' }))
    fireEvent.click(screen.getByRole('button', { name: '내 계정 메뉴' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '로그아웃' }))
    await screen.findByText('세션이 만료됐어요. 다시 로그인해 주세요.')
    expect(store.getState().session.role).toBeNull()
    expect(screen.queryByText('로그아웃했어요')).toBeNull()
  })

  it('보호 화면(/lib)에서 로그아웃해도 홈으로 가고 로그인 안내가 남지 않는다 (목업 logout)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf' }))
      if (path.endsWith('/refresh')) return new Response(JSON.stringify({ accessToken: 'token', user: { id: '1', email: 'reader@storyfork.demo', nickname: '독자', operator: false } }))
      return new Response(null, { status: 204 })
    }))
    const store = createAppStore({ role: 'user' })
    render(<Provider store={store}><MemoryRouter initialEntries={['/lib']} useTransitions={false}><App /><Where /></MemoryRouter></Provider>)
    fireEvent.click(await screen.findByRole('button', { name: '내 계정 메뉴' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '로그아웃' }))
    await screen.findByText('로그아웃했어요')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'))
    expect(store.getState().session).toMatchObject({ role: null, next: null, loginMsg: '' })
  })
})

it.each([
  ['/login', '로그인'],
  ['/me/signup', '회원가입'],
  ['/auth/resend-verification', '확인 메일 재발송'],
  ['/auth/forgot-password', '비밀번호 찾기'],
  ['/auth/reset-password', '비밀번호 재설정'],
  ['/auth/verify-email', '이메일 확인'],
  ['/auth/verify-email-change', '이메일 변경 확인'],
])('인증 경로 %s는 같은 브랜드·주요 제목·일반 흐름 테마를 제공한다', (path, title) => {
  const { container } = renderApp(path)
  expect(screen.getByRole('main').contains(screen.getByRole('heading', { name: title, level: 1 }))).toBe(true)
  expect(screen.getByRole('link', { name: /STORYFORK/ }).getAttribute('href')).toBe('/')
  expect(screen.getByRole('link', { name: '홈으로' }).getAttribute('href')).toBe('/')
  expect(container.querySelector('.lg-card')?.contains(screen.getByRole('button', { name: /모드로/ }))).toBe(true)
  expect(container.querySelector('.meg')).toBeNull()
  expect(container.querySelector('.gnb')).toBeNull()
})

it.each(['unavailable', 'failed'])('초기 인증 잠금 %s 오류를 안내한다', async (reason) => {
  vi.stubGlobal('navigator', reason === 'unavailable' ? {} : { locks: { request: () => Promise.reject(new Error('denied')) } })
  render(<Provider store={createAppStore()}><MemoryRouter><App /></MemoryRouter></Provider>)
  expect((await screen.findByRole('alert')).textContent).toContain('브라우저')
})
