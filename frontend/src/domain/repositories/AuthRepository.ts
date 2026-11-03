export type AuthUser = { id: string; email: string; nickname: string; operator: boolean }

export class InvalidResetLink extends Error {}

export interface AuthRepository {
  login(email: string, password: string): Promise<AuthUser>
  refresh(): Promise<AuthUser>
  logout(): Promise<void>
  forgotPassword(email: string): Promise<void>
  resetPassword(token: string, newPassword: string): Promise<void>
  sessions(signal?: AbortSignal): Promise<AuthSession[]>
  revokeSession(id: string, current: boolean, signal?: AbortSignal): Promise<void>
  logoutAll(signal?: AbortSignal): Promise<void>
}

export type AuthSession = { id: string; deviceLabel: string; createdAt: string; current: boolean }
