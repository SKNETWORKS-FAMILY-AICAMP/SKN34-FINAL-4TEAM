// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { OrderIssue } from '../../../../domain/entities/worldReview'
import { WorldCardOrder } from './WorldCardOrder'

afterEach(cleanup)

const body = (visibleFrom = 1, over: Partial<OrderIssue> = {}): OrderIssue => ({ cardId: 'me', source: 'body', name: '캠프장', named: { cardId: 'camp', title: '위즐리네 캠프장', from: 64 }, visibleFrom, ...over })
const relation = (id: string, visibleFrom: number): OrderIssue => body(visibleFrom, { source: 'relation', relationId: id })
const show = (issues: OrderIssue[], onOpen = vi.fn(), limit?: number) => { render(<WorldCardOrder issues={issues} limit={limit} relationTitle={(id) => '관계 ' + id} onOpenCard={onOpen} />); return onOpen }

it('경고가 없으면 아무것도 그리지 않는다(공개 순서 문제 없음 한 줄은 공개 범위 칸이 알린다)', () => {
  show([])
  expect(document.body.textContent).toBe('')
})

it('같은 카드 이름이 되풀이돼도 카드별 한 줄이다: 이름(이동 버튼) — N화부터 공개 · 본문 · 관계 글 회차', () => {
  show([body(), ...[17, 20, 23, 40, 62].map((ep, i) => relation('r' + i, ep))])
  const region = screen.getByRole('region', { name: '공개 순서 확인' })
  const items = within(region).getAllByRole('listitem', {}).filter((li) => li.classList.contains('world-finding'))
  expect(items).toHaveLength(1)
  expect(items[0].querySelector('p')!.textContent).toBe('위즐리네 캠프장 — 64화부터 공개 · 본문 1 · 관계 글 5곳 (17·20·23·40·62화)')
})

it('이름 버튼은 그 카드로 옮겨 가고, 자세히는 접혀 있다가 경고마다 어느 글에 어떤 이름이 나오는지 보인다', () => {
  const onOpen = show([body(1), relation('r1', 17), relation('r2', 20)])
  fireEvent.click(screen.getByRole('button', { name: '위즐리네 캠프장' }))
  expect(onOpen).toHaveBeenCalledWith('camp')
  const more = screen.getByText('자세히').closest('details')!
  expect(more.open).toBe(false)
  expect(screen.getByText('자세히').getAttribute('aria-label')).toBe('위즐리네 캠프장 경고 자세히')
  expect([...more.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
    '본문에 ‘캠프장’이(가) 나와요 · 이 글은 1화부터 독자에게 보여요',
    '관계 ‘관계 r1’의 글에 ‘캠프장’이(가) 나와요 · 이 글은 17화부터 독자에게 보여요',
    '관계 ‘관계 r2’의 글에 ‘캠프장’이(가) 나와요 · 이 글은 20화부터 독자에게 보여요',
  ])
})

it('카드마다 따로 묶고 설명 한 줄은 저장·확정을 막지 않는다고 알린다', () => {
  show([body(), body(3, { source: 'relation', relationId: 'r9' }), { ...body(2), named: { cardId: 'x', title: '비밀 방' } }])
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['위즐리네 캠프장', '비밀 방']) // 경고가 많은 카드가 먼저
  expect(screen.getByText(/저장·확정을 막지 않아요/)).toBeTruthy()
  expect(screen.getByText('비밀 방', { selector: 'button' }).closest('li')!.querySelector('p')!.textContent).toBe('비밀 방 — 작가 전용 · 본문 1')
})

it('연결된 소설의 마지막 회차를 넘는 공개 회차는 N화부터 공개 대신 작가 전용 · N화는 아직 없어요로 쓴다(마지막 회차 안이거나 회차 수를 모르면 그대로)', () => {
  show([body()], vi.fn(), 10)
  expect(screen.getByRole('button', { name: '위즐리네 캠프장' }).closest('p')!.textContent).toBe('위즐리네 캠프장 — 작가 전용 · 64화는 아직 없어요 · 본문 1')
  cleanup()
  show([body()], vi.fn(), 64)
  expect(screen.getByRole('button', { name: '위즐리네 캠프장' }).closest('p')!.textContent).toBe('위즐리네 캠프장 — 64화부터 공개 · 본문 1')
  cleanup()
  show([body()])
  expect(screen.getByRole('button', { name: '위즐리네 캠프장' }).closest('p')!.textContent).toBe('위즐리네 캠프장 — 64화부터 공개 · 본문 1')
})
