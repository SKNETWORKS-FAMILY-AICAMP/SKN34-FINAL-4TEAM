// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { Pager } from './Pager'

afterEach(cleanup)

const nav = () => within(screen.getByRole('navigation', { name: '페이지' }))
const buttons = () => nav().getAllByRole('button')
const current = () => buttons().filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.textContent)

it('한 쪽 이하면 아무것도 그리지 않는다', () => {
  render(<Pager page={1} pages={1} onPage={() => {}} />)
  expect(screen.queryByRole('navigation')).toBeNull()
})

it('7쪽까지는 이전·번호 전부·다음이고 현재 쪽만 aria-current="page"이며 양 끝에서는 이전·다음이 잠긴다', () => {
  const view = render(<Pager page={1} pages={3} onPage={() => {}} />)
  expect(buttons().map((b) => b.textContent)).toEqual(['이전', '1', '2', '3', '다음'])
  expect(current()).toEqual(['1'])
  expect(nav().getByRole('button', { name: '이전' }).hasAttribute('disabled')).toBe(true)
  expect(nav().getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(false)
  view.rerender(<Pager page={3} pages={3} onPage={() => {}} />)
  expect(current()).toEqual(['3'])
  expect(nav().getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(true)
})

it('8쪽부터는 현재 쪽 주변만 번호 버튼이고 줄인 구간은 보조기기에서 숨긴 …이다 (#505)', () => {
  render(<Pager page={10} pages={20} onPage={() => {}} />)
  const bar = screen.getByRole('navigation', { name: '페이지' })
  expect([...bar.children].map((el) => el.textContent)).toEqual(['이전', '1', '…', '9', '10', '11', '…', '20', '다음'])
  expect(buttons().map((b) => b.textContent)).toEqual(['이전', '1', '9', '10', '11', '20', '다음'])
  expect([...bar.querySelectorAll('[aria-hidden="true"]')].map((el) => el.textContent)).toEqual(['…', '…'])
  expect(current()).toEqual(['10'])
})

it('번호·이전·다음을 누르면 그 쪽으로 onPage를 부른다', () => {
  const onPage = vi.fn()
  render(<Pager page={10} pages={20} onPage={onPage} />)
  fireEvent.click(nav().getByRole('button', { name: '11' }))
  fireEvent.click(nav().getByRole('button', { name: '이전' }))
  fireEvent.click(nav().getByRole('button', { name: '다음' }))
  fireEvent.click(nav().getByRole('button', { name: '20' }))
  expect(onPage.mock.calls).toEqual([[11], [9], [11], [20]])
})
