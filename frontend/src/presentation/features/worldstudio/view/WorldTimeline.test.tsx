// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { canvasSize, notifyResize } from '../../../../test/forceGraphFake'
import { WorldTimeline } from './WorldTimeline'

// forceGraphFake를 가져오면 jsdom에 없는 ResizeObserver와 요소 크기(기본 800×600)가 설치된다(숨긴 상자는 canvasSize.w = 0 뒤 notifyResize()).
beforeEach(() => { canvasSize.w = 800; canvasSize.h = 600 })
afterEach(cleanup)

const event = (title: string, reveal?: number, item: Partial<StudioSetting['item']> = {}): StudioSetting => {
  const row = newSetting()
  Object.assign(row.item, { kind: 'event', title, timeText: '', text: title + ' 설명', ...item })
  if (reveal) row.revealFromEpisode = reveal
  return row
}
const person = (title: string) => { const row = newSetting('people'); row.item.title = title; return row }
const region = () => screen.getByRole('region', { name: '사건 시간선' })
const eventButtons = () => within(region()).getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
const titles = () => eventButtons().map((b) => b.querySelector('strong')!.textContent)
const pressed = () => eventButtons().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.querySelector('strong')!.textContent)

it('사건이 없으면 안내 한 줄만 보인다', () => {
  render(<WorldTimeline settings={[]} />)
  expect(screen.getByText('아직 확정한 과거 사건이 없어요.')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '사건 시간선' })).toBeNull()
})

it('가로 시간축: 회차 열 순서로 사건이 놓이고 축 위에 회차 눈금(1화…)이 있으며, 처음엔 첫 사건이 골라져 설명에 보인다', () => {
  render(<WorldTimeline settings={[event('셋째', 6), event('첫째', 1), event('둘째', 3), event('둘째 반', 3)]} />)
  expect(titles()).toEqual(['첫째', '둘째', '둘째 반', '셋째']) // 열(회차) 순서, 같은 열은 위아래
  expect([...region().querySelectorAll('svg text')].map((t) => t.textContent)).toEqual(['1화', '3화', '6화'])
  expect(pressed()).toEqual(['첫째'])
  expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('첫째')
  const wide = eventButtons().map((b) => Number.parseFloat(b.style.left))
  expect(wide[0]).toBeLessThan(wide[1])
  expect(wide[1]).toBe(wide[2]) // 같은 회차는 같은 열(왼쪽 위치가 같다)
  expect(Number.parseFloat(eventButtons()[2].style.top)).toBeGreaterThan(Number.parseFloat(eventButtons()[1].style.top)) // 위아래
})

it('사건을 누르면 그 사건이 골라지고(aria-pressed) 설명·앞선 사건이 바뀌며, 본문의 카드 링크는 글자만 보인다', () => {
  const first = event('건국', 1), second = event('전쟁', 2, { afterId: first.item.id, text: '[가람](card:' + crypto.randomUUID() + ')이 싸웠다', timeText: '3년' })
  render(<WorldTimeline settings={[first, second]} />)
  fireEvent.click(eventButtons()[1])
  expect(pressed()).toEqual(['전쟁'])
  expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('전쟁')
  expect(document.querySelector('.world-timeline-description .world-prose')!.textContent).toBe('가람이 싸웠다')
  expect(screen.getByText('앞선 사건 · 건국')).toBeTruthy()
  expect(screen.getAllByText('3년').length).toBeGreaterThan(0) // 시점 글(사건 버튼과 설명 칩)
})

it('사건 버튼은 방향키로 오가고(←→↑↓ 다음·이전 사건, 한 곳만 Tab 자리) 골라진 사건은 누른 뒤에도 aria-pressed가 남는다', () => {
  render(<WorldTimeline settings={[event('가', 1), event('나', 2), event('다', 2)]} />)
  const [a, b, c] = eventButtons()
  expect([a, b, c].map((x) => x.tabIndex)).toEqual([0, -1, -1])
  act(() => a.focus())
  fireEvent.keyDown(a, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(b)
  fireEvent.keyDown(b, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(c)
  expect([a, b, c].map((x) => x.tabIndex)).toEqual([-1, -1, 0])
  fireEvent.keyDown(c, { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(b)
  fireEvent.keyDown(a, { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(b) // 처음 앞에서는 움직이지 않는다
  fireEvent.click(b)
  expect(pressed()).toEqual(['나'])
})

it('참여 인물·장소 칩은 설명 아래에 있고 누르면 그 카드의 편집 화면으로 간다', () => {
  const hero = person('주인공'), e = event('전투', 3)
  const settings = putRelation([hero, e], { subjectId: hero.item.id, targetId: e.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '참여' })
  const open = vi.fn()
  render(<WorldTimeline settings={settings} onOpenCard={open} />)
  fireEvent.click(screen.getByRole('button', { name: '주인공' }))
  expect(open).toHaveBeenCalledWith(hero.item.id)
})

it('한 열에 사건이 6개를 넘으면 사건 N 한 줄로 접히고(고른 사건이 든 열은 펼친 채 시작) 눌러서 펼치고 접는다', () => {
  const many = Array.from({ length: 8 }, (_, i) => event('많은' + i, 1))
  render(<WorldTimeline settings={[...many, event('뒤', 2), ...Array.from({ length: 7 }, (_, i) => event('둘째열' + i, 5))]} />)
  const toggles = () => within(region()).getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded'))
  expect(toggles().map((b) => [b.textContent, b.getAttribute('aria-expanded')])).toEqual([['사건 8', 'true'], ['사건 7', 'false']]) // 첫 사건이 든 열만 펼침
  expect(titles()).toEqual([...many.map((m) => m.item.title), '뒤'])
  fireEvent.click(toggles()[0])
  expect(titles()).toEqual(['뒤']) // 접히면 사건 버튼이 사라진다(고른 사건은 설명에 남는다)
  expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('많은0')
  fireEvent.click(toggles()[1])
  expect(titles()).toHaveLength(1 + 7)
})

it('회차 열이 20개를 넘으면 구간으로 나눠 한 쪽에 20열만 그리고 이전·다음 구간으로 옮긴다', () => {
  const settings = Array.from({ length: 30 }, (_, i) => event('사건' + (i + 1), i + 1))
  render(<WorldTimeline settings={settings} />)
  expect(eventButtons()).toHaveLength(20)
  const pager = screen.getByRole('navigation', { name: '회차 구간' })
  expect(pager.textContent).toContain('1화–20화')
  expect((within(pager).getByRole('button', { name: '이전 구간' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(pager).getByRole('button', { name: '다음 구간' }))
  expect(titles()).toEqual(Array.from({ length: 10 }, (_, i) => '사건' + (21 + i)))
  expect(pager.textContent).toContain('21화–30화')
  expect((within(pager).getByRole('button', { name: '다음 구간' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('사건1') // 고른 사건은 구간을 옮겨도 설명에 남는다
  render(<WorldTimeline settings={[event('한 쪽', 1)]} />)
})

it('큰 세계관(사건 1634·회차 199)도 한 번에 사건 버튼 수백 개 이하만 그린다', () => {
  const settings = Array.from({ length: 1634 }, (_, i) => event('사건' + i, 1 + (i % 199)))
  render(<WorldTimeline settings={settings} />)
  expect(within(region()).getAllByRole('button').length).toBeLessThanOrEqual(400)
  expect(screen.getByRole('navigation', { name: '회차 구간' }).textContent).toContain('1화–20화')
})

it('시간축 SVG는 상자 크기를 재서 그리고(사이드바 접기·창 크기로 바뀌면 다시), 크기가 0이면 그리지 않는다. 사건 버튼은 크기와 무관하게 남는다', () => {
  canvasSize.w = 0; canvasSize.h = 0
  render(<WorldTimeline settings={[event('가', 1), event('나', 2)]} />)
  expect(region().querySelector('svg')).toBeNull()
  expect(eventButtons()).toHaveLength(2)
  canvasSize.w = 800; canvasSize.h = 400
  act(() => notifyResize())
  expect(region().querySelector('svg')!.getAttribute('width')).toBe('800') // 열 둘(264px)보다 상자가 넓으면 축이 상자 폭을 채운다
  canvasSize.w = 300
  act(() => notifyResize())
  expect(Number(region().querySelector('svg')!.getAttribute('width'))).toBeGreaterThanOrEqual(264) // 상자보다 보드가 넓으면 보드 폭(가로 스크롤)
  canvasSize.w = 0
  act(() => notifyResize())
  expect(region().querySelector('svg')).toBeNull()
})

it('선은 열마다 세로 한 줄(축에서 그 열의 마지막 사건 점까지)이고 열과 열 사이를 잇는 대각선은 없다 — 열 사이의 시간 흐름은 축 눈금만으로 보인다', () => {
  render(<WorldTimeline settings={[event('가', 1), event('나', 1), event('다', 1), event('라', 2)]} />)
  const svg = region().querySelector('svg')!
  expect(svg.querySelector('polyline')).toBeNull() // 열 사이를 지그재그로 잇던 선
  const stems = [...svg.querySelectorAll('line.world-timeline-stem')]
  expect(stems.map((s) => [s.getAttribute('x1'), s.getAttribute('x2')])).toEqual([['66', '66'], ['198', '198']]) // 모두 세로(x가 같다), 열 가운데
  expect(stems.map((s) => [s.getAttribute('y1'), s.getAttribute('y2')])).toEqual([['24', '248'], ['24', '64']]) // 1화 열은 셋째 사건(64+2×92)까지, 2화 열은 첫 사건까지
  expect(svg.querySelectorAll('line:not(.world-timeline-stem)')).toHaveLength(1 + 2) // 축 하나 + 눈금 둘
})

it('접힌 열(사건 N)의 세로 줄은 그 버튼까지, 펼치면 마지막 사건까지다', () => {
  const many = Array.from({ length: 8 }, (_, i) => event('많은' + i, 1))
  render(<WorldTimeline settings={[...many, event('뒤', 2)]} />)
  const stem = () => region().querySelector('line.world-timeline-stem')!
  expect(stem().getAttribute('y2')).toBe(String(64 + 8 * 92)) // 펼친 열: 사건 N 줄 아래 사건 8개의 마지막
  fireEvent.click(within(region()).getByRole('button', { name: '사건 8' }))
  expect(stem().getAttribute('y2')).toBe('64') // 접힌 열: 사건 N 버튼까지
})

it('afterId 선후는 얇은 곡선 화살표(1.5px 이하)이고, 선후가 없으면 화살표가 없다', () => {
  const first = event('건국', 1), second = event('전쟁', 2, { afterId: first.item.id })
  render(<WorldTimeline settings={[first, second]} />)
  const arrow = region().querySelector('svg path[marker-end]')!
  expect(arrow.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ Q /) // 곡선
  expect(Number(arrow.getAttribute('stroke-width'))).toBeLessThanOrEqual(1.5)
  cleanup()
  render(<WorldTimeline settings={[event('가', 1), event('나', 2)]} />)
  expect(region().querySelector('svg path[marker-end]')).toBeNull()
})
