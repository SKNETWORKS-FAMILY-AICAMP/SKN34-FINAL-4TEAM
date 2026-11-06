// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { AdminPage } from './AdminPage'

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

const renderAdmin = (tab: string) => render(
  <Provider store={createAppStore({ role: 'admin' })}>
    <MemoryRouter initialEntries={[`/admin?tab=${tab}`]}><AdminPage /></MemoryRouter>
  </Provider>,
)
const tables = () => [...document.querySelectorAll('table')]

it('신고·권리 행은 첫 셀의 버튼으로도 선택하고 선택 상태를 알린다', async () => {
  renderAdmin('rights')
  const pick = await screen.findByRole('button', { name: '○○○ 2차 연재' })
  expect(pick.closest('td')?.cellIndex).toBe(0)
  expect(pick.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(pick)
  await screen.findByText('신고 상세 · ○○○ 2차 연재')
  expect(screen.getByRole('button', { name: '○○○ 2차 연재' }).getAttribute('aria-pressed')).toBe('true')
})

it('신고·권리 행을 마우스로 눌러도 그대로 선택된다', async () => {
  renderAdmin('rights')
  fireEvent.click((await screen.findByText('○○○ 2차 연재')).closest('tr')!)
  await screen.findByText('신고 상세 · ○○○ 2차 연재')
  expect(screen.getByRole('button', { name: '○○○ 2차 연재' }).getAttribute('aria-pressed')).toBe('true')
})

it.each(['data', 'rights', 'llm', 'users', 'works', 'characterChats', 'comments', 'feedback', 'jobs', 'events', 'notices', 'credits', 'admins'])(
  '%s 탭의 모든 표에 캡션·열 머리 범위·키보드 스크롤 영역이 있다',
  async (tab) => {
    renderAdmin(tab)
    await waitFor(() => expect(tables().length).toBeGreaterThan(0))
    for (const table of tables()) {
      expect(table.querySelector(':scope > caption.sr-only')?.textContent?.trim()).toBeTruthy()
      for (const th of table.querySelectorAll('th')) expect(th.getAttribute('scope')).toBe('col')
      const scroller = table.parentElement!
      expect(scroller.classList.contains('adm-scroll')).toBe(true)
      expect(scroller.getAttribute('role')).toBe('region')
      expect(scroller.getAttribute('tabindex')).toBe('0')
      expect(scroller.getAttribute('aria-label')).toBeTruthy()
    }
  },
)

it('본문 영역은 건너뛰기 링크가 닿는 하나의 main이다', async () => {
  renderAdmin('data')
  const main = await screen.findByRole('main')
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(main.id).toBe('main')
  expect(main.getAttribute('tabindex')).toBe('-1')
})

it('상단바 글자·버튼 색은 하드코딩하지 않고 고정 어두운 면용 토큰을 쓴다', async () => {
  renderAdmin('data')
  await screen.findByRole('main')
  const inline = [...document.querySelectorAll('.adm .top [style]')].map((el) => el.getAttribute('style')).join(';')
  expect(inline).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  expect(inline).toMatch(/var\(--fixed-/)
})

it('탭 제목에 관리자와 현재 섹션 이름을 쓴다', async () => {
  renderAdmin('users')
  await waitFor(() => expect(document.title).toBe('관리자 · 사용자 관리 · STORYFORK'))
})
