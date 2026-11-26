// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

import { isTourSeen, markTourSeen, tourKey, tourScreens } from './tourPrefs'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

it('화면 키는 storyfork.tour.<화면> 형식이다', () => {
  expect(tourKey('studio')).toBe('storyfork.tour.studio')
})

it('본 적이 없는 화면은 안 본 것으로 본다', () => {
  expect(isTourSeen('studio')).toBe(false)
})

it('화면마다 따로 기억한다', () => {
  markTourSeen('studio')
  expect(localStorage.getItem(tourKey('studio'))).toBe('seen')
  expect(isTourSeen('studio')).toBe(true)
  expect(isTourSeen('manage')).toBe(false)
})

it('투어가 있는 화면은 아홉 곳이고 키가 겹치지 않는다', () => {
  expect(tourScreens).toHaveLength(9)
  expect(new Set(tourScreens).size).toBe(9)
})

it('저장소를 읽거나 쓸 수 없어도 예외 없이 동작하고 읽기 실패는 안 본 것으로 본다', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  expect(() => markTourSeen('studio')).not.toThrow()
  expect(isTourSeen('studio')).toBe(false)
})
