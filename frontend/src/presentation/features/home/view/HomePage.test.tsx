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

function Carousel({ list = works }: { list?: typeof works }) {
  const [hero, setHero] = useState(0)
  return <MemoryRouter><Hero works={list} hero={hero} setHero={setHero} stepHero={(d) => setHero((i) => i + d)} /></MemoryRouter>
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

  it('소설이 많아도 위치 점은 현재 위치 주변 5개만 그리고 넘기면 따라 움직인다', () => {
    // 점 버튼은 44px 터치 대상이라 소설 수만큼 늘리면 좁은 화면에서 줄어들거나 넘친다.
    const many = Array.from({ length: 12 }, (_, i) => ({ ...works[0], id: `w${i}`, title: `소설 ${i + 1}` }))
    render(<Carousel list={many} />)
    const dots = () => screen.getAllByRole('button', { name: /번째 소설 보기/ })
    const pressed = () => dots().filter((dot) => dot.getAttribute('aria-pressed') === 'true').map((dot) => dot.getAttribute('aria-label'))
    const names = () => dots().map((dot) => dot.getAttribute('aria-label')!.replace('번째 소설 보기', ''))
    expect(names()).toEqual(['1', '2', '3', '4', '5'])
    expect(pressed()).toEqual(['1번째 소설 보기'])
    fireEvent.click(screen.getByRole('button', { name: '5번째 소설 보기' }))
    expect(count()).toBe('5 / 12')
    expect(names()).toEqual(['3', '4', '5', '6', '7'])
    expect(pressed()).toEqual(['5번째 소설 보기'])
    fireEvent.click(screen.getByRole('button', { name: '다음 소설' }))
    expect(names()).toEqual(['4', '5', '6', '7', '8'])
    expect(pressed()).toEqual(['6번째 소설 보기'])
  })

  it('마지막 소설에서는 끝의 점 5개를 그린다', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...works[0], id: `w${i}`, title: `소설 ${i + 1}` }))
    render(<Carousel list={many} />)
    fireEvent.click(screen.getByRole('button', { name: '이전 소설' }))
    expect(count()).toBe('12 / 12')
    const dots = screen.getAllByRole('button', { name: /번째 소설 보기/ })
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual(['8번째 소설 보기', '9번째 소설 보기', '10번째 소설 보기', '11번째 소설 보기', '12번째 소설 보기'])
    expect(dots[4].getAttribute('aria-pressed')).toBe('true')
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
