import '../../testLocks'
import { afterEach, expect, it, vi } from 'vitest'
import { login, logout, getAccessToken } from './auth'
import { getProfile, profileRepository } from './profile'

afterEach(() => vi.unstubAllGlobals())

it('refreshes once for parallel unauthorized profile requests', async () => {
  let refreshes = 0
  const user = { id: '1', email: 'a@b.co', nickname: 'A', operator: false }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) return Response.json({ accessToken: 'old', user })
    if (path.endsWith('/refresh')) { refreshes++; return Response.json({ accessToken: 'new', user }) }
    return new Headers(init?.headers).get('Authorization') === 'Bearer new' ? Response.json(user) : new Response(null, { status: 401 })
  }))
  await login('a@b.co', 'password')
  expect(await Promise.all([getProfile(), getProfile()])).toEqual([user, user])
  expect(refreshes).toBe(1)
})

it('uses CSRF and bearer for changes and keeps verification separate', async () => {
  const user = { id: '1', email: 'a@b.co', nickname: 'B', operator: false }
  const mock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/verify-email-change')) return new Response(null, { status: 204 })
    if (path.endsWith('/email-change')) return new Response(null, { status: 202 })
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token', 'X-CSRF-TOKEN': 'c' })
    return Response.json(user)
  })
  vi.stubGlobal('fetch', mock)
  await login('a@b.co', 'password')
  expect(await profileRepository.update('B')).toEqual(user)
  await profileRepository.requestEmailChange('b@b.co')
  await profileRepository.verifyEmailChange('challenge')
  expect(mock.mock.calls.find(([path]) => path.endsWith('/email-change'))?.[1]?.body).toBe(JSON.stringify({ email: 'b@b.co' }))
})

it('does not send the second save step after the account changes', async () => {
  const user = { id: '1', email: 'a@b.co', nickname: 'A', operator: false }
  const mock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/me')) return Response.json(user)
    return new Response(null, { status: 202 })
  })
  vi.stubGlobal('fetch', mock)
  await login('a@b.co', 'password')
  const session = profileRepository.sessionKey()
  await profileRepository.update('A', undefined, session)
  await login('other@b.co', 'password')
  await expect(profileRepository.requestEmailChange('b@b.co', undefined, session)).rejects.toThrow()
  expect(mock.mock.calls.some(([path]) => path.endsWith('/email-change'))).toBe(false)
})

it('clears the token when refresh is rejected', async () => {
  const user = { id: '1', email: 'a@b.co', nickname: 'A', operator: false }
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) return Response.json({ accessToken: 'old', user })
    return new Response(null, { status: 401 })
  }))
  await login('a@b.co', 'password')
  await expect(getProfile()).rejects.toThrow()
  expect(getAccessToken()).toBeNull()
})

it('rejects a profile response arriving after logout starts', async () => {
  const user = { id: '1', email: 'a@b.co', nickname: 'A', operator: false }
  let finish!: (response: Response) => void
  const pendingResponse = new Promise<Response>((resolve) => { finish = resolve })
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/login')) return Response.json({ accessToken: 'old', user })
    if (path.endsWith('/logout')) return new Response(null, { status: 204 })
    return pendingResponse
  }))
  await login('a@b.co', 'password')
  const pending = getProfile()
  await logout()
  finish(Response.json(user))
  await expect(pending).rejects.toThrow()
  expect(getAccessToken()).toBeNull()
})
