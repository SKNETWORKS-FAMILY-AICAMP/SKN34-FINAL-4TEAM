// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import type { CreditBalance } from '../../../domain/entities/creditLedger'
import type { Role } from '../../../domain/entities/work'
import { AccountMenu } from './AccountMenu'

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.unstubAllGlobals() })

const Where = () => { const { pathname, search } = useLocation(); return <p data-testid="where">{pathname + search}</p> }
const balanceOf = (total: number): CreditBalance => ({ total, items: [] })
/** 메뉴가 읽는 크레딧 UseCase 대역. 기본은 끝나지 않는 요청이라 상태 갱신 없이 '읽는 중'에 머문다. */
const creditsOf = (balance: (signal?: AbortSignal) => Promise<CreditBalance> = () => new Promise(() => {})) => ({ balance })

/** shortcuts는 상단바(Gnb)에서 연 메뉴만 넘긴다(600px 이하에서 검색·알림함 항목을 쓴다). theme은 기본 라이트라 OS 설정과 무관하다. */
function open(role: Role = 'user', creditLedger = creditsOf(), options: { shortcuts?: { unread: number }; theme?: 'light' | 'dark' } = {}) {
  const anchor = document.createElement('button')
  const rect = { bottom: 60, right: 500 }
  anchor.getBoundingClientRect = () => rect as DOMRect
  document.body.append(anchor)
  const onClose = vi.fn()
  const store = createAppStore({ role }, { theme: options.theme ?? 'light' })
  const view = render(<Provider store={store}><MemoryRouter><AccountMenu anchor={anchor} onClose={onClose} creditLedger={creditLedger} shortcuts={options.shortcuts} /><Where /></MemoryRouter></Provider>)
  return { anchor, onClose, rect, view, store, menu: screen.getByRole('menu'), items: screen.getAllByRole('menuitem') }
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

it('프로필 바로 아래에 보유 크레딧 줄을 두고, 읽히면 합계를 보이며, 누르면 결제 내역으로 간다', async () => {
  const { items, onClose } = open('user', creditsOf(async () => balanceOf(1234)))
  expect(items[0].className).toBe('who')
  expect(items[1].textContent).toBe('보유 크레딧 …')
  const row = await screen.findByRole('menuitem', { name: '보유 크레딧 1,234.0' })
  expect(row).toBe(items[1])
  fireEvent.click(row)
  expect(onClose).toHaveBeenCalledOnce()
  expect(screen.getByTestId('where').textContent).toBe('/me/pay')
})

it.each([
  [99921.009, '보유 크레딧 99,921.0'],
  [5.96, '보유 크레딧 5.9'],
])('보유 크레딧은 소수 첫째 자리까지 버림으로 보인다: %s', async (total, name) => {
  open('user', creditsOf(async () => balanceOf(total)))
  expect((await screen.findByRole('menuitem', { name })).textContent).toBe(name)
})

it('계정 메뉴에는 내 서재 안에도 있는 관심 소설 항목을 두지 않는다', () => {
  open('user')
  expect(screen.queryByRole('menuitem', { name: '관심 소설' })).toBeNull()
})

it('로그인한 회원 메뉴에는 작품이 없는 독자도 닿는 내 제보·수정 제안 항목이 있고 작품 관리의 내 제보 화면으로 간다', () => {
  const { onClose } = open()
  fireEvent.click(screen.getByRole('menuitem', { name: '내 제보·수정 제안' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(screen.getByTestId('where').textContent).toBe('/content?view=reports')
})

it('잔액을 읽지 못하면 실패 문구만 보이고 0으로 채우지 않는다', async () => {
  open('user', creditsOf(async () => { throw new Error('offline') }))
  const row = await screen.findByRole('menuitem', { name: '크레딧을 불러오지 못했어요' })
  expect(row.textContent).toBe('크레딧을 불러오지 못했어요')
  expect(screen.queryByText('보유 크레딧')).toBeNull()
  expect(screen.queryByText('0')).toBeNull()
})

it('비로그인 메뉴에는 보유 크레딧 줄이 없고 크레딧도 읽지 않는다', async () => {
  const balance = vi.fn(async () => balanceOf(1))
  open(null, { balance })
  await act(async () => {})
  expect(screen.queryByText('보유 크레딧')).toBeNull()
  expect(balance).not.toHaveBeenCalled()
})

it('메뉴가 닫히면 진행 중인 크레딧 요청을 취소한다', async () => {
  let seen: AbortSignal | undefined
  const { view } = open('user', creditsOf((signal) => { seen = signal; return new Promise(() => {}) }))
  await waitFor(() => expect(seen).toBeDefined())
  expect(seen?.aborted).toBe(false)
  view.unmount()
  expect(seen?.aborted).toBe(true)
})

it('잔액이 늦게 도착해도 메뉴 항목을 다시 만들지 않아 열어 둔 포커스가 그대로다', async () => {
  let finish: (balance: CreditBalance) => void = () => {}
  const pending = new Promise<CreditBalance>((done) => { finish = done })
  const { items } = open('user', creditsOf(() => pending))
  items[3].focus()
  await act(async () => { finish(balanceOf(7)) })
  expect(screen.getByRole('menuitem', { name: '보유 크레딧 7.0' })).toBe(items[1])
  screen.getAllByRole('menuitem').forEach((item, index) => expect(item).toBe(items[index]))
  expect(document.activeElement).toBe(items[3])
})

it('상단바가 다시 그려져 onClose가 새 함수로 바뀌어도 메뉴 항목을 다시 만들지 않고 옮겨 둔 포커스를 지키며, 닫을 때는 최신 onClose를 부른다', () => {
  // 홈은 히어로 자동 넘김으로 4.5초마다 다시 그려지고, 상단바는 그때마다 새 onClose를 넘긴다.
  const anchor = document.createElement('button')
  anchor.getBoundingClientRect = () => ({ bottom: 60, right: 500 }) as DOMRect
  document.body.append(anchor)
  const store = createAppStore({ role: 'user' })
  const ui = (onClose: () => void) => <Provider store={store}><MemoryRouter><AccountMenu anchor={anchor} onClose={onClose} creditLedger={creditsOf()} /></MemoryRouter></Provider>
  const view = render(ui(() => {}))
  const items = screen.getAllByRole('menuitem')
  expect(document.activeElement).toBe(items[0])
  items[3].focus()
  const latest = vi.fn()
  view.rerender(ui(latest))
  screen.getAllByRole('menuitem').forEach((item, index) => expect(item).toBe(items[index]))
  expect(document.activeElement).toBe(items[3])
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(latest).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(anchor)
})

it.each([['user', '내 계정 메뉴'], [null, '로그인·회원가입 메뉴']] as const)('역할이 %s인 메뉴는 연 버튼과 같은 이름(%s)을 갖는다', (role, name) => {
  open(role)
  expect(screen.getByRole('menu', { name })).toBeTruthy()
})

it('운영자에게만 운영자 대시보드 항목을 내 서재 위에 보이고, 누르면 /admin으로 간다', () => {
  const { items, onClose } = open('admin')
  const names = items.map((item) => item.textContent)
  expect(names.indexOf('운영자 대시보드')).toBeGreaterThan(0)
  expect(names.indexOf('운영자 대시보드')).toBeLessThan(names.indexOf('내 서재'))
  fireEvent.click(screen.getByRole('menuitem', { name: '운영자 대시보드' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(screen.getByTestId('where').textContent).toBe('/admin')
})

it.each(['user', null] as const)('역할이 %s인 메뉴에는 운영자 대시보드가 없다', (role) => {
  open(role)
  expect(screen.queryByRole('menuitem', { name: '운영자 대시보드' })).toBeNull()
})

it('프로필 줄의 아바타 머리글자는 장식이라 메뉴 항목 이름에 섞이지 않는다', () => {
  const { items } = open()
  expect(items[0].querySelector('.meav')?.getAttribute('aria-hidden')).toBe('true')
  // 머리글자 '읽'이 이름 앞에 붙어 '읽읽는사람…'으로 읽히지 않는다.
  expect(screen.getByRole('menuitem', { name: /^읽는사람reader@storyfork\.demo프로필 ›$/ })).toBe(items[0])
})

it('프로필 줄은 아바타·이름과 이메일 묶음·프로필 › 가 한 줄에 놓이고 길어지는 값은 title로 전체를 남긴다', () => {
  const { items } = open()
  expect([...items[0].children].map((el) => el.className || el.tagName.toLowerCase())).toEqual(['meav', 'who-text', 'em'])
  expect(items[0].querySelector('.who-text b')?.getAttribute('title')).toBe('읽는사람')
  expect(items[0].querySelector('.who-text small')?.getAttribute('title')).toBe('reader@storyfork.demo')
})

const themeItem = () => screen.getByRole('menuitemcheckbox', { name: '다크 모드' })

it('다크 모드 항목은 현재 상태를 aria-checked로 알리고, 누르면 메뉴는 열린 채 같은 항목에서 테마만 바꾼다', () => {
  const { store, onClose } = open('user')
  const theme = themeItem()
  expect(theme.getAttribute('aria-checked')).toBe('false')
  theme.focus()
  fireEvent.click(theme)
  expect(store.getState().ui.theme).toBe('dark')
  expect(themeItem()).toBe(theme) // 다시 만들어지지 않아 초점도 그대로다
  expect(theme.getAttribute('aria-checked')).toBe('true')
  expect(onClose).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(theme)
  fireEvent.click(theme)
  expect(store.getState().ui.theme).toBe('light')
  expect(theme.getAttribute('aria-checked')).toBe('false')
})

it('다크 모드가 켜진 채 열면 항목은 켜짐이고, 표시 글자는 항목 이름에 섞이지 않는다', () => {
  open('user', creditsOf(), { theme: 'dark' })
  const theme = themeItem()
  expect(theme.getAttribute('aria-checked')).toBe('true')
  expect(theme.textContent).toBe('다크 모드켜짐')
  expect(theme.querySelector('em')?.getAttribute('aria-hidden')).toBe('true')
})

it('로그인한 메뉴의 다크 모드 항목은 로그아웃 바로 위 묶음(구분선 앞)의 끝에 있다', () => {
  open('user')
  const theme = themeItem()
  expect(theme.previousElementSibling).toBe(screen.getByRole('menuitem', { name: '이벤트' }))
  expect(theme.nextElementSibling?.tagName).toBe('HR')
  expect(theme.nextElementSibling?.nextElementSibling).toBe(screen.getByRole('menuitem', { name: '로그아웃' }))
})

it('비로그인 메뉴의 다크 모드 항목은 맨 끝 묶음의 끝이다', () => {
  const { menu } = open(null)
  expect(menu.lastElementChild).toBe(themeItem())
  expect(themeItem().previousElementSibling).toBe(screen.getByRole('menuitem', { name: '문의하기' }))
})

it('다크 모드 항목도 방향키·Home·End 이동 대상이다', () => {
  open('user')
  const logout = screen.getByRole('menuitem', { name: '로그아웃' })
  logout.focus()
  fireEvent.keyDown(logout, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(themeItem())
  cleanup()
  const guest = open(null)
  fireEvent.keyDown(guest.items[0], { key: 'End' })
  expect(document.activeElement).toBe(themeItem())
})

it('shortcuts를 받은 메뉴는 크레딧 줄 다음 묶음에 검색·알림함 항목을 두고, 읽지 않은 수를 알림함에 붙인다', () => {
  open('user', creditsOf(), { shortcuts: { unread: 2 } })
  const search = screen.getByRole('menuitem', { name: '검색' })
  const inbox = screen.getByRole('menuitem', { name: '알림함, 읽지 않은 알림 2건' })
  expect(inbox.textContent).toBe('알림함 2')
  expect([search.className, inbox.className]).toEqual(['acct-m', 'acct-m']) // 601px부터 CSS가 숨기는 표시다
  expect(search.nextElementSibling).toBe(inbox)
  expect(search.previousElementSibling?.tagName).toBe('HR')
  expect(search.previousElementSibling?.previousElementSibling).toBe(screen.getByRole('menuitem', { name: /^보유 크레딧/ }))
  expect(inbox.nextElementSibling?.matches('hr.acct-m')).toBe(true) // 항목이 숨는 화면에서는 구분선도 함께 숨는다
  expect(inbox.nextElementSibling?.nextElementSibling).toBe(screen.getByRole('menuitem', { name: '내 서재' }))
})

it('알림함 항목은 메뉴를 닫고 /notifications로 간다', () => {
  const { onClose } = open('user', creditsOf(), { shortcuts: { unread: 0 } })
  fireEvent.click(screen.getByRole('menuitem', { name: '알림함' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(screen.getByTestId('where').textContent).toBe('/notifications')
})

it('검색 항목은 초점을 연 버튼으로 돌려 놓은 뒤 메뉴를 닫고 검색 시트(sf-quick)를 연다 — 시트가 닫힐 때 돌아갈 곳은 곧 사라질 항목이 아니라 연 버튼이다', () => {
  const focusAtOpen: (Element | null)[] = []
  const listener = () => focusAtOpen.push(document.activeElement)
  addEventListener('sf-quick', listener)
  try {
    const { anchor, onClose } = open('user', creditsOf(), { shortcuts: { unread: 0 } })
    fireEvent.click(screen.getByRole('menuitem', { name: '검색' }))
    expect(focusAtOpen).toEqual([anchor])
    expect(onClose).toHaveBeenCalledOnce()
  } finally { removeEventListener('sf-quick', listener) }
})

it('비로그인 메뉴는 검색 항목만 두고 알림함은 두지 않는다', () => {
  open(null, creditsOf(), { shortcuts: { unread: 0 } })
  expect(screen.getByRole('menuitem', { name: '검색' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: /^알림함/ })).toBeNull()
})

it('CSS로 숨긴 항목(601px 이상에서 .acct-m)은 방향키·Home 이동에서 건너뛰고 첫 보이는 항목이 처음이다', () => {
  const { items: shown } = open('user', creditsOf(), { shortcuts: { unread: 1 } })
  const credit = screen.getByRole('menuitem', { name: /^보유 크레딧/ })
  const search = screen.getByRole('menuitem', { name: '검색' })
  const inbox = screen.getByRole('menuitem', { name: /^알림함/ })
  const library = screen.getByRole('menuitem', { name: '내 서재' })
  const logout = screen.getByRole('menuitem', { name: '로그아웃' })
  // jsdom은 CSS를 읽지 않으니 601px 이상에서 .acct-m이 display:none이 되는 것을 인라인 스타일로 흉내 낸다.
  for (const hidden of [search, inbox]) hidden.style.display = 'none'
  credit.focus()
  fireEvent.keyDown(credit, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(library)
  fireEvent.keyDown(library, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(credit)
  // 맨 앞 항목(프로필)이 숨은 경우의 처음·끝: Home은 첫 보이는 항목, 그 앞에서 위로 가면 끝으로 이어진다.
  shown[0].style.display = 'none'
  fireEvent.keyDown(credit, { key: 'Home' })
  expect(document.activeElement).toBe(credit)
  fireEvent.keyDown(credit, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(logout)
})
