import { expect, it } from 'vitest'

import { adminReturnPath } from '../entities/admin'

it('관리자 로그인 복귀는 허용 탭만 보존하고 외부 경로·임의 쿼리를 버린다', () => {
  expect(adminReturnPath('?tab=notices')).toBe('/admin?tab=notices')
  expect(adminReturnPath('?tab=events&next=https://example.invalid')).toBe('/admin?tab=events')
  expect(adminReturnPath('?tab=feedback')).toBe('/admin?tab=feedback')
  expect(adminReturnPath('?tab=ai')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=https://example.invalid')).toBe('/admin?tab=data')
  expect(adminReturnPath('?next=//example.invalid')).toBe('/admin')
  expect(adminReturnPath('')).toBe('/admin')
})
