// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../app/store'
import { Gnb } from './Gnb'

afterEach(cleanup)

it('건너뛰기 링크가 헤더보다 먼저 포커스를 받고 본문으로 포커스를 옮긴다', () => {
  render(<Provider store={createAppStore()}><MemoryRouter><Gnb /><main id="main" tabIndex={-1}>본문</main></MemoryRouter></Provider>)
  const skip = screen.getByRole('link', { name: '본문으로 바로가기' })
  expect(skip.getAttribute('href')).toBe('#main')
  expect(skip.className).toBe('skip-link')
  expect(document.body.querySelector('a,button')).toBe(skip)
  expect(skip.compareDocumentPosition(screen.getByRole('banner')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(skip)
  expect(document.activeElement).toBe(screen.getByRole('main'))
  expect(window.location.hash).toBe('')
})

it('주요 메뉴는 세계관 · 랭킹 · 캐릭터챗 · 내 서재 순서이고 모바일 짧은 라벨도 같은 순서다', () => {
  render(<Provider store={createAppStore()}><MemoryRouter><Gnb /></MemoryRouter></Provider>)
  const nav = screen.getByRole('navigation', { name: '주요 메뉴' })
  expect(within(nav).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/worlds', '/rank', '/chat', '/lib'])
  expect(Array.from(nav.querySelectorAll('.lf'), label => label.textContent)).toEqual(['세계관', '랭킹', '캐릭터챗', '내 서재'])
  expect(Array.from(nav.querySelectorAll('.ls'), label => label.textContent)).toEqual(['세계관', '랭킹', '챗', '서재'])
})

it('세계관 화면(on="worlds")에서는 세계관 링크만 현재 페이지로 표시한다', () => {
  render(<Provider store={createAppStore()}><MemoryRouter><Gnb on="worlds" /></MemoryRouter></Provider>)
  const nav = screen.getByRole('navigation', { name: '주요 메뉴' })
  const current = within(nav).getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page')
  expect(current.map(link => link.getAttribute('href'))).toEqual(['/worlds'])
})

it('상단바에는 크레딧 버튼이 없다', () => {
  render(<Provider store={createAppStore()}><MemoryRouter><Gnb /></MemoryRouter></Provider>)
  expect(screen.queryByRole('button', { name: /크레딧/ })).toBeNull()
})
