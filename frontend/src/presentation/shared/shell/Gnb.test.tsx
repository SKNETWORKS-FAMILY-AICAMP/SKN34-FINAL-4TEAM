// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../app/appContainer'
import { createAppStore } from '../../../app/store'
import type { Role } from '../../../domain/entities/work'
import { Gnb } from './Gnb'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** 읽지 않은 알림 수는 상단바가 읽는 배지 UseCase 대역으로, 메뉴의 보유 크레딧은 읽는 중에 머무는 대역으로 대신해 실제 요청을 보내지 않는다. */
function renderGnb(role: Role = 'user', unread = 0) {
  vi.spyOn(appContainer.resolve('shellUseCase'), 'getBadges').mockResolvedValue({ unread, pending: 0 })
  vi.spyOn(appContainer.resolve('creditLedgerUseCase'), 'balance').mockReturnValue(new Promise(() => {}))
  render(<Provider store={createAppStore({ role }, { theme: 'light' })}><MemoryRouter><Gnb /></MemoryRouter></Provider>)
}

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

it('검색 버튼은 소설·세계관·설정 카드·캐릭터챗 검색이고 좁은 화면용 짧은 표시가 따로 있다 (#505)', () => {
  render(<Provider store={createAppStore()}><MemoryRouter><Gnb /></MemoryRouter></Provider>)
  const button = screen.getByRole('button', { name: '소설·세계관·설정 카드·캐릭터챗 검색' })
  expect(button.querySelector('.lf')?.textContent).toBe('소설·세계관·설정 카드·캐릭터챗 검색')
  expect(button.querySelector('.ls')?.textContent).toBe('검색')
  expect(button.textContent).not.toMatch(/인물|회차/)
})

it('상단바에는 다크 모드 버튼이 없다 — 테마는 계정 메뉴의 다크 모드 항목이 맡는다', () => {
  renderGnb()
  expect(screen.queryByRole('button', { name: /모드로/ })).toBeNull()
  expect(document.querySelector('.gnb .thm')).toBeNull()
})

it('600px 이하에서 CSS가 숨기는 검색 버튼·알림 링크에는 구분용 클래스(.search·.gnb-noti)가 있다', () => {
  renderGnb()
  expect(screen.getByRole('button', { name: '소설·세계관·설정 카드·캐릭터챗 검색' }).classList.contains('search')).toBe(true)
  expect(screen.getByRole('link', { name: '알림함' }).classList.contains('gnb-noti')).toBe(true)
})

it('아바타로 연 계정 메뉴에는 600px 이하용 검색·알림함(읽지 않은 수 포함)과 다크 모드 항목이 있다', async () => {
  renderGnb('user', 3)
  fireEvent.click(screen.getByRole('button', { name: '내 계정 메뉴' }))
  const menu = within(screen.getByRole('menu', { name: '내 계정 메뉴' }))
  expect(menu.getByRole('menuitem', { name: '검색' })).toBeTruthy()
  expect((await menu.findByRole('menuitem', { name: '알림함, 읽지 않은 알림 3건' })).textContent).toBe('알림함 3')
  expect(menu.getByRole('menuitemcheckbox', { name: '다크 모드' }).getAttribute('aria-checked')).toBe('false')
})
