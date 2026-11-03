// @vitest-environment jsdom
import './testLocks'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderApp } from './test/renderApp'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

it('서버 프로필을 표시하고 확인 전 기존 이메일을 유지한다', async () => {
  const user = { id: '1', nickname: '독자', email: 'reader@example.com', operator: false }
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/refresh')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/email-change')) return pending
    if (path.endsWith('/me') && init?.method === 'PATCH') return Response.json({ ...user, nickname: '새이름' })
    return Response.json(user)
  }))
  renderApp('/me/profile')
  const nick = await screen.findByLabelText<HTMLInputElement>('닉네임')
  const email = screen.getByLabelText<HTMLInputElement>('이메일')
  expect(nick.autocomplete).toBe('nickname')
  expect(email.autocomplete).toBe('email')
  expect(screen.queryByText(/가입일/)).toBeNull()
  expect(screen.getByRole('button', { name: '다크 모드로' }).closest('.screen-controls')).toBeNull()
  fireEvent.change(nick, { target: { value: '새이름' } })
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'new@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await screen.findByRole('button', { name: '저장 중…' })
  expect(nick.disabled).toBe(true)
  expect(email.disabled).toBe(true)
  expect(document.getElementById('toast')?.textContent).not.toContain('확인 메일을 보냈어요')
  finish(new Response(null, { status: 202 }))
  await waitFor(() => expect(document.getElementById('toast')?.textContent).toContain('확인 메일을 보냈어요'))
  expect(within(screen.getByRole('navigation', { name: '계정 메뉴' })).getByText('reader@example.com')).toBeTruthy()
  const pendingStatus = screen.getByText(/new@example.com 주소로 확인 메일을/)
  expect(pendingStatus.getAttribute('role')).toBe('status')
  expect(pendingStatus.textContent).toContain('reader@example.com')
  expect(nick.disabled).toBe(false)
  expect(email.disabled).toBe(false)
  fireEvent.change(nick, { target: { value: '다음이름' } })
  expect(screen.getByText(/new@example.com 주소로 확인 메일을/)).toBeTruthy()
})

it('프로필 조회 오류를 같은 화면에서 재시도하고 비밀번호 찾기로 이동한다', async () => {
  const user = { id: '1', nickname: '독자', email: 'reader@example.com', operator: false }
  let attempts = 0
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/refresh')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/sessions')) return Response.json({ sessions: [] })
    if (path.endsWith('/me') && ++attempts === 1) return new Response(null, { status: 503 })
    return Response.json(user)
  }))
  renderApp('/me/profile')
  fireEvent.click(await screen.findByRole('button', { name: '프로필 다시 시도' }))
  expect(await screen.findByLabelText<HTMLInputElement>('닉네임')).toHaveProperty('value', '독자')
  expect(attempts).toBe(2)
  const resetLink = screen.getByRole('link', { name: '비밀번호 재설정' })
  expect(resetLink.getAttribute('href')).toBe('/auth/forgot-password')
  expect(within(screen.getByRole('navigation', { name: '계정 메뉴' })).getByRole('link', { name: '프로필' }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(resetLink)
  expect(await screen.findByRole('heading', { name: '비밀번호 찾기' })).toBeTruthy()
})

it('이메일 변경 완료 화면에서 프로필을 새로 조회한다', async () => {
  const user = { id: '1', nickname: '독자', email: 'old@example.com', operator: false }
  const updated = { ...user, email: 'new@example.com' }
  window.history.replaceState(null, '', '/auth/verify-email-change#token=secret')
  const mock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/refresh')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/verify-email-change')) return new Response(null, { status: 204 })
    if (path.endsWith('/sessions')) return Response.json({ sessions: [] })
    return Response.json(updated)
  })
  vi.stubGlobal('fetch', mock)
  renderApp('/auth/verify-email-change#token=secret')
  expect(await screen.findByText('이메일 변경이 완료됐어요.')).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: '프로필로' }))
  expect(await screen.findByLabelText<HTMLInputElement>('이메일')).toHaveProperty('value', 'new@example.com')
  expect(mock).toHaveBeenCalledWith('/api/v1/me', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

it('닉네임 저장 뒤 이메일 요청 실패는 부분 성공과 입력을 보존한다', async () => {
  const user = { id: '1', nickname: '독자', email: 'reader@example.com', operator: false }
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  const mock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/refresh')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/sessions')) return Response.json({ sessions: [] })
    if (path.endsWith('/email-change')) return pending
    if (init?.method === 'PATCH') return Response.json({ ...user, nickname: '새이름' })
    return Response.json(user)
  })
  vi.stubGlobal('fetch', mock)
  const { store } = renderApp('/me/profile')
  const nick = await screen.findByLabelText<HTMLInputElement>('닉네임')
  const email = screen.getByLabelText<HTMLInputElement>('이메일')
  fireEvent.change(nick, { target: { value: '새이름' } })
  fireEvent.change(email, { target: { value: 'new@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(mock.mock.calls.some(([path]) => path.endsWith('/email-change'))).toBe(true))
  await act(async () => { finish(new Response(null, { status: 503 })) })
  expect((await screen.findByRole('alert')).textContent).toContain('닉네임은 저장했지만')
  expect(store.getState().session.user).toMatchObject({ nick: '새이름', email: user.email })
  expect(email.value).toBe('new@example.com')
  expect(email.disabled).toBe(false)
  expect(screen.queryByText(/주소로 확인 메일을 요청했어요/)).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(false)
})

it('이메일 변경 인증 fragment를 제거하고 실패를 표시한다', async () => {
  window.history.replaceState(null, '', '/auth/verify-email-change#token=secret')
  const mock = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 }))
  vi.stubGlobal('fetch', mock)
  renderApp('/auth/verify-email-change#token=secret')
  expect(window.location.hash).toBe('')
  expect(await screen.findByText(/이메일을 변경하지 못했어요/)).toBeTruthy()
  expect(mock).toHaveBeenCalledWith('/api/v1/auth/verify-email-change', expect.objectContaining({ body: JSON.stringify({ token: 'secret' }) }))
})
