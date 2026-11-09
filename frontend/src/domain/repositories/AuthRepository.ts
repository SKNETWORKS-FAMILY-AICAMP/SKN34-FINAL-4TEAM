export type AuthUser = { id: string; email: string; nickname: string; operator: boolean }

export class InvalidResetLink extends Error {}
export class InvalidCredentials extends Error {}
/** 운영이 이용을 제한한 계정의 로그인입니다(Core 403 + `ACCOUNT_RESTRICTED`). 자격 증명은 맞았습니다. */
export class AccountRestricted extends Error {}
export class LockUnavailable extends Error {}

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
