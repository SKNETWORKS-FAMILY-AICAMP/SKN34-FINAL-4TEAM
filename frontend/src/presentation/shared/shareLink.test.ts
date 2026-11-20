// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

import { shareLink } from './shareLink'

const URL_ = 'https://storyfork.test/read/w/1'
const toasts: string[] = []
window.addEventListener('sf-toast', (event) => toasts.push((event as CustomEvent<string>).detail))
const stub = (name: 'share' | 'clipboard', value: unknown) => Object.defineProperty(navigator, name, { value, configurable: true })
const denied = { writeText: () => Promise.reject(new Error('denied')) }

afterEach(() => {
  toasts.length = 0
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'clipboard')
})

it('Web Share가 있어도 먼저 주소를 클립보드에 복사하고 토스트로 알린다(공유 창은 열지 않는다)', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  const writeText = vi.fn().mockResolvedValue(undefined)
  stub('share', share)
  stub('clipboard', { writeText })
  await shareLink(URL_)
  expect(writeText).toHaveBeenCalledWith(URL_)
  expect(share).not.toHaveBeenCalled()
  expect(toasts).toEqual(['링크를 복사했어요'])
})

it('복사를 못 하면 Web Share 공유 창을 열고 따로 안내하지 않는다', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  stub('share', share)
  stub('clipboard', denied)
  await shareLink(URL_)
  expect(share).toHaveBeenCalledWith({ url: URL_ })
  expect(toasts).toEqual([])
})

it('복사를 못 해 연 공유 창을 사용자가 닫으면(AbortError) 조용히 끝난다', async () => {
  stub('share', vi.fn().mockRejectedValue(new DOMException('canceled', 'AbortError')))
  stub('clipboard', denied)
  await shareLink(URL_)
  expect(toasts).toEqual([])
})

it('복사도 공유 창도 못 하면 성공으로 숨기지 않고 주소를 알려 준다', async () => {
  stub('clipboard', undefined)
  await shareLink(URL_)
  stub('share', vi.fn().mockRejectedValue(new DOMException('no gesture', 'NotAllowedError')))
  stub('clipboard', denied)
  await shareLink(URL_)
  expect(toasts).toEqual([`링크를 복사하지 못했어요 · ${URL_}`, `링크를 복사하지 못했어요 · ${URL_}`])
})
