// @vitest-environment jsdom
import '../fixtureApp'
import '../testLocks'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../App'
import { createAppStore } from '../../app/store'
import { LoginPage } from '../../presentation/features/auth/view/LoginPage'
import { RequireRole } from '../../presentation/shared/session/RequireRole'
import { renderApp } from '../renderApp'

vi.mock('../../presentation/features/worldstudio/view/WorldStudioPage', () => ({
  WorldStudioPage: () => {
    const { pathname, search } = useLocation()
    return <><h1>세계관 작업실</h1><p data-testid="world-location">{pathname + search}</p></>
  },
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf' }))
    if (path.endsWith('/refresh')) return new Response(null, { status: 401 })
    if (path.endsWith('/logout')) return new Response(null, { status: 204 })
    const { email } = JSON.parse(String(options?.body))
    return new Response(JSON.stringify({ accessToken: 'token', user: { id: '1', email, nickname: '독자', operator: email.startsWith('admin@') } }))
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

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

  it.each(['/worldstudio', '/worldstudio/owned-world?tab=cards'])('세계관 경로 %s는 로그인 후 원래 경로로 돌아간다', async (path) => {
    const { store } = renderApp(path)
    await screen.findByRole('heading', { name: '로그인', level: 1 })
    expect(screen.queryByRole('heading', { name: '세계관 작업실' })).toBeNull()
    expect(store.getState().session.next).toBe(path)
    submitLogin('reader@example.com')
    await screen.findByRole('heading', { name: '세계관 작업실' })
    expect(screen.getByTestId('world-location').textContent).toBe(path)
    expect(store.getState().session).toMatchObject({ role: 'user', next: null })
  })

  it.each(['/worldstudio', '/worldstudio/owned-world?tab=cards'])('세계관 경로 %s는 실제 세션 복원이 끝날 때까지 기다린다', async (path) => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/csrf')
      ? Response.json({ csrfToken: 'csrf' }) : pending))
    const { store } = renderApp(path)
    expect(screen.getByText('로그인 상태를 확인하고 있어요.').getAttribute('role')).toBe('status')
    expect(screen.queryByRole('heading', { name: '세계관 작업실' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '로그인', level: 1 })).toBeNull()
    expect(store.getState().session.next).toBeNull()
    await act(async () => { finish(Response.json({ accessToken: 'token', user: { id: '1', email: 'reader@example.com', nickname: '독자', operator: false } })) })
    await screen.findByRole('heading', { name: '세계관 작업실' })
    expect(screen.getByTestId('world-location').textContent).toBe(path)
    expect(store.getState().session).toMatchObject({ role: 'user', next: null, user: { email: 'reader@example.com' } })
  })

  it.each(['/worldstudio', '/worldstudio/owned-world?tab=cards'])('세계관 경로 %s의 복원 401은 기존 세션을 해제한다', async (path) => {
    const { store } = renderApp(path, createAppStore({ role: 'user' }))
    await screen.findByRole('heading', { name: '로그인', level: 1 })
    expect(store.getState().session).toMatchObject({ role: null, next: path })
    expect(screen.queryByRole('heading', { name: '세계관 작업실' })).toBeNull()
  })

  it('비로그인 사용자를 경로별 안내와 함께 로그인으로 보내고, 로그인 후 원래 경로로 돌려보낸다', async () => {
    const store = renderGuarded('/lib?tab=write')
    await screen.findByText('내 서재는 로그인 후 볼 수 있어요.')
    expect(store.getState().session.next).toBe('/lib?tab=write')
    submitLogin('reader@example.com')
    expect(await screen.findByTestId('where')).toHaveProperty('textContent', '/lib')
    expect(store.getState().session).toMatchObject({ role: 'user', next: null, loginMsg: '' })
  })

  it('회차 뷰어는 비회원에게도 열려 로그인 안내 없이 공개 회차를 보여 준다', async () => {
    // UC-01: 공개 회차 열람과 작품 탐색은 비회원도 할 수 있다. 서버(Content)도 공개 작품 GET을 익명으로 허용한다.
    for (const path of ['/read/guunmong/1', '/read/guunmong']) {
      const { store } = renderApp(path)
      await screen.findByRole('heading', { name: '연화봉의 젊은 승려' })
      expect(screen.queryByText('소설을 읽으려면 로그인해 주세요.')).toBeNull()
      expect(screen.queryByRole('heading', { name: '로그인', level: 1 })).toBeNull()
      expect(store.getState().session).toMatchObject({ role: null, next: null, loginMsg: '' })
      cleanup()
    }
  })

  it('목업 캐릭터챗 목록은 비회원에게도 열려 로그인 안내 없이 목록을 보여 준다', async () => {
    vi.stubEnv('MODE', 'mockup')
    const { store } = renderApp('/chat')
    await screen.findByRole('heading', { name: '캐릭터챗', level: 1 })
    await screen.findByRole('navigation', { name: '작품 유형' })
    expect(screen.getByRole('link', { name: /^성진 · / })).toBeTruthy()
    expect(store.getState().session).toMatchObject({ role: null, next: null, loginMsg: '' })
  })

  it.each(['/chat/guunmong/' + encodeURIComponent('성진'), '/chat/guunmong'])('목업 캐릭터챗 대화방 %s는 비회원을 안내와 함께 로그인으로 보내고, 로그인 뒤 그 대화방으로 돌려보낸다', async (path) => {
    vi.stubEnv('MODE', 'mockup')
    const { store } = renderApp(path)
    await screen.findByRole('heading', { name: '로그인', level: 1 })
    expect(screen.getByText('캐릭터챗은 로그인 후 이용할 수 있어요.')).toBeTruthy()
    expect(store.getState().session.next).toBe(path)
    submitLogin('reader@example.com')
    await screen.findByRole('log', { name: /대화 기록/ })
    expect(store.getState().session).toMatchObject({ role: 'user', next: null })
  })

  it('관리자 화면은 관리자 로그인을 요구한다', async () => {
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

// ── #620: 없는 주소의 404 화면과 로그인 상태의 /login·/me/signup ─────────────────────────────

const member = { id: '1', email: 'reader@example.com', nickname: '독자', operator: false }

/** 세션 복원(/refresh)이 이 회원으로 끝나는 서버. 그 밖의 요청은 내용 없는 성공이다. */
function restoreMember() {
  vi.stubGlobal('fetch', vi.fn(async (path: string) =>
    path.endsWith('/csrf') ? Response.json({ csrfToken: 'csrf' })
      : path.endsWith('/refresh') ? Response.json({ accessToken: 'token', user: member })
        : new Response(null, { status: 204 })))
}

/** 앱 전체(App)와 현재 주소 표시. */
function renderAppAt(path: string, store = createAppStore()) {
  render(<Provider store={store}><MemoryRouter initialEntries={[path]} useTransitions={false}><App /><Where /></MemoryRouter></Provider>)
  return store
}

describe('알 수 없는 주소 (#620)', () => {
  it('없는 주소는 홈으로 보내지 않고 주소를 그대로 둔 채 404 화면을 보여 준다', async () => {
    const path = '/no-such-page'
    renderAppAt(path)
    await screen.findByRole('heading', { name: '페이지를 찾을 수 없어요', level: 1 })
    expect(screen.getByText('주소가 바뀌었거나 삭제된 페이지예요.')).toBeTruthy()
    expect(screen.getByRole('link', { name: '홈으로' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: '작품 둘러보기' }).getAttribute('href')).toBe('/search')
    expect(document.title).toBe('페이지를 찾을 수 없어요 · STORYFORK')
    expect(screen.getByTestId('where').textContent).toBe(path)
  })
})

describe('로그인한 채 /login·/me/signup (#620)', () => {
  it.each([['/login', '로그인'], ['/me/signup', '회원가입']])('로그인 상태로 %s에 들어오면 세션 복원이 끝난 뒤 메인(/)으로 보낸다', async (path, title) => {
    restoreMember()
    const store = renderAppAt(path)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'))
    expect(store.getState().session.role).toBe('user')
    expect(screen.queryByRole('heading', { name: title, level: 1 })).toBeNull()
  })

  it('세션 복원이 끝나기 전에는 Store에 남은 로그인 값만 보고 홈으로 보내지 않는다', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'csrf' }) : pending))
    renderAppAt('/login', createAppStore({ role: 'user' }))
    expect(screen.getByRole('heading', { name: '로그인', level: 1 })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/login')
    await act(async () => { finish(Response.json({ accessToken: 'token', user: member })) })
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'))
  })

  it('복원 결과가 비로그인이면 /login은 폼을 그대로 보이고 주소를 바꾸지 않는다', async () => {
    const store = renderAppAt('/login', createAppStore({ role: 'user' }))
    await waitFor(() => expect(store.getState().session.role).toBeNull())
    expect(screen.getByRole('heading', { name: '로그인', level: 1 })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/login')
  })

  it('보호 화면이 다른 계정의 로그인을 요구해 보낸 로그인 상태는 홈으로 돌리지 않고 폼을 보인다', async () => {
    restoreMember()
    const store = renderAppAt('/admin?tab=users')
    await screen.findByText('관리자 화면은 관리자 계정으로 로그인해야 볼 수 있어요.')
    expect(screen.getByRole('heading', { name: '로그인', level: 1 })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/login')
    expect(store.getState().session).toMatchObject({ role: 'user', next: '/admin?tab=users' })
  })

  it('보호 화면에서 로그인하면 방금 한 로그인을 메인으로 가로채지 않고 원래 주소로 돌아간다 (전환 렌더)', async () => {
    // useTransitions를 켠 라우터는 이동을 로그인 상태 변경보다 늦게 렌더하므로, 로그인한 채 /login이 한 번 그려진다.
    const path = '/worldstudio/owned-world?tab=cards'
    const store = createAppStore()
    render(<Provider store={store}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Provider>)
    await screen.findByRole('heading', { name: '로그인', level: 1 })
    submitLogin('reader@example.com')
    await screen.findByRole('heading', { name: '세계관 작업실' })
    expect(screen.getByTestId('world-location').textContent).toBe(path)
    expect(store.getState().session).toMatchObject({ role: 'user', next: null })
  })
})
