// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import { AccountMenu } from './AccountMenu'

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.unstubAllGlobals() })

function open() {
  const anchor = document.createElement('button')
  const rect = { bottom: 60, right: 500 }
  anchor.getBoundingClientRect = () => rect as DOMRect
  document.body.append(anchor)
  const onClose = vi.fn()
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><AccountMenu anchor={anchor} onClose={onClose} /></MemoryRouter></Provider>)
  return { anchor, onClose, rect, menu: screen.getByRole('menu'), items: screen.getAllByRole('menuitem') }
}

it('방향키·Home·End로 메뉴 항목 사이를 이동하고 처음과 끝은 이어진다', () => {
  const { items } = open()
  const last = items[items.length - 1]
  expect(document.activeElement).toBe(items[0])
  fireEvent.keyDown(items[0], { key: 'ArrowDown' })
  expect(document.activeElement).toBe(items[1])
  fireEvent.keyDown(items[1], { key: 'ArrowUp' })
  fireEvent.keyDown(items[0], { key: 'ArrowUp' })
  expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(items[0])
  fireEvent.keyDown(items[0], { key: 'End' })
  expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last, { key: 'Home' })
  expect(document.activeElement).toBe(items[0])
})

it('Tab으로 메뉴를 벗어나면 닫고 포커스를 연 버튼으로 돌려 다음 Tab 이동이 이어지게 한다', () => {
  const { anchor, onClose, items } = open()
  fireEvent.keyDown(items[2], { key: 'Tab' })
  expect(onClose).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(anchor)
})

it('열려 있는 동안 창 크기·스크롤이 바뀌면 버튼 아래로 다시 맞추고 포커스를 지킨다', () => {
  const { rect, menu, items } = open()
  expect([menu.style.top, menu.style.left]).toEqual(['68px', '260px'])
  items[2].focus()
  Object.assign(rect, { bottom: 100, right: 300 })
  fireEvent(window, new Event('resize'))
  expect([menu.style.top, menu.style.left]).toEqual(['108px', '60px'])
  vi.stubGlobal('scrollY', 200)
  fireEvent(window, new Event('scroll'))
  expect(menu.style.top).toBe('308px')
  expect(document.activeElement).toBe(items[2])
  expect(screen.getAllByRole('menuitem')[2]).toBe(items[2])
})
