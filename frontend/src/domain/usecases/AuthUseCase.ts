import type { AuthRepository } from '../repositories/AuthRepository'

export class AuthUseCase {
  private readonly repository: AuthRepository
  constructor(repository: AuthRepository) { this.repository = repository }
  login(email: string, password: string) { return this.repository.login(email, password) }
  refresh() { return this.repository.refresh() }
  logout() { return this.repository.logout() }
  forgotPassword(email: string) { return this.repository.forgotPassword(email) }
  resetPassword(token: string, password: string) { return this.repository.resetPassword(token, password) }
  sessions(signal?: AbortSignal) { return this.repository.sessions(signal) }
  revokeSession(id: string, current: boolean, signal?: AbortSignal) { return this.repository.revokeSession(id, current, signal) }
  logoutAll(signal?: AbortSignal) { return this.repository.logoutAll(signal) }
}
