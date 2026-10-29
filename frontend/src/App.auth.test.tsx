// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { createAppStore } from './app/store'
import { LoginPage } from './presentation/features/auth/view/LoginPage'
import { RequireRole } from './presentation/shared/session/RequireRole'
import { renderApp } from './test/renderApp'

afterEach(cleanup)

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
  it('비로그인 사용자를 경로별 안내와 함께 로그인으로 보내고, 로그인 후 원래 경로로 돌려보낸다', async () => {
    const store = renderGuarded('/lib?tab=write')
    await screen.findByText('내 서재는 로그인 후 볼 수 있어요.')
    expect(store.getState().session.next).toBe('/lib?tab=write')
    fireEvent.click(screen.getByRole('button', { name: '데모 계정으로 바로 시작' }))
    expect(await screen.findByTestId('where')).toHaveProperty('textContent', '/lib')
    expect(store.getState().session).toMatchObject({ role: 'user', next: null, loginMsg: '' })
  })

  it('회차 뷰어는 읽기 안내를, 관리자 화면은 관리자 로그인을 요구한다', async () => {
    renderGuarded('/read/guunmong/1')
    await screen.findByText('소설을 읽으려면 로그인해 주세요.')
    cleanup()
    const store = renderGuarded('/admin', createAppStore({ role: 'user' }))
    await screen.findByText('관리자 화면은 관리자 계정으로 로그인해야 볼 수 있어요.')
    expect(screen.getByRole('button', { name: '관리자 데모' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '데모 관리자 계정으로 들어가기' }))
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

  it('계정 메뉴에서 로그아웃하면 홈으로 가고 메뉴에 로그아웃이 다시 보이지 않는다 (목업 logout 케이스)', async () => {
    const { store } = renderApp('/', createAppStore({ role: 'user' }))
    fireEvent.click(screen.getByRole('button', { name: '내 계정 메뉴' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('reader@storyfork.demo')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: '로그아웃' }))
    expect(store.getState().session.role).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    await screen.findByText('로그아웃했어요')
    fireEvent.click(screen.getByRole('button', { name: '로그인·회원가입 메뉴' }))
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: '로그아웃' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
