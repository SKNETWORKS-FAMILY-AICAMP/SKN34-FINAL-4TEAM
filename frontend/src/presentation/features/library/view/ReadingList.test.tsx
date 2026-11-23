// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { ReadingList } from './ReadingList'

vi.mock('../../../shared/art', () => ({ CoverOf: () => null }))
afterEach(cleanup)

type Recent = Parameters<typeof ReadingList>[0]['recent']
const recent = (count: number) => Array.from({ length: count }, (_, index) => ({ work: { id: `w${index + 1}`, title: `작품 ${index + 1}`, genre: '판타지' }, n: 1, tot: 3 })) as unknown as Recent
const show = (count: number) => render(<MemoryRouter><ReadingList recent={recent(count)} removing={null} onRemove={vi.fn()} /></MemoryRouter>)
const titles = () => screen.getAllByText(/^작품 \d+$/).map(node => node.textContent)

it('shows ten reading records per page and moves with the page buttons', () => {
  show(12)
  expect(titles()).toEqual(Array.from({ length: 10 }, (_, index) => `작품 ${index + 1}`))
  fireEvent.click(screen.getByRole('button', { name: '2' }))
  expect(titles()).toEqual(['작품 11', '작품 12'])
  expect(screen.getByRole('button', { name: '2' }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(screen.getByRole('button', { name: '이전' }))
  expect(titles()).toHaveLength(10)
})

it('links the title to the work page, keeps the continue link and the delete button as separate controls, and the delete button only removes the record', () => {
  const onRemove = vi.fn()
  render(<MemoryRouter><ReadingList recent={recent(1)} removing={null} onRemove={onRemove} /></MemoryRouter>)
  const title = screen.getByRole('link', { name: '작품 1' })
  expect(title.getAttribute('href')).toBe('/work/w1')
  expect(title.closest('.li')?.className).toBe('li rowlink') // 제목 링크의 ::after가 행 전체를 덮는다(storyfork.css)
  expect(screen.getByRole('link', { name: '▶ 1화 이어 읽기' }).getAttribute('href')).toBe('/read/w1/1')
  const remove = screen.getByRole('button', { name: '작품 1 이어 읽기 기록 삭제' })
  expect(title.contains(remove)).toBe(false) // 링크 안에 버튼을 넣지 않는다
  fireEvent.click(remove)
  expect(onRemove).toHaveBeenCalledWith('w1')
  expect(screen.getByText('1화까지 읽음 · 판타지')).toBeTruthy()
})

it('leaves out the separator when the work has no genre', () => {
  const noGenre = [{ work: { id: 'w1', title: '작품 1', genre: '' }, n: 1, tot: 3 }] as unknown as Recent
  render(<MemoryRouter><ReadingList recent={noGenre} removing={null} onRemove={vi.fn()} /></MemoryRouter>)
  expect(screen.getByText('1화까지 읽음')).toBeTruthy()
  expect(screen.queryByText(/·/)).toBeNull()
})

it('hides the page controls for ten or fewer reading records', () => {
  show(10)
  expect(titles()).toHaveLength(10)
  expect(screen.queryByRole('navigation', { name: '페이지' })).toBeNull()
})
