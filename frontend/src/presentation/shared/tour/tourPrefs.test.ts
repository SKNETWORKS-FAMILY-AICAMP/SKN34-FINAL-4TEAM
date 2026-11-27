// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

import { isTourSeen, markTourSeen, tourKey, tourOffKey } from './tourPrefs'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

it('화면 키는 storyfork.tour.<화면>, 탭·패널 키는 storyfork.tour.<화면>.<탭> 형식이다', () => {
  expect(tourKey('studio')).toBe('storyfork.tour.studio')
  expect(tourKey('manage', 'settings')).toBe('storyfork.tour.manage.settings')
})

it('본 적이 없는 화면은 안 본 것으로 본다', () => {
  expect(isTourSeen('studio')).toBe(false)
  expect(isTourSeen('manage', 'settings')).toBe(false)
})

it('화면마다 따로 기억한다', () => {
  markTourSeen('studio')
  expect(localStorage.getItem(tourKey('studio'))).toBe('seen')
  expect(isTourSeen('studio')).toBe(true)
  expect(isTourSeen('manage')).toBe(false)
})

it('탭마다 따로 기억하고, 화면을 봤다고 그 안의 탭을 본 것이 되지 않는다', () => {
  markTourSeen('manage')
  expect(isTourSeen('manage', 'settings')).toBe(false)
  markTourSeen('manage', 'settings')
  expect(localStorage.getItem('storyfork.tour.manage.settings')).toBe('seen')
  expect(isTourSeen('manage', 'settings')).toBe(true)
  expect(isTourSeen('manage', 'read')).toBe(false)
  expect(isTourSeen('world', 'settings')).toBe(false)
})

it("storyfork.tour 값이 'off'면 모든 화면·탭을 본 것으로 본다(키를 하나씩 적지 않는 끄기 스위치)", () => {
  expect(tourOffKey).toBe('storyfork.tour')
  localStorage.setItem(tourOffKey, 'off')
  expect(isTourSeen('card')).toBe(true)
  expect(isTourSeen('manage', 'serial')).toBe(true)
  localStorage.setItem(tourOffKey, 'on')
  expect(isTourSeen('card')).toBe(false)
})

it('저장소를 읽거나 쓸 수 없어도 예외 없이 동작하고 읽기 실패는 안 본 것으로 본다', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  expect(() => markTourSeen('studio')).not.toThrow()
  expect(isTourSeen('studio')).toBe(false)
})
