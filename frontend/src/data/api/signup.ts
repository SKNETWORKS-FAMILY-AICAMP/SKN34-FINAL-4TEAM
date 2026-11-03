import type { SignupRepository } from '../../domain/repositories/SignupRepository'
import { csrf } from './csrf'

async function post(path: string, body: object, status: number) {
  const csrfToken = await csrf()
  const response = await fetch(`/api/v1/auth/${path}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
    body: JSON.stringify(body),
  })
  if (response.status !== status && !(path === 'verify-email' && response.status === 200)) throw new Error('Request failed')
}

export const signup: SignupRepository['signup'] = (input) => post('signup', input, 202)
export const verifyEmail: SignupRepository['verifyEmail'] = (token, password) => post('verify-email', { token, password }, 204)
export const resendVerification: SignupRepository['resendVerification'] = (email) => post('resend-verification', { email }, 202)
export const signupRepository: SignupRepository = { signup, verifyEmail, resendVerification }
