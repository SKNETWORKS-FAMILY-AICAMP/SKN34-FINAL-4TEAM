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

const Where = () => <p data-testid="where">{useLocation().pathname}</p>
const balanceOf = (total: number): CreditBalance => ({ total, items: [] })
/** 메뉴가 읽는 크레딧 UseCase 대역. 기본은 끝나지 않는 요청이라 상태 갱신 없이 '읽는 중'에 머문다. */
const creditsOf = (balance: (signal?: AbortSignal) => Promise<CreditBalance> = () => new Promise(() => {})) => ({ balance })

function open(role: Role = 'user', creditLedger = creditsOf()) {
  const anchor = document.createElement('button')
  const rect = { bottom: 60, right: 500 }
  anchor.getBoundingClientRect = () => rect as DOMRect
  document.body.append(anchor)
  const onClose = vi.fn()
  const view = render(<Provider store={createAppStore({ role })}><MemoryRouter><AccountMenu anchor={anchor} onClose={onClose} creditLedger={creditLedger} /><Where /></MemoryRouter></Provider>)
  return { anchor, onClose, rect, view, menu: screen.getByRole('menu'), items: screen.getAllByRole('menuitem') }
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
  const row = await screen.findByRole('menuitem', { name: '보유 크레딧 1,234' })
  expect(row).toBe(items[1])
  fireEvent.click(row)
  expect(onClose).toHaveBeenCalledOnce()
  expect(screen.getByTestId('where').textContent).toBe('/me/pay')
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
  expect(screen.getByRole('menuitem', { name: '보유 크레딧 7' })).toBe(items[1])
  screen.getAllByRole('menuitem').forEach((item, index) => expect(item).toBe(items[index]))
  expect(document.activeElement).toBe(items[3])
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

it('프로필 줄은 아바타·이름과 이메일 묶음·프로필 › 가 한 줄에 놓이고 길어지는 값은 title로 전체를 남긴다', () => {
  const { items } = open()
  expect([...items[0].children].map((el) => el.className || el.tagName.toLowerCase())).toEqual(['meav', 'who-text', 'em'])
  expect(items[0].querySelector('.who-text b')?.getAttribute('title')).toBe('읽는사람')
  expect(items[0].querySelector('.who-text small')?.getAttribute('title')).toBe('reader@storyfork.demo')
})
