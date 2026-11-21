// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { CardRelationMap } from './CardRelationMap'
import type { RelationEntry } from './cardRelations'
import type { CardKind } from './worldBoard'

afterEach(cleanup)

let n = 0
const entry = (other: string, steps: [string, number | null][], kind: CardKind = '인물'): RelationEntry => ({ id: 'r' + ++n, otherId: other, otherTitle: other, otherKind: kind, steps: steps.map(([name, episode]) => ({ name, episode })) })
const center = { id: 'c', title: '홍길동', kind: '인물' as CardKind }
const ui = (props: Partial<Parameters<typeof CardRelationMap>[0]> & { entries: RelationEntry[] }) => <MemoryRouter><CardRelationMap center={center} {...props} /></MemoryRouter>
const svg = () => document.querySelector('svg.card-relmap-svg')!
const listed = () => within(screen.getByRole('list', { name: '관계 목록' })).getAllByRole('listitem').map((li) => li.textContent)

it('그림은 aria-hidden이고 둘레에는 사건이 아닌 이웃 최대 16명만 두며, 넘치는 수를 알리고 아래 목록에는 모두 있다', () => {
  const rows = Array.from({ length: 20 }, (_, i) => entry('이웃' + i, [['친구', i + 1]]))
  render(ui({ entries: rows }))
  expect(svg().getAttribute('aria-hidden')).toBe('true')
  expect(svg().querySelectorAll('.card-relmap-node')).toHaveLength(16)
  expect(svg().querySelectorAll('line')).toHaveLength(16)
  expect(screen.getByText('외 4개는 아래 목록에서 볼 수 있어요')).toBeTruthy()
  expect(listed()).toHaveLength(20)
  expect(listed()[0]).toContain('— 친구')
  expect(svg().textContent).toContain('홍길동') // 가운데 카드
})

it('같은 상대의 관계는 선 하나이고 선 위에는 가장 늦은 회차의 관계 이름(+외 N), 올리면 이력이 말풍선으로, 목록에는 상대 — 관계 이름 · N화부터가 보인다', () => {
  render(ui({ entries: [entry('세라핀', [['경계', 1]]), entry('세라핀', [['보호', 3]])] }))
  expect(svg().querySelectorAll('line')).toHaveLength(1)
  expect(svg().querySelector('.card-relmap-edge')!.textContent).toBe('보호 외 1')
  expect(svg().querySelector('.card-relmap-node title')!.textContent).toBe('세라핀 — 경계(1화) → 보호(3화)')
  expect(listed()).toEqual(['세라핀 — 보호 외 1 · 1화부터 경계(1화) → 보호(3화)'])
})

it('사건은 둘레에 두지 않고 함께한 사건 N(회차순, 접힘 목록)에 모은다', () => {
  render(ui({ entries: [entry('친구', [['동료', 1]]), entry('늦은 전투', [['참여', 9]], '사건'), entry('이른 전투', [['참여', 2]], '사건')] }))
  expect(svg().querySelectorAll('.card-relmap-node')).toHaveLength(1)
  const details = screen.getByText('함께한 사건 2').closest('details')!
  expect(details.open).toBe(false)
  expect(within(details).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['이른 전투 — 참여 · 2화', '늦은 전투 — 참여 · 9화'])
})

it('회차 탭: 전체·관계가 생기거나 바뀌는 회차가 있고 N화 탭은 그 시점까지의 관계만 보이며(방향키로 옮긴다), 6개를 넘으면 더보기로 고른다', () => {
  render(ui({ entries: [entry('가', [['경계', 1], ['보호', 3]]), entry('나', [['동료', 5]]), entry('다', [['친구', 7]]), entry('라', [['적', 9]]), entry('마', [['스승', 11]]), entry('바', [['제자', 13]]), entry('사', [['벗', 15]])] }))
  const tabs = within(screen.getByRole('tablist', { name: '공개 회차' }))
  expect(tabs.getAllByRole('tab').map((t) => t.textContent)).toEqual(['전체', '1화', '3화', '5화', '7화', '9화', '11화']) // 앞 6개
  expect(tabs.getByRole('tab', { name: '전체' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(tabs.getByRole('tab', { name: '1화' }))
  expect(listed()).toEqual(['가 — 경계 · 1화부터'])
  fireEvent.keyDown(tabs.getByRole('tab', { name: '1화' }), { key: 'ArrowRight' })
  expect(tabs.getByRole('tab', { name: '3화' }).getAttribute('aria-selected')).toBe('true')
  expect(listed()).toEqual(['가 — 보호 · 1화부터 경계(1화) → 보호(3화)'])
  fireEvent.keyDown(tabs.getByRole('tab', { name: '3화' }), { key: 'End' })
  expect(tabs.getByRole('tab', { name: '11화' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.change(tabs.getByRole('combobox', { name: '더 많은 회차' }), { target: { value: '15' } })
  expect(listed()).toHaveLength(7) // 15화 시점에는 모두
  fireEvent.click(tabs.getByRole('tab', { name: '전체' }))
  expect(listed()).toHaveLength(7)
})

it('작가 화면은 가운데 카드의 공개 회차보다 앞선 탭에 독자에게 숨김을 단다(공개 화면은 공개 회차를 주지 않는다)', () => {
  const rows = [entry('가', [['경계', 1]]), entry('나', [['동료', 5]])]
  render(ui({ entries: rows, revealEpisode: 3 }))
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['전체', '1화 숨김', '5화'])
  expect(screen.getAllByRole('tab')[1].getAttribute('title')).toBe('아직 독자에게 숨김')
  expect(screen.getAllByRole('tab')[2].getAttribute('title')).toBeNull()
  cleanup()
  render(ui({ entries: rows }))
  expect(screen.queryByText('숨김')).toBeNull()
})

it('이웃이 없으면 한 줄 안내와 동작(작가 화면의 관계 추가)이고, 그 시점에 이웃이 없으면 그렇게 알린다', () => {
  const view = render(ui({ entries: [], emptyAction: <button type="button">관계 추가</button> }))
  expect(screen.getByText(/아직 연결된 설정이 없어요/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '관계 추가' })).toBeTruthy()
  expect(document.querySelector('svg')).toBeNull()
  view.unmount()
  render(ui({ entries: [entry('가', [['경계', 5]])] }))
  fireEvent.click(screen.getByRole('tab', { name: '5화' }))
  expect(listed()).toHaveLength(1)
})

it('작가 화면의 이웃(목록 버튼·그림)은 onOpen으로 편집 화면을 열고, 공개 화면은 hrefOf의 링크로 가며 그림을 눌러도 같은 곳으로 간다', () => {
  const open = vi.fn()
  const view = render(ui({ entries: [entry('세라핀', [['보호', 3]])], onOpen: open }))
  fireEvent.click(screen.getByRole('button', { name: '세라핀' }))
  expect(open).toHaveBeenLastCalledWith('세라핀')
  fireEvent.click(svg().querySelector('.card-relmap-node')!)
  expect(open).toHaveBeenCalledTimes(2)
  view.unmount()
  function Where() { return <p data-testid="where">{useLocation().pathname}</p> }
  render(<MemoryRouter><Routes><Route path="*" element={<><CardRelationMap center={center} entries={[entry('세라핀', [['보호', 3]])]} hrefOf={(id) => '/worlds/w/cards/' + id} /><Where /></>} /></Routes></MemoryRouter>)
  const link = screen.getByRole('link', { name: '세라핀' })
  expect(link.getAttribute('href')).toBe('/worlds/w/cards/세라핀')
  fireEvent.click(svg().querySelector('.card-relmap-node')!)
  expect(screen.getByTestId('where').textContent).toBe('/worlds/w/cards/세라핀')
})

it('이웃이 아주 많아도(89명·사건 80) 그림 16개·목록은 50개씩 쪽으로·사건은 접힌 목록이다', () => {
  const rows = [...Array.from({ length: 89 }, (_, i) => entry('이웃' + i, [['관계', 1 + (i % 9)]], i % 3 ? '인물' : '장소')), ...Array.from({ length: 80 }, (_, i) => entry('사건' + i, [['참여', 1 + (i % 50)]], '사건'))]
  render(ui({ entries: rows }))
  expect(svg().querySelectorAll('.card-relmap-node')).toHaveLength(16)
  expect(listed()).toHaveLength(50) // 한 쪽에 50개
  expect(screen.getByText('외 73개는 아래 목록에서 볼 수 있어요')).toBeTruthy()
  expect(screen.getByText('함께한 사건 80').closest('details')!.open).toBe(false)
})
