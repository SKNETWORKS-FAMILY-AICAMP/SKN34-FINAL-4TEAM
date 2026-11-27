// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../app/appContainer'
import { createAppStore } from '../../../app/store'
import { ManageMenu } from './ManageMenu'

// 알림 수는 상단바(Gnb)와 같은 useGnbViewModel이 읽는다. 기본은 0건으로 대신해 실제 요청을 보내지 않는다.
beforeEach(() => { vi.spyOn(appContainer.resolve('shellUseCase'), 'getBadges').mockResolvedValue({ unread: 0, pending: 0 }) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function open(isOpen = true, tools: ReactNode = <button type="button">도구 하나</button>) {
  const onOpenChange = vi.fn()
  render(
    <Provider store={createAppStore({ role: 'user' })}>
      <MemoryRouter>
        <ManageMenu name="작품" open={isOpen} onOpenChange={onOpenChange} back={{ to: '/lib?tab=write', label: '내가 쓰는 소설' }} tools={tools}>
          <nav aria-label="작품 메뉴"><button type="button">탭 하나</button></nav>
        </ManageMenu>
        <div id="ep-content" tabIndex={-1} />
      </MemoryRouter>
    </Provider>,
  )
  return onOpenChange
}

it('위에서 아래로 로고·접기 토글·돌아가기 링크·내용(메뉴)·도구·알림·계정 순서이고, 도구 묶음과 계정 줄은 따로다', () => {
  open()
  const side = within(document.querySelector<HTMLElement>('.ep-menu')!)
  const order = [
    side.getByRole('link', { name: 'STORYFORK 홈으로' }),
    side.getByRole('button', { name: '작품 메뉴 접기' }),
    side.getByRole('link', { name: '내가 쓰는 소설' }),
    side.getByRole('navigation', { name: '작품 메뉴' }),
    side.getByRole('button', { name: '도구 하나' }),
    side.getByRole('link', { name: '알림함' }),
    side.getByRole('button', { name: '내 계정 메뉴' }),
  ]
  order.slice(1).forEach((el, i) => expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, el.textContent || el.getAttribute('aria-label') || '').toBeTruthy())
  expect(order[0].getAttribute('href')).toBe('/')
  expect(order[0].textContent).toBe('SFSTORYFORK') // 상단바 로고와 같은 이름·모양
  expect(order[2].getAttribute('href')).toBe('/lib?tab=write')
  expect(order[0].closest('.ep-menu-top')?.contains(order[1])).toBe(true) // 로고와 접기 토글이 맨 위 한 줄이다
  expect(order[2].closest('.ep-menu-body')?.contains(order[3])).toBe(true)
  expect(order[4].closest('.ep-menu-tools')?.closest('.ep-menu-body')).toBeTruthy() // 도구는 본문의 마지막 묶음이다
  expect(order[5].closest('.ep-menu-account')?.contains(order[6])).toBe(true)
  expect(order[5].closest('.ep-menu-body')).toBeNull() // 계정 줄은 본문 밖의 맨 아래 줄이다
  expect(screen.queryByRole('button', { name: '소설·세계관·설정 카드·캐릭터챗 검색' })).toBeNull() // 검색 버튼은 두지 않는다: Ctrl K(전역 QuickJump)가 남는다
})

it('도구를 주지 않으면 도구 묶음 칸(.ep-menu-tools)을 그리지 않는다 — 도구가 없는 화면(작품 관리)에 빈 구분선만 남지 않는다', () => {
  open(true, null)
  expect(document.querySelector('.ep-menu-tools')).toBeNull()
  expect(document.querySelector('.ep-menu-body')?.lastElementChild?.tagName).toBe('NAV') // 본문의 마지막은 메뉴다
  expect(document.querySelector('.ep-menu-account')).toBeTruthy() // 알림·계정 줄은 그대로다
})

it('첫 요소는 본문으로 바로가기 링크라 키보드 첫 Tab이 사이드바를 건너뛰어 내용 열(#ep-content)로 간다 — 공용 상단바가 없는 화면에서 상단바의 같은 링크를 대신한다', () => {
  open()
  const skip = screen.getByRole('link', { name: '본문으로 바로가기' })
  expect(skip.classList.contains('skip-link')).toBe(true)
  expect(skip.getAttribute('href')).toBe('#ep-content')
  expect(document.querySelector('.ep-menu')?.firstElementChild).toBe(skip) // 로고·접기 토글보다 DOM에서 앞선다
  fireEvent.click(skip)
  expect(document.activeElement).toBe(document.getElementById('ep-content'))
  expect(window.location.hash).toBe('') // 주소를 바꾸지 않는다(라우터 주소와 겹치지 않게)
})

it('접기 토글은 이름(name)으로 메뉴를 부르고 본문을 가리키며(aria-controls) 누르면 반대 값을 알린다', () => {
  const change = open()
  const toggle = screen.getByRole('button', { name: '작품 메뉴 접기' })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(toggle.getAttribute('title')).toBe('작품 메뉴 접기') // 아이콘만 있는 버튼: 이름(aria-label)과 마우스 툴팁(title)이 같은 글이다
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.classList.contains('ep-menu-body')).toBe(true)
  fireEvent.click(toggle)
  expect(change).toHaveBeenCalledWith(false)
})

it('접힌 동안 본문은 hidden이고 토글은 펼치기이며, 돌아가기 링크는 그리지 않는다(상단 줄에 둔 링크와 두 곳에 동시에 두지 않는다)', () => {
  const change = open(false)
  const toggle = screen.getByRole('button', { name: '작품 메뉴 펼치기' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.hidden).toBe(true)
  expect(screen.queryByRole('navigation', { name: '작품 메뉴' })).toBeNull() // hidden 안은 접근성 트리 밖이다
  // 900px 이하에서는 접힌 본문도 CSS로 보이므로 hidden에 기대지 않고 DOM에서 뺀다: 돌아가기 링크는 그리지 않고 도구도 호출 측이 비운다.
  expect(document.querySelector('.ep-menu-back')).toBeNull()
  fireEvent.click(toggle)
  expect(change).toHaveBeenCalledWith(true)
})

it('알림 링크는 상단바와 같은 이름에 읽지 않은 알림 수를 붙인다', async () => {
  vi.spyOn(appContainer.resolve('shellUseCase'), 'getBadges').mockResolvedValue({ unread: 3, pending: 0 })
  open()
  const link = await screen.findByRole('link', { name: '알림함, 읽지 않은 알림 3건' })
  expect(link.getAttribute('href')).toBe('/notifications')
  expect(link.textContent).toBe('알림 3')
})

it('계정 아바타는 상단바와 같은 계정 메뉴를 열고 Esc로 닫으면 초점이 아바타로 돌아온다', () => {
  vi.spyOn(appContainer.resolve('creditLedgerUseCase'), 'balance').mockReturnValue(new Promise(() => {})) // 메뉴의 보유 크레딧은 읽는 중에 머문다
  open()
  const avatar = screen.getByRole('button', { name: '내 계정 메뉴' })
  expect(avatar.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(avatar)
  expect(avatar.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('menu', { name: '내 계정 메뉴' })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(avatar)
})

it('맨 아래 줄에는 테마 버튼이 없고 테마는 계정 메뉴의 다크 모드 항목이 맡는다 — 검색·알림함 항목은 상단바(Gnb)에서 연 메뉴에만 있고 사이드바에는 알림 버튼이 그대로 있다', () => {
  vi.spyOn(appContainer.resolve('creditLedgerUseCase'), 'balance').mockReturnValue(new Promise(() => {}))
  open()
  expect(screen.queryByRole('button', { name: /모드로/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '내 계정 메뉴' }))
  const menu = within(screen.getByRole('menu', { name: '내 계정 메뉴' }))
  expect(menu.getByRole('menuitemcheckbox', { name: '다크 모드' })).toBeTruthy()
  expect(menu.queryByRole('menuitem', { name: '검색' })).toBeNull()
  expect(menu.queryByRole('menuitem', { name: /^알림함/ })).toBeNull()
  expect(screen.getByRole('link', { name: '알림함' }).closest('.ep-menu-account')).toBeTruthy()
})
