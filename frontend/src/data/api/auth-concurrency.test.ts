import { afterEach, expect, it, vi } from 'vitest'
import { login, logout } from './auth'

afterEach(() => vi.unstubAllGlobals())

it('waits for the login response before sending logout', async () => {
  let release!: (value: Response) => void
  const response = new Promise<Response>((resolve) => { release = resolve })
  const tails = new Map<string, Promise<void>>()
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: object, callback: (lock: object) => Promise<unknown>) => {
    const next = (tails.get(_name) ?? Promise.resolve()).then(() => callback({}))
    tails.set(_name, next.then(() => {}, () => {}))
    return next
  } } })
  const fetchMock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'csrf' })
    if (path.endsWith('/login')) return response
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const pending = login('a@b.co', 'password')
  const settled = pending.catch(() => {})
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  const closing = logout()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/logout'))).toBe(false)
  release(Response.json({ accessToken: 'token', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } }))
  await settled
  await closing
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/v1/auth/logout')
})

it('fails safely without browser locks before making a request', async () => {
  vi.stubGlobal('navigator', {})
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  await expect(login('a@b.co', 'password')).rejects.toThrow('Browser lock unavailable')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('serializes CSRF issuance across concurrent callers', async () => {
  const { csrf } = await import('./csrf')
  let release!: () => void
  const first = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    calls++
    if (calls === 1) await first
    return Response.json({ csrfToken: 'csrf' })
  }))
  const one = csrf()
  await vi.waitFor(() => expect(calls).toBe(1))
  const two = csrf()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(calls).toBe(1)
  release()
  expect(await Promise.all([one, two])).toEqual(['csrf', 'csrf'])
})

it('serializes refreshes from separate module instances sharing a cookie', async () => {
  vi.resetModules()
  const first = await import('./auth')
  vi.resetModules()
  const second = await import('./auth')
  let active = 0
  let maximum = 0
  let rotations = 0
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'csrf' })
    active++
    maximum = Math.max(maximum, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active--
    rotations++
    return Response.json({ accessToken: `token-${rotations}`, user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } })
  }))
  await Promise.all([first.refresh(), second.refresh()])
  expect(maximum).toBe(1)
  expect(rotations).toBe(2)
})

it('reports a lock acquisition failure without sending credentials', async () => {
  vi.stubGlobal('navigator', { locks: { request: () => Promise.reject(new Error('denied')) } })
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  await expect(login('a@b.co', 'password')).rejects.toThrow('Browser lock failed')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('does not start a login while logout is in progress', async () => {
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  const fetchMock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'csrf' })
    if (path.endsWith('/logout')) return pending
    return Response.json({ accessToken: 'token', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } })
  })
  vi.stubGlobal('fetch', fetchMock)
  const closing = logout()
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  const result = login('a@b.co', 'password')
  const assertion = expect(result).rejects.toThrow()
  finish(new Response(null, { status: 204 }))
  await closing
  await assertion
  expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/login'))).toBe(false)
})

it('rejects login in another tab while logout holds the auth lock', async () => {
  vi.resetModules()
  const first = await import('./auth')
  vi.resetModules()
  const second = await import('./auth')
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  const fetchMock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'csrf' })
    if (path.endsWith('/logout')) return pending
    return new Response(null, { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const closing = first.logout()
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  await expect(second.login('a@b.co', 'password')).rejects.toThrow('Browser lock busy')
  finish(new Response(null, { status: 204 }))
  await closing
  expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/login'))).toBe(false)
})

it.each(['refresh', 'profile', 'all', 'current'])('does not switch account on stale-tab %s refresh', async (kind) => {
  vi.resetModules()
  const first = await import('./auth')
  const { SessionExpired } = await import('../../domain/repositories/ProfileRepository')
  vi.resetModules()
  const second = await import('./auth')
  const userA = { id: 'a', email: 'a@b.co', nickname: 'A', operator: false }
  const userB = { id: 'b', email: 'b@b.co', nickname: 'B', operator: false }
  let shared = userA
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'csrf' })
    if (path.endsWith('/login')) {
      shared = JSON.parse(String(init?.body)).email === userA.email ? userA : userB
      return Response.json({ accessToken: `token-${shared.id}`, user: shared })
    }
    if (path.endsWith('/refresh')) return Response.json({ accessToken: `token-${shared.id}`, user: shared })
    return new Headers(init?.headers).get('Authorization') === 'Bearer token-b'
      ? (path.endsWith('/me') ? Response.json(userB) : new Response(null, { status: 204 }))
      : new Response(null, { status: 401 })
  })
  vi.stubGlobal('fetch', fetchMock)
  await first.login(userA.email, 'password')
  await second.login(userB.email, 'password')
  const request = kind === 'refresh' ? first.refresh()
    : kind === 'profile' ? first.protectedRequest('/api/v1/me')
      : kind === 'all' ? first.logoutAll() : first.revokeSession('self', true)
  await expect(request).rejects.toBeInstanceOf(SessionExpired)
  expect(first.getAccessToken()).toBeNull()
  expect(second.getAccessToken()).toBe('token-b')
  const refreshCall = fetchMock.mock.calls.find(([path]) => path.endsWith('/refresh'))
  expect(new Headers(refreshCall?.[1]?.headers).get('X-Auth-User')).toBe('a')
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/me') || path.endsWith('/logout-all') || path.endsWith('/sessions/self'))).toHaveLength(kind === 'refresh' ? 0 : 1)
})

it.each(['all', 'current'])('serializes %s revocation with another tab refresh and retries 401 without deadlock', async (kind) => {
  vi.resetModules()
  const first = await import('./auth')
  vi.resetModules()
  const second = await import('./auth')
  let release!: () => void
  let mutationStarted!: () => void
  const started = new Promise<void>((resolve) => { mutationStarted = resolve })
  const held = new Promise<void>((resolve) => { release = resolve })
  let mutations = 0
  const fetchMock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'csrf' })
    if (path.endsWith('/refresh')) return Response.json({ accessToken: 'token', user: { id: '1', email: 'a@b.co', nickname: 'A', operator: false } })
    mutations++
    if (mutations === 1) return new Response(null, { status: 401 })
    mutationStarted()
    await held
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('fetch', fetchMock)
  await first.refresh()
  const mutation = kind === 'all' ? first.logoutAll() : first.revokeSession('self', true)
  await started
  const other = second.refresh()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/refresh'))).toHaveLength(2)
  release()
  await Promise.all([mutation, other])
})
