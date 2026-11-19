/** 가입 요청이 이미 쓰는 이메일이라 409로 거절됨(UC-22 E1: 계정을 만들지 않고 수정할 항목을 안내). */
export class DuplicateEmail extends Error {}

export interface SignupRepository {
  signup(input: { email: string; nickname: string; password: string }): Promise<void>
  verifyEmail(token: string, password: string): Promise<void>
  resendVerification(email: string): Promise<void>
}
