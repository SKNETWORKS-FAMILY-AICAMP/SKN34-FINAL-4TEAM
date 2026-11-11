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

it('주요 메뉴는 세계관 · 랭킹 · 캐릭터 챗 · 내 서재 순서이고 모바일 짧은 라벨도 같은 순서다', () => {
  render(<Provider store={createAppStore()}><MemoryRouter><Gnb /></MemoryRouter></Provider>)
  const nav = screen.getByRole('navigation', { name: '주요 메뉴' })
  expect(within(nav).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/worldstudio', '/rank', '/chat', '/lib'])
  expect(Array.from(nav.querySelectorAll('.lf'), label => label.textContent)).toEqual(['세계관', '랭킹', '캐릭터 챗', '내 서재'])
  expect(Array.from(nav.querySelectorAll('.ls'), label => label.textContent)).toEqual(['세계관', '랭킹', '챗', '서재'])
})
