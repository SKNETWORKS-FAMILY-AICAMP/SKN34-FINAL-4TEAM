import { afterEach, expect, it, vi } from 'vitest'
import { requestLeave } from './events'

afterEach(() => vi.unstubAllGlobals())

it('이탈 요청은 취소할 수 있고 구독 해제 후에는 이동을 막지 않는다', () => {
  const target = new EventTarget()
  vi.stubGlobal('window', target)
  const guard = vi.fn((event: Event) => event.preventDefault())
  expect(requestLeave()).toBe(true)
  target.addEventListener('sf-before-leave', guard)
  expect(requestLeave()).toBe(false)
  expect(guard).toHaveBeenCalledTimes(1)
  target.removeEventListener('sf-before-leave', guard)
  expect(requestLeave()).toBe(true)
})
