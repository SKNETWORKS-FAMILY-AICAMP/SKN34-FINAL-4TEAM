import { afterEach, expect, it, vi } from 'vitest'
import { login, refresh, logout, getAccessToken } from './auth'
import { SessionExpired } from '../../domain/repositories/ProfileRepository'

afterEach(() => { vi.unstubAllGlobals() })

it('uses CSRF for login and retains the token only in memory', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'secret', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: true } })))
  vi.stubGlobal('fetch', fetchMock)
  expect((await login('a@b.co', 'password')).operator).toBe(true)
  expect(getAccessToken()).toBe('secret')
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': 'csrf' } })
})

it('shares concurrent refresh and clears the token on failure', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf' })))
    .mockResolvedValueOnce(new Response('', { status: 401 }))
  vi.stubGlobal('fetch', fetchMock)
  const results = await Promise.allSettled([refresh(), refresh()])
  expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(getAccessToken()).toBeNull()
})

it('does not allow an earlier login response to revive a completed logout', async () => {
  let finishLogin!: (response: Response) => void
  const loginResponse = new Promise<Response>((resolve) => { finishLogin = resolve })
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'c' }))
    if (path.endsWith('/login')) return loginResponse
    return new Response(null, { status: 204 })
  }))
  const pending = login('a@b.co', 'password')
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  const loggingOut = logout()
  finishLogin(new Response(JSON.stringify({ accessToken: 'late', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } })))
  await expect(pending).rejects.toThrow('Authentication superseded')
  await loggingOut
  expect(getAccessToken()).toBeNull()
})

it('does not accept an earlier login while logout is pending', async () => {
  let finishLogin!: (response: Response) => void
  let finishLogout!: (response: Response) => void
  const loginResponse = new Promise<Response>((resolve) => { finishLogin = resolve })
  const logoutResponse = new Promise<Response>((resolve) => { finishLogout = resolve })
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'c' }))
    if (path.endsWith('/login')) return loginResponse
    return logoutResponse
  }))
  const pending = login('a@b.co', 'password')
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  const loggingOut = logout()
  finishLogin(new Response(JSON.stringify({ accessToken: 'late', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } })))
  await expect(pending).rejects.toThrow('Authentication superseded')
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
  finishLogout(new Response(null, { status: 204 }))
  await loggingOut
  expect(getAccessToken()).toBeNull()
})

it('rejects a refresh that finishes after logout starts', async () => {
  let finishRefresh!: (response: Response) => void
  const refreshResponse = new Promise<Response>((resolve) => { finishRefresh = resolve })
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/refresh')) return refreshResponse
    return new Response(null, { status: 204 })
  }))
  const pending = refresh()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  const loggingOut = logout()
  finishRefresh(Response.json({ accessToken: 'late', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } }))
  await expect(pending).rejects.toThrow('Authentication superseded')
  await loggingOut
  expect(getAccessToken()).toBeNull()
})

it('binds logout to the in-memory account without sending its possibly expired bearer', async () => {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) return Response.json({ accessToken: 'old', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } })
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('fetch', fetchMock)
  await login('a@b.co', 'password')
  await logout()
  const call = fetchMock.mock.calls.find(([path]) => path.endsWith('/logout'))
  expect(call?.[1]).toMatchObject({ headers: { 'X-Auth-User': '1', 'X-CSRF-TOKEN': 'c' } })
  expect(new Headers(call?.[1]?.headers).has('Authorization')).toBe(false)
  expect(getAccessToken()).toBeNull()
})

it('expires only local authentication on an account-mismatched logout', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) return Response.json({ accessToken: 'old', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } })
    return new Response(null, { status: 409 })
  }))
  await login('a@b.co', 'password')
  await expect(logout()).rejects.toBeInstanceOf(SessionExpired)
  expect(getAccessToken()).toBeNull()
})

it('does not clear the token when logout fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'c' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'secret', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'c' })))
    .mockResolvedValueOnce(new Response('', { status: 500 })))
  await login('a@b.co', 'password')
  await expect(logout()).rejects.toThrow()
  expect(getAccessToken()).toBe('secret')
})
