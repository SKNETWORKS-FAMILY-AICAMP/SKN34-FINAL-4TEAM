// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { CardRelationMap } from './CardRelationMap'
import type { RelationEntry } from './cardRelations'
import type { CardKind } from './worldBoard'

afterEach(cleanup)

let n = 0
const entry = (other: string, steps: [string, number | null, string?][], kind: CardKind = '인물'): RelationEntry => ({ id: 'r' + ++n, otherId: other, otherTitle: other, otherKind: kind, steps: steps.map(([name, episode, body]) => ({ name, episode, ...(body ? { body } : {}) })) })
const center = { id: 'c', title: '홍길동', kind: '인물' as CardKind }
const ui = (props: Partial<Parameters<typeof CardRelationMap>[0]> & { entries: RelationEntry[] }) => <MemoryRouter><CardRelationMap center={center} {...props} /></MemoryRouter>
const svg = () => document.querySelector('svg.card-relmap-svg')!
/** 간단 목록의 줄 글: 펼침(details) 안의 이력·본문은 뺀 보이는 한 줄이다. */
const rowText = (li: HTMLElement) => [...li.childNodes].filter((node) => node.nodeName !== 'DETAILS').map((node) => node.textContent).join('')
const listed = () => within(screen.getByRole('list', { name: '관계 목록' })).getAllByRole('listitem').filter((li) => li.parentElement?.getAttribute('aria-label') === '관계 목록').map((li) => rowText(li))

const rowTextOf = (title: string) => rowText(screen.getByRole('button', { name: title }).closest('li')!)

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

it('같은 상대의 관계는 선 하나이고 선 위에는 가장 늦은 회차의 관계 이름만, 올리면 외 N·이력이 말풍선으로, 목록에는 상대 — 관계 이름 · N화부터 · 외 N이 보인다', () => {
  render(ui({ entries: [entry('세라핀', [['경계', 1]]), entry('세라핀', [['보호', 3]])] }))
  expect(svg().querySelectorAll('line')).toHaveLength(1)
  expect(svg().querySelector('.card-relmap-edge')!.textContent).toBe('보호') // 외 N은 선 위가 아니라 목록·말풍선에
  expect(svg().querySelector('.card-relmap-node title')!.textContent).toBe('세라핀 — 보호 외 1 · 경계(1화) → 보호(3화)')
  expect(listed()).toEqual(['세라핀 — 보호 · 1화부터 · 외 1'])
})

const longBody = '길현과 홍길동은 같은 아버지를 둔 이복형제로, 길동은 초부석을 들어 올려 이복형 길현에게 보였다.'
it('선 위 글자는 관계 이름이고 관계 본문(긴 문장)이 아니다: 8자 넘는 이름은 말줄임이며, 본문은 말풍선과 펼친 목록 안에서만 보인다', () => {
  render(ui({ entries: [entry('길현', [['이복형', 2, longBody]]), entry('초낭', [['초부석을 들어 올려 보였다', 3, '긴 설명 문장이다.']])] }))
  const edges = [...svg().querySelectorAll('.card-relmap-edge')].map((t) => t.textContent)
  expect(edges.sort()).toEqual(['이복형', '초부석을 들어 …'].sort())
  expect([...svg().querySelectorAll('text')].map((t) => t.textContent).join('')).not.toContain('이복형제') // 그림에 그려지는 글자에는 본문이 없다(말풍선 title에만)
  expect(svg().querySelector('.card-relmap-node title')!.textContent).toContain(longBody.slice(0, 20)) // 말풍선에는 본문 앞부분
  expect(rowTextOf('길현')).toBe('길현 — 이복형 · 2화부터')
  const more = screen.getByRole('button', { name: '길현' }).closest('li')!.querySelector('details')!
  expect(more.open).toBe(false)
  expect(within(more).getByText(longBody)).toBeTruthy() // 펼친 안에서만
})

it('간단 목록 줄은 상대 — 관계 이름 · N화부터 · 외 N이고, 이력(이름 위주)과 본문은 줄을 펼칠 때(자세히)만 보인다. 이력·본문이 없으면 펼침이 없다', () => {
  render(ui({ entries: [
    entry('길현', [['이복형', 2, '길현과 홍길동은 이복형제다.'], ['형님', 6, '길동은 길현을 형님이라 부른다.']]),
    entry('길현', [['동행', 3]]), entry('길현', [['동료', 4]]), entry('길현', [['스승', 5]]), entry('길현', [['제자', 7]]),
    entry('나래', [['친구', null]]),
  ] }))
  expect(listed()).toEqual(['길현 — 제자 · 2화부터 · 외 4', '나래 — 친구']) // 가장 늦은 회차(7화)의 이름이 대표다
  const row = screen.getByRole('button', { name: '길현' }).closest('li')!, details = row.querySelector('details')!
  expect(details.open).toBe(false)
  expect(within(details).getByText('자세히').getAttribute('aria-label')).toBe('길현 관계 자세히') // 줄마다 같은 글자라 누구의 것인지 이름에 넣는다
  expect(details.querySelector('p')!.textContent).toBe('이복형(2화) → 동행(3화) → 동료(4화) → 스승(5화) → 형님(6화) → 제자(7화)')
  expect([...details.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['형님 길동은 길현을 형님이라 부른다.']) // 본문은 현재 본문만
  expect(screen.getByRole('button', { name: '나래' }).closest('li')!.querySelector('details')).toBeNull() // 이력·본문이 없다
})

it('이웃 이름은 방향마다 맞춤이 다르고(왼쪽 end·오른쪽 start·위아래 middle) 긴 이름은 말줄임이다(상자 안에 드는지는 nodeText 단위 시험이 본다)', () => {
  const rows = Array.from({ length: 16 }, (_, i) => entry('다드 로드리고 가나다라마바사아자차카' + i, [['관계' + i, i + 1]]))
  render(ui({ entries: rows }))
  const texts = [...svg().querySelectorAll('.card-relmap-node text:not(.card-relmap-edge)')]
  expect(texts).toHaveLength(16)
  expect(new Set(texts.map((t) => t.getAttribute('text-anchor')))).toEqual(new Set(['start', 'end', 'middle']))
  expect(texts.some((t) => t.textContent!.endsWith('…'))).toBe(true)
})

it('겹치는 선 이름은 숨기고(목록에 모두 있다) 겹치지 않는 것만 그린다', () => {
  const rows = Array.from({ length: 16 }, (_, i) => entry('이웃' + i, [['아주 긴 관계 이름' + i, 1]]))
  render(ui({ entries: rows }))
  const edges = svg().querySelectorAll('.card-relmap-edge').length
  expect(edges).toBeGreaterThan(0)
  expect(edges).toBeLessThan(16)
  expect(listed()).toHaveLength(16)
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
  expect(listed()).toEqual(['가 — 보호 · 1화부터'])
  fireEvent.keyDown(tabs.getByRole('tab', { name: '3화' }), { key: 'End' })
  expect(tabs.getByRole('tab', { name: '11화' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.change(tabs.getByRole('combobox', { name: '더 많은 회차' }), { target: { value: '15' } })
  expect(listed()).toHaveLength(7) // 15화 시점에는 모두
  expect(tabs.getByRole('tab', { name: '전체' }).tabIndex).toBe(0) // 탭 줄에 없는 회차를 골라도 Tab으로 들어올 자리가 남는다
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

const quiet = ['알고 있음', '전해 들음']
const harry = () => [...Array.from({ length: 5 }, (_, i) => entry('지인' + i, [['알고 있음', 1]])), entry('빌', [['가족', 2]]), entry('지니', [['가족', 3]]), entry('론', [['친구', 4]])]

it('quietKinds를 주면 목록이 관계 종류별 묶음이다: 의미 있는 종류는 위에 열려 있고 알고 있음 (5) 같은 조용한 묶음은 기본으로 접혀 있다(수십 줄이 한꺼번에 늘어서지 않는다)', () => {
  render(ui({ entries: harry(), quietKinds: quiet }))
  const groups = [...document.querySelectorAll<HTMLDetailsElement>('details.card-relmap-kind')]
  expect(groups.map((d) => [d.querySelector('summary')!.textContent, d.open])).toEqual([['가족 (2)', true], ['친구 (1)', true], ['알고 있음 (5)', false]])
  expect(within(screen.getByRole('list', { name: '가족 관계 목록' })).getAllByRole('listitem').map((li) => rowText(li))).toEqual(['빌 — 가족 · 2화부터', '지니 — 가족 · 3화부터'])
  expect(within(screen.getByRole('list', { name: '알고 있음 관계 목록' })).getAllByRole('listitem')).toHaveLength(5) // 접혀 있어도 키보드·낭독기가 펼쳐서 읽는다
  expect(screen.queryByRole('list', { name: '관계 목록' })).toBeNull() // 묶음이 아닌 한 덩어리 목록은 없다
})

it('묶음의 목록도 50개씩 쪽으로 나뉜다(묶음마다 따로)', () => {
  render(ui({ entries: Array.from({ length: 55 }, (_, i) => entry('이웃' + i, [['알고 있음', 1]])), quietKinds: quiet }))
  expect(within(screen.getByRole('list', { name: '알고 있음 관계 목록' })).getAllByRole('listitem')).toHaveLength(50)
  expect(screen.getByText('알고 있음 (55)')).toBeTruthy()
})

it('quietKinds가 없으면 기존처럼 한 덩어리 목록이다(공개 카드 페이지)', () => {
  render(ui({ entries: harry() }))
  expect(document.querySelector('details.card-relmap-kind')).toBeNull()
  expect(listed()).toHaveLength(8)
})
