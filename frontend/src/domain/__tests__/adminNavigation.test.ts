import { describe, expect, it } from 'vitest'

import { adminReturnPath, oidcAuthorizeReturn } from '../entities/admin'

it('관리자 로그인 복귀는 허용 탭만 보존하고 외부 경로·임의 쿼리를 버린다', () => {
  expect(adminReturnPath('?tab=notices')).toBe('/admin?tab=notices')
  expect(adminReturnPath('?tab=events&next=https://example.invalid')).toBe('/admin?tab=events')
  expect(adminReturnPath('?tab=feedback')).toBe('/admin?tab=feedback')
  expect(adminReturnPath('?tab=ai')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=https://example.invalid')).toBe('/admin?tab=data')
  expect(adminReturnPath('?next=//example.invalid')).toBe('/admin')
  expect(adminReturnPath('')).toBe('/admin')
})

describe('Langfuse 로그인 복귀 (DEC-55)', () => {
  it('Core OIDC 인가 주소만 허용하고 쿼리는 그대로 보존하며 조각(#)은 버린다', () => {
    const authorize = '/api/v1/auth/oidc/authorize?client_id=langfuse&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb&state=s&code_challenge=c'
    expect(oidcAuthorizeReturn(authorize)).toBe(authorize)
    expect(oidcAuthorizeReturn('/api/v1/auth/oidc/authorize')).toBe('/api/v1/auth/oidc/authorize')
    expect(oidcAuthorizeReturn('/api/v1/auth/oidc/authorize?a=1#frag')).toBe('/api/v1/auth/oidc/authorize?a=1')
  })

  it.each([
    null, '', '/', '/admin?tab=llm', '/api/v1/auth/login', '/api/v1/auth/oidc/token',
    '/api/v1/auth/oidc/authorize/extra', '/api/v1/auth/oidc/authorized', '/api/v1/auth/oidc/../authorize', '/api/v1/auth/oidc%2Fauthorize',
    'https://evil.example/api/v1/auth/oidc/authorize', '//evil.example/api/v1/auth/oidc/authorize', '/\\evil.example/api/v1/auth/oidc/authorize', 'javascript:alert(1)',
  ])('%s는 허용하지 않는다', (next) => {
    expect(oidcAuthorizeReturn(next)).toBeNull()
  })
})
