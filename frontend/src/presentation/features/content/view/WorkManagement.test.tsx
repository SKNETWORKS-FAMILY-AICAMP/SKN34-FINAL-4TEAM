// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { Episode, Work } from '../../../../domain/entities/content'
import { WorkManagement } from './WorkManagement'

// 히어로·정책 카드는 이 테스트가 보는 회차 목록과 무관하다. 포크 수는 12화에만 2편이 갈라졌다고 본다(회차 번호로 조회).
vi.mock('./WorkOverview', () => ({ WorkOverview: () => null }))
vi.mock('../viewmodel/useEpisodeForkCounts', () => ({ useEpisodeForkCounts: () => ({ 12: 2 }) }))

const episode = (number: number): Episode => ({ number, version: 1, title: `${number}화 제목`, body: `${number}화 본문`, inherited: false })
const work = (count: number): Work => ({
  id: 'w', title: '작품', summary: '', visibility: 'public', allowFork: true, allowForkPublication: false, revision: 0, source: null,
  episodes: Array.from({ length: count }, (_, i) => episode(i + 1)), draft: { title: '', body: '', revision: 0 },
})
const vm = { busy: false, coverRevision: 0, loadHistory: async () => {}, history: null }
const open = (count: number) => render(
  <MemoryRouter><WorkManagement vm={vm as never} work={work(count)} onForked={() => {}} onDeleted={() => {}} /></MemoryRouter>,
)

const rows = () => within(screen.getByRole('list')).getAllByRole('listitem')
const titles = () => rows().map((row) => row.querySelector('b')?.textContent)
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${from + i}화 제목`)
const pager = () => screen.getByRole('navigation', { name: '페이지' })
const press = (name: string) => fireEvent.click(within(pager()).getByRole('button', { name }))

// jsdom에는 scrollIntoView가 없어, 어느 요소를 어떻게 불렀는지 기록하는 대역을 둔다.
const scrolled: { el: Element; arg: unknown }[] = []
beforeEach(() => {
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) { scrolled.push({ el: this, arg }) }
})
afterEach(() => { cleanup(); Reflect.deleteProperty(Element.prototype, 'scrollIntoView') })

it('회차가 10개 이하면 전부 한 번에 보이고 페이지 이동 버튼은 없다', () => {
  open(10)
  expect(titles()).toEqual(range(1, 10))
  expect(screen.queryByRole('navigation', { name: '페이지' })).toBeNull()
})

it('회차가 10개를 넘으면 1쪽에 1~10화만 보이고 이전은 막히며 현재 쪽이 표시된다', () => {
  open(25)
  expect(titles()).toEqual(range(1, 10))
  expect(within(pager()).getByRole('button', { name: '이전' }).hasAttribute('disabled')).toBe(true)
  expect(within(pager()).getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(false)
  expect(within(pager()).getByRole('button', { name: '1' }).getAttribute('aria-current')).toBe('page')
  expect(within(pager()).getByRole('button', { name: '2' }).getAttribute('aria-current')).toBeNull()
})

it('다음·쪽 번호·이전으로 쪽을 옮기면 그 쪽의 회차만 보이고 처음과 끝에서 막힌다', () => {
  open(25)
  press('다음')
  expect(titles()).toEqual(range(11, 20))
  expect(within(pager()).getByRole('button', { name: '2' }).getAttribute('aria-current')).toBe('page')
  press('3')
  expect(titles()).toEqual(range(21, 25))
  expect(within(pager()).getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(true)
  press('이전')
  expect(titles()).toEqual(range(11, 20))
})

it('쪽을 바꾸면 회차 목록 머리로 스크롤한다', () => {
  open(25)
  expect(scrolled).toEqual([])
  press('다음')
  expect(scrolled).toHaveLength(1)
  expect(scrolled[0].el).toBe(screen.getByRole('list'))
  expect(scrolled[0].arg).toEqual({ block: 'start' })
})

it('회차별 포크 수는 쪽 안의 순서가 아니라 회차 번호로 붙는다', () => {
  open(25)
  expect(screen.queryByTitle('이 회차에서 갈라진 포크')).toBeNull()
  press('다음')
  const marked = rows().filter((row) => within(row).queryByTitle('이 회차에서 갈라진 포크'))
  expect(marked.map((row) => row.querySelector('b')?.textContent)).toEqual(['12화 제목'])
  expect(within(marked[0]).getByTitle('이 회차에서 갈라진 포크').textContent).toContain('2')
})

it('쪽을 나눠도 이야기 분기의 기준 회차 선택에는 모든 회차가 있다', () => {
  open(25)
  fireEvent.click(screen.getByRole('button', { name: '이야기 분기' }))
  expect(within(screen.getByRole('combobox', { name: /기준 회차/ })).getAllByRole('option')).toHaveLength(25)
})
