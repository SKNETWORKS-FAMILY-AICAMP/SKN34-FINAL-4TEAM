// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

import { jumpTo } from './jumpTo'

// jsdom에는 scrollIntoView·animate가 없다
const scrollIntoView = vi.fn()
const animate = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView
Element.prototype.animate = animate as never
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); Reflect.deleteProperty(window, 'matchMedia') })

/** 접힌 상위 문단(details) 둘 안의 대상 summary */
const page = () => {
  document.body.innerHTML = '<details id="outer" open><summary>바깥</summary><details id="inner" open><summary id="target" tabindex="-1">대상</summary></details></details>'
  return document.getElementById('target')!
}
const colors = () => (animate.mock.calls[0][0] as { backgroundColor: string }[]).map((frame) => frame.backgroundColor)

it('id의 요소로 스크롤하고 초점을 옮기며 접힌 상위 문단은 펼치고 강조는 요청할 때만 한다', () => {
  const target = page()
  const [outer, inner] = ['outer', 'inner'].map((id) => document.getElementById(id) as HTMLDetailsElement)
  outer.open = inner.open = false
  jumpTo('target')
  expect([outer.open, inner.open]).toEqual([true, true])
  expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' })
  expect(document.activeElement).toBe(target)
  expect(animate).not.toHaveBeenCalled()
})

it('flash이면 대상을 서서히 사라지는 색으로 잠깐 강조한다', () => {
  const target = page()
  jumpTo('target', true)
  expect(animate.mock.contexts).toEqual([target])
  expect(colors()).toEqual([expect.stringContaining('color-mix'), 'transparent'])
  expect(animate.mock.calls[0][1]).toEqual({ duration: 1600 })
})

it('움직임 줄이기 설정이면 부드럽게 스크롤하지 않고 강조도 서서히 사라지지 않는 고정 색이다', () => {
  page()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
  jumpTo('target', true)
  expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' })
  expect(new Set(colors()).size).toBe(1)
})

it('없는 id면 아무 일도 하지 않는다', () => {
  page()
  expect(() => jumpTo('없음', true)).not.toThrow()
  expect(scrollIntoView).not.toHaveBeenCalled()
  expect(animate).not.toHaveBeenCalled()
})
