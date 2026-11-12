import { expect, it } from 'vitest'

import { screenLabel } from './screenIds'

it('공개 세계관 화면(W02~W04)은 실제 API를 읽으므로 화면 ID 이름에 (데모)를 붙이지 않는다', () => {
  expect(screenLabel('W02')).toBe('W02 세계관 · 공개 둘러보기')
  expect(screenLabel('W03')).toBe('W03 세계관 · 공개 상세')
  expect(screenLabel('W04')).toBe('W04 세계관 · 공개 설정 카드')
})
