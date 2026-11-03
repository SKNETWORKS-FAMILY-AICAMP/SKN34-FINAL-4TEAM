// @vitest-environment jsdom
import './testLocks'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { AuthSession } from './domain/repositories/AuthRepository'
import { renderApp } from './test/renderApp'

const user = { id: '1', nickname: '독자', email: 'reader@example.com', operator: false }
const session = (deviceLabel: string, current = false): AuthSession => ({ id: current ? 'current' : 'other', deviceLabel, current, createdAt: '2026-01-01T00:00:00Z' })

function mockDevices(devices: AuthSession[], mutation: () => Promise<Response> = async () => new Response(null, { status: 204 })) {
  const mock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/refresh')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/sessions') && !init?.method) return Response.json({ sessions: devices })
    if (path.includes('/sessions/') || path.endsWith('/logout-all')) return mutation()
    return Response.json(user)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

it.each([
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0', 'Edge · Windows'],
  ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36', 'Chrome · Android'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 HeadlessChrome/155.0 Safari/537.36', 'Chrome · macOS'],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 'Firefox · Linux'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'Safari · iOS'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'Safari · macOS'],
  ['Browser', '알 수 없는 브라우저 · 알 수 없는 운영체제'],
])('기기 원문을 상세에 보존하고 읽기 쉬운 이름을 표시한다 (%s)', async (raw, label) => {
  mockDevices([session(raw, true)])
  renderApp('/me/profile')
  const devices = await screen.findByRole('region', { name: '로그인 기기' })
  const name = await within(devices).findByText(label)
  const item = name.closest('li')!
  expect(item.firstElementChild?.textContent).toBe('현재 기기')
  const details = within(item).getByText(raw).closest('details')!
  expect(details.open).toBe(false)
  expect(within(details).getByText('기기 상세 정보')).toBeTruthy()
  expect(within(item).getByRole('button', { name: '이 기기에서 로그아웃' })).toBeTruthy()
})

it('다른 기기의 로그아웃은 해당 기기만 제거한다', async () => {
  const mock = mockDevices([session('Firefox/140.0 (X11; Linux x86_64)')])
  const { store } = renderApp('/me/profile')
  fireEvent.click(await screen.findByRole('button', { name: 'Firefox · Linux 로그아웃' }))
  expect(await screen.findByText('로그인 기기가 없어요.')).toBeTruthy()
  expect(store.getState().session.role).toBe('user')
  expect(mock).toHaveBeenCalledWith('/api/v1/auth/sessions/other', expect.objectContaining({ method: 'DELETE' }))
})

it('현재 기기 로그아웃 실패는 목록과 로그인 상태를 보존한다', async () => {
  mockDevices([session('Browser', true)], async () => new Response(null, { status: 503 }))
  const { store } = renderApp('/me/profile')
  fireEvent.click(await screen.findByRole('button', { name: '이 기기에서 로그아웃' }))
  expect(await screen.findByText(/로그아웃하지 못했어요/)).toBeTruthy()
  expect(screen.getByText('현재 기기')).toBeTruthy()
  expect(store.getState().session.role).toBe('user')
})

it('전체 로그아웃은 현재 기기 포함을 확인하고 취소·실패 뒤 상태를 보존한다', async () => {
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  const mock = mockDevices([session('Browser', true)], () => pending)
  const { store } = renderApp('/me/profile')
  fireEvent.click(await screen.findByRole('button', { name: '모든 기기 로그아웃' }))
  expect(mock.mock.calls.some(([path]) => path.endsWith('/logout-all'))).toBe(false)
  const confirmation = screen.getByRole('group', { name: '모든 기기 로그아웃 확인' })
  expect(within(confirmation).getByText(/이 기기를 포함한 모든 기기/)).toBeTruthy()
  fireEvent.click(within(confirmation).getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('group', { name: '모든 기기 로그아웃 확인' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '모든 기기 로그아웃' }))
  const confirm = screen.getByRole<HTMLButtonElement>('button', { name: '모든 기기에서 로그아웃' })
  fireEvent.click(confirm)
  await waitFor(() => expect(mock.mock.calls.filter(([path]) => path.endsWith('/logout-all'))).toHaveLength(1))
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  await act(async () => { finish(new Response(null, { status: 503 })) })
  expect(await screen.findByText(/로그아웃하지 못했어요/)).toBeTruthy()
  expect(screen.getByText('현재 기기')).toBeTruthy()
  expect(store.getState().session.role).toBe('user')
  expect(confirm.disabled).toBe(false)
  expect(mock.mock.calls.filter(([path]) => path.endsWith('/logout-all'))).toHaveLength(1)
})

it('전체 로그아웃 성공 때만 현재 로그인 상태를 해제한다', async () => {
  const mock = mockDevices([session('Browser', true)])
  const { store } = renderApp('/me/profile')
  fireEvent.click(await screen.findByRole('button', { name: '모든 기기 로그아웃' }))
  fireEvent.click(screen.getByRole('button', { name: '모든 기기에서 로그아웃' }))
  await waitFor(() => expect(store.getState().session.role).toBeNull())
  expect(mock).toHaveBeenCalledWith('/api/v1/auth/logout-all', expect.objectContaining({ method: 'POST' }))
})
