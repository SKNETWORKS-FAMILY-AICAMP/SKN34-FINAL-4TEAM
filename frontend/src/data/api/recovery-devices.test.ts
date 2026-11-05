import { afterEach, expect, it, vi } from 'vitest'
import { login, getAccessToken, forgotPassword, resetPassword, sessions, revokeSession, logoutAll } from './auth'

const user = { id: '1', email: 'a@b.co', nickname: 'A', operator: false }
afterEach(() => vi.unstubAllGlobals())

it('sends recovery requests with CSRF and checks their exact statuses', async () => {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: path.endsWith('/forgot-password') ? 202 : 204 }))
  vi.stubGlobal('fetch', fetchMock)
  await forgotPassword('a@b.co')
  await resetPassword('secret', 'new-password')
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ headers: { 'X-CSRF-TOKEN': 'c' }, body: JSON.stringify({ email: 'a@b.co' }) })
  expect(fetchMock.mock.calls[3][1]).toMatchObject({ body: JSON.stringify({ token: 'secret', newPassword: 'new-password' }) })
})

it('validates sessions and revokes the current device only after server success', async () => {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) return Response.json({ accessToken: 'access', user })
    if (path.endsWith('/sessions') && !init?.method) return Response.json({ sessions: [{ id: 'one', deviceLabel: 'Browser', createdAt: '2026-01-01T00:00:00Z', current: true }] })
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('fetch', fetchMock)
  await login('a@b.co', 'password')
  expect((await sessions())[0].current).toBe(true)
  await revokeSession('one', true)
  expect(getAccessToken()).toBeNull()
  expect(fetchMock.mock.calls.find(([path]) => path.endsWith('/sessions/one'))?.[1]).toMatchObject({ method: 'DELETE', headers: { Authorization: 'Bearer access', 'X-CSRF-TOKEN': 'c' } })
  await login('a@b.co', 'password')
  await logoutAll()
  expect(getAccessToken()).toBeNull()
})
