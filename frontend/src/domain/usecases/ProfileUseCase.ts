import type { ProfileRepository } from '../repositories/ProfileRepository'

export class ProfileUseCase {
  private readonly repository: ProfileRepository
  constructor(repository: ProfileRepository) { this.repository = repository }
  sessionKey() { return this.repository.sessionKey() }
  get(signal?: AbortSignal) { return this.repository.get(signal) }
  update(nickname: string, signal?: AbortSignal, session?: number) { return this.repository.update(nickname, signal, session) }
  requestEmailChange(email: string, signal?: AbortSignal, session?: number) { return this.repository.requestEmailChange(email, signal, session) }
  verifyEmailChange(token: string) { return this.repository.verifyEmailChange(token) }
}
