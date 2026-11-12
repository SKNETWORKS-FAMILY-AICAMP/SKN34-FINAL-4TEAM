import { expect, it } from 'vitest'

import { screenLabel } from './screenIds'

it('공개 세계관 화면(W02~W04)은 실제 API를 읽으므로 화면 ID 이름에 (데모)를 붙이지 않는다', () => {
  expect(screenLabel('W02')).toBe('W02 세계관 · 공개 둘러보기')
  expect(screenLabel('W03')).toBe('W03 세계관 · 공개 상세')
  expect(screenLabel('W04')).toBe('W04 세계관 · 공개 설정 카드')
})

it("캐릭터챗 화면(U27)의 이름은 화면 제목·관리자 메뉴와 같은 붙여 쓴 표기다", () => {
  expect(screenLabel('U27')).toBe('U27 캐릭터챗')
})

