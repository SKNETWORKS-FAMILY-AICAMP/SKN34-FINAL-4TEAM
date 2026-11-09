// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { AdminPage } from './AdminPage'

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.title = 'STORYFORK' })

const renderAdmin = (tab: string) => render(
  <Provider store={createAppStore({ role: 'admin' })}>
    <MemoryRouter initialEntries={[`/admin?tab=${tab}`]}><AdminPage /></MemoryRouter>
  </Provider>,
)
const tables = () => [...document.querySelectorAll('table')]

it('신고·권리 탭은 운영 API 실패를 데모 행이나 빈 목록으로 숨기지 않는다', async () => {
  renderAdmin('rights')
  await screen.findByText(/신고 목록을 불러오지 못했어요/)
  expect(screen.queryByText('○○○ 2차 연재')).toBeNull()
  expect(screen.getByText('운영 API 연결')).toBeTruthy()
})

// users·admins 표는 운영 API 응답이 있어야 그려지므로, notices·events는 표 없이 목록 패널만 그리므로 렌더 통합 대상에서 뺍니다.
it.each(['data', 'rights', 'llm', 'works', 'characterChats', 'comments', 'feedback', 'jobs', 'credits'])(
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

it('작품 탭은 정본 작품의 운영상 비공개 버튼을 막고 사유를 연결하며 메모리 작품은 막지 않는다', async () => {
  const work = appContainer.resolve('mockDb').works.find((w) => w.id === 'starlight')!
  work.canonical = true
  try {
    renderAdmin('works')
    const canonicalRow = (await screen.findByText('별빛 서약의 탑', { selector: 'b' })).closest('tr') as HTMLElement
    const blocked = within(canonicalRow).getByRole('button', { name: '운영상 비공개' }) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    expect(document.getElementById(blocked.getAttribute('aria-describedby')!)?.textContent).toMatch('정본 작품')
    const demoRow = screen.getByText('구운몽', { selector: 'b' }).closest('tr') as HTMLElement
    const open = within(demoRow).getByRole('button', { name: '운영상 비공개' }) as HTMLButtonElement
    expect(open.disabled).toBe(false)
    expect(open.hasAttribute('aria-describedby')).toBe(false)
  } finally {
    delete work.canonical
  }
})

it('운영 API 탭은 데모 조회가 실패해도 본문과 조치 버튼을 그리고 데모 조회 오류 안내는 데모 탭에만 보인다', async () => {
  const load = vi.spyOn(appContainer.resolve('adminUseCase'), 'load').mockRejectedValue(new Error('데모 조회 실패'))
  vi.spyOn(appContainer.resolve('memberUseCase'), 'listMembers').mockResolvedValue([
    { id: 'member-1', email: 'member@example.invalid', nickname: '연화봉러', role: 'MEMBER', restricted: false, createdAt: '2026-11-01T00:00:00Z' },
  ])
  renderAdmin('users')
  const row = (await screen.findByText('연화봉러')).closest('tr') as HTMLElement
  await waitFor(() => expect(load).toHaveBeenCalled())
  await act(async () => { await new Promise((done) => setTimeout(done, 0)) })
  expect((within(row).getByRole('button', { name: '이용 제한' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.queryByText(/관리자 데이터를 불러오지 못했어요/)).toBeNull()
  cleanup()
  renderAdmin('works')
  await screen.findByText(/관리자 데이터를 불러오지 못했어요/)
})

it('개요의 답변 대기 문의는 운영 패널의 답변 없는 문의만 세고 제보·문의 탭으로 연결한다', async () => {
  const operations = appContainer.resolve('operationsUseCase')
  const answered = await operations.saveInquiry(null, { category: '계정', title: '답변된 문의', body: '본문' })
  await operations.saveReply(answered.id, null, '답변')
  for (const title of ['첫 문의', '둘째 문의']) await operations.saveInquiry(null, { category: '계정', title, body: '본문' })
  await appContainer.resolve('accountUseCase').ask('이용 문의', '회원 문의', '본문')
  renderAdmin('data')
  const link = (await screen.findByText('답변 대기 문의 (데모)')).closest('a') as HTMLElement
  expect(link.getAttribute('href')).toBe('/admin?tab=feedback')
  expect(link.querySelector('b')!.textContent).toBe('2')
})
