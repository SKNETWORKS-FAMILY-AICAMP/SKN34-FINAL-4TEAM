import { afterEach, expect, it, vi } from 'vitest'
import { requestLeave, toastDuration } from './events'

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

it.each([
  ['다크 모드로 바꿨어요', 2600],
  ['', 2600],
  ['이어 읽기 위치를 저장하지 못했어요 · 읽기는 계속할 수 있어요', 3800],
  ['가'.repeat(60), 5800],
  ['가'.repeat(200), 8000],
])('토스트는 글자 수에 비례해 머문다: %j → %dms (짧아도 2.6초, 길어도 8초)', (text, ms) => {
  expect(toastDuration(text)).toBe(ms)
})

