/** 가입·이메일 확인 요청이 이미 쓰는 이메일이라 409로 거절됨(UC-22 E1: 가입은 수정할 항목을, E7: 이메일 확인은 로그인을 안내). */
export class DuplicateEmail extends Error {}

export interface SignupRepository {
  signup(input: { email: string; nickname: string; password: string }): Promise<void>
  verifyEmail(token: string, password: string): Promise<void>
  resendVerification(email: string): Promise<void>
}
