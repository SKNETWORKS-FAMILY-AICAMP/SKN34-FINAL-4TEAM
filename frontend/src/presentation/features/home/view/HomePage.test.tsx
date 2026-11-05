// @vitest-environment jsdom
// React 조립 회귀: CI 통합 계층에서만 실행한다.
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { seedWorks } from '../../../../data/mock/seed'
import { Hero } from './HomePage'

const works = seedWorks(0).filter((w) => !w.parent && !w.private)
let reduced = false
const mediaListeners = new Set<() => void>()
const motion = (value: boolean) => act(() => { reduced = value; mediaListeners.forEach((listener) => listener()) })
const advance = (ms = 4500) => act(() => { vi.advanceTimersByTime(ms) })
const count = () => document.getElementById('cnt')!.textContent

function Carousel() {
  const [hero, setHero] = useState(0)
  return <MemoryRouter><Hero works={works} hero={hero} setHero={setHero} stepHero={(d) => setHero((i) => i + d)} /></MemoryRouter>
}

beforeEach(() => {
  vi.useFakeTimers()
  reduced = false
  mediaListeners.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return reduced },
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  })))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200 } as DOMRect)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('홈 Hero 자동 넘김과 접근성', () => {
  it('4.5초마다 넘기고, 포커스가 들어오면 떠난 뒤에도 명시적으로 재생하기 전까지 정지한다', () => {
    render(<Carousel />)
    advance()
    expect(count()).toBe('2 / 4')
    const link = within(screen.getByRole('region', { name: '추천 소설' })).getByRole('link')
    act(() => link.focus())
    advance(9000)
    expect(count()).toBe('2 / 4')
    expect(document.activeElement).toBe(link)
    act(() => link.blur())
    advance()
    expect(count()).toBe('2 / 4')
    fireEvent.click(screen.getByRole('button', { name: '자동 넘김 재생' }))
    advance()
    expect(count()).toBe('3 / 4')
    fireEvent.click(screen.getByRole('button', { name: '자동 넘김 일시 정지' }))
    advance()
    expect(count()).toBe('3 / 4')
  })

  it('hover와 열린 시트에서는 넘기지 않고 수동 정지는 hover 종료로 풀리지 않는다', () => {
    render(<Carousel />)
    const region = screen.getByRole('region', { name: '추천 소설' })
    fireEvent.mouseEnter(region)
    advance()
    expect(count()).toBe('1 / 4')
    fireEvent.mouseLeave(region)
    advance()
    expect(count()).toBe('2 / 4')
    const sheet = document.createElement('div')
    sheet.setAttribute('role', 'dialog')
    document.body.append(sheet)
    advance()
    expect(count()).toBe('2 / 4')
    sheet.remove()
    advance()
    expect(count()).toBe('3 / 4')
    fireEvent.click(screen.getByRole('button', { name: '자동 넘김 일시 정지' }))
    fireEvent.mouseEnter(region)
    fireEvent.mouseLeave(region)
    advance()
    expect(count()).toBe('3 / 4')
  })

  it('reduced motion에서는 JS 타이머를 만들지 않으며 설정 해제 뒤에도 재생을 명시해야 한다', () => {
    reduced = true
    render(<Carousel />)
    expect(vi.getTimerCount()).toBe(0)
    expect(screen.getByRole('button', { name: '자동 넘김 재생' })).toHaveProperty('disabled', true)
    advance(9000)
    expect(count()).toBe('1 / 4')
    motion(false)
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '자동 넘김 재생' }))
    expect(vi.getTimerCount()).toBe(1)
    motion(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('모바일 수동 전환과 양끝 순환이 가능하고 비활성 카드는 탭·접근성 탐색에서 제외한다', () => {
    render(<Carousel />)
    const region = screen.getByRole('region', { name: '추천 소설' })
    expect(within(region).getAllByRole('link')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '이전 소설' }))
    expect(count()).toBe('4 / 4')
    fireEvent.click(screen.getByRole('button', { name: '다음 소설' }))
    expect(count()).toBe('1 / 4')
    fireEvent.click(screen.getByRole('button', { name: '3번째 소설 보기' }))
    expect(count()).toBe('3 / 4')
    for (const link of region.querySelectorAll('a[aria-hidden="true"]')) {
      expect(link.hasAttribute('inert')).toBe(true)
      expect(link.getAttribute('tabindex')).toBe('-1')
    }
  })

  it('데스크톱에서 완전히 보이는 두 카드는 모두 탐색할 수 있고 리사이즈하면 가시 범위를 갱신한다', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(414)
    render(<Carousel />)
    const region = screen.getByRole('region', { name: '추천 소설' })
    expect(within(region).getAllByRole('link')).toHaveLength(2)
    expect(within(region).getAllByRole('button', { name: /번째 소설 보기/ })).toHaveLength(3)
    width.mockReturnValue(240)
    fireEvent(window, new Event('resize'))
    expect(within(region).getAllByRole('link')).toHaveLength(1)
  })
})
