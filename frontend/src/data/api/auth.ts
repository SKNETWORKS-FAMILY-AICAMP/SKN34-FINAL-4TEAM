import { z } from 'zod'
import { InvalidResetLink } from '../../domain/repositories/AuthRepository'
import { SessionExpired } from '../../domain/repositories/ProfileRepository'
import { csrf, LockUnavailable, withLock } from './csrf'

export const userSchema = z.object({ id: z.string(), email: z.string().email(), nickname: z.string(), operator: z.boolean() })
const responseSchema = z.object({ accessToken: z.string().min(1), user: userSchema })
type AuthUser = z.infer<typeof userSchema>

let accessToken: string | null = null
let userId: string | null = null
let inFlight: Promise<AuthUser> | null = null
let generation = 0
let loggingOut = false
export const authVersion = () => generation
export function assertAuthVersion(version: number) {
  if (version !== generation || loggingOut) throw new Error('Request cancelled')
}
export const getAccessToken = () => accessToken

async function post(path: string, body?: object, expectedUser?: string | null) {
  const csrfToken = await csrf()
  const response = await fetch(`/api/v1/auth/${path}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken, ...(expectedUser ? { 'X-Auth-User': expectedUser } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (path === 'logout' && response.status === 409) throw new SessionExpired()
  if (path === 'reset-password' && [400, 401, 410].includes(response.status)) throw new InvalidResetLink()
  if (!response.ok) throw new Error('Authentication request failed')
  return response
}

async function renew() {
  const expectedUser = userId
  const result = responseSchema.parse(await (await post('refresh', undefined, expectedUser)).json())
  if (expectedUser && result.user.id !== expectedUser) throw new SessionExpired()
  userId = result.user.id
  return result
}

export async function login(email: string, password: string) {
  if (loggingOut) throw new Error('Authentication superseded')
  if (inFlight) await inFlight.catch(() => {})
  if (loggingOut) throw new Error('Authentication superseded')
  const version = ++generation
  const result = await withLock('storyfork-auth', async () => {
    const result = responseSchema.parse(await (await post('login', { email, password })).json())
    userId = result.user.id
    return result
  }, true)
  if (version !== generation) throw new Error('Authentication superseded')
  accessToken = result.accessToken
  return result.user
}

export function refresh(): Promise<AuthUser> {
  if (inFlight) return inFlight
  const version = generation
  inFlight = (async () => {
    try {
      const result = await withLock('storyfork-auth', renew)
      if (version !== generation) throw new Error('Authentication superseded')
      accessToken = result.accessToken
      return result.user
    } catch (error) {
      if (version === generation && !(error instanceof LockUnavailable)) accessToken = null
      throw error
    }
  })().finally(() => { inFlight = null })
  return inFlight
}

export async function protectedRequest(path: string, init: RequestInit = {}, version = generation, lockHeld = false) {
  assertAuthVersion(version)
  const token = accessToken
  if (!token) throw new SessionExpired()
  const send = (current: string) => fetch(path, { ...init, credentials: 'same-origin', headers: { ...init.headers, Authorization: `Bearer ${current}` } })
  let response = await send(token)
  if (version !== generation || init.signal?.aborted) throw new Error('Request cancelled')
  if (response.status === 401) {
    try {
      if (accessToken === token) {
        if (lockHeld) {
          const result = await renew()
          assertAuthVersion(version)
          accessToken = result.accessToken
        } else await refresh()
      }
      if (version !== generation || init.signal?.aborted || !accessToken) throw new Error('Request cancelled')
      response = await send(accessToken)
      if (version !== generation || init.signal?.aborted) throw new Error('Request cancelled')
      if (response.status === 401) throw new SessionExpired()
    } catch (error) {
      if (version !== generation || init.signal?.aborted) throw error
      if (error instanceof LockUnavailable) throw error
      accessToken = null
      ++generation
      throw new SessionExpired()
    }
  }
  if (!response.ok) throw new Error('Request failed')
  return response
}

export async function forgotPassword(email: string) {
  if ((await post('forgot-password', { email })).status !== 202) throw new Error('Request failed')
}

export async function resetPassword(token: string, newPassword: string) {
  if ((await post('reset-password', { token, newPassword })).status !== 204) throw new Error('Request failed')
}

const sessionsSchema = z.object({ sessions: z.array(z.object({ id: z.string().min(1), deviceLabel: z.string(), createdAt: z.string().datetime({ offset: true }), current: z.boolean() })) })
export async function sessions(signal?: AbortSignal) {
  const version = authVersion()
  const result = sessionsSchema.parse(await (await protectedRequest('/api/v1/auth/sessions', { signal }, version)).json())
  assertAuthVersion(version)
  return result.sessions
}

async function sessionMutation(path: string, method: string, clear: boolean, signal?: AbortSignal) {
  const version = authVersion()
  const mutate = async () => {
    assertAuthVersion(version)
    const csrfToken = await csrf(signal)
    const result = await protectedRequest(path, { method, signal, headers: { 'X-CSRF-TOKEN': csrfToken } }, version, clear)
    if (result.status !== 204) throw new Error('Request failed')
    assertAuthVersion(version)
    if (clear) { ++generation; accessToken = null }
  }
  if (clear) await withLock('storyfork-auth', mutate)
  else await mutate()
}
export function revokeSession(id: string, current: boolean, signal?: AbortSignal) {
  return sessionMutation(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, 'DELETE', current, signal)
}
export function logoutAll(signal?: AbortSignal) {
  return sessionMutation('/api/v1/auth/logout-all', 'POST', true, signal)
}

export async function logout() {
  ++generation
  loggingOut = true
  try {
    const response = await withLock('storyfork-auth', () => post('logout', undefined, userId))
    if (response.status !== 204) throw new Error('Authentication request failed')
    generation++
    accessToken = null
  } catch (error) {
    if (error instanceof SessionExpired) accessToken = null
    throw error
  } finally { loggingOut = false }
}
