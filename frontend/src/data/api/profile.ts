import type { ProfileRepository } from '../../domain/repositories/ProfileRepository'
import { assertAuthVersion, authVersion, protectedRequest, userSchema } from './auth'
import { csrf } from './csrf'

export async function getProfile(signal?: AbortSignal) {
  const version = authVersion()
  const user = userSchema.parse(await (await protectedRequest('/api/v1/me', { signal }, version)).json())
  assertAuthVersion(version)
  return user
}
async function update(nickname: string, signal?: AbortSignal, version = authVersion()) {
  assertAuthVersion(version)
  const token = await csrf(signal)
  const user = userSchema.parse(await (await protectedRequest('/api/v1/me', { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token }, body: JSON.stringify({ nickname }) }, version)).json())
  assertAuthVersion(version)
  return user
}
async function requestEmailChange(email: string, signal?: AbortSignal, version = authVersion()) {
  assertAuthVersion(version)
  const token = await csrf(signal)
  const response = await protectedRequest('/api/v1/me/email-change', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token }, body: JSON.stringify({ email }) }, version)
  if (response.status !== 202) throw new Error('Request failed')
}
async function verifyEmailChange(token: string) {
  const csrfToken = await csrf()
  const response = await fetch('/api/v1/auth/verify-email-change', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken }, body: JSON.stringify({ token }) })
  if (response.status !== 204) throw new Error('Request failed')
}
export const profileRepository: ProfileRepository = { sessionKey: authVersion, get: getProfile, update, requestEmailChange, verifyEmailChange }
