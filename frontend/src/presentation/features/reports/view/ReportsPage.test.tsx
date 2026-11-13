// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { Report } from '../../../../domain/entities/report'
import { ReportsPage } from './ReportsPage'

// 상단바(Gnb)는 이 테스트와 무관하니 비우고, 공용 Footer는 실제 것을 그린다.
vi.mock('../../../shared/shell/Gnb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/shell/Gnb')>()),
  Gnb: () => null,
}))

// jsdom에는 scrollIntoView가 없어, 어느 요소를 불렀는지 기록하는 대역을 둔다.
const scrolled: Element[] = []
beforeEach(() => {
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) }
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(Element.prototype, 'scrollIntoView') })

const at = '2026-11-10T01:00:00Z'
const report = (patch: Partial<Report> = {}): Report => ({
  id: 'r1', kind: 'RIGHTS', workId: 'w1', workTitle: '달빛 도서관', workOwnerId: 'owner', reporterId: 'me', reason: '무단 사용이 의심돼요', evidence: '',
  status: 'RECEIVED', contentRestricted: false, createdAt: at, updatedAt: at, history: [], ...patch,
})
/** 내가 신고한 두 건을 서버 대신 답하고, 로그인한 회원(me)으로 내 신고 화면을 연다. */
function open() {
  const reports = appContainer.resolve('reportUseCase')
  const rows = [report(), report({ id: 'r2', workTitle: '별빛 서약' })]
  vi.spyOn(reports, 'listMine').mockResolvedValue(rows)
  vi.spyOn(reports, 'get').mockImplementation(async (id) => rows.find((row) => row.id === id)!)
  render(<Provider store={createAppStore({ role: 'user', memberId: 'me' })}><MemoryRouter><ReportsPage /></MemoryRouter></Provider>)
}

it('내 신고 화면은 본문(main) 뒤에 공용 푸터를 최상위 형제로 둔다', async () => {
  const { container } = render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><ReportsPage /></MemoryRouter></Provider>)
  // 토큰 없는 단위 환경이라 신고 목록 조회가 실패한다. 그 비동기 갱신을 테스트 안에서 끝낸다.
  await screen.findByRole('alert')
  const footer = screen.getByRole('contentinfo')
  expect(within(footer).getByText('SKN34 최종 프로젝트 4팀')).toBeTruthy()
  expect(footer.parentElement).toBe(container)
  expect(screen.getByRole('main').nextElementSibling).toBe(footer)
})

it('신고를 고르면 목록 아래에 열린 상세의 제목으로 초점을 옮기고 화면 안으로 끌어온다', async () => {
  open()
  fireEvent.click(await screen.findByRole('button', { name: /별빛 서약/ }))
  const heading = await screen.findByRole('heading', { name: '별빛 서약', level: 2 })
  expect(heading.getAttribute('tabindex')).toBe('-1')
  await waitFor(() => expect(document.activeElement).toBe(heading))
  expect(scrolled).toEqual([heading])

  // 다른 신고를 고르면 그 상세 제목으로 다시 옮긴다.
  fireEvent.click(screen.getByRole('button', { name: /달빛 도서관/ }))
  const next = await screen.findByRole('heading', { name: '달빛 도서관', level: 2 })
  await waitFor(() => expect(document.activeElement).toBe(next))
  expect(scrolled).toHaveLength(2)
})

it('증거 보완을 비워 보내면 브라우저 말풍선 대신 화면의 경고로 알리고 서버에 보내지 않는다', async () => {
  open()
  const sent = vi.spyOn(appContainer.resolve('reportRepository'), 'addEvidence').mockResolvedValue()
  fireEvent.click(await screen.findByRole('button', { name: /별빛 서약/ }))
  const body = await screen.findByLabelText<HTMLTextAreaElement>('증거 보완')
  expect(body.required).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '증거 보내기' }))
  expect((await screen.findByRole('alert')).textContent).toBe('내용을 입력해 주세요.')
  expect(sent).not.toHaveBeenCalled()
})
