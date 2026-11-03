import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignupUseCase } from '../../domain/usecases/SignupUseCase'
import { signup, verifyEmail, resendVerification, signupRepository } from './signup'

afterEach(() => vi.unstubAllGlobals())

describe('가입 API', () => {
  it('CSRF 토큰을 확인하고 같은 출처로 가입을 요청한다', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf' }), { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetch)
    await signup({ email: 'a@example.com', nickname: '독자', password: 'password' })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/auth/signup', expect.objectContaining({ credentials: 'same-origin', headers: expect.objectContaining({ 'X-CSRF-TOKEN': 'csrf' }), body: JSON.stringify({ email: 'a@example.com', nickname: '독자', password: 'password' }) }))
  })
  it('이메일 확인은 유스케이스부터 가입 비밀번호를 함께 전송한다', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'csrf' })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await new SignupUseCase(signupRepository).verifyEmail('token', 'password123')
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/auth/verify-email', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ token: 'token', password: 'password123' }),
    }))
  })
  it('서버 거부와 잘못된 CSRF 응답을 실패로 처리한다', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf' }))).mockResolvedValueOnce(new Response(null, { status: 400 })).mockResolvedValueOnce(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    await expect(verifyEmail('token', 'password123')).rejects.toThrow()
    await expect(resendVerification('a@example.com')).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
