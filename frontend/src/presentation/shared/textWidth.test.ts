import { expect, it } from 'vitest'
import { textWidth } from './textWidth'

it('textWidth는 한글을 글자당 한 칸(글자 크기)으로, 영문·숫자를 약 0.56칸으로 어림한다', () => {
  expect(textWidth('가람', 12)).toBe(24)
  expect(textWidth('abcd', 12)).toBeCloseTo(4 * 0.56 * 12, 5)
  expect(textWidth('가a', 10)).toBeCloseTo(10 + 5.6, 5)
})
