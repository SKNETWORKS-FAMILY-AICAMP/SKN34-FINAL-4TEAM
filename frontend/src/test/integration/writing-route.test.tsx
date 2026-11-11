// @vitest-environment jsdom
import '../testLocks'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderApp } from '../renderApp'
import { refresh, login, getAccessToken } from '../../data/api/auth'
import { sessionActions } from '../../presentation/shared/session/sessionSlice'
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
  await refresh().catch(() => {})
})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('requires restored authentication before opening a persisted studio route',async()=>{
  const fetcher=vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : Response.json({detail:'서버 인증이 필요합니다.'},{status:401}))
  vi.stubGlobal('fetch',fetcher)
  renderApp('/studio/00000000-0000-0000-0000-000000000001')
  expect(await screen.findByRole('heading',{name:'로그인'})).toBeTruthy()
  expect(fetcher.mock.calls.some(([path])=>path.startsWith('/api/v1/works'))).toBe(false)
  expect(screen.queryByRole('button',{name:'데모 계정으로 바로 시작'})).toBeNull()
})

it('keeps a signed-in screen and reports a server outage during restore', async () => {
  const user = { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false }
  let unavailable = false
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) return Response.json({ accessToken: 'old', user })
    if (path.endsWith('/refresh')) return new Response(null, { status: unavailable ? 503 : 401 })
    return new Response(null, { status: 401 })
  }))
  await login(user.email, 'password')
  unavailable = true
  const { store } = renderApp('/me')
  store.dispatch(sessionActions.login(user))
  await screen.findByText('서버 연결에 실패했어요. 잠시 후 다시 시도해 주세요.')
  expect(store.getState().session.role).toBe('user')
  expect(getAccessToken()).toBe('old')
})

it('shows a recoverable error without granting access on an initial outage', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 503 })))
  const { store } = renderApp('/')
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('연결'))
  expect(store.getState().session.role).toBeNull()
})

it('clears a restore connection error only after a later successful login', async () => {
  const user = { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false }
  const connectionError = '서버 연결에 실패했어요. 잠시 후 다시 시도해 주세요.'
  let loginAttempts = 0
  const fetcher = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) {
      loginAttempts += 1
      return loginAttempts === 1 ? new Response(null, { status: 401 }) : Response.json({ accessToken: 'manual-login', user })
    }
    return new Response(null, { status: 503 })
  })
  vi.stubGlobal('fetch', fetcher)
  const { store } = renderApp('/login')
  await screen.findByText(connectionError)
  expect(store.getState().session.role).toBeNull()

  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: user.email } })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
  await screen.findByText('로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.')
  expect(screen.getByText(connectionError)).toBeTruthy()
  expect(store.getState().session.role).toBeNull()

  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
  await waitFor(() => expect(store.getState().session.role).toBe('user'))
  expect(getAccessToken()).toBe('manual-login')
  await waitFor(() => expect(screen.queryByText(connectionError)).toBeNull())
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/refresh'))).toHaveLength(1)
})

it.each(['/content', '/studio/00000000-0000-0000-0000-000000000001', '/studio/00000000-0000-0000-0000-000000000001?view=narrative'])('waits for restored memory authentication before loading %s', async path => {
  let finish!: (response: Response) => void
  const pending = new Promise<Response>(resolve => { finish = resolve })
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (url.endsWith('/refresh')) return pending
    if (url.endsWith('/world')) return Response.json({ id: 'w', name: '설정집', revision: 0, mode: 'own', basis: null, draft: null, drafts: [], settings: [], history: [], sourceToken: 't', changes: [] })
    return Response.json([])
  })
  vi.stubGlobal('fetch', fetcher)
  renderApp(path)
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/refresh'))).toBe(true))
  expect(fetcher.mock.calls.some(([url]) => url.startsWith('/api/v1/works'))).toBe(false)
  await act(async () => { finish(Response.json({ accessToken: 'restored-content', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })) })
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.startsWith('/api/v1/works'))).toBe(true))
  const content = fetcher.mock.calls.find(([url]) => url.startsWith('/api/v1/works'))
  expect(content?.[1]).toMatchObject({ credentials: 'same-origin', headers: { Authorization: 'Bearer restored-content' } })
})
