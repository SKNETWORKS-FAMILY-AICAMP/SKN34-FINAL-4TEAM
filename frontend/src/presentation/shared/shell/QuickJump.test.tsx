// @vitest-environment jsdom
import '../../../test/fixtureApp'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../app/store'
import { QuickJump } from './QuickJump'

afterEach(cleanup)

const open = () => {
  render(<Provider store={createAppStore()}><MemoryRouter><QuickJump /></MemoryRouter></Provider>)
  act(() => { window.dispatchEvent(new Event('sf-quick')) })
}

it('입력과 목록이 combobox·listbox·option으로 연결되고 방향키가 활성 항목을 알린다', async () => {
  open()
  const input = screen.getByRole('combobox', { name: '소설·인물·회차 검색' })
  const options = await screen.findAllByRole('option')
  const list = screen.getByRole('listbox')
  expect(input.getAttribute('aria-expanded')).toBe('true')
  expect(input.getAttribute('aria-controls')).toBe(list.id)
  expect(input.getAttribute('aria-autocomplete')).toBe('list')
  expect(new Set(options.map((o) => o.id)).size).toBe(options.length)
  expect(options.every((o) => o.id && list.contains(o))).toBe(true)
  expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id)
  expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(options.map((_, i) => String(i === 0)))
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id)
  expect(options[1].getAttribute('aria-selected')).toBe('true')
  expect(options[0].getAttribute('aria-selected')).toBe('false')
})

it('목록이 비어 있으면 닫힘으로 알리고 옵션이 아닌 안내만 보여 준다', () => {
  open()
  const input = screen.getByRole('combobox', { name: '소설·인물·회차 검색' })
  expect(input.getAttribute('aria-expanded')).toBe('false')
  expect(input.hasAttribute('aria-activedescendant')).toBe(false)
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.queryAllByRole('option')).toHaveLength(0)
  expect(screen.getByText('검색 결과가 없어요.')).toBeTruthy()
})

it('한글 조합 중 Enter는 이동하지 않고 조합이 끝난 Enter만 이동한다', () => {
  open()
  const input = screen.getByRole('combobox', { name: '소설·인물·회차 검색' })
  fireEvent.change(input, { target: { value: '용사' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(screen.queryByRole('dialog')).not.toBeNull()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.queryByRole('dialog')).toBeNull()
})
