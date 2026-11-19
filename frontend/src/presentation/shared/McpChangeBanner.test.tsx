// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { McpChangeBanner } from './McpChangeBanner'

afterEach(cleanup)

it('바뀐 것이 없으면 아무것도 그리지 않는다', () => {
  const { container } = render(<McpChangeBanner stale={false} reload={vi.fn()} />)
  expect(container.firstChild).toBeNull()
})

it('"다른 곳에서 바뀌었어요"를 role=status로 알리고, 다시 불러오기를 누르면 reload를 부르고 초점을 main으로 넘긴다', () => {
  const reload = vi.fn()
  render(<><McpChangeBanner stale reload={reload} /><main id="main" tabIndex={-1} /></>)
  expect(screen.getByRole('status').textContent).toContain('다른 곳에서 바뀌었어요')
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  expect(reload).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(screen.getByRole('main'))
})
