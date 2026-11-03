import type { SignupRepository } from '../repositories/SignupRepository'

export class SignupUseCase {
  private readonly repository: SignupRepository
  constructor(repository: SignupRepository) { this.repository = repository }

  signup(input: { email: string; nickname: string; password: string }) { return this.repository.signup(input) }
  verifyEmail(token: string, password: string) { return this.repository.verifyEmail(token, password) }
  resendVerification(email: string) { return this.repository.resendVerification(email) }
}
