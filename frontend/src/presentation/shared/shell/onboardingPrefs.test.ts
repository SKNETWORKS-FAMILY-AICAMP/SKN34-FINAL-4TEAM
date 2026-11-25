// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

import { dismissOnboarding, isOnboardingDismissed, onboardingKey } from './onboardingPrefs'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

it('다시 보지 않기를 누른 적이 없으면 숨기지 않는다', () => {
  expect(isOnboardingDismissed()).toBe(false)
})

it('다시 보지 않기를 기록하면 이후에는 숨긴다', () => {
  dismissOnboarding()
  expect(localStorage.getItem(onboardingKey)).toBe('dismissed')
  expect(isOnboardingDismissed()).toBe(true)
})

it('저장소를 읽거나 쓸 수 없어도 예외 없이 동작하고 읽기 실패는 숨기지 않은 것으로 본다', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  expect(() => dismissOnboarding()).not.toThrow()
  expect(isOnboardingDismissed()).toBe(false)
})
