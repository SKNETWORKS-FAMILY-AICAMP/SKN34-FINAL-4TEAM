import { DuplicateEmail, type SignupRepository } from '../../domain/repositories/SignupRepository'
import { csrf } from './csrf'

async function post(path: string, body: object, status: number) {
  const csrfToken = await csrf()
  const response = await fetch(`/api/v1/auth/${path}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
    body: JSON.stringify(body),
  })
  // 409는 같은 이메일 회원이 이미 있다는 뜻이다(Core: signup은 중복 회원, verify-email은 회원 생성 때의 이메일 unique 충돌).
  if ((path === 'signup' || path === 'verify-email') && response.status === 409) throw new DuplicateEmail()
  if (response.status !== status && !(path === 'verify-email' && response.status === 200)) throw new Error('Request failed')
}

export const signup: SignupRepository['signup'] = (input) => post('signup', input, 202)
export const verifyEmail: SignupRepository['verifyEmail'] = (token, password) => post('verify-email', { token, password }, 204)
export const resendVerification: SignupRepository['resendVerification'] = (email) => post('resend-verification', { email }, 202)
export const signupRepository: SignupRepository = { signup, verifyEmail, resendVerification }
