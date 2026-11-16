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

it('hides the page controls for ten or fewer reading records', () => {
  show(10)
  expect(titles()).toHaveLength(10)
  expect(screen.queryByRole('navigation', { name: '페이지' })).toBeNull()
})
