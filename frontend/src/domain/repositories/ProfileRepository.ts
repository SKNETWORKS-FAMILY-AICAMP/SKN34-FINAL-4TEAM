import type { AuthUser } from './AuthRepository'

export class SessionExpired extends Error {}

export interface ProfileRepository {
  sessionKey(): number
  get(signal?: AbortSignal): Promise<AuthUser>
  update(nickname: string, signal?: AbortSignal, session?: number): Promise<AuthUser>
  requestEmailChange(email: string, signal?: AbortSignal, session?: number): Promise<void>
  verifyEmailChange(token: string): Promise<void>
}
