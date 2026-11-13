import { expect, it } from 'vitest'

import { inheritedRangeLabel } from './inheritedRange'

const eps = (...inherited: boolean[]) => inherited.map((flag, i) => ({ number: i + 1, inherited: flag }))

it('원작에서 이어받은 회차가 없으면 빈 문자열이다', () => {
  expect(inheritedRangeLabel([])).toBe('')
  expect(inheritedRangeLabel(eps(false, false))).toBe('')
})

it('이어받은 회차가 이어지면 처음~끝 범위로 줄이고, 내 회차는 세지 않는다', () => {
  expect(inheritedRangeLabel(eps(true, true, false))).toBe('1~2화')
  expect(inheritedRangeLabel(eps(true, true, true, false, false))).toBe('1~3화')
})

it('이어받은 회차가 하나면 그 회차 번호만 쓴다', () => {
  expect(inheritedRangeLabel(eps(true, false))).toBe('1화')
  expect(inheritedRangeLabel([{ number: 3, inherited: true }])).toBe('3화')
})

it('번호가 끊기면 이어진 묶음마다 따로 쓰고, 입력 순서와 상관없이 번호순으로 센다', () => {
  expect(inheritedRangeLabel(eps(true, true, false, true))).toBe('1~2화, 4화')
  expect(inheritedRangeLabel([{ number: 2, inherited: true }, { number: 1, inherited: true }, { number: 5, inherited: true }])).toBe('1~2화, 5화')
})
