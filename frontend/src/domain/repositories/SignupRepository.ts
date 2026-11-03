export interface SignupRepository {
  signup(input: { email: string; nickname: string; password: string }): Promise<void>
  verifyEmail(token: string, password: string): Promise<void>
  resendVerification(email: string): Promise<void>
}
