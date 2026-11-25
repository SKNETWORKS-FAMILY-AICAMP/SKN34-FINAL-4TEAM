// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import '../../../../test/testLocks'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { login } from '../../../../data/api/auth'
import { HttpAdminActivityRepository, HttpOperationsCommentRepository, HttpOperationsWorkRepository } from '../../../../data/api/operationsApi'
import { InMemoryOperationsGenreRepository } from '../../../../data/mock/InMemoryGenreRepositories'
import { ADMIN_PERMISSIONS } from '../../../../domain/entities/admin'
import { DatasetInvalid } from '../../../../domain/entities/llmDatasets'
import type { AdminActivity } from '../../../../domain/entities/adminActivity'
import type { Evaluation } from '../../../../domain/entities/llmOps'
import { OperationsForbidden, OperationsRejected } from '../../../../domain/entities/operations'
import { CREDIT_INSUFFICIENT_MESSAGE, CREDITS_FORBIDDEN, MEMBER_SEARCH_FORBIDDEN, type MemberCredits } from '../../../../domain/entities/operationsCredit'
import type { OperationsComment } from '../../../../domain/entities/operationsComment'
import type { OperationsFeedbackReport } from '../../../../domain/entities/operationsFeedbackReport'
import type { OperationsWork } from '../../../../domain/entities/operationsWork'
import { promptLabel } from '../../../../domain/entities/promptNames'
import { AdminActivityUseCase } from '../../../../domain/usecases/AdminActivityUseCase'
import { OperationsCommentUseCase } from '../../../../domain/usecases/OperationsCommentUseCase'
import { OperationsGenreUseCase } from '../../../../domain/usecases/OperationsGenreUseCase'
import { OperationsWorkUseCase } from '../../../../domain/usecases/OperationsWorkUseCase'
import { kstDateTime } from '../../../shared/format'
import { AdminPage } from './AdminPage'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.title = 'STORYFORK' })

// 파이프라인 캔버스(react-force-graph, d3·canvas)는 jsdom에서 그리지 않는다. 프롬프트·평가 쪽의 AI 파이프라인 보기가 불러오기만 해도 대역으로 막는다.
vi.mock('react-force-graph-2d', () => ({ default: () => null }))

const renderAdmin = (tab: string, view?: string) => render(
  <Provider store={createAppStore({ role: 'admin' })}>
    <MemoryRouter initialEntries={[`/admin?tab=${tab}${view ? `&view=${view}` : ''}`]}><AdminPage /></MemoryRouter>
  </Provider>,
)
const tables = () => [...document.querySelectorAll('table')]
/** 제목 옆 칩: 운영 API 탭에는 없고 데모 탭에만 '데모 화면'이 있다. */
const demoChip = () => document.querySelector('.admin-head .chip')

it('신고·권리 탭은 운영 API 실패를 데모 행이나 빈 목록으로 숨기지 않는다', async () => {
  renderAdmin('rights')
  await screen.findByText(/신고 목록을 불러오지 못했어요/)
  expect(screen.queryByText('○○○ 2차 연재')).toBeNull()
  expect(demoChip()).toBeNull()
})

// users·admins·rights 표는 운영 API 응답이 있어야 그려지므로(rights는 이 환경에서 유일하던 예시 격리 점검 표를 지웠다), notices·events는 표 없이 목록 패널만 그리므로, data(대시보드)는 표 없이 숫자 카드와 차트만 그리므로(아래 별도 테스트) 렌더 통합 대상에서 뺍니다.
it.each(['llm', 'works', 'characterChats', 'comments', 'feedback', 'jobs', 'genres', 'cardCategories'])(
  '%s 탭의 모든 표에 캡션·열 머리 범위·키보드 스크롤 영역이 있다',
  async (tab) => {
    // 작가 검토 제보는 한 건도 없으면 표 대신 빈 상태 글을 그리므로, 표 검사를 위해 제보 한 건을 준다.
    if (tab === 'feedback') {
      const report: OperationsFeedbackReport = {
        id: 'r1', workId: 'w1', workTitle: '별빛 서약의 탑', episodeNumber: 3, kind: 'typo', body: '오탈자가 있어요', quote: null,
        visibility: 'private', status: 'unchecked', reporterName: '연화', withdrawn: false, createdAt: '2026-11-20T01:02:03Z',
      }
      vi.spyOn(appContainer.resolve('operationsFeedbackReportUseCase')!, 'list').mockResolvedValue({ items: [report], page: 0, size: 20, total: 1 })
    }
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

// 대시보드는 표가 아니라 숫자 카드와 차트라, 표의 캡션·열 머리 범위 대신 카드의 이름·값 글자와 차트의 캡션·role=img·요약 aria-label로 읽힙니다.
it('data 탭의 숫자 카드는 이름과 값을 글자로 갖고 차트는 캡션과 role=img 요약 aria-label을 갖는다', async () => {
  renderAdmin('data')
  await waitFor(() => {
    expect(document.querySelectorAll('.admin-summary > div').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.admin-chart').length).toBeGreaterThan(0)
  })
  for (const card of document.querySelectorAll('.admin-summary > div')) {
    expect(card.querySelector(':scope > small')?.textContent?.trim()).toBeTruthy()
    expect(card.querySelector(':scope > b')?.textContent?.trim()).toBeTruthy()
  }
  for (const chart of document.querySelectorAll('.admin-chart')) {
    expect(chart.querySelector(':scope > figcaption')?.textContent?.trim()).toBeTruthy()
    expect(chart.querySelector(':scope > [role="img"]')?.getAttribute('aria-label')?.trim()).toBeTruthy()
  }
})

it('본문 영역은 건너뛰기 링크가 닿는 하나의 main이다', async () => {
  renderAdmin('data')
  const main = await screen.findByRole('main')
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(main.id).toBe('main')
  expect(main.getAttribute('tabindex')).toBe('-1')
})

it('관리자 화면도 공용 푸터를 .adm 밖 최상위 형제로 둔다', async () => {
  const { container } = renderAdmin('data')
  await screen.findByRole('main')
  const footer = screen.getByRole('contentinfo')
  expect(within(footer).getByText('SKN34 최종 프로젝트 4팀')).toBeTruthy()
  expect(footer.parentElement).toBe(container)
  expect(footer.previousElementSibling).toBe(container.querySelector('.adm'))
})

it('상단바 글자·버튼 색은 하드코딩하지 않고 고정 어두운 면용 토큰을 쓴다', async () => {
  renderAdmin('data')
  await screen.findByRole('main')
  const inline = [...document.querySelectorAll('.adm .top [style]')].map((el) => el.getAttribute('style')).join(';')
  expect(inline).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  // 상단바는 밝은 테마 면(--surface)이라 어두운 면용 --fixed-* 글자색을 인라인으로 두지 않는다(어두운 면은 사이드바 열이고, 색은 모두 CSS 토큰이 정한다).
  expect(inline).not.toMatch(/var\(--fixed-/)
})

it('탭 제목에 관리자와 현재 섹션 이름을 쓴다', async () => {
  renderAdmin('users')
  await waitFor(() => expect(document.title).toBe('관리자 · 사용자 관리 · STORYFORK'))
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
  expect((openRowMenu(row).getByRole('menuitem', { name: '이용 제한' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.queryByText(/관리자 데이터를 불러오지 못했어요/)).toBeNull()
  cleanup()
  renderAdmin('characterChats')
  await screen.findByText(/관리자 데이터를 불러오지 못했어요/)
})

/** 운영 작품 API(74)를 흉내 내는 fetch 대역으로 실제 Http 저장소·UseCase·ViewModel·화면을 잇는다. */
const work = (patch: Partial<OperationsWork> = {}): OperationsWork => ({
  workId: 'w-open', ownerId: 'owner-1', title: '달빛 도서관', authorName: '연화', originKind: 'original', creationType: 'original',
  rightsConfirmed: true, visibility: 'public', restricted: false, ...patch,
})
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent)
/** 표 행의 ⋮ 버튼('「이름」 조치')을 눌러 메뉴를 열고 그 메뉴 안을 돌려준다(메뉴는 한 번에 하나만 열려 있다). */
const openRowMenu = (row: HTMLElement) => {
  fireEvent.pointerDown(document.body) // 열려 있던 다른 행의 메뉴는 바깥 누름으로 닫힌다
  fireEvent.click(within(row).getByRole('button', { name: /조치$/ }))
  return within(screen.getByRole('menu'))
}

it('작품 탭은 운영 작품 API로 목록을 읽고 운영 제한·해제 뒤 목록을 다시 읽으며 실패는 그대로 보여 준다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'w-csrf' })
    : Response.json({ accessToken: 'w-bearer', user: { id: 'admin', email: 'admin@example.invalid', nickname: '관리자', operator: true } })))
  await login('admin@example.invalid', 'test-password')
  const rows = [work(), work({ workId: 'w-fork', title: '달빛 도서관 외전', authorName: '하늘', originKind: 'fork', creationType: 'external_derivative', rightsConfirmed: false, visibility: 'private' })]
  let failRestriction = false
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = /\/works\/([^/]+)\/restriction$/.exec(String(url))?.[1]
    if (String(url).endsWith('/w-fork/fork-integrity')) return Response.json({
      basisEpisode: 2, forkHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), matches: false, characterStateStatus: 'unavailable',
    })
    if (!target) return Response.json({ items: rows })
    if (failRestriction) return Response.json({ code: 'BAD_GATEWAY', message: 'content down' }, { status: 502 })
    const row = rows.find((w) => w.workId === target)!
    row.restricted = init?.method === 'PUT'
    return Response.json({ workId: row.workId, ownerId: row.ownerId, title: row.title, restricted: row.restricted })
  })
  const http = new OperationsWorkUseCase(new HttpOperationsWorkRepository(fetcher))
  const works = appContainer.resolve('operationsWorkUseCase')
  vi.spyOn(works, 'list').mockImplementation(() => http.list())
  vi.spyOn(works, 'forkIntegrity').mockImplementation(id => http.forkIntegrity(id))
  vi.spyOn(works, 'setRestriction').mockImplementation((id, restricted) => http.setRestriction(id, restricted))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const requests = () => fetcher.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)

  renderAdmin('works')
  const open = (await screen.findByText('달빛 도서관', { selector: 'b' })).closest('tr') as HTMLElement
  const fork = screen.getByText('달빛 도서관 외전', { selector: 'b' }).closest('tr') as HTMLElement
  expect(demoChip()).toBeNull()
  expect(screen.queryByText('목업 작품 데이터')).toBeNull()
  // 운영 제한·해제는 신고 사건이 아니라 활동 로그(72)에 남는다.
  expect(screen.getByText(/신고 사건에는 남기지 않고 활동 로그에만 기록해요/)).toBeTruthy()
  expect(requests()).toEqual(['GET /api/v1/operations/works'])
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer w-bearer' } })
  expect(cells(open)).toEqual(['달빛 도서관', '연화', '원작', '원작 · 권리 확인됨', '공개', ''])
  expect(cells(fork)).toEqual(['달빛 도서관 외전', '하늘', '포크', '외부 2차 창작 · 권리 미확인', '비공개', ''])

  // 제한은 확인을 거쳐야 보내고, 취소하면 요청도 목록 재조회도 없다. 항목을 고르면 메뉴는 닫힌다.
  fireEvent.click(openRowMenu(open).getByRole('menuitem', { name: '운영 제한' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).toBeNull()
  expect(requests()).toEqual(['GET /api/v1/operations/works'])
  confirm.mockReturnValue(true)
  fireEvent.click(openRowMenu(open).getByRole('menuitem', { name: '운영 제한' }))
  await within(open).findByText('운영 제한', { selector: '.chip' })
  expect(requests()).toEqual(['GET /api/v1/operations/works', 'PUT /api/v1/operations/works/w-open/restriction', 'GET /api/v1/operations/works'])
  expect(cells(open)[4]).toBe('운영 제한')
  expect(within(open).getByText('운영 제한', { selector: '.chip' }).className).toContain('wait')
  expect(openRowMenu(fork).getByRole('menuitem', { name: '운영 제한' })).toBeTruthy()
  // 완료 안내는 화면 위 한 줄에 대상 이름과 함께 한 번만 보인다(같은 문구를 조치 상태 줄로 또 그리지 않는다).
  const done = screen.getAllByText('작품을 운영 제한했어요.')
  expect(done).toHaveLength(1)
  expect(done[0].getAttribute('role')).toBe('status')
  expect(done[0].textContent).toBe('「달빛 도서관」 · 작품을 운영 제한했어요.')

  // 해제는 확인 없이 보내고 목록을 다시 읽어 공개 상태로 돌아온다.
  confirm.mockClear()
  fireEvent.click(openRowMenu(open).getByRole('menuitem', { name: '제한 해제' }))
  await waitFor(() => expect(cells(open)[4]).toBe('공개'))
  expect(confirm).not.toHaveBeenCalled()
  expect(requests().slice(3)).toEqual(['DELETE /api/v1/operations/works/w-open/restriction', 'GET /api/v1/operations/works'])
  expect(cells(open)[4]).toBe('공개')

  // 서버(Content) 실패는 성공으로 바꾸지 않고 오류를 보이며 목록도 다시 읽지 않는다.
  failRestriction = true
  fireEvent.click(openRowMenu(fork).getByRole('menuitem', { name: '운영 제한' }))
  // 실패 안내는 어느 작품의 조치인지 이름과 함께 알린다.
  expect((await screen.findByRole('alert')).textContent).toBe('「달빛 도서관 외전」 · 연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.')
  expect(cells(fork)[4]).toBe('비공개')
  expect(requests()).toHaveLength(6)

  expect(openRowMenu(open).queryByRole('menuitem', { name: /포크 정합성 점검/ })).toBeNull()
  fireEvent.click(openRowMenu(fork).getByRole('menuitem', { name: '포크 정합성 점검' }))
  expect(await screen.findByText('불일치')).toBeTruthy()
  expect(screen.getByText('a'.repeat(64))).toBeTruthy()
  expect(screen.getByText('비교 불가 · 기준 회차의 인물 상태 기록이 없어요.')).toBeTruthy()
  expect(requests().at(-1)).toBe('GET /api/v1/operations/works/w-fork/fork-integrity')
  fireEvent.click(screen.getByRole('link', { name: '캐릭터챗' }))
  fireEvent.click(screen.getByRole('link', { name: /^작품$/ }))
  await screen.findByText('달빛 도서관 외전', { selector: 'b' })
  expect(screen.queryByRole('region', { name: '포크 정합성 점검 결과' })).toBeNull()
  expect(requests().filter(request => request.endsWith('/fork-integrity'))).toHaveLength(1)
})

/** 포크 정합성 점검 패널용: 작품 목록(원작 1·포크 1)과 점검 응답을 fetch 대역으로 실제 Http 저장소·UseCase·화면에 잇는다. */
async function openForkTab(check: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'f-csrf' })
    : Response.json({ accessToken: 'f-bearer', user: { id: 'admin', email: 'admin@example.invalid', nickname: '관리자', operator: true } })))
  await login('admin@example.invalid', 'test-password')
  const rows = [work(), work({ workId: 'w-fork', title: '달빛 도서관 외전', authorName: '하늘', originKind: 'fork', creationType: 'external_derivative' })]
  const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/fork-integrity') ? check() : Response.json({ items: rows }))
  const http = new OperationsWorkUseCase(new HttpOperationsWorkRepository(fetcher))
  const works = appContainer.resolve('operationsWorkUseCase')
  vi.spyOn(works, 'list').mockImplementation(() => http.list())
  vi.spyOn(works, 'forkIntegrity').mockImplementation((id) => http.forkIntegrity(id))
  renderAdmin('works')
  const row = (await screen.findByText('달빛 도서관 외전', { selector: 'b' })).closest('tr') as HTMLElement
  const checks = () => fetcher.mock.calls.filter(([url]) => String(url).endsWith('/fork-integrity')).length
  return { row, checks, trigger: () => within(row).getByRole('button', { name: '「달빛 도서관 외전」 조치' }), button: () => openRowMenu(row).getByRole('menuitem', { name: '포크 정합성 점검' }) }
}
const integrityReport = { basisEpisode: 2, forkHash: 'a'.repeat(64), sourceHash: 'a'.repeat(64), matches: true, characterStateStatus: 'unavailable' }

it('포크 정합성 점검은 결과 제목으로 포커스를 옮기고, 닫으면 누른 점검 버튼으로 되돌리며, 점검 중인 행을 표시한다', async () => {
  const { row, button, trigger } = await openForkTab(() => Response.json(integrityReport))
  expect(row.classList.contains('sel')).toBe(false)
  fireEvent.click(button())
  const heading = await screen.findByRole('heading', { name: '달빛 도서관 외전 정합성 점검' })
  const verdict = await screen.findByText('일치', { selector: '.chip' })
  expect(document.activeElement).toBe(heading)
  expect(row.classList.contains('sel')).toBe(true)
  // 판정은 칩으로, 결과 항목은 다른 상세 화면과 같은 dl.ai로 보인다.
  expect(verdict.className).toContain('ok')
  expect(screen.getByText('기준 회차', { selector: 'dt' }).parentElement?.className).toBe('ai')

  fireEvent.click(screen.getByRole('button', { name: '점검 결과 닫기' }))
  expect(screen.queryByRole('region', { name: '포크 정합성 점검 결과' })).toBeNull()
  expect(document.activeElement).toBe(trigger())
  expect(row.classList.contains('sel')).toBe(false)
})

it('원작과 다른 포크의 점검 결과는 불일치를 주의 칩으로 보인다', async () => {
  const { button } = await openForkTab(() => Response.json({ ...integrityReport, forkHash: 'b'.repeat(64), matches: false }))
  fireEvent.click(button())
  expect((await screen.findByText('불일치', { selector: '.chip' })).className).toContain('wait')
})

it.each([
  [409, '원작의 고정 기준 기록을 확인할 수 없어요.'],
  [404, '포크 작품을 찾을 수 없어요.'],
])('포크 정합성 점검이 %s이면 서버 안내 문구를 그대로 보이고 다시 시도 버튼은 두지 않는다', async (status, message) => {
  const { button, checks } = await openForkTab(() => Response.json({ code: 'X', message }, { status }))
  fireEvent.click(button())
  const alert = await screen.findByText(message)
  expect(alert.getAttribute('role')).toBe('alert')
  expect(alert.className).toContain('admin-action-error')
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
  expect(screen.queryByText(/점검 결과를 불러오지 못했어요/)).toBeNull()
  expect(checks()).toBe(1)
})

it('그 밖의 점검 실패는 일반 오류와 다시 시도 버튼을 보이고, 다시 시도하면 결과를 읽는다', async () => {
  let fail = true
  const { button, checks } = await openForkTab(() => fail ? Response.json({ code: 'UPSTREAM_FAILED', message: 'Upstream service request failed.' }, { status: 502 }) : Response.json(integrityReport))
  fireEvent.click(button())
  const alert = await screen.findByText(/점검 결과를 불러오지 못했어요/)
  expect(alert.getAttribute('role')).toBe('alert')
  expect(alert.className).toContain('admin-action-error')
  fail = false
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('일치', { selector: '.chip' })
  expect(checks()).toBe(2)
})

it('데모(메모리) 작품의 포크 정합성 점검은 지원하지 않는다는 안내만 보이고 다시 시도 버튼은 두지 않는다', async () => {
  renderAdmin('works')
  const fork = (await screen.findAllByText('포크', { selector: 'td' }))[0].closest('tr') as HTMLElement
  fireEvent.click(openRowMenu(fork).getByRole('menuitem', { name: '포크 정합성 점검' }))
  const alert = await screen.findByText('데모에서는 포크 정합성 점검을 지원하지 않아요.')
  expect(alert.getAttribute('role')).toBe('alert')
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
})

it('작품 탭은 받은 전체 목록에서 원작·포크 분류, 작품명·작성자·권리 표시값 검색, 제목 정렬을 계산한다', async () => {
  renderAdmin('works')
  const titles = () => [...document.querySelectorAll('tbody tr td:first-child b')].map((b) => b.textContent)
  await waitFor(() => expect(titles()).toContain('구운몽'))
  const all = titles()
  expect(all).toEqual([...all].sort((a, b) => a!.localeCompare(b!, 'ko')))

  fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'titleDesc' } })
  await waitFor(() => expect(titles()).toEqual([...all].reverse()))

  const search = (query: string) => {
    fireEvent.change(screen.getByLabelText('작품 검색'), { target: { value: query } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
  }
  search('김만중')
  await waitFor(() => expect(titles()).toEqual(['구운몽']))
  search('외부 2차 창작')
  await waitFor(() => expect(titles()).toContain('구운몽'))
  expect(titles()).not.toContain('별빛 서약의 탑')
  search('없는 작품')
  await screen.findByText('검색 결과가 없어요.')

  search('')
  fireEvent.change(screen.getByLabelText('분류'), { target: { value: 'fork' } })
  await waitFor(() => expect(titles()).not.toContain('구운몽'))
  expect(titles().length).toBeGreaterThan(0)
  expect(titles().length).toBeLessThan(all.length)
})

/** 운영 댓글 API(75)를 흉내 내는 fetch 대역으로 실제 Http 저장소·UseCase·ViewModel·화면을 잇는다. */
const comment = (patch: Partial<OperationsComment> = {}): OperationsComment => ({
  commentId: 'c-open', workId: 'w1', workTitle: '달빛 도서관', episodeNumber: 2, authorId: 'user-1', authorName: '연화',
  body: '첫 감상', likeCount: 3, hidden: false, createdAt: '2026-11-09T01:00:00Z', ...patch,
})

it('댓글 탭은 운영 댓글 API로 목록을 읽고 숨김·게시 복구 뒤 목록을 다시 읽으며 실패는 그대로 보여 준다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c-csrf' })
    : Response.json({ accessToken: 'c-bearer', user: { id: 'admin', email: 'admin@example.invalid', nickname: '관리자', operator: true } })))
  await login('admin@example.invalid', 'test-password')
  const rows = [comment(), comment({ commentId: 'c-hidden', authorName: '하늘', body: '숨긴 댓글의 원문', likeCount: 9, hidden: true })]
  let failAction = false
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = /\/comments\/([^/]+)\/hidden$/.exec(String(url))?.[1]
    if (!target) return Response.json({ items: rows })
    if (failAction) return Response.json({ code: 'BAD_GATEWAY', message: 'content down' }, { status: 502 })
    const row = rows.find((c) => c.commentId === target)!
    row.hidden = init?.method === 'PUT'
    return Response.json(row)
  })
  const http = new OperationsCommentUseCase(new HttpOperationsCommentRepository(fetcher))
  const comments = appContainer.resolve('operationsCommentUseCase')
  vi.spyOn(comments, 'list').mockImplementation(() => http.list())
  vi.spyOn(comments, 'hide').mockImplementation((id) => http.hide(id))
  vi.spyOn(comments, 'unhide').mockImplementation((id) => http.unhide(id))
  const requests = () => fetcher.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)

  renderAdmin('comments')
  const open = (await screen.findByText('첫 감상')).closest('tr') as HTMLElement
  const hidden = screen.getByText('숨긴 댓글의 원문').closest('tr') as HTMLElement
  expect(demoChip()).toBeNull()
  expect(screen.queryByText(/서버 저장 없음/)).toBeNull()
  expect(requests()).toEqual(['GET /api/v1/operations/comments'])
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer c-bearer' } })
  // 숨긴 댓글도 운영자에게는 원문이 보인다.
  expect(cells(hidden)).toEqual(['숨긴 댓글의 원문', '달빛 도서관 · 2화', '하늘', '9', '숨김', kstDateTime('2026-11-09T01:00:00Z'), ''])
  expect(cells(open)).toEqual(['첫 감상', '달빛 도서관 · 2화', '연화', '3', '게시', kstDateTime('2026-11-09T01:00:00Z'), ''])
  // 작성일 열은 회원·신고 표처럼 한국시간으로 보이고, 댓글 셀은 줄바꿈을 살리며 긴 글자도 줄바꿈한다. 버튼 이름에는 작성자가 들어간다.
  expect(screen.getByRole('columnheader', { name: '작성일' })).toBeTruthy()
  expect(within(open).getByText('첫 감상').style.whiteSpace).toBe('pre-wrap')
  expect(within(open).getByText('첫 감상').style.overflowWrap).toBe('anywhere')
  // 날짜 칸은 공백에서 두 줄로 꺾이지 않게 admin-date를 가진다.
  expect(within(open).getByText(kstDateTime('2026-11-09T01:00:00Z')).className).toBe('admin-date')
  expect(within(hidden).getByText('숨김', { selector: '.chip' }).className).toContain('wait')
  expect(within(open).getByText('게시', { selector: '.chip' }).className).toContain('ok')

  // 숨김은 확인을 거치고, 취소하면 요청하지 않는다.
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(openRowMenu(open).getByRole('menuitem', { name: '숨김' }))
  expect(confirm).toHaveBeenCalledWith('「달빛 도서관」의 댓글을 숨길까요? 독자에게는 자리표시로만 보여요.')
  expect(requests()).toEqual(['GET /api/v1/operations/comments'])
  // 승인하면 서버에 보낸 뒤 목록을 다시 읽어 상태를 바꾼다.
  confirm.mockReturnValue(true)
  fireEvent.click(openRowMenu(open).getByRole('menuitem', { name: '숨김' }))
  await within(open).findByText('숨김', { selector: '.chip' })
  confirm.mockClear()
  expect(requests()).toEqual(['GET /api/v1/operations/comments', 'PUT /api/v1/operations/comments/c-open/hidden', 'GET /api/v1/operations/comments'])
  expect(cells(open)[4]).toBe('숨김')
  expect(openRowMenu(hidden).getByRole('menuitem', { name: '게시 복구' })).toBeTruthy()

  // 게시 복구는 DELETE로 보내고 목록을 다시 읽어 게시 상태로 돌아온다.
  fireEvent.click(openRowMenu(open).getByRole('menuitem', { name: '게시 복구' }))
  await within(open).findByText('게시', { selector: '.chip' })
  expect(requests().slice(3)).toEqual(['DELETE /api/v1/operations/comments/c-open/hidden', 'GET /api/v1/operations/comments'])
  expect(cells(open)[4]).toBe('게시')
  // 게시 복구는 확인 없이 바로 보낸다.
  expect(confirm).not.toHaveBeenCalled()

  // 서버(Content) 실패는 성공으로 바꾸지 않고 오류를 보이며 목록도 다시 읽지 않는다.
  failAction = true
  fireEvent.click(openRowMenu(hidden).getByRole('menuitem', { name: '게시 복구' }))
  expect((await screen.findByRole('alert')).textContent).toBe('하늘 님의 댓글 · 연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.')
  expect(cells(hidden)[4]).toBe('숨김')
  expect(requests()).toHaveLength(6)
})

it('댓글 탭은 받은 전체 목록에서 작품 분류, 내용·작품명·작성자 검색, 공감순 정렬을 계산한다', async () => {
  renderAdmin('comments')
  const column = (n: number) => [...document.querySelectorAll(`tbody tr td:nth-child(${n})`)].map((td) => td.textContent)
  const likes = () => column(4).map(Number)
  await waitFor(() => expect(likes()).toEqual([412, 301, 230, 210, 133, 122, 88]))
  expect(column(1)[0]).toBe('돌다리 장면 묘사 최고… 성진 흔들릴 만하네')

  fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'likesAsc' } })
  await waitFor(() => expect(likes()).toEqual([88, 122, 133, 210, 230, 301, 412]))

  const search = (query: string) => {
    fireEvent.change(screen.getByLabelText('댓글 검색'), { target: { value: query } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
  }
  search('별빛')
  await waitFor(() => expect(likes()).toEqual([122, 301]))
  search('TOKKI')
  await waitFor(() => expect(likes()).toEqual([210]))
  search('7구역')
  await waitFor(() => expect(likes()).toEqual([133]))
  search('없는 말')
  await screen.findByText('검색 결과가 없어요.')

  search('')
  fireEvent.change(screen.getByLabelText('분류'), { target: { value: 'guunmong' } })
  await waitFor(() => expect(likes()).toEqual([88, 230, 412]))
  // 데모 댓글은 회차 구분이 없어 1회차로 보인다.
  expect(new Set(column(2))).toEqual(new Set(['구운몽 · 1화']))
})

it('댓글 목록을 못 읽으면 빈 표로 숨기지 않고 실패와 다시 불러오기를 보인다', async () => {
  vi.spyOn(appContainer.resolve('operationsCommentUseCase'), 'list').mockRejectedValueOnce(new Error('offline'))
  renderAdmin('comments')
  await screen.findByText(/댓글 목록을 불러오지 못했어요/)
  expect(document.querySelector('table')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await waitFor(() => expect(document.querySelector('table')).not.toBeNull())
  expect(screen.queryByText(/댓글 목록을 불러오지 못했어요/)).toBeNull()
})

/** 관리자 활동 기록 API(72)를 흉내 내는 fetch 대역으로 실제 Http 저장소·UseCase·ViewModel·화면을 잇는다. */
const activity = (patch: Partial<AdminActivity> = {}): AdminActivity => ({
  id: 'a1', actorId: 'admin-1', actorNickname: '운영자', action: 'WORK_RESTRICT', targetType: 'WORK', targetId: 'w-open',
  detail: '달빛 도서관', createdAt: '2026-11-10T01:00:00Z', ...patch,
})
const activityRows = () => [...document.querySelectorAll<HTMLElement>('.audit-list li')]
const activities = () => appContainer.resolve('adminActivityUseCase')

it('활동 로그 탭은 운영 활동 기록 API를 읽어 시각·수행자·조치·대상·내역을 서버의 최신순 그대로 보여 주고 닉네임이 없으면 ID를 보여 준다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'a-csrf' })
    : Response.json({ accessToken: 'a-bearer', user: { id: 'admin', email: 'admin@example.invalid', nickname: '관리자', operator: true } })))
  await login('admin@example.invalid', 'test-password')
  const rows = [
    activity(),
    activity({ id: 'a2', actorId: 'gone-admin', actorNickname: null, action: 'NOTICE_DELETE', targetType: 'NOTICE', targetId: 'n-1', detail: null, createdAt: '2026-11-09T01:00:00Z' }),
    activity({ id: 'a3', action: 'FUTURE_ACTION', targetType: 'FUTURE', targetId: 'f-1', createdAt: '2026-11-08T01:00:00Z' }),
  ]
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ items: rows }))
  const http = new AdminActivityUseCase(new HttpAdminActivityRepository(fetcher))
  vi.spyOn(activities(), 'list').mockImplementation(() => http.list())

  renderAdmin('audit')
  await waitFor(() => expect(activityRows()).toHaveLength(3))
  expect(demoChip()).toBeNull()
  expect(document.body.textContent).not.toContain('브라우저 메모리에만')
  expect(document.body.textContent).not.toContain('데모 조치')
  expect(fetcher.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)).toEqual(['GET /api/v1/operations/admin/activities'])
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer a-bearer' } })
  const [first, second, third] = activityRows()
  expect(activityRows().map((li) => li.querySelector('time')?.getAttribute('datetime'))).toEqual(rows.map((row) => row.createdAt))
  expect(first.querySelector('time')?.textContent).toBe(kstDateTime('2026-11-10T01:00:00Z'))
  within(first).getByText('작품 운영 제한', { selector: 'b' })
  within(first).getByText('수행자 운영자 · 대상 작품 w-open')
  within(first).getByText('달빛 도서관')
  // 닉네임이 없으면(관리자 해제·탈퇴) ID를 보이고, 내역이 없으면 내역 줄을 그리지 않는다.
  within(second).getByText('공지 삭제', { selector: 'b' })
  within(second).getByText('수행자 gone-admin · 대상 공지 n-1')
  expect(second.querySelectorAll('.small')).toHaveLength(1)
  // 모르는 조치·대상 종류는 코드 그대로 보인다.
  within(third).getByText('FUTURE_ACTION', { selector: 'b' })
  within(third).getByText('수행자 운영자 · 대상 FUTURE f-1')
})

it('활동 로그 탭은 불러오는 동안 빈 상태를 보이지 않고, 기록이 없으면 빈 상태를 보인다', async () => {
  let finish!: (rows: AdminActivity[]) => void
  vi.spyOn(activities(), 'list').mockImplementationOnce(() => new Promise<AdminActivity[]>((done) => { finish = done }))
  renderAdmin('audit')
  await screen.findByText('활동 기록을 불러오고 있어요.')
  expect(screen.queryByText('아직 기록된 조치가 없어요.')).toBeNull()
  await act(async () => { finish([]) })
  await screen.findByText('아직 기록된 조치가 없어요.')
  expect(screen.queryByText('활동 기록을 불러오고 있어요.')).toBeNull()
})

it('활동 로그 탭은 조회 실패를 빈 목록으로 숨기지 않고 다시 불러오기로 복구한다', async () => {
  const list = vi.spyOn(activities(), 'list').mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([activity()])
  renderAdmin('audit')
  expect((await screen.findByRole('alert')).textContent).toContain('활동 기록을 불러오지 못했어요')
  expect(screen.queryByText('아직 기록된 조치가 없어요.')).toBeNull()
  expect(activityRows()).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await screen.findByText('작품 운영 제한', { selector: 'b' })
  screen.getByText('달빛 도서관')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(list).toHaveBeenCalledTimes(2)
})

it('활동 로그 탭은 내역을 조치에 맞게 보인다: 신고 결정은 한국어로, 관리자 생성의 권한은 권한 이름으로, 문의 답변의 답변 ID는 감춘다', async () => {
  vi.spyOn(activities(), 'list').mockResolvedValue([
    activity({ id: 'b1', action: 'REPORT_REVIEW', targetType: 'REPORT', targetId: 'r-1', detail: 'ACCEPTED' }),
    activity({ id: 'b2', action: 'ADMIN_CREATE', targetType: 'MEMBER', targetId: 'm-1', detail: 'new@example.invalid · works,notices' }),
    activity({ id: 'b3', action: 'INQUIRY_REPLY_CREATE', targetType: 'INQUIRY', targetId: 'q-1', detail: '3f2c9a10-0000-4000-8000-000000000001' }),
  ])
  renderAdmin('audit')
  await waitFor(() => expect(activityRows()).toHaveLength(3))
  const [review, create, reply] = activityRows()
  within(review).getByText('신고 인정')
  within(create).getByText('new@example.invalid · 작품 관리, 공지 게시')
  // 문의 답변 줄에는 수행자·대상 줄만 있고 답변 ID 줄은 없다.
  expect(reply.querySelectorAll('.small')).toHaveLength(1)
  expect(document.body.textContent).not.toContain('ACCEPTED')
  expect(document.body.textContent).not.toContain('3f2c9a10')
})

it('활동 로그 탭은 조회 권한이 없으면(403) 실패 화면 대신 필요한 권한을 안내하고 다시 불러오기를 두지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'a-csrf' })
    : Response.json({ accessToken: 'a-bearer', user: { id: 'admin', email: 'admin@example.invalid', nickname: '관리자', operator: true } })))
  await login('admin@example.invalid', 'test-password')
  const http = new AdminActivityUseCase(new HttpAdminActivityRepository(vi.fn(async () => Response.json({ code: 'FORBIDDEN', message: 'Access denied.' }, { status: 403 }))))
  vi.spyOn(activities(), 'list').mockImplementation(() => http.list())
  renderAdmin('audit')
  expect((await screen.findByRole('alert')).textContent).toBe("활동 로그를 보려면 '관리자 계정 관리' 권한이 필요해요.")
  expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
  expect(screen.queryByText(/활동 기록을 불러오지 못했어요/)).toBeNull()
  expect(document.querySelector('.audit-list')).toBeNull()
  // 탭 안내문에도 필요한 권한이 적혀 있다.
  expect(screen.getByText(/‘관리자 계정 관리’ 권한이 있는 관리자만 볼 수 있어요/).className).toBe('admin-note')
})

it('패널 제목은 굵은 글씨가 아니라 제목 요소이고, 메뉴 묶음 이름은 제목이 아니어서 화면 제목(h1)이 첫 제목이다', async () => {
  renderAdmin('jobs')
  const title = await screen.findByRole('heading', { name: '실행 기록', level: 2 })
  expect(title.className).toBe('panel-title')
  expect(screen.getAllByRole('heading')[0].tagName).toBe('H1')
  const menu = screen.getByRole('navigation', { name: '관리자 업무' })
  expect(within(menu).queryAllByRole('heading')).toHaveLength(0)
  expect(within(menu).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['회원 관리', '콘텐츠 관리', '소통 관리', 'LLM Ops', '서비스 운영'])
  // 대시보드는 묶음 없이 메뉴 맨 위 단독 항목이다.
  expect(within(menu).getByRole('link', { name: '대시보드' }).closest('[role="group"]')).toBeNull()
})

it('표의 행 버튼은 이름이 같은 버튼끼리 구분되도록 대상 이름을 함께 읽는다', async () => {
  renderAdmin('jobs')
  // 행 조치는 ⋮ 버튼 하나이고, 그 이름(과 메뉴 이름)에 어느 행의 조치인지 대상 이름이 들어간다.
  const retry = await screen.findByRole('button', { name: '「manuscript_preprocessing 실행 job-failed-1」 조치' })
  expect(retry.textContent).toBe('')
  fireEvent.click(retry)
  within(screen.getByRole('menu', { name: '「manuscript_preprocessing 실행 job-failed-1」 조치' })).getByRole('menuitem', { name: '다시 실행' })
  cleanup()
  renderAdmin('characterChats')
  const chat = (await screen.findAllByRole('button', { name: /조치$/ }))[0]
  const cells = within(chat.closest('tr') as HTMLElement).getAllByRole('cell').map((cell) => cell.textContent)
  expect(chat.getAttribute('aria-label')).toBe(`「${cells[1]} ${cells[2]}」 조치`)
})

// 오류 없이 대상만 있는 실행(예: 성공한 회귀 평가)은 빈 칸 표시(—)를 대상 위에 또 붙이지 않는다: 줄마다 소음이 생긴다. 오류도 대상도 없을 때만 —를 보인다.
it('실행 기록의 오류·대상 칸은 오류 없이 대상만 있으면 대상 한 줄만, 둘 다 없을 때만 —를 보인다', async () => {
  const jobs = appContainer.resolve('jobMonitorUseCase')
  const real = (await jobs.runs({ status: '', kind: '', page: 0 }))!
  const targetOnly = { id: 'run-target-only', kind: 'evaluation', source: 'ai-evaluation', status: 'succeeded', trigger: 'schedule', startedAt: '2026-11-20T01:02:03Z', finishedAt: '2026-11-20T01:05:03Z', targetId: 'character_simulation' }
  const neither = { id: 'run-neither', kind: 'alert_cleanup', source: 'operations-scheduler', status: 'succeeded', trigger: 'schedule', startedAt: '2026-11-20T00:00:00Z', finishedAt: '2026-11-20T00:01:00Z' }
  vi.spyOn(jobs, 'runs').mockResolvedValue({ ...real, items: [targetOnly, neither] })
  renderAdmin('jobs')
  const table = await screen.findByRole('region', { name: '작업 실행 기록 표' })
  const column = [...table.querySelectorAll('th')].findIndex((th) => th.textContent === '오류·대상')
  expect(column).toBeGreaterThanOrEqual(0)
  const [first, second] = [...table.querySelectorAll('tbody tr')].map((row) => row.querySelectorAll('td')[column].textContent)
  expect([first, second]).toEqual(['대상 character_simulation', '—'])
})

it('관리자 계정 생성 폼은 필수 항목과 비밀번호 규칙을 글로 알린다', async () => {
  renderAdmin('admins')
  const password = await screen.findByLabelText<HTMLInputElement>('초기 비밀번호')
  screen.getByText('모든 항목은 필수예요. 권한은 한 가지 이상 골라 주세요.')
  expect(document.getElementById(password.getAttribute('aria-describedby')!)!.textContent).toBe('초기 비밀번호는 8자 이상이에요.')
})

it('메뉴가 넘칠 때 현재 탭이 이미 보이면 스크롤을 건드리지 않고, 보이는 영역 밖일 때만 그 축을 16px 여유로 보이게 옮긴다', async () => {
  renderAdmin('profile')
  const menu = await screen.findByRole('navigation', { name: '관리자 업무' })
  // jsdom에는 레이아웃이 없어 메뉴(스크롤 상자)와 항목의 위치·크기를 직접 정한다.
  const rect = (top: number, bottom: number, left = 0, right = 200) =>
    ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  const size = (values: Record<string, number>) => {
    for (const [prop, value] of Object.entries(values)) Object.defineProperty(menu, prop, { configurable: true, value })
  }
  const visit = async (name: string, at: DOMRect) => {
    const link = within(menu).getByRole('link', { name })
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(at)
    fireEvent.click(link)
    await waitFor(() => expect(link.getAttribute('aria-current')).toBe('page'))
  }
  // 세로 메뉴: 보이는 칸 400px, 내용 1000px(가로는 넘치지 않는다).
  size({ scrollHeight: 1000, clientHeight: 400 })
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect(0, 400))
  await visit('사용자', rect(120, 158))
  expect(menu.scrollTop).toBe(0) // 이미 보이는 탭은 그대로 둔다: 맨 위 브랜드가 밀려나지 않는다
  await visit('활동 로그', rect(520, 558))
  expect(menu.scrollTop).toBe(174) // 아래로 벗어남: 아래 가장자리에서 16px 여유
  await visit('대시보드', rect(-60, -22))
  expect(menu.scrollTop).toBe(98) // 위로 벗어남: 위 가장자리에서 16px 여유
  // 가로 메뉴: 보이는 칸 300px, 내용 900px(세로는 넘치지 않는다).
  menu.scrollTop = 0
  size({ scrollHeight: 400, scrollWidth: 900, clientWidth: 300 })
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect(0, 400, 0, 300))
  await visit('작품', rect(0, 38, 100, 160))
  expect(menu.scrollLeft).toBe(0)
  await visit('크레딧', rect(0, 38, 400, 480))
  expect(menu.scrollLeft).toBe(196) // 오른쪽으로 벗어남
  await visit('사용자', rect(0, 38, -50, 60))
  expect([menu.scrollLeft, menu.scrollTop]).toEqual([130, 0]) // 왼쪽으로 벗어남, 세로는 그대로
})

it('상단바 닉네임 버튼이 프로필·로그아웃 메뉴를 열고, 바깥 클릭·Esc로 닫으며 Esc는 초점을 버튼으로 돌린다', async () => {
  renderAdmin('data')
  const button = await screen.findByRole('button', { name: /계정 메뉴/ })
  expect([button.getAttribute('aria-haspopup'), button.getAttribute('aria-expanded')]).toEqual(['menu', 'false'])
  // 프로필·로그아웃은 사이드바 업무 메뉴가 아니라 이 메뉴에 있다.
  const side = screen.getByRole('navigation', { name: '관리자 업무' })
  expect(within(side).queryByRole('link', { name: '프로필' })).toBeNull()
  expect(within(side).queryByRole('button', { name: '로그아웃' })).toBeNull()
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(button)
  const menu = screen.getByRole('menu')
  expect(button.getAttribute('aria-expanded')).toBe('true')
  const profile = within(menu).getByRole('menuitem', { name: '프로필' })
  expect(profile.getAttribute('href')).toBe('/admin?tab=profile')
  expect(profile.getAttribute('aria-current')).toBeNull()
  within(menu).getByRole('menuitem', { name: '로그아웃' })
  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(button)
  fireEvent.click(button)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
  // 프로필 탭에서는 프로필 항목이 현재 항목이다.
  cleanup()
  renderAdmin('profile')
  fireEvent.click(await screen.findByRole('button', { name: /계정 메뉴/ }))
  expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: '프로필' }).getAttribute('aria-current')).toBe('page')
})

it('API 표시는 데모 탭에만 둔다: 메뉴 ‘데모’ 배지와 제목 옆 ‘데모 화면’ 칩은 데모 탭(캐릭터챗)에만 있고 실제 API 탭(크레딧 포함)에는 둘 다, 범례 줄도 없다', async () => {
  renderAdmin('works')
  const menu = await screen.findByRole('navigation', { name: '관리자 업무' })
  // 실제 API 탭: 배지도, 설명 연결도 없다.
  for (const name of ['대시보드', '사용자', '작품', '신고·권리', '경고·누설 감시', '에이전트 지표', '크레딧', '활동 로그']) {
    const link = within(menu).getByRole('link', { name })
    expect([link.querySelector('.nav-demo'), link.getAttribute('aria-describedby')], name).toEqual([null, null])
  }
  expect(menu.querySelector('.nav-live, .nav-legend')).toBeNull()
  expect(document.querySelector('.admin-head .chip')).toBeNull()
  // 데모 탭: 배지는 읽지 않게(aria-hidden) 두고, 링크 이름은 그대로 둔 채 설명으로 데모임을 알린다.
  for (const name of ['캐릭터챗']) {
    const link = within(menu).getByRole('link', { name })
    const badge = link.querySelector('.nav-demo')
    expect([badge?.textContent, badge?.getAttribute('aria-hidden')], name).toEqual(['데모', 'true'])
    expect(document.getElementById(link.getAttribute('aria-describedby') ?? '')?.textContent, name).toBe('데모 화면이에요')
  }
  cleanup()
  renderAdmin('characterChats')
  await screen.findByRole('heading', { name: '캐릭터챗 관리' })
  expect(document.querySelector('.admin-head .chip')?.textContent).toBe('데모 화면')
})

it('머리 영역: 목록 새로고침은 제목 줄 오른쪽(데모 칩 바로 옆)에 있어 혼자 차지하는 줄이 없고, 상단바에도 브랜드가 있다', async () => {
  renderAdmin('characterChats')
  const refresh = await screen.findByRole('button', { name: '목록 새로고침' })
  const head = document.querySelector('.admin-head')!
  expect(head.contains(refresh)).toBe(true)
  expect(head.querySelector('.chip')?.nextElementSibling).toBe(refresh)
  expect(document.querySelector('.admin-refresh')).toBeNull()
  // 900px 이하에서는 메뉴 밖 상단바 왼쪽 브랜드만 보인다(어느 쪽이 보이는지는 CSS 계약 테스트가 지킨다).
  const top = document.querySelector('.adm .top .admin-brand-top')
  expect([top?.textContent, top?.closest('nav')]).toEqual(['STORYFORK 관리자', null])
  expect(document.querySelector('.adm .admin-nav .admin-brand')?.textContent).toBe('STORYFORK 관리자')
})

it('관리자 브랜드는 메인 페이지(/)로 가는 링크다: 사이드바 맨 위와 900px 이하 상단바 두 곳이고, 이름은 보이는 글자로 시작한다', async () => {
  renderAdmin('characterChats')
  await screen.findByRole('heading', { name: '캐릭터챗 관리' })
  // 보이는 글자는 그대로이고 목적지는 메인(/)이다(둘 중 어느 쪽이 보이는지는 CSS 계약 테스트가 지킨다).
  const brands = ['.adm .admin-nav .admin-brand', '.adm .top .admin-brand-top'].map((selector) => document.querySelector(selector))
  expect(brands.map((el) => [el?.tagName, el?.getAttribute('href'), el?.textContent])).toEqual([
    ['A', '/', 'STORYFORK 관리자'],
    ['A', '/', 'STORYFORK 관리자'],
  ])
  // 접근 가능한 이름은 보이는 글자로 시작해(WCAG 2.5.3) 메인 페이지로 간다고 알린다. 현재 쪽을 가리키는 메뉴 항목이 아니라서 aria-current는 달지 않는다.
  const links = screen.getAllByRole('link', { name: /메인 페이지/ })
  expect(links).toHaveLength(2)
  for (const link of links) expect([link.getAttribute('aria-label'), link.getAttribute('title'), link.getAttribute('aria-current')]).toEqual(['STORYFORK 관리자 · 메인 페이지로', '메인 페이지로', null])
})

// 데모 작품은 모두 공개 인물이 있어, 첫 선택지(첫 포크 작품)의 인물만 비워 '고를 캐릭터가 없는' 경우를 만든다.
it('캐릭터챗 추가 폼은 고를 캐릭터가 없으면 빈 선택 대신 이유를 보이고 추가 버튼을 잠근다', async () => {
  const admin = appContainer.resolve('adminUseCase')
  const choices = admin.chatChoices.bind(admin)
  vi.spyOn(admin, 'chatChoices').mockImplementation((works, kind) => choices(works, kind).map((choice, i) => (i ? choice : { ...choice, cast: [] })))
  renderAdmin('characterChats')
  const select = await screen.findByLabelText<HTMLSelectElement>('캐릭터')
  expect([select.disabled, select.selectedOptions[0]?.textContent]).toEqual([true, '선택할 수 있는 캐릭터가 없어요'])
  expect((screen.getByRole('button', { name: '캐릭터챗 추가' }) as HTMLButtonElement).disabled).toBe(true)
})

it('필터는 왼쪽 정렬 한 줄: 검색 입력 → 분류(역할) → 정렬 → 검색 버튼을 한 form(.admin-filter)에 두고, 상태 선택은 제목 아래에 둔다', async () => {
  const controls = (form: HTMLFormElement) => [...form.elements].map((el) => el.tagName)
  renderAdmin('works')
  const works = (await screen.findByLabelText('작품 검색')).closest('form')!
  expect([works.className, controls(works)]).toEqual(['admin-filter', ['INPUT', 'SELECT', 'SELECT', 'BUTTON']])
  cleanup()
  renderAdmin('users')
  const users = (await screen.findByLabelText('사용자 검색')).closest('form')!
  expect([users.className, controls(users)]).toEqual(['admin-filter', ['INPUT', 'SELECT', 'SELECT', 'BUTTON']])
  cleanup()
  renderAdmin('llm', 'alerts')
  const status = await screen.findByLabelText('상태')
  expect([status.closest('.admin-filter') !== null, status.closest('.table-head')]).toEqual([true, null])
  expect(status.closest('section')!.querySelector('.table-head h2')?.textContent).toBe('운영 경고')
})

it('대시보드 탭의 새로고침도 다른 탭처럼 제목 줄 오른쪽(.admin-head)에 있고 설명 아래 혼자 차지하는 줄이 없다', async () => {
  renderAdmin('data')
  const refresh = await screen.findByRole('button', { name: '새로고침' })
  expect(document.querySelector('.admin-head')!.contains(refresh)).toBe(true)
  expect(document.querySelector('.admin-refresh')).toBeNull()
})

// 날짜·시각이 공백에서 두 줄('26. 11. 20. 오전 / 12:03')로 꺾이면 표가 어색하고 넓은 칸이 폭을 다 가져간다: 날짜만 담은 표 칸은 모두 admin-date(한 줄·고정 폭 숫자)를 쓴다.
it('날짜·시각만 담은 표 칸(td)은 admin-date 없이 맨 td로 그리지 않는다', () => {
  for (const file of ['AdminPage.tsx', 'JobMonitor.tsx', 'LlmAlerts.tsx', 'LlmOps.tsx', 'LlmOpsManage.tsx', 'PromptLoop.tsx', 'AgentMetrics.tsx']) {
    expect(readFileSync(new URL(file, import.meta.url), 'utf8').match(/<td>\{[^}]*kstDateTime\(/g), file).toBeNull()
  }
})

// LLM Ops는 사이드바 세 메뉴(주소 ?tab=llm&view=)로 나뉜다(#857). 쪽마다 패널을 위아래로 쌓고, 에이전트 지표·프롬프트·평가 쪽은 보기 전환(주소 sub)으로 하나만 보인다.
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const region = (name: string) => screen.findByRole('region', { name })
const llmMenu = async () => within(await screen.findByRole('navigation', { name: '관리자 업무' })).getByRole('group', { name: 'LLM Ops' })
const links = (nav: HTMLElement) => within(nav).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('aria-current')])
/** LLM Ops 묶음의 쪽 링크 셋(프롬프트·평가 아래 하위 탭 링크는 뺀다). */
const pageLinks = (group: HTMLElement) => within(group).getAllByRole('link').filter((link) => !link.closest('ul'))
const subnav = () => screen.findByRole('list', { name: '프롬프트·평가 하위 메뉴' })

it('LLM Ops 에이전트 지표 쪽(기본)은 지표 보기에서 AI 요청·경고 요약 카드 → 최근 7일 AI 사용 → 에이전트별 지표를 위에서부터 쌓고, 추적은 보기 전환으로 옮겨 본다', async () => {
  renderAdmin('llm')
  expect(links(await screen.findByRole('navigation', { name: '에이전트 지표 보기' }))).toEqual([['지표', '/admin?tab=llm', 'page'], ['추적', '/admin?tab=llm&sub=traces', null]])
  const summary = await region('AI 요청·경고 요약')
  const usage = await region('최근 7일 AI 사용')
  const metrics = await region('LLM 지표')
  expect([before(summary, usage), before(usage, metrics)]).toEqual([true, true])
  // 요약 카드 넷은 대시보드에서 옮겨 왔고 미확인 경고 카드는 경고·누설 감시로 잇는다.
  await waitFor(() => expect([...summary.querySelectorAll('.admin-summary > div > small')].map((s) => s.textContent)).toEqual(['AI 요청 · 오늘', 'AI 요청 · 최근 7일', '진행 중 작업', '미확인 경고']))
  expect(within(summary).getByRole('link', { name: '미확인 경고 바로 가기' }).getAttribute('href')).toBe('/admin?tab=llm&view=alerts')
  for (const name of ['LLM 추적', '운영 경고', '에이전트별 평가']) expect(screen.queryByRole('region', { name }), name).toBeNull()
})

it('LLM Ops 추적 보기(sub=traces)는 추적 패널만 보이고 지표 쪽 패널은 없다', async () => {
  renderAdmin('llm', 'metrics&sub=traces')
  await region('LLM 추적')
  expect(links(screen.getByRole('navigation', { name: '에이전트 지표 보기' }))).toEqual([['지표', '/admin?tab=llm', null], ['추적', '/admin?tab=llm&sub=traces', 'page']])
  for (const name of ['AI 요청·경고 요약', '최근 7일 AI 사용', 'LLM 지표']) expect(screen.queryByRole('region', { name }), name).toBeNull()
})

it('LLM Ops는 view가 없거나 모르는 값이면, 옛 추적·지표 주소(view=traces)도 에이전트 지표 쪽이다', async () => {
  for (const view of [undefined, 'nope', 'traces']) {
    renderAdmin('llm', view)
    await region('LLM 지표')
    expect(screen.queryByRole('region', { name: '운영 경고' }), view).toBeNull()
    cleanup()
  }
})

it('에이전트 지표 카드는 기능마다 하나씩 요청 많은 순으로 보이고, 요청 수·실패율·p95 지연·비용 숫자와 role=img 요약이 붙은 처리 결과·지연 막대를 가진다(#857)', async () => {
  renderAdmin('llm')
  const cards = await within(await region('LLM 지표')).findAllByRole('article')
  expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
    '집필 AI 채팅 지표', '원고 검수 지표', '새 원고·부분 수정 지표', '설정집 검토 지표', '전개 제안 지표', '심의 등급 지표', '고증 조사 지표', '프롬프트 자동 개선 지표',
  ])
  const first = within(cards[0])
  first.getByRole('heading', { name: '집필 AI 채팅' })
  first.getByText('orchestration')
  expect(first.getByText('412').tagName).toBe('B')
  const number = (label: string) => first.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
  expect(['실패율', '시간 초과율', 'p95 지연', '비용'].map(number)).toEqual(['5.1%', '1.2%', '14,800ms', '$4.8200'])
  // 막대는 보조라 같은 값을 말로 옮긴 요약을 달고, 같은 숫자는 막대 위 글자에도 있다.
  const bar = (card: HTMLElement, name: string) => [...within(card).getByRole('img', { name }).children].map((part) => part.className)
  expect(bar(cards[0], '처리 결과: 성공 386건, 실패 21건, 시간 초과 5건')).toEqual(['ok', 'bad', 'wait'])
  expect(bar(cards[0], '지연: p50 5,200ms, p95 14,800ms')).toEqual(['p50', 'p95'])
  first.getByText('p50 5,200ms · p95 14,800ms')
  // 요청 없이 비용만 있는 기능은 비율·지연을 0으로 채우지 않고 데이터 없음이다.
  const last = within(cards[7])
  expect([bar(cards[7], '처리 결과: 데이터 없음'), bar(cards[7], '지연: 데이터 없음')]).toEqual([[], []])
  expect(last.getByText('실패율', { selector: 'dt' }).nextElementSibling?.textContent).toBe('데이터 없음')
  // 같은 값은 카드 아래 표에도 있고, 묶음을 날짜·모델로 바꾸면 카드 대신 차트가 보인다.
  within(await region('LLM 지표 표')).getByText('orchestration')
  fireEvent.change(screen.getByLabelText('묶음'), { target: { value: 'day' } })
  fireEvent.click(within(screen.getByRole('region', { name: 'LLM 지표' })).getByRole('button', { name: '조회' }))
  await within(await region('LLM 지표 표')).findByRole('columnheader', { name: '날짜' })
  expect(screen.queryAllByRole('article')).toHaveLength(0)
})

it('LLM Ops 프롬프트·평가 쪽은 보기 전환(sub)에 따라 전체(AI 파이프라인, 가장 왼쪽·기본)·에이전트별 평가·프롬프트·모델 중 하나만, 경고·누설 감시 쪽은 경고·경고 기준·누설 검사 기록·표본 비율을 쌓는다', async () => {
  // sub가 없으면 전체(AI 파이프라인)가 기본 보기이고, 에이전트별 평가(입구 표)·프롬프트·모델은 따로 보인다(#857).
  renderAdmin('llm', 'prompts')
  await region('AI 파이프라인')
  expect(links(screen.getByRole('navigation', { name: '프롬프트·평가 보기' }))).toEqual([
    ['전체(AI 파이프라인)', '/admin?tab=llm&view=prompts', 'page'], ['에이전트별 평가', '/admin?tab=llm&view=prompts&sub=evals', null],
    ['프롬프트', '/admin?tab=llm&view=prompts&sub=prompts', null], ['모델', '/admin?tab=llm&view=prompts&sub=models', null],
  ])
  const others = (...names: string[]) => names.forEach((name) => expect(screen.queryByRole('region', { name }), name).toBeNull())
  others('에이전트별 평가', '프롬프트', '모델 단가')
  cleanup()
  renderAdmin('llm', 'prompts&sub=evals')
  await region('에이전트별 평가')
  others('프롬프트', '모델 단가', 'AI 파이프라인')
  cleanup()
  renderAdmin('llm', 'prompts&sub=prompts')
  await region('프롬프트')
  others('에이전트별 평가', '모델 단가', 'AI 파이프라인')
  cleanup()
  renderAdmin('llm', 'prompts&sub=models')
  await region('모델 단가')
  others('에이전트별 평가', '프롬프트', 'AI 파이프라인')
  cleanup()
  renderAdmin('llm', 'prompts&sub=all')
  await region('AI 파이프라인')
  others('에이전트별 평가', '프롬프트', '모델 단가')
  cleanup()
  // 경고·누설 감시: 경고 목록 아래 경고 기준, 그 아래 누설 검사 기록과 표본 비율 폼(평가는 프롬프트·평가 쪽으로 옮겼다).
  renderAdmin('llm', 'alerts')
  const alerts = await region('운영 경고')
  const rules = await region('경고 기준')
  const leaks = await region('정보 누설 검사')
  const rate = await region('누설 검사 표본 비율')
  expect([before(alerts, rules), before(rules, leaks), before(leaks, rate)]).toEqual([true, true, true])
  within(rate).getByLabelText('표본 비율(0~1)')
  within(rate).getByRole('button', { name: '표본 비율 저장' })
  others('에이전트별 평가', '회귀 평가', 'LLM 지표')
})

it('사이드바는 서비스 운영 묶음 위에 LLM Ops 묶음(에이전트 지표·프롬프트·평가·경고·누설 감시)을 두고, 현재 표시는 탭과 view가 모두 같은 메뉴에만 있다', async () => {
  renderAdmin('llm', 'prompts&sub=models')   // 하위 탭(흐름 범위)이 켜지지 않는 보기(모델 단가)라 쪽 링크가 현재 표시를 가진다
  const group = await llmMenu()
  const items = pageLinks(group)
  expect(items.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['에이전트 지표', '/admin?tab=llm'], ['프롬프트·평가▾', '/admin?tab=llm&view=prompts'], ['경고·누설 감시', '/admin?tab=llm&view=alerts'],   // ▾는 하위 탭이 펼쳐졌다는 장식 표시(aria-hidden)
  ])
  expect(items.map((link) => [link.getAttribute('aria-current'), link.classList.contains('on')])).toEqual([[null, false], ['page', true], [null, false]])
  const menu = screen.getByRole('navigation', { name: '관리자 업무' })
  expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['회원 관리', '콘텐츠 관리', '소통 관리', 'LLM Ops', '서비스 운영'])
  expect(within(within(menu).getByRole('group', { name: '서비스 운영' })).queryByRole('link', { name: /LLM/ })).toBeNull()
  // 모르는 view는 에이전트 지표 메뉴가 켜지고, 다른 탭에서는 세 메뉴 모두 꺼진다.
  cleanup()
  renderAdmin('llm', 'nope')
  expect(pageLinks(await llmMenu()).map((link) => link.getAttribute('aria-current'))).toEqual(['page', null, null])
  cleanup()
  renderAdmin('jobs')
  expect(pageLinks(await llmMenu()).map((link) => link.getAttribute('aria-current'))).toEqual([null, null, null])
})

it('프롬프트·평가는 사이드바에서 그 아래 하위 탭(전체·인물 시뮬레이션·원고 전처리·원고 검수·고증 조사·기획·집필·수정)으로 펼쳐지고, 펼침 표시(▾)·aria-expanded와 현재 하위 탭(aria-current)을 보인다(#857 3차 정정)', async () => {
  renderAdmin('llm', 'prompts')
  const group = await llmMenu()
  const parent = within(group).getByRole('link', { name: '프롬프트·평가' })   // 이름은 보이는 글자 그대로(▾는 읽지 않는다)
  expect([parent.getAttribute('aria-expanded'), parent.getAttribute('aria-controls'), parent.querySelector('.nav-caret')?.textContent, parent.querySelector('.nav-caret')?.getAttribute('aria-hidden')])
    .toEqual(['true', 'admin-prompts-subnav', '▾', 'true'])
  const sub = await subnav()
  expect(sub.id).toBe('admin-prompts-subnav')
  expect(links(sub)).toEqual([
    ['전체', '/admin?tab=llm&view=prompts', 'page'],
    ['인물 시뮬레이션', '/admin?tab=llm&view=prompts&flow=simulation', null],
    ['원고 전처리', '/admin?tab=llm&view=prompts&flow=preprocessing', null],
    ['원고 검수', '/admin?tab=llm&view=prompts&flow=review', null],
    ['고증 조사', '/admin?tab=llm&view=prompts&flow=research', null],
    ['기획·집필·수정', '/admin?tab=llm&view=prompts&flow=writing', null],
  ])
  // 쪽을 가리키는 현재 표시는 한 곳에만 둔다: 하위 탭이 켜져 있으면 쪽 링크(부모)는 열림 표시만 한다.
  expect([parent.getAttribute('aria-current'), parent.classList.contains('on'), parent.classList.contains('open')]).toEqual([null, false, true])
  expect(within(group).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
  // 캔버스 위 선택 상자는 없다(워크플로우는 사이드바 하위 탭으로 고른다).
  expect(screen.queryByLabelText('워크플로우')).toBeNull()
})

it('켜진 하위 탭은 주소의 flow(흐름 범위)를 따르고(없거나 모르는 값은 전체) 파이프라인·에이전트별 평가·프롬프트 보기에 같이 적용되며, 모델 단가는 범위가 없어 하위 탭이 켜지지 않고 쪽 링크가 현재 표시를 가진다(#857)', async () => {
  const current = async () => links(await subnav()).filter(([, , aria]) => aria).map(([text]) => text)
  renderAdmin('llm', 'prompts&flow=simulation')
  expect(await current()).toEqual(['인물 시뮬레이션'])
  cleanup()
  renderAdmin('llm', 'prompts&flow=nope')
  expect(await current()).toEqual(['전체'])
  cleanup()
  for (const view of ['evals', 'prompts']) {
    renderAdmin('llm', `prompts&sub=${view}&flow=review`)
    expect(await current(), view).toEqual(['원고 검수'])
    cleanup()
  }
  renderAdmin('llm', 'prompts&sub=models&flow=simulation')
  expect(await current()).toEqual([])
  const parent = within(await llmMenu()).getByRole('link', { name: '프롬프트·평가' })
  expect([parent.getAttribute('aria-current'), parent.classList.contains('on'), parent.getAttribute('aria-expanded')]).toEqual(['page', true, 'true'])
})

it('하위 탭 링크는 보고 있는 보기(에이전트별 평가·프롬프트)를 유지한 채 흐름 범위만 바꾸고, 모델 단가에서는 범위가 적용되는 파이프라인 보기로 간다(#857)', async () => {
  renderAdmin('llm', 'prompts&sub=evals&flow=review')
  expect(links(await subnav()).map(([text, href]) => [text, href])).toEqual([
    ['전체', '/admin?tab=llm&view=prompts&sub=evals'],
    ['인물 시뮬레이션', '/admin?tab=llm&view=prompts&sub=evals&flow=simulation'],
    ['원고 전처리', '/admin?tab=llm&view=prompts&sub=evals&flow=preprocessing'],
    ['원고 검수', '/admin?tab=llm&view=prompts&sub=evals&flow=review'],
    ['고증 조사', '/admin?tab=llm&view=prompts&sub=evals&flow=research'],
    ['기획·집필·수정', '/admin?tab=llm&view=prompts&sub=evals&flow=writing'],
  ])
  cleanup()
  renderAdmin('llm', 'prompts&sub=models&flow=review')
  expect(links(await subnav()).map(([, href]) => href).slice(0, 2)).toEqual(['/admin?tab=llm&view=prompts', '/admin?tab=llm&view=prompts&flow=simulation'])
})

it('프롬프트·평가가 아닌 쪽에서는 하위 탭이 접히고(▸·aria-expanded=false·읽히지 않음), 쪽 링크를 누르면 그 쪽으로 가며 펼쳐진다(#857 3차 정정)', async () => {
  renderAdmin('jobs')
  const group = await llmMenu()
  const parent = within(group).getByRole('link', { name: '프롬프트·평가' })
  expect([parent.getAttribute('aria-expanded'), parent.querySelector('.nav-caret')?.textContent, parent.classList.contains('open')]).toEqual(['false', '▸', false])
  expect(within(group).queryByRole('list', { name: '프롬프트·평가 하위 메뉴' })).toBeNull()
  expect(document.getElementById('admin-prompts-subnav')?.hidden).toBe(true)   // aria-controls가 가리키는 목록은 있되 접혀 있다
  expect(within(group).getAllByRole('link')).toHaveLength(3)
  fireEvent.click(parent)
  expect(links(await subnav())[0]).toEqual(['전체', '/admin?tab=llm&view=prompts', 'page'])
  expect([parent.getAttribute('aria-expanded'), parent.querySelector('.nav-caret')?.textContent]).toEqual(['true', '▾'])
  // 에이전트 지표·경고·누설 감시 쪽에서도 접혀 있다.
  cleanup()
  renderAdmin('llm', 'alerts')
  expect(within(await llmMenu()).getByRole('link', { name: '프롬프트·평가' }).getAttribute('aria-expanded')).toBe('false')
})

it('하위 탭이 현재 항목이 되면 가로 메뉴 줄(900px 이하)에서 그 하위 탭이 보이게 메뉴를 옮긴다(#857 3차 정정)', async () => {
  renderAdmin('llm', 'prompts')
  const menu = await screen.findByRole('navigation', { name: '관리자 업무' })
  const rect = (top: number, bottom: number, left: number, right: number) => ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  for (const [prop, value] of Object.entries({ scrollHeight: 400, scrollWidth: 900, clientWidth: 300 })) Object.defineProperty(menu, prop, { configurable: true, value })
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect(0, 400, 0, 300))
  const link = within(menu).getByRole('link', { name: '기획·집필·수정' })
  vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(rect(0, 38, 400, 480))
  fireEvent.click(link)
  await waitFor(() => expect(link.getAttribute('aria-current')).toBe('page'))
  expect(menu.scrollLeft).toBe(196)   // 오른쪽으로 벗어남: 오른쪽 가장자리에서 16px 여유
})

it('LLM Ops 화면 제목과 문서 제목은 쪽 이름을 붙인다', async () => {
  for (const [view, title] of [[undefined, 'LLM Ops · 에이전트 지표'], ['prompts', 'LLM Ops · 프롬프트·평가'], ['alerts', 'LLM Ops · 경고·누설 감시']] as const) {
    renderAdmin('llm', view)
    await screen.findByRole('heading', { level: 1, name: title })
    await waitFor(() => expect(document.title).toBe(`관리자 · ${title} · STORYFORK`))
    cleanup()
  }
})

it('LLM Ops는 쪽을 옮기면 열어 둔 추적 상세를 닫아, 돌아오면 목록부터 보인다', async () => {
  renderAdmin('llm', 'metrics&sub=traces')
  const menu = await screen.findByRole('navigation', { name: '관리자 업무' })
  fireEvent.click((await screen.findAllByRole('button', { name: /^「.+ 추적 .+」 조치$/ }))[0])
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '단계 상세' }))
  await region('추적 상세')
  // 상세가 열려 있는 동안은 그 상세만 보인다(보기 전환도 목록으로 돌아오면 다시 나온다).
  expect(screen.queryByRole('region', { name: 'LLM 추적' })).toBeNull()
  expect(screen.queryByRole('navigation', { name: '에이전트 지표 보기' })).toBeNull()
  fireEvent.click(within(menu).getByRole('link', { name: '프롬프트·평가' }))
  await region('AI 파이프라인')
  fireEvent.click(within(menu).getByRole('link', { name: '에이전트 지표' }))
  await region('LLM 지표')
  expect(screen.queryByRole('region', { name: '추적 상세' })).toBeNull()
  fireEvent.click(within(await screen.findByRole('navigation', { name: '에이전트 지표 보기' })).getByRole('link', { name: '추적' }))
  await region('LLM 추적')
  expect(screen.queryByRole('region', { name: '추적 상세' })).toBeNull()
})

it('대시보드는 서비스 지표 카드 넷과 서비스 지표(전체 기간)만 보이고, AI 요청·경고 카드와 최근 7일 AI 사용은 LLM Ops 에이전트 지표 위에 있다(#857)', async () => {
  renderAdmin('data')
  await screen.findByRole('heading', { level: 1, name: '대시보드' })
  await region('서비스 지표(전체 기간)')
  await waitFor(() => expect([...document.querySelectorAll('.admin-summary > div > small')].map((s) => s.textContent)).toEqual(['전체 회원', '답변 대기 문의', '접수 신고', '작가 검토 대기']))
  expect(screen.queryByRole('region', { name: '최근 7일 AI 사용' })).toBeNull()
  expect(screen.queryByText('미확인 경고')).toBeNull()
})

/** 운영 장르 관리(DEC-56): 테스트마다 새 메모리 목록(시드 30개)을 UseCase에 잇는다(픽스처 컨테이너의 목록은 파일 안에서 공유되므로 건드리지 않는다). */
const openGenres = (repo = new InMemoryOperationsGenreRepository()) => {
  const useCase = new OperationsGenreUseCase(repo)
  const real = appContainer.resolve('operationsGenreUseCase')
  vi.spyOn(real, 'list').mockImplementation(() => useCase.list())
  vi.spyOn(real, 'create').mockImplementation((input) => useCase.create(input))
  const update = vi.spyOn(real, 'update').mockImplementation((code, patch) => useCase.update(code, patch))
  vi.spyOn(real, 'reorder').mockImplementation((codes) => useCase.reorder(codes))
  return { repo, update }
}
const genreRow = (name: string) => screen.getByText(name, { selector: 'b' }).closest('tr') as HTMLElement
const genreMenu = (name: string) => within(genreRow(name)).getByRole('button', { name: `「${name}」 조치` })
const openGenreMenu = (name: string) => fireEvent.click(genreMenu(name))
const pickGenreItem = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }))
const genreNames = () => within(screen.getByRole('table', { name: '장르 관리 표' })).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[2].textContent)

it('장르 탭은 콘텐츠 관리 묶음에서 카드 카테고리 바로 앞 메뉴로 열리고 장르 표(순서·아이콘·이름·상태·홈 노출·사용 수·조치)와 추가 폼을 보이며 데모 표시는 없다', async () => {
  openGenres()
  renderAdmin('genres')
  await screen.findByText('판타지', { selector: 'b' })
  const links = within(screen.getByRole('group', { name: '콘텐츠 관리' })).getAllByRole('link')
  expect([links.at(-2)?.textContent, links.at(-2)?.getAttribute('href'), links.at(-2)?.getAttribute('aria-current')]).toEqual(['장르', '/admin?tab=genres', 'page'])
  expect([links.at(-1)?.textContent, links.at(-1)?.getAttribute('href')]).toEqual(['카드 카테고리', '/admin?tab=cardCategories'])
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('장르 관리')
  expect(demoChip()).toBeNull()
  const table = screen.getByRole('table', { name: '장르 관리 표' })
  expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['순서', '아이콘', '이름', '상태', '홈 노출', '작품 수', '세계관 수', '조치'])
  expect(cells(genreRow('판타지'))).toEqual(['1', '✨', '판타지', '활성', '홈 노출', '0', '0', '⋮'])
  expect(cells(genreRow('현대판타지'))).toEqual(['2', '—', '현대판타지', '활성', '—', '0', '0', '⋮'])
  expect(within(table).getAllByRole('row')).toHaveLength(31)
  const form = within(screen.getByRole('form', { name: '장르 추가' }))
  form.getByLabelText('새 장르 이름')
  form.getByLabelText(/아이콘/)
  form.getByRole('button', { name: '장르 추가' })
  expect(genreMenu('판타지').getAttribute('aria-haspopup')).toBe('menu')
})

it('장르를 추가하면 맨 뒤에 활성·홈 숨김으로 붙고 입력이 비며, 같은 이름은 거절 이유를 그 자리에서 알린다', async () => {
  const { repo } = openGenres()
  renderAdmin('genres')
  await screen.findByText('판타지', { selector: 'b' })
  const form = within(screen.getByRole('form', { name: '장르 추가' }))
  fireEvent.change(form.getByLabelText('새 장르 이름'), { target: { value: ' 사이버펑크 ' } })
  fireEvent.change(form.getByLabelText(/아이콘/), { target: { value: '🤖' } })
  fireEvent.click(form.getByRole('button', { name: '장르 추가' }))
  const done = await screen.findByText('「사이버펑크」 장르를 추가했어요.')
  expect(done.getAttribute('role')).toBe('status')
  expect(screen.getAllByText('「사이버펑크」 장르를 추가했어요.')).toHaveLength(1) // 화면 위 완료 줄과 겹쳐 두 번 그리지 않는다
  await screen.findByText('사이버펑크', { selector: 'b' })
  expect(cells(genreRow('사이버펑크'))).toEqual(['31', '🤖', '사이버펑크', '활성', '—', '0', '0', '⋮'])
  expect((form.getByLabelText('새 장르 이름') as HTMLInputElement).value).toBe('')
  expect(document.activeElement).toBe(form.getByLabelText('새 장르 이름')) // 이어서 다음 장르를 적을 수 있게 초점이 이름 칸에 남는다
  fireEvent.change(form.getByLabelText('새 장르 이름'), { target: { value: '판타지' } })
  fireEvent.click(form.getByRole('button', { name: '장르 추가' }))
  expect((await screen.findByRole('alert')).textContent).toBe('장르 추가 · 이미 같은 이름의 장르가 있어요.')
  expect(await repo.list()).toHaveLength(31)
})

it('⋮ 메뉴의 숨기기는 확인 뒤에만 보내고 다시 보이기·홈 노출 켜기/끄기는 바로 보내며, 고르면 메뉴가 닫히고 초점이 ⋮로 돌아온다', async () => {
  openGenres()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  renderAdmin('genres')
  await screen.findByText('무협', { selector: 'b' })
  openGenreMenu('무협')
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['이름·아이콘 수정', '숨기기', '홈 노출 켜기', '위로 옮기기', '아래로 옮기기'])
  pickGenreItem('숨기기')
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('「무협」을(를) 숨길까요?'))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(genreMenu('무협'))
  expect(cells(genreRow('무협'))[3]).toBe('활성') // 취소하면 바뀌지 않는다
  confirm.mockReturnValue(true)
  openGenreMenu('무협')
  pickGenreItem('숨기기')
  await waitFor(() => expect(cells(genreRow('무협'))[3]).toBe('숨김'))
  expect(screen.getByText('「무협」 장르를 숨겼어요.').getAttribute('role')).toBe('status')
  confirm.mockClear()
  openGenreMenu('무협')
  pickGenreItem('다시 보이기') // 확인 없이 바로
  await waitFor(() => expect(cells(genreRow('무협'))[3]).toBe('활성'))
  expect(confirm).not.toHaveBeenCalled()
  openGenreMenu('무협')
  pickGenreItem('홈 노출 켜기')
  await waitFor(() => expect(cells(genreRow('무협'))[4]).toBe('홈 노출'))
  openGenreMenu('무협')
  pickGenreItem('홈 노출 끄기')
  await waitFor(() => expect(cells(genreRow('무협'))[4]).toBe('—'))
})

it('홈 노출은 일곱 번째를 켜면 거절 이유를 그 장르 이름과 함께 알리고 표는 그대로이며 하나를 끄면 켤 수 있다', async () => {
  const { repo } = openGenres()
  for (const code of ['genre-02', 'genre-03', 'genre-04']) await repo.update(code, { featured: true }) // 판타지·SF·고전과 함께 6개
  renderAdmin('genres')
  await screen.findByText('퓨전', { selector: 'b' })
  openGenreMenu('퓨전')
  pickGenreItem('홈 노출 켜기')
  expect((await screen.findByRole('alert')).textContent).toBe('「퓨전」 · 홈에 보이는 장르는 최대 6개예요. 다른 장르의 홈 노출을 먼저 꺼 주세요.')
  expect(cells(genreRow('퓨전'))[4]).toBe('—')
  openGenreMenu('선협')
  pickGenreItem('홈 노출 끄기')
  await waitFor(() => expect(cells(genreRow('선협'))[4]).toBe('—'))
  openGenreMenu('퓨전')
  pickGenreItem('홈 노출 켜기')
  await waitFor(() => expect(cells(genreRow('퓨전'))[4]).toBe('홈 노출'))
})

it('이름·아이콘 수정은 행 아래 인라인 폼으로 열려 바뀐 것만 보내고, 저장·취소하면 닫히며 초점이 그 줄의 ⋮로 돌아온다', async () => {
  const { update } = openGenres()
  renderAdmin('genres')
  await screen.findByText('무협', { selector: 'b' })
  openGenreMenu('무협')
  pickGenreItem('이름·아이콘 수정')
  const form = within(screen.getByRole('form', { name: '「무협」 이름·아이콘 수정' }))
  expect(document.activeElement).toBe(form.getByLabelText('장르 이름'))
  expect((form.getByLabelText('장르 이름') as HTMLInputElement).value).toBe('무협')
  // 아무것도 바꾸지 않고 저장하면 보내지 않고 닫는다.
  fireEvent.click(form.getByRole('button', { name: '저장' }))
  expect(screen.queryByRole('form', { name: /이름·아이콘 수정/ })).toBeNull()
  expect(update).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(genreMenu('무협'))
  // 취소도 보내지 않고 닫는다.
  openGenreMenu('무협')
  pickGenreItem('이름·아이콘 수정')
  fireEvent.click(within(screen.getByRole('form', { name: '「무협」 이름·아이콘 수정' })).getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('form', { name: /이름·아이콘 수정/ })).toBeNull()
  expect(update).not.toHaveBeenCalled()
  openGenreMenu('무협')
  pickGenreItem('이름·아이콘 수정')
  const edit = within(screen.getByRole('form', { name: '「무협」 이름·아이콘 수정' }))
  fireEvent.change(edit.getByLabelText('장르 이름'), { target: { value: ' 신무협 ' } })
  fireEvent.change(edit.getByLabelText(/아이콘/), { target: { value: '⚔' } })
  fireEvent.click(edit.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.queryByRole('form', { name: /이름·아이콘 수정/ })).toBeNull())
  expect(update).toHaveBeenCalledWith('genre-03', { name: '신무협', emoji: '⚔' })
  await screen.findByText('신무협', { selector: 'b' })
  expect(cells(genreRow('신무협'))).toEqual(['3', '⚔', '신무협', '활성', '—', '0', '0', '⋮'])
  expect(screen.getByText('「신무협」 장르를 수정했어요.')).toBeTruthy()
  expect(document.activeElement).toBe(genreMenu('신무협'))
})

it('위·아래로 옮기면 순서를 저장해 표가 바뀌고 맨 앞은 위로·맨 뒤는 아래로 옮길 수 없다', async () => {
  openGenres()
  renderAdmin('genres')
  await screen.findByText('판타지', { selector: 'b' })
  expect(genreNames().slice(0, 3)).toEqual(['판타지', '현대판타지', '무협'])
  openGenreMenu('현대판타지')
  pickGenreItem('위로 옮기기')
  await waitFor(() => expect(genreNames().slice(0, 3)).toEqual(['현대판타지', '판타지', '무협']))
  expect(screen.getByText('「현대판타지」 장르를 위로 옮겼어요.')).toBeTruthy()
  openGenreMenu('현대판타지')
  expect((screen.getByRole('menuitem', { name: '위로 옮기기' }) as HTMLButtonElement).disabled).toBe(true) // 이제 맨 앞
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  openGenreMenu('기타')
  expect((screen.getByRole('menuitem', { name: '아래로 옮기기' }) as HTMLButtonElement).disabled).toBe(true) // 맨 뒤
})

it('장르 조회 권한이 없으면(403) 폼·표 없이 필요한 권한만 안내하고, 읽지 못하면 실패와 다시 불러오기를 보인다', async () => {
  const list = vi.spyOn(appContainer.resolve('operationsGenreUseCase'), 'list').mockResolvedValue(null)
  renderAdmin('genres')
  expect((await screen.findByRole('alert')).textContent).toBe("장르를 관리하려면 '작품 관리' 권한이 필요해요.")
  expect(screen.queryByRole('form', { name: '장르 추가' })).toBeNull()
  expect(screen.queryByRole('table', { name: '장르 관리 표' })).toBeNull()
  cleanup()
  list.mockRejectedValue(new Error('offline'))
  renderAdmin('genres')
  expect((await screen.findByRole('alert')).textContent).toContain('장르 목록을 불러오지 못했어요.')
  expect(screen.queryByRole('table', { name: '장르 관리 표' })).toBeNull() // 실패를 빈 표로 숨기지 않는다
  list.mockImplementation(() => new OperationsGenreUseCase(new InMemoryOperationsGenreRepository()).list())
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await screen.findByText('판타지', { selector: 'b' })
  expect(screen.queryByRole('alert')).toBeNull()
})

// 표 행 조치는 글자 버튼이 줄마다 늘어서 지저분했다: 행마다 ⋮ 버튼 하나(공용 PopMenu)가 그 행의 조치들을 세로 메뉴로 연다.
it('작품 표의 행 조치는 글자 버튼 대신 ⋮ 버튼 하나가 여는 메뉴에 모이고, Esc로 닫으면 초점이 ⋮로 돌아온다', async () => {
  const { row } = await openForkTab(() => Response.json(integrityReport))
  const trigger = within(row).getByRole('button', { name: '「달빛 도서관 외전」 조치' })
  expect([trigger.getAttribute('aria-haspopup'), trigger.getAttribute('aria-expanded'), trigger.textContent]).toEqual(['menu', 'false', ''])
  // 글자 버튼은 행에 없고, 메뉴가 열려야 항목이 나온다.
  expect(within(row).queryByRole('button', { name: /운영 제한|포크 정합성 점검/ })).toBeNull()
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(trigger)
  const menu = screen.getByRole('menu', { name: '「달빛 도서관 외전」 조치' })
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const items = within(menu).getAllByRole('menuitem')
  expect(items.map((item) => item.textContent)).toEqual(['상세', '운영 제한', '포크 정합성 점검', '소설 보기', '집필실 보기'])
  // 운영자는 소유권 없이 모든 작품의 상세·집필실을 연다(2026-11-23 사용자 결정).
  const workId = row.querySelector('[data-record-id]')?.getAttribute('data-record-id')
  expect(items.slice(3).map((item) => item.getAttribute('href'))).toEqual([`/work/${workId}`, `/studio/${workId}`])
  // 위험 조치(제한)만 danger 글자이고, 열리면 첫 항목에 초점이 간다.
  expect(items.map((item) => item.classList.contains('danger'))).toEqual([false, true, false, false, false])
  expect(document.activeElement).toBe(items[0])
  fireEvent.keyDown(items[0], { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  // 조치 칸 머리의 글자는 감추되 열 머리(scope=col)로 남는다.
  const head = screen.getByRole('columnheader', { name: '조치' })
  expect([head.getAttribute('scope'), head.querySelector('.sr-only')?.textContent]).toEqual(['col', '조치'])
})

it('신고 표의 ⋮ 메뉴를 여는 누름은 행 선택까지 올라가지 않고, 검토 항목을 고르면 그 신고가 선택된다', async () => {
  const report = (id: string, workTitle: string) => ({
    id, kind: 'RIGHTS' as const, targetType: 'work' as const, workId: `w-${id}`, workTitle, workOwnerId: 'o1', episodeNumber: null, worldId: null, worldName: null, reporterId: 'r1', reason: '권리 침해', evidence: '근거',
    status: 'RECEIVED' as const, contentRestricted: false, createdAt: '2026-11-09T01:00:00Z', updatedAt: '2026-11-09T01:00:00Z',
  })
  // jsdom에는 scrollIntoView가 없어(신고 상세가 열리면 제목으로 스크롤한다) 빈 대역을 둔다.
  Element.prototype.scrollIntoView = vi.fn()
  const reports = appContainer.resolve('reportUseCase')
  vi.spyOn(reports, 'listAll').mockResolvedValue([report('rep-1', '달빛 도서관'), report('rep-2', '별빛 정원')])
  const detail = vi.spyOn(reports, 'get').mockImplementation(async (id) => ({ ...report(id, id === 'rep-1' ? '달빛 도서관' : '별빛 정원'), history: [] }))
  renderAdmin('rights')
  const row = (await screen.findByText('달빛 도서관', { selector: 'b' })).closest('tr') as HTMLElement
  const menu = openRowMenu(row)
  // 메뉴를 열었다고 신고를 선택(상세 조회)하지 않는다. 행을 누르는 선택은 그대로다.
  expect([row.classList.contains('sel'), detail.mock.calls.length]).toEqual([false, 0])
  const review = menu.getByRole('menuitem', { name: '검토' })
  expect(review.getAttribute('aria-current')).toBeNull()
  fireEvent.click(review)
  await screen.findByRole('heading', { name: '신고 상세 · 달빛 도서관' })
  expect(row.classList.contains('sel')).toBe(true)
  expect(detail).toHaveBeenCalledWith('rep-1')
  // 선택된 신고의 항목은 '검토 중'으로 읽힌다.
  try {
    expect(openRowMenu(row).getByRole('menuitem', { name: '검토 중' }).getAttribute('aria-current')).toBe('true')
  } finally { Reflect.deleteProperty(Element.prototype, 'scrollIntoView') }
})

// 데모 조회(d)가 있어야 본문을 그리는 데모 탭(캐릭터챗)은 조회 중·실패일 때 본문이 없다. 그때 화면은 빈 채로 두지 않고 제목 아래 안내가 로딩·오류와 다시 불러오기를 맡는다.
const DEMO_TABS = [['characterChats', '캐릭터챗 관리', '캐릭터챗 목록']] as const

it.each(DEMO_TABS)('%s 탭은 데모 조회가 아직 오지 않았으면 제목 아래에 불러오는 중임을 알리고, 오면 본문을 그린다', async (tab, title, body) => {
  const admin = appContainer.resolve('adminUseCase')
  const loaded = await admin.load()
  let arrive = () => {}
  vi.spyOn(admin, 'load').mockReturnValue(new Promise((resolve) => { arrive = () => resolve(loaded) }))
  renderAdmin(tab)
  await screen.findByRole('heading', { level: 1, name: title })
  expect((await screen.findByRole('status')).textContent).toBe('관리자 데이터를 불러오고 있어요.')
  expect([screen.queryByRole('alert'), screen.queryByRole('heading', { level: 2, name: body })]).toEqual([null, null])
  await act(async () => { arrive() })
  await screen.findByRole('heading', { level: 2, name: body })
  expect(screen.queryByText('관리자 데이터를 불러오고 있어요.')).toBeNull()
})

it.each(DEMO_TABS)('%s 탭은 데모 조회가 실패하면 오류 안내와 다시 불러오기를 보이고, 누르면 다시 읽어 본문을 그린다', async (tab, title, body) => {
  const load = vi.spyOn(appContainer.resolve('adminUseCase'), 'load').mockRejectedValueOnce(new Error('데모 조회 실패'))
  renderAdmin(tab)
  await screen.findByRole('heading', { level: 1, name: title })
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('관리자 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  expect(screen.queryByRole('heading', { level: 2, name: body })).toBeNull()
  fireEvent.click(within(alert).getByRole('button', { name: '다시 불러오기' }))
  await screen.findByRole('heading', { level: 2, name: body })
  expect(load).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

// 문의·이벤트·공지는 운영 API 탭이라 데모 조회(d)가 늦거나 실패해도 본문을 그린다: 제목만 남는 빈 화면이 아니다. 데모 조회 안내(불러오는 중·오류)는 데모 탭에만 보인다.
const OPS_BODIES = [['feedback', '회원 문의'], ['events', '운영 이벤트 목록'], ['notices', '운영 공지 목록']] as const

it.each(OPS_BODIES)('%s 탭은 데모 조회가 실패해도 본문(%s)을 그리고 데모 조회 오류 안내는 보이지 않는다', async (tab, heading) => {
  vi.spyOn(appContainer.resolve('adminUseCase'), 'load').mockRejectedValue(new Error('데모 조회 실패'))
  renderAdmin(tab)
  await screen.findByRole('heading', { level: 2, name: heading })
  expect(screen.queryByText(/관리자 데이터를 불러오지 못했어요/)).toBeNull()
})

it.each(OPS_BODIES)('%s 탭은 데모 조회가 아직 오지 않았어도 본문(%s)을 먼저 그리고 데모 조회 불러오는 중 안내는 보이지 않는다', async (tab, heading) => {
  vi.spyOn(appContainer.resolve('adminUseCase'), 'load').mockReturnValue(new Promise(() => {}))
  renderAdmin(tab)
  await screen.findByRole('heading', { level: 2, name: heading })
  expect(screen.queryByText('관리자 데이터를 불러오고 있어요.')).toBeNull()
})

// 크레딧 탭(DEC-57): 회원 목록(MemberUseCase)과 운영 크레딧 UseCase를 대역으로 잇고, 열자마자 목록·행별 잔액 → ⋮ 선택 → 잔액·내역 → 지급·회수를 화면에서 따라간다.
const yeonhwa = { id: 'm1', email: 'yeonhwa@example.invalid', nickname: '연화봉러', role: 'MEMBER' as const, restricted: false, createdAt: '2026-11-01T00:00:00Z' }
const credit: MemberCredits = {
  balance: { total: 130, items: [{ kind: 'operator', remaining: 100, expiresAt: '2027-01-01T00:00:00Z' }, { kind: 'reward', remaining: 30, expiresAt: '2027-02-01T00:00:00Z' }] },
  history: [{ type: 'revoke', kind: 'reward', amount: 5, occurredAt: '2026-11-10T02:00:00Z' }, { type: 'grant', kind: 'operator', amount: 100, occurredAt: '2026-11-10T01:00:00Z' }],
}
async function openMemberCredits(overview: MemberCredits | null = credit) {
  const members = vi.spyOn(appContainer.resolve('memberUseCase'), 'listMembers').mockResolvedValue([yeonhwa])
  const useCase = appContainer.resolve('operationsCreditUseCase')
  const member = vi.spyOn(useCase, 'member').mockResolvedValue(overview)
  const balances = vi.spyOn(useCase, 'balances').mockResolvedValue({ m1: 130 })
  renderAdmin('credits')
  const row = (await screen.findByText('연화봉러', { selector: 'b' })).closest('tr') as HTMLElement
  fireEvent.click(openRowMenu(row).getByRole('menuitem', { name: '크레딧 보기·조정' }))
  await screen.findByRole('heading', { name: '연화봉러 님의 크레딧' })
  return { useCase, member, members, balances }
}
const fillChange = (amount: string, reason: string) => {
  fireEvent.change(screen.getByLabelText('금액'), { target: { value: amount } })
  fireEvent.change(screen.getByLabelText('사유'), { target: { value: reason } })
}

it('크레딧 탭은 열자마자 전체 회원을 최신 가입순으로 읽고 행마다 보유 크레딧을 묶음 잔액으로 보인다', async () => {
  const other = { ...yeonhwa, id: 'm2', email: 'other@example.invalid', nickname: '하늘' }
  const members = vi.spyOn(appContainer.resolve('memberUseCase'), 'listMembers').mockResolvedValue([yeonhwa, other])
  const balances = vi.spyOn(appContainer.resolve('operationsCreditUseCase'), 'balances').mockResolvedValue({ m1: 130 })
  renderAdmin('credits')
  const first = (await screen.findByText('연화봉러', { selector: 'b' })).closest('tr') as HTMLElement
  const second = screen.getByText('하늘', { selector: 'b' }).closest('tr') as HTMLElement
  expect(members).toHaveBeenCalledWith({ role: 'ALL', q: '', sort: 'newest' })
  await waitFor(() => expect(cells(first)[2]).toBe('130'))
  // 서버가 모르는 회원은 잔액 결과에서 빠져 '—'로 보인다(0으로 채우지 않는다).
  expect(cells(second)[2]).toBe('—')
  expect(balances).toHaveBeenCalledWith(['m1', 'm2'])
  expect(screen.queryByRole('heading', { name: /님의 크레딧/ })).toBeNull()
})

it('잔액 조회 권한(크레딧 운영)이 없으면(403) 회원 표는 그대로 두고 잔액 칸은 비운 채 권한 안내만 보인다', async () => {
  vi.spyOn(appContainer.resolve('memberUseCase'), 'listMembers').mockResolvedValue([yeonhwa])
  vi.spyOn(appContainer.resolve('operationsCreditUseCase'), 'balances').mockResolvedValue(null)
  renderAdmin('credits')
  const row = (await screen.findByText('연화봉러', { selector: 'b' })).closest('tr') as HTMLElement
  expect((await screen.findByRole('alert')).textContent).toBe(CREDITS_FORBIDDEN)
  expect(cells(row)[2]).toBe('—')
})

it('크레딧 탭은 데모가 아니라 열자마자 보이는 회원 목록 → ⋮ 선택 → 지급분별 잔액·내역 표를 실제 API 값으로 보인다', async () => {
  const { member } = await openMemberCredits()
  expect(demoChip()).toBeNull()
  expect(member).toHaveBeenCalledWith('m1')
  within(screen.getByText('보유 크레딧', { selector: 'small' }).closest('div') as HTMLElement).getByText('130')
  const body = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('row').slice(1).map((row) => cells(row))
  expect(body('지급분별 잔액 표').map((row) => row.slice(0, 2))).toEqual([['운영자 지급 크레딧', '100'], ['보상 크레딧', '30']])
  expect(body('크레딧 내역 표').map((row) => row.slice(1))).toEqual([['회수', '보상 크레딧', '-5'], ['지급', '운영자 지급 크레딧', '+100']])
  expect(document.body.textContent).not.toContain('정책 미확정')
})

it('크레딧 지급은 확인 대화 뒤 금액·사유를 보내고, 성공하면 입력을 비우며 잔액·내역을 다시 읽는다', async () => {
  const { useCase, member, balances } = await openMemberCredits()
  const grant = vi.spyOn(useCase, 'grant').mockResolvedValue(undefined)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  fillChange('500', '이벤트 보상')
  fireEvent.click(screen.getByRole('button', { name: '지급' }))
  expect(confirm).toHaveBeenCalledWith('연화봉러 님에게 크레딧 500만큼 지급할까요? 사유는 활동 로그에 남아요.')
  await screen.findByText('연화봉러 님에게 크레딧 500만큼 지급했어요.')
  expect(grant).toHaveBeenCalledWith('m1', 500, '이벤트 보상')
  await waitFor(() => expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe(''))
  expect((screen.getByLabelText('사유') as HTMLTextAreaElement).value).toBe('')
  await waitFor(() => expect(member.mock.calls.length).toBeGreaterThan(1))
  // 목록의 행별 잔액도 지급 뒤 다시 읽는다.
  await waitFor(() => expect(balances.mock.calls.length).toBeGreaterThan(1))
})

it('금액이나 사유가 비어 있으면 대화도 요청도 없고, 확인을 취소하면 회수를 요청하지 않는다', async () => {
  const { useCase } = await openMemberCredits()
  const revoke = vi.spyOn(useCase, 'revoke').mockResolvedValue(undefined)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: '회수' }))
  expect(confirm).not.toHaveBeenCalled()
  fillChange('20', '오지급 회수')
  fireEvent.click(screen.getByRole('button', { name: '회수' }))
  expect(confirm).toHaveBeenCalledWith('연화봉러 님의 크레딧 20만큼 회수할까요? 쓸 수 있는 잔액 안에서만 회수되고, 사유는 활동 로그에 남아요.')
  expect(revoke).not.toHaveBeenCalled()
})

it('회수가 잔액을 넘어 거절되면(409) 이유를 알리고 입력은 그대로 두며 완료로 표시하지 않는다', async () => {
  const { useCase } = await openMemberCredits()
  vi.spyOn(useCase, 'revoke').mockRejectedValue(new OperationsRejected(CREDIT_INSUFFICIENT_MESSAGE))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fillChange('999', '회수')
  fireEvent.click(screen.getByRole('button', { name: '회수' }))
  expect((await within(screen.getByRole('region', { name: '크레딧 운영' })).findByRole('alert')).textContent).toContain(CREDIT_INSUFFICIENT_MESSAGE)
  expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('999')
  expect(screen.queryByText(/회수했어요/)).toBeNull()
  expect(screen.getByRole('button', { name: '회수' }).closest('fieldset')?.disabled).toBe(false)
})

it('처리 중에는 입력·버튼을 잠그고 같은 요청을 한 번만 보낸다', async () => {
  const { useCase } = await openMemberCredits()
  let done!: () => void
  const grant = vi.spyOn(useCase, 'grant').mockImplementation(() => new Promise<void>((resolve) => { done = resolve }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fillChange('10', '확인')
  fireEvent.click(screen.getByRole('button', { name: '지급' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '지급' }).closest('fieldset')?.disabled).toBe(true))
  // 잠긴 fieldset 안의 클릭이 jsdom에서는 전달돼도 같은 키의 조치 실행기가 두 번째 요청을 막는다.
  fireEvent.click(screen.getByRole('button', { name: '지급' }))
  expect(grant).toHaveBeenCalledTimes(1)
  await screen.findByText('요청을 처리하고 있어요. 중복으로 보내지 마세요.')
  await act(async () => { done() })
  await screen.findByText('연화봉러 님에게 크레딧 10만큼 지급했어요.')
})

it('크레딧 운영 권한이 없으면(403) 잔액 대신 권한 안내만 보이고 지급·회수 폼은 그리지 않는다', async () => {
  await openMemberCredits(null)
  expect((await screen.findByRole('alert')).textContent).toBe(CREDITS_FORBIDDEN)
  expect(screen.queryByRole('form', { name: '크레딧 지급·회수' })).toBeNull()
})

it('회원 목록 권한(사용자 관리)이 없으면 다시 불러오기 없이 권한 안내만 보이고 잔액은 요청하지 않는다', async () => {
  vi.spyOn(appContainer.resolve('memberUseCase'), 'listMembers').mockRejectedValue(new OperationsForbidden('권한 없음'))
  const balances = vi.spyOn(appContainer.resolve('operationsCreditUseCase'), 'balances').mockResolvedValue({})
  renderAdmin('credits')
  expect((await screen.findByRole('alert')).textContent).toBe(MEMBER_SEARCH_FORBIDDEN)
  expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
  expect(balances.mock.calls.every(([ids]) => ids.length === 0)).toBe(true)
})

it('회원 검색은 목록을 좁히고 검색어를 서버에 보낸다', async () => {
  const members = vi.spyOn(appContainer.resolve('memberUseCase'), 'listMembers').mockResolvedValue([yeonhwa])
  vi.spyOn(appContainer.resolve('operationsCreditUseCase'), 'balances').mockResolvedValue({ m1: 130 })
  renderAdmin('credits')
  await screen.findByText('연화봉러', { selector: 'b' })
  fireEvent.change(screen.getByLabelText('회원 검색'), { target: { value: '연화' } })
  fireEvent.click(screen.getByRole('button', { name: '검색' }))
  await waitFor(() => expect(members).toHaveBeenLastCalledWith({ role: 'ALL', q: '연화', sort: 'newest' }))
})

// 관리자 계정 생성 결과(오류·완료)는 공지·이벤트 폼처럼 폼 안 제출 줄 아래에 보이고 화면 맨 위에는 또 그리지 않는다(권한 12개 아래 제출 버튼에서 맨 위 상태 줄은 멀다).
async function submitAdminForm(permissions: string[] = []) {
  vi.spyOn(appContainer.resolve('memberUseCase'), 'listAdmins').mockResolvedValue([])
  renderAdmin('admins')
  fireEvent.change(await screen.findByLabelText('이메일'), { target: { value: 'new-admin@example.invalid' } })
  fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: '새 관리자' } })
  fireEvent.change(screen.getByLabelText('초기 비밀번호'), { target: { value: 'StoryforkDev123!' } })
  for (const name of permissions) fireEvent.click(screen.getByLabelText(name))
  const form = screen.getByRole('button', { name: '관리자 계정 추가' }).closest('form') as HTMLFormElement
  fireEvent.submit(form)
  return form
}
const afterSubmitRow = (form: HTMLFormElement, node: Element) => !!(form.querySelector('.rowend')!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)

it('관리자 계정 생성 오류는 화면 맨 위가 아니라 폼 안 제출 줄 아래에 한 번만 보인다', async () => {
  const form = await submitAdminForm()
  const alert = await within(form).findByRole('alert')
  expect(alert.textContent).toBe('한 가지 이상 권한을 선택해 주세요.')
  expect(screen.getAllByRole('alert')).toEqual([alert])
  expect(afterSubmitRow(form, alert)).toBe(true)
})

it('관리자 계정 생성 완료도 폼 안 제출 줄 아래에 한 번만 보이고 화면 맨 위 완료 줄은 없다', async () => {
  const created = vi.spyOn(appContainer.resolve('memberUseCase'), 'createAdmin').mockResolvedValue(undefined)
  const form = await submitAdminForm([ADMIN_PERMISSIONS[0][1]])
  const done = await within(form).findByText('관리자 계정을 만들고 권한을 저장했어요.')
  expect(created).toHaveBeenCalledTimes(1)
  expect(done.getAttribute('role')).toBe('status')
  expect(screen.getAllByText('관리자 계정을 만들고 권한을 저장했어요.')).toEqual([done])
  expect(afterSubmitRow(form, done)).toBe(true)
})

it('경고 기준 행은 값이 저장값과 다르면 저장 버튼 곁에 "저장 안 됨"을 보이고, 저장돼 기준이 바뀌거나 값을 되돌리면 지운다', async () => {
  // 공유 메모리 저장소를 바꾸지 않도록 이 테스트 안에서만 기준 목록을 들고 있는다.
  const llm = appContainer.resolve('llmOpsUseCase')
  let saved = (await llm.alertRules())!
  vi.spyOn(llm, 'alertRules').mockImplementation(async () => structuredClone(saved))
  vi.spyOn(llm, 'updateAlertRule').mockImplementation(async (key, input) => { saved = saved.map((rule) => rule.key === key ? { ...rule, ...input } : rule) })
  renderAdmin('llm', 'alerts')
  await screen.findByLabelText('AI 실패율 켜기')
  const row = () => screen.getByLabelText('AI 실패율 켜기').closest('tr') as HTMLElement
  const unsaved = () => within(row()).queryByText('저장 안 됨')
  expect(unsaved()).toBeNull()
  fireEvent.click(within(row()).getByLabelText('AI 실패율 켜기'))
  // 저장 버튼과 같은 칸(곁)에 보인다.
  expect(unsaved()!.closest('td')).toBe(within(row()).getByRole('button', { name: 'AI 실패율 기준 저장' }).closest('td'))
  fireEvent.click(within(row()).getByLabelText('AI 실패율 켜기'))
  expect(unsaved()).toBeNull()
  fireEvent.change(within(row()).getByLabelText('AI 실패율 기준값'), { target: { value: '0.2' } })
  expect(unsaved()).not.toBeNull()
  fireEvent.click(within(row()).getByRole('button', { name: 'AI 실패율 기준 저장' }))
  await waitFor(() => expect(unsaved()).toBeNull())
  expect((within(row()).getByLabelText('AI 실패율 기준값') as HTMLInputElement).value).toBe('0.2')
})

// 프롬프트 상세(개선 루프)를 입구(에이전트별 평가)의 이름 버튼으로 연다. 예시 프롬프트(character_simulation.act)는 네 버전·짝 세트 simulation.act·자동 개선 대상이다.
const openLoop = async (prompt = 'character_simulation.act') => {
  fireEvent.click(await screen.findByRole('button', { name: `${promptLabel(prompt)} 프롬프트 열기` }))
  const detail = await region('프롬프트 상세')
  await within(detail).findByRole('navigation', { name: '프롬프트 개선 루프 단계' })
  return detail
}
const stepOf = (detail: HTMLElement, name: string) => within(detail).getByRole('button', { name })
const panelOf = (detail: HTMLElement) => within(detail).getByRole('group', { name: /^\d단계 / })
const rowsOf = (table: HTMLElement) => [...table.querySelectorAll('tbody tr')].map((tr) => tr.textContent)

it('회귀 평가 실행은 프롬프트를 상세의 프롬프트로 고정하고 데이터셋(짝 세트가 처음 들어 있음)과 버전(그 프롬프트의 버전 목록, 반영 중인 버전이 기본)만 받는다(#857)', async () => {
  const run = vi.spyOn(appContainer.resolve('llmOpsUseCase'), 'runEvaluation').mockResolvedValue(undefined)
  renderAdmin('llm', 'prompts&sub=evals')
  const detail = await openLoop()
  fireEvent.click(stepOf(detail, '평가'))
  const form = await region('회귀 평가')
  expect(within(form).queryByLabelText('프롬프트 이름')).toBeNull()
  const dataset = within(form).getByLabelText<HTMLInputElement>('데이터셋')
  expect([dataset.value, dataset.getAttribute('placeholder')]).toEqual(['simulation.act', '예: simulation.narrate'])
  const version = within(form).getByLabelText<HTMLSelectElement>('버전')
  expect([[...version.options].map((o) => o.value), version.value]).toEqual([['4', '3', '2', '1'], '1'])
  fireEvent.change(version, { target: { value: '2' } })
  fireEvent.click(within(form).getByRole('button', { name: '평가 실행' }))
  await waitFor(() => expect(run).toHaveBeenCalledWith('simulation.act', 'character_simulation.act', 2))
})

it('프롬프트·평가 쪽은 에이전트별 평가 표를 입구로 열어 세트 없는 에이전트도 보이고, 세트마다 최근 Run을 통과 여부와 Run 상세로 보이며, 프롬프트가 정해진 행의 이름과 Run 상세는 그 프롬프트의 개선 루프를 연다(#837·#857)', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  const run = (runId: string, passed: boolean, createdAt: string): Evaluation => ({ runId, dataset: 'simulation.act', prompt: 'character_simulation.act', version: 2, status: 'completed', passed, createdAt, metrics: [] })
  const newest = run('act-new', false, '2026-11-24T02:00:00Z')
  vi.spyOn(llm, 'evaluations').mockResolvedValue([run('act-old', true, '2026-11-20T02:00:00Z'), newest])
  vi.spyOn(llm, 'evaluation').mockResolvedValue(newest)
  renderAdmin('llm', 'prompts&sub=evals')
  const catalog = await region('에이전트별 평가')
  const table = within(catalog).getByRole('table', { name: '에이전트별 평가 표' })
  expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['에이전트 · 평가하는 호출', '평가 모드', '평가 세트(항목 수)', '지표', '최근 결과'])
  const rowOf = (feature: string) => within(within(table).getAllByRole('row').find((tr) => tr.textContent?.includes(feature)) as HTMLElement)
  // 세트가 없는 에이전트도 숨기지 않고, 세트는 있으나 Run이 없으면 그렇게 알린다.
  rowOf('orchestration.main').getByText('평가 세트 없음(후속)')
  rowOf('character_simulation.narrate').getByText('실행한 평가 없음')
  // 원문 검색은 실행 버튼 없이 CI에서 확인한다.
  rowOf('기억 회상(NovelBrain recall)').getByText(/버튼 없음 · CI에서 확인/)
  expect(rowOf('기억 회상(NovelBrain recall)').queryByRole('button')).toBeNull()
  // 행 이름은 한국어로 자세히('에이전트 · 무슨 호출'): 프롬프트가 정해진 행은 한국어 이름(작은 코드 곁들임)이 개선 루프를 여는 버튼이고, 범용 세트·검색·묶음 행은 버튼이 아니다(#857).
  const names = within(table).getAllByRole('row').slice(1).map((tr) => within(tr).getAllByRole('cell')[0].textContent)
  expect(names).toEqual(expect.arrayContaining([
    '인물 시뮬레이션 · 인물 대사(act) character_simulation.act', '인물 시뮬레이션 · 나레이션·독백(narrate) character_simulation.narrate', '메인 에이전트 · 작가 요청 처리(main) orchestration.main',
    'Q&A · 작품 질문 답변(answer) story_context.answer', 'Manuscript Review · 원고 검수(manuscript_review.*)', 'World · 설정 충돌 지적', 'Q&A · 설정·관계 발췌(world_excerpts)',
  ]))
  expect(new Set(names).size).toBe(names.length)
  rowOf('orchestration.main').getByRole('button', { name: '메인 에이전트 · 작가 요청 처리(main) 프롬프트 열기' })
  for (const feature of ['설정 충돌 지적', '집필 교정', '설정·관계 발췌(world_excerpts)', 'manuscript_review.*']) expect(rowOf(feature).queryByRole('button', { name: /프롬프트 열기/ }), feature).toBeNull()
  // 그 세트의 가장 최근 Run(목록 순서와 무관)이 통과·미통과와 Run 상세로 보이고, Run 상세는 그 프롬프트 상세의 평가 단계에서 Run을 연다.
  const act = rowOf('character_simulation.act')
  act.getByText('미통과')
  act.getByText(/인물 대사\(act\) 2번 버전/)
  fireEvent.click(act.getByRole('button', { name: /act-new/ }))
  const detail = await region('프롬프트 상세')
  await region('평가 상세')
  expect(screen.queryByRole('region', { name: '에이전트별 평가' })).toBeNull()
  within(detail).getByRole('heading', { name: /인물 대사\(act\) character_simulation\.act$/, level: 2 })
  expect(stepOf(detail, '평가').getAttribute('aria-current')).toBe('step')
})

it('프롬프트 상세는 단계 표시(① 프롬프트 ─ ② 평가 세트 ─ ③ 평가 ─ ④ 자동 개선 ─ ⑤ 게이트 ─ ⑥ 서비스 반영)가 위에 있고 현재 단계는 aria-current=step이며, 단계를 고르면 아래 패널이 바뀐다(#857)', async () => {
  renderAdmin('llm', 'prompts&sub=evals')
  const detail = await openLoop()
  const stepButtons = () => within(within(detail).getByRole('navigation', { name: '프롬프트 개선 루프 단계' })).getAllByRole('button')
  const current = () => stepButtons().map((button) => [button.textContent, button.getAttribute('aria-current')])
  expect(current()).toEqual([['①프롬프트', 'step'], ['②평가 세트', null], ['③평가', null], ['④자동 개선', null], ['⑤게이트', null], ['⑥서비스 반영', null]])
  // ① 프롬프트: 버전 목록과 새 조합 만들기(버튼은 없다: 후보 등록은 ⑤, 서비스 반영은 ⑥).
  expect(panelOf(detail).getAttribute('aria-label')).toBe('1단계 프롬프트')
  const versions = within(panelOf(detail)).getByRole('region', { name: '프롬프트 버전 표' })
  expect(within(versions).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['버전', '상태', '모델', '등록'])
  expect(within(versions).queryByRole('button')).toBeNull()
  within(panelOf(detail)).getByRole('heading', { name: '새 조합 만들기' })
  // ② 평가 세트: 짝 세트 이름·문항 수·지표·게이트. 등록은 보기 전용이라 폼이 없고 등록 방법만 안내한다.
  fireEvent.click(stepOf(detail, '평가 세트'))
  expect(current()[1]).toEqual(['②평가 세트', 'step'])
  expect(current().filter(([, at]) => at === 'step')).toHaveLength(1)
  expect(panelOf(detail).getAttribute('aria-label')).toBe('2단계 평가 세트')
  const set = within(panelOf(detail))
  expect(['simulation.act', '24문항', 'voice(말투) · intent(의도) · pov_ok(시점)', '후보로 등록하려면 이 세트의 회귀 평가를 통과해야 해요.'].map((text) => set.getByText(text, { selector: 'dd' }).tagName)).toEqual(['DD', 'DD', 'DD', 'DD'])
  set.getByText(/위의 목록과 JSONL 업로드는 운영 서버 API로 그 Dataset을 읽고/)
  set.getByText(/python -m app\.evaluation\.seed/)
  set.getByText(/저작권이 있는 원문\(해리 포터·웹소설\)은 저장소와 Langfuse에 올리지 않고/)
  // 이 단계에는 평가 데이터셋 목록·JSONL 업로드가 이어진다(아래 테스트가 본다).
  set.getByRole('region', { name: '평가 데이터셋' })
  set.getByRole('form', { name: 'JSONL 업로드' })
  // ③ 평가: 그 프롬프트의 짝 세트 Run만(다른 세트·다른 프롬프트의 Run은 거른다).
  fireEvent.click(stepOf(detail, '평가'))
  const runs = await within(panelOf(detail)).findByRole('region', { name: '회귀 평가 표' })
  expect(rowsOf(runs)).toHaveLength(4)
  expect(rowsOf(runs).every((text) => text!.includes('simulation.act') && text!.includes('character_simulation.act'))).toBe(true)
  expect(rowsOf(runs).join()).not.toMatch(/story_context\.answer|character_simulation\.narrate|world_review\.check|qa-answer/)
  // ④ 자동 개선: 지원하는 프롬프트의 기존 폼.
  fireEvent.click(stepOf(detail, '자동 개선'))
  within(panelOf(detail)).getByRole('form', { name: '프롬프트 자동 개선' })
  expect(within(panelOf(detail)).getByLabelText<HTMLInputElement>('평가 호출 상한').value).toBe('150')
  // 단계를 고르면 다른 패널은 사라진다.
  expect(screen.queryByRole('region', { name: '회귀 평가 표' })).toBeNull()
  expect(screen.queryByRole('region', { name: '프롬프트 버전 표' })).toBeNull()
})

it('프롬프트 상세에서 단계를 오가도 ① 새 조합 만들기에 쓰던 입력이 남는다(#857)', async () => {
  renderAdmin('llm', 'prompts&sub=evals')
  const detail = await openLoop()
  fireEvent.change(within(detail).getByLabelText<HTMLTextAreaElement>('프롬프트 본문'), { target: { value: '쓰던 본문' } })
  fireEvent.click(stepOf(detail, '평가 세트'))
  fireEvent.click(stepOf(detail, '프롬프트'))
  expect(within(detail).getByLabelText<HTMLTextAreaElement>('프롬프트 본문').value).toBe('쓰던 본문')
})

it('프롬프트 상세 ⑤ 게이트는 버전마다 짝 세트의 가장 최근 평가 통과 여부와 후보 등록(통과한 버전만)을, ⑥ 서비스 반영은 후보 버전의 반영 버튼(확인 뒤)을 보이고, 결과 보기는 ③ 평가에서 Run 상세를 연다(#857)', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  const candidate = vi.spyOn(llm, 'candidate').mockResolvedValue(undefined)
  const promote = vi.spyOn(llm, 'promote').mockResolvedValue(undefined)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderAdmin('llm', 'prompts&sub=evals')
  const detail = await openLoop()
  fireEvent.click(stepOf(detail, '게이트'))
  within(panelOf(detail)).getByText('후보 등록 조건: 평가 세트 simulation.act의 회귀 평가를 통과해야 해요(그 버전의 가장 최근 평가 기준).')
  const gate = within(panelOf(detail)).getByRole('region', { name: '평가 게이트 버전 표' })
  expect(within(gate).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['버전', '상태', '회귀 평가', '조치'])
  const row = (table: HTMLElement, version: number) => within(within(table).getByRole('cell', { name: String(version) }).closest('tr') as HTMLElement)
  // 4번(통과·후보 아님) → 후보 등록, 3번(미통과) → 평가 통과 후 가능, 2번(후보) → 후보 등록됨, 1번(반영 중).
  row(gate, 4).getByText('통과')
  fireEvent.click(row(gate, 4).getByRole('button', { name: 'character_simulation.act 4번 버전 후보 등록' }))
  await waitFor(() => expect(candidate).toHaveBeenCalledWith('character_simulation.act', 4))
  row(gate, 3).getByText('미통과')
  row(gate, 3).getByText('평가 통과 후 가능')
  expect(row(gate, 3).queryByRole('button', { name: /후보 등록/ })).toBeNull()
  row(gate, 2).getByText('후보 등록됨')
  row(gate, 1).getByText('반영 중')
  // ⑥ 서비스 반영: 후보로 등록한 버전만 버튼이 있고 확인을 받는다.
  fireEvent.click(stepOf(detail, '서비스 반영'))
  const serve = within(panelOf(detail)).getByRole('region', { name: '서비스 반영 버전 표' })
  expect(within(serve).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['버전', '상태', '모델', '조치'])
  expect(['후보로 등록한 뒤 가능', '후보로 등록한 뒤 가능'].map((text, i) => row(serve, 4 - i).getByText(text).tagName)).toEqual(['SPAN', 'SPAN'])
  row(serve, 1).getByText('반영 중')
  fireEvent.click(row(serve, 2).getByRole('button', { name: 'character_simulation.act 2번 버전 서비스에 반영' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(promote).toHaveBeenCalledWith('character_simulation.act', 2))
  // 게이트의 결과 보기는 ③ 평가로 옮겨 그 Run의 상세(지표 표·문항별 결과, 실패 먼저)를 연다.
  fireEvent.click(stepOf(detail, '게이트'))
  fireEvent.click(row(within(panelOf(detail)).getByRole('region', { name: '평가 게이트 버전 표' }), 3).getByRole('button', { name: 'character_simulation.act 3번 버전 평가 결과 보기' }))
  const run = await region('평가 상세')
  expect(stepOf(detail, '평가').getAttribute('aria-current')).toBe('step')
  const title = await within(run).findByRole('heading', { name: /^simulation\.act · 인물 시뮬레이션 · 인물 대사\(act\) character_simulation\.act 3번 버전$/, level: 3 })
  await waitFor(() => expect(document.activeElement).toBe(title))
  within(run).getByRole('region', { name: '평가 지표 표' })
  within(run).getByText('실패 3문항 / 전체 4문항 (실패: 항목 오류 · 시점 위반 · 지표 하나라도 0.5 미만)')
  expect(rowsOf(within(run).getByRole('region', { name: '문항별 결과 표' }))[0]).toContain('simulation.act-19')
  // 평가 목록으로 돌아오면 그 단계의 Run 목록이다.
  fireEvent.click(within(run).getByRole('button', { name: '평가 목록으로' }))
  await within(panelOf(detail)).findByRole('region', { name: '회귀 평가 표' })
})

it('짝 평가 세트가 없는 프롬프트의 상세는 ② 평가 세트가 없음을 알리고, ④ 자동 개선은 지원하지 않음을, ⑤ 게이트는 평가 없이 후보로 등록할 수 있음을 알린다(#857)', async () => {
  renderAdmin('llm', 'prompts&sub=evals')
  const detail = await openLoop('orchestration.main')
  fireEvent.click(stepOf(detail, '평가 세트'))
  within(panelOf(detail)).getByText(/이 프롬프트는 짝 평가 세트가 없어요/)
  // 그래도 범용 세트를 돌려 볼 수 있게 ③의 실행 폼은 있고, 이 프롬프트로 돌린 Run이 없으면 그렇게 알린다.
  fireEvent.click(stepOf(detail, '평가'))
  await within(panelOf(detail)).findByText('이 프롬프트로 실행한 평가가 아직 없어요.')
  expect(within(panelOf(detail)).getByLabelText<HTMLInputElement>('데이터셋').value).toBe('')
  fireEvent.click(stepOf(detail, '자동 개선'))
  within(panelOf(detail)).getByText(/이 프롬프트는 자동 개선을 지원하지 않아요/)
  expect(within(panelOf(detail)).queryByRole('form', { name: '프롬프트 자동 개선' })).toBeNull()
  fireEvent.click(stepOf(detail, '게이트'))
  within(panelOf(detail)).getByText('이 프롬프트는 짝 평가 세트가 없어 평가 없이 후보로 등록할 수 있어요.')
})

it('모델을 고르지 않은 버전의 모델 칸은 파이프라인 기록에서 실제로 쓰인 모델을 \'기본 모델 · 최근 사용 …\'으로 근거와 함께 보이고, 근거가 없는 프롬프트는 이름을 지어내지 않는다(#857)', async () => {
  renderAdmin('llm', 'prompts&sub=prompts')
  const table = await screen.findByRole('region', { name: '프롬프트 표' })
  const modelOf = (name: RegExp) => within(within(table).getByRole('button', { name }).closest('tr') as HTMLElement).getAllByRole('cell')[2]
  // 인물 대사·나레이션·메인은 예시 파이프라인 기록에 프롬프트·버전·모델이 남아 있고(인물 대사만 다른 모델), 웹 고증 검색은 기록이 없다.
  await waitFor(() => expect(modelOf(/인물 대사\(act\)/).textContent).toBe('기본 모델 · 최근 사용 gpt-demo-mini'))
  expect(modelOf(/작가 요청 처리\(main\)/).textContent).toBe('기본 모델 · 최근 사용 gpt-demo')
  expect(modelOf(/웹 고증 검색/).textContent).toBe('기본 모델(환경 설정)')
  // 근거(어느 버전의 기록인지·언제인지)는 마우스를 올리면 보인다. 모델을 고른 버전은 그 이름이 그대로이고 근거를 붙이지 않는다.
  expect(within(modelOf(/인물 대사\(act\)/)).getByTitle(/^1번 버전의 파이프라인 기록 · /)).toBeTruthy()
  expect(modelOf(/작품 질문 답변\(answer\)/).textContent).toBe('gpt-demo')
  expect(within(modelOf(/작품 질문 답변\(answer\)/)).queryByTitle(/파이프라인 기록/)).toBeNull()

  // 상세: 반영 중인 조합 요약에는 근거까지 글자로, 버전 표는 기본 모델 버전에만 근거를 붙이고 모델을 고른 버전(2~4번)은 그 이름이며, 새 조합의 기본 선택지도 같다.
  fireEvent.click(within(table).getByRole('button', { name: /인물 대사\(act\)/ }))
  const detail = await screen.findByRole('region', { name: '프롬프트 상세' })
  const live = await within(detail).findByRole('group', { name: '서비스 반영 중인 조합' })
  await waitFor(() => expect(live.textContent).toContain('기본 모델 · 최근 사용 gpt-demo-mini'))
  expect(live.textContent).toContain('(1번 버전의 파이프라인 기록 · ')
  const versions = await within(detail).findByRole('region', { name: '프롬프트 버전 표' })
  const modelCell = (version: number) => within(within(versions).getByRole('cell', { name: String(version) }).closest('tr') as HTMLElement).getAllByRole('cell')[2].textContent
  expect([1, 2, 3, 4].map(modelCell)).toEqual(['기본 모델 · 최근 사용 gpt-demo-mini', 'gpt-demo', 'gpt-demo', 'gpt-demo'])
  expect(within(versions).getAllByTitle(/파이프라인 기록/)).toHaveLength(1)   // 근거는 기본 모델 버전(1번)에만 붙고, 모델을 고른 버전에는 붙지 않는다
  expect([...within(detail).getByLabelText<HTMLSelectElement>('모델').options].map((option) => option.text)[0]).toBe('기본 모델 · 최근 사용 gpt-demo-mini')
})

it('서버가 실제 기본 모델(effectiveModel, #868)을 알려 주면 \'기본 모델 · gpt-…\'로 보이고 최근 사용 근거는 붙지 않으며, 못 알려 준(null) 프롬프트만 근거를 쓴다', async () => {
  renderAdmin('llm', 'prompts&sub=prompts')
  const table = await screen.findByRole('region', { name: '프롬프트 표' })
  const modelOf = (name: RegExp) => within(within(table).getByRole('button', { name }).closest('tr') as HTMLElement).getAllByRole('cell')[2]
  await waitFor(() => expect(modelOf(/나레이션·독백/).textContent).toBe('기본 모델 · gpt-demo'))
  expect(modelOf(/회차 심의\(assess\)/).textContent).toBe('기본 모델 · gpt-demo-mini')   // 파이프라인 기록이 없어도 서버가 알려 준다
  within(modelOf(/나레이션·독백/)).getByTitle('AI 서비스가 실제로 쓰는 기본 모델')
  expect(within(modelOf(/나레이션·독백/)).queryByTitle(/파이프라인 기록/)).toBeNull()
  expect(modelOf(/작가 요청 처리\(main\)/).textContent).toBe('기본 모델 · 최근 사용 gpt-demo')   // 서버가 못 알려 준 프롬프트는 근거를 쓴다
  // 상세: 반영 중인 조합 요약에는 출처를 글자로, 새 조합의 기본 선택지도 같은 모델이다.
  fireEvent.click(within(table).getByRole('button', { name: /나레이션·독백/ }))
  const detail = await screen.findByRole('region', { name: '프롬프트 상세' })
  const live = await within(detail).findByRole('group', { name: '서비스 반영 중인 조합' })
  expect(live.textContent).toContain('기본 모델 · gpt-demo')
  expect(live.textContent).toContain('(AI 서비스가 실제로 쓰는 기본 모델)')
  expect([...within(detail).getByLabelText<HTMLSelectElement>('모델').options].map((option) => option.text)[0]).toBe('기본 모델 · gpt-demo')
})

it('모델을 고른 버전이 남긴 기록은 기본 모델의 근거가 아니고, 기록을 읽지 못해도 이름을 지어내지 않는다(#857)', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  const record = (id: string, promptVersion: number, model: string) => ({ id, traceId: 't', name: 'n', type: 'GENERATION', level: 'DEFAULT', startTime: '2026-11-24T01:00:00Z', promptName: 'character_simulation.act', promptVersion, model })
  const records = vi.spyOn(llm, 'promptRecords').mockResolvedValue([record('a', 2, 'gpt-pinned')])
  renderAdmin('llm', 'prompts&sub=prompts')
  const table = await screen.findByRole('region', { name: '프롬프트 표' })
  const act = () => within(within(table).getByRole('button', { name: /인물 대사\(act\)/ }).closest('tr') as HTMLElement).getAllByRole('cell')[2].textContent
  await waitFor(() => expect(records).toHaveBeenCalled())
  expect(act()).toBe('기본 모델(환경 설정)')   // 2번 버전은 모델을 고른 버전이라 기본 모델의 근거가 아니다
  cleanup()
  records.mockRejectedValue(new Error('기록 조회 실패'))
  renderAdmin('llm', 'prompts&sub=prompts')
  const again = await screen.findByRole('region', { name: '프롬프트 표' })
  await waitFor(() => expect(records).toHaveBeenCalledTimes(2))
  expect(within(within(again).getByRole('button', { name: /인물 대사\(act\)/ }).closest('tr') as HTMLElement).getAllByRole('cell')[2].textContent).toBe('기본 모델(환경 설정)')
})

const cellsOf = (tr: HTMLElement) => within(tr).getAllByRole('cell').map((td) => td.textContent)
const jsonl = (...names: string[]) => names.map((name) => JSON.stringify({ input: { question: `${name} 질문` }, expectedOutput: '정답', metadata: { source: '시험' } })).join('\n')
const pickFile = (form: HTMLElement, name: string, text: string) => fireEvent.change(within(form).getByLabelText(/^JSONL 파일/), { target: { files: [new File([text], name)] } })
const openSets = async () => {
  renderAdmin('llm', 'prompts&sub=evals')
  const detail = await openLoop()
  fireEvent.click(stepOf(detail, '평가 세트'))
  return detail
}

it('② 평가 세트에는 평가 데이터셋 목록(세트 이름·짝 프롬프트·문항 수·설명)이 있고, 세트를 고르면 문항(id·요약)이 20개씩 쪽으로 나오며 본문은 접혀 있다(#868)', async () => {
  const detail = await openSets()
  const table = await within(panelOf(detail)).findByRole('region', { name: '평가 데이터셋 표' })
  expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['세트 이름', '짝 프롬프트', '문항 수', '설명'])
  const rows = within(table).getAllByRole('row').slice(1)
  const seeds = rows.map(cellsOf).filter((cells) => cells[3] === '저장소 시드(ai-eval-seed)')
  expect(seeds).toEqual([
    ['extraction.extract', '전처리 설정 추출 · 회차 설정 추출(extract) manuscript_extraction.extract', '30문항', '저장소 시드(ai-eval-seed)'],
    ['leak.spoiler', '—', '5문항', '저장소 시드(ai-eval-seed)'],
    ['qa.grounding', 'Q&A · 작품 질문 답변(answer) story_context.answer', '6문항', '저장소 시드(ai-eval-seed)'],
    ['simulation.act', '인물 시뮬레이션 · 인물 대사(act) character_simulation.act', '24문항', '저장소 시드(ai-eval-seed)'],
    ['simulation.narrate', '인물 시뮬레이션 · 나레이션·독백(narrate) character_simulation.narrate', '46문항', '저장소 시드(ai-eval-seed)'],
    ['world.conflict', '—', '5문항', '저장소 시드(ai-eval-seed)'],
    ['writing.fix', '—', '5문항', '저장소 시드(ai-eval-seed)'],
  ])
  expect(within(panelOf(detail)).queryByRole('region', { name: 'simulation.act 문항' })).toBeNull()
  fireEvent.click(within(table).getByRole('button', { name: 'simulation.act' }))
  const items = await within(panelOf(detail)).findByRole('region', { name: 'simulation.act 문항' })
  const list = () => within(items).getAllByRole('listitem')
  expect(list()).toHaveLength(20)   // 한 쪽 20개
  expect(within(items).getByRole('navigation', { name: '쪽 이동' }).textContent).toContain('전체 24건 · 1/2쪽')
  expect(within(list()[0]).getByRole('button', { name: 'simulation.act-01' }).getAttribute('aria-expanded')).toBe('false')
  expect(list()[0].textContent).toContain('simulation.act 문항 01의 입력')   // 한 줄 요약
  expect(list()[0].querySelector('pre')).toBeNull()   // 본문은 접혀 있다
  fireEvent.click(within(list()[0]).getByRole('button', { name: 'simulation.act-01' }))
  expect(list()[0].querySelector('pre')?.textContent).toContain('"expectedOutput": "simulation.act 문항 01의 기대 답변(시연용)"')
  fireEvent.click(within(list()[0]).getByRole('button', { name: 'simulation.act-01' }))
  expect(list()[0].querySelector('pre')).toBeNull()
  // 다음 쪽(21~24번)으로 넘기고, 같은 세트를 다시 누르면 문항 목록이 접힌다.
  fireEvent.click(within(items).getByRole('button', { name: '다음' }))
  await waitFor(() => expect(list().map((li) => li.querySelector('button')?.textContent)).toEqual(['simulation.act-21', 'simulation.act-22', 'simulation.act-23', 'simulation.act-24']))
  fireEvent.click(within(table).getByRole('button', { name: 'simulation.act' }))
  expect(within(panelOf(detail)).queryByRole('region', { name: 'simulation.act 문항' })).toBeNull()
})

it('JSONL 업로드는 올릴 세트(목록의 세트, 프롬프트의 짝 세트가 처음 골라짐)와 .jsonl만 받고, 고르면 건수·첫 항목·오류 줄·크기 제한을 미리 보이며, 오류가 있거나 저작권 확인이 없으면 올릴 수 없다(#868)', async () => {
  const upload = vi.spyOn(appContainer.resolve('llmDatasetRepository'), 'upload')
  const detail = await openSets()
  const form = await within(panelOf(detail)).findByRole('form', { name: 'JSONL 업로드' })
  const target = await within(form).findByLabelText<HTMLSelectElement>('올릴 세트')
  await waitFor(() => expect([...target.options].map((o) => o.value)).toEqual(['extraction.extract', 'leak.spoiler', 'qa.grounding', 'simulation.act', 'simulation.narrate', 'world.conflict', 'writing.fix']))
  expect(target.value).toBe('simulation.act')   // 이 프롬프트의 짝 세트
  const submit = within(form).getByRole('button', { name: '업로드' }) as HTMLButtonElement
  const check = within(form).getByRole('checkbox', { name: /저작권 있는 원문\(웹소설·해리 포터 등\)이 아님/ }) as HTMLInputElement
  expect([check.required, check.checked, submit.disabled]).toEqual([true, false, true])
  // .jsonl이 아니면 읽지도 않고 안내한다.
  pickFile(form, 'items.csv', 'a,b')
  expect((await within(form).findByRole('alert')).textContent).toBe('.jsonl 파일만 올릴 수 있어요.')
  expect(within(form).queryByLabelText('업로드 미리보기')).toBeNull()
  // 통과한 파일: 건수와 첫 항목을 보인다. 저작권 확인이 없으면 아직 올릴 수 없다.
  pickFile(form, 'my-set.jsonl', jsonl('a', 'b', 'c'))
  const preview = within(await within(form).findByLabelText('업로드 미리보기'))
  preview.getByText('my-set.jsonl')
  expect(preview.getByRole('status').textContent).toContain('줄 3개 중 3개 통과')
  expect(preview.getByText(/"question": "a 질문"/).tagName).toBe('PRE')
  expect(within(form).queryByRole('alert')).toBeNull()
  expect(submit.disabled).toBe(true)
  fireEvent.click(check)
  expect(submit.disabled).toBe(false)
  // 오류 줄이 있으면 줄 번호와 이유를 보이고(처음 5줄만, 나머지는 건수) 올릴 수 없다.
  const broken = [jsonl('ok'), '{not json', JSON.stringify({ id: 'x', input: 1 }), ...Array.from({ length: 5 }, () => JSON.stringify({ input: null }))].join('\n')
  pickFile(form, 'broken.jsonl', broken)
  const errors = within(await within(form).findByLabelText('업로드 미리보기'))
  expect(errors.getByRole('status').textContent).toContain('줄 8개 중 1개 통과 · 오류 7줄')
  expect(errors.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    '2번째 줄 · JSON으로 읽을 수 없어요.', '3번째 줄 · 알 수 없는 칸이 있어요: id', '4번째 줄 · input이 필요해요.', '5번째 줄 · input이 필요해요.', '6번째 줄 · input이 필요해요.', '…외 2줄',
  ])
  expect(submit.disabled).toBe(true)
  // 500줄을 넘으면 크기 제한을 알리고 올릴 수 없다.
  pickFile(form, 'big.jsonl', Array.from({ length: 501 }, () => JSON.stringify({ input: 'q', expectedOutput: 'a' })).join('\n'))
  const big = within(await within(form).findByLabelText('업로드 미리보기'))
  expect((await big.findByRole('alert')).textContent).toBe('줄이 501개라 너무 많아요. 500줄·2MB까지 올릴 수 있으니 나눠서 올려 주세요.')
  expect(submit.disabled).toBe(true)
  expect(upload).not.toHaveBeenCalled()
})

it('서버 규칙대로 input만 있는 줄도 올릴 수 있고(expectedOutput·metadata는 선택), 안내 문구가 같은 규칙을 말한다(#868)', async () => {
  const detail = await openSets()
  const form = await within(panelOf(detail)).findByRole('form', { name: 'JSONL 업로드' })
  pickFile(form, 'min.jsonl', [JSON.stringify({ input: '질문만' }), JSON.stringify({ input: { q: 2 }, expectedOutput: null })].join('\n'))
  const preview = within(await within(form).findByLabelText('업로드 미리보기'))
  expect(preview.getByRole('status').textContent).toContain('줄 2개 중 2개 통과')
  expect(within(form).queryByRole('alert')).toBeNull()
  expect(form.textContent).toMatch(/input만 필수/)
  expect(form.textContent).toMatch(/문항 id\(서버가 붙여요\)를 비롯한 다른 칸은 오류/)
})

it('UTF-8이 아닌 파일은 미리보기 없이 안내한다: 서버는 UTF-8만 받고, 느슨하게 읽어 보내면 깨진 글자(�)가 평가 데이터에 저장된다(#868)', async () => {
  const detail = await openSets()
  const form = await within(panelOf(detail)).findByRole('form', { name: 'JSONL 업로드' })
  fireEvent.change(within(form).getByLabelText(/^JSONL 파일/), { target: { files: [new File([new Uint8Array([0x7b, 0xb1, 0xc2, 0x7d])], 'euc-kr.jsonl')] } })
  expect((await within(form).findByRole('alert')).textContent).toBe('UTF-8 텍스트 파일이 아니에요. UTF-8로 저장한 .jsonl 파일을 골라 주세요.')
  expect(within(form).queryByLabelText('업로드 미리보기')).toBeNull()
  pickFile(form, 'ok.jsonl', jsonl('a'))
  await within(form).findByLabelText('업로드 미리보기')
  expect(within(form).queryByRole('alert')).toBeNull()   // UTF-8 파일을 다시 고르면 안내가 지워진다
})

it('파일을 연달아 고르면 마지막에 고른 파일의 읽기 결과만 미리보기에 반영한다: 늦게 끝난 앞 파일이 덮어쓰지 않는다(#857)', async () => {
  const detail = await openSets()
  const form = await within(panelOf(detail)).findByRole('form', { name: 'JSONL 업로드' })
  const bytes = (text: string) => new TextEncoder().encode(text).buffer
  let finishFirst: (text: string) => void = () => {}
  const first = new File([''], 'first.jsonl')
  Object.defineProperty(first, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>((resolve) => { finishFirst = (text) => resolve(bytes(text)) }) })   // 첫 파일은 읽기가 오래 걸린다
  fireEvent.change(within(form).getByLabelText(/^JSONL 파일/), { target: { files: [first] } })
  pickFile(form, 'second.jsonl', jsonl('b-1'))
  const preview = await within(form).findByLabelText('업로드 미리보기')
  expect(preview.textContent).toContain('second.jsonl')
  await act(async () => { finishFirst(jsonl('a-1', 'a-2')) })
  expect(within(form).getByLabelText('업로드 미리보기').textContent).toContain('second.jsonl · 줄 1개 중 1개 통과')
  expect(within(form).queryByText('first.jsonl')).toBeNull()
  // 오래 걸린 읽기가 실패해도 새 선택에 오류를 남기지 않는다.
  const failing = new File([''], 'failing.jsonl')
  let failFirst: (error: Error) => void = () => {}
  Object.defineProperty(failing, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>((_, reject) => { failFirst = reject }) })
  fireEvent.change(within(form).getByLabelText(/^JSONL 파일/), { target: { files: [failing] } })
  pickFile(form, 'third.jsonl', jsonl('c-1'))
  await within(form).findByText('third.jsonl')
  await act(async () => { failFirst(new Error('읽기 실패')) })
  expect(within(form).queryByRole('alert')).toBeNull()
})

it('검사를 통과한 파일은 고른 세트에 올라가 서버가 만든 문항 수를 알리고, 그 세트의 문항 수가 늘고 문항이 보이며, 올린 뒤 폼은 비워진다(#868)', async () => {
  const detail = await openSets()
  const form = await within(panelOf(detail)).findByRole('form', { name: 'JSONL 업로드' })
  const target = await within(form).findByLabelText<HTMLSelectElement>('올릴 세트')
  await waitFor(() => expect(target.options.length).toBe(7))
  fireEvent.change(target, { target: { value: 'leak.spoiler' } })
  pickFile(form, 'upload-me.jsonl', jsonl('x-1', 'x-2'))
  await within(form).findByLabelText('업로드 미리보기')
  fireEvent.click(within(form).getByRole('checkbox', { name: /저작권 있는 원문/ }))
  fireEvent.click(within(form).getByRole('button', { name: '업로드' }))
  await within(form).findByText("2개 문항을 'leak.spoiler' 세트에 올렸어요.")
  const table = within(panelOf(detail)).getByRole('region', { name: '평가 데이터셋 표' })
  await waitFor(() => expect(within(table).getAllByRole('row').slice(1).map(cellsOf).find((cells) => cells[0] === 'leak.spoiler')).toEqual(['leak.spoiler', '—', '7문항', '저장소 시드(ai-eval-seed)']))
  // 올린 세트가 골라져 문항 목록이 보이고(마지막 두 개가 방금 올린 문항), 폼은 비워지며 올리기는 다시 잠긴다.
  const items = await within(panelOf(detail)).findByRole('region', { name: 'leak.spoiler 문항' })
  expect(within(items).getAllByRole('listitem').map((li) => li.querySelector('button')?.textContent).slice(-2)).toEqual(['leak.spoiler-06', 'leak.spoiler-07'])
  expect([(within(form).getByRole('checkbox', { name: /저작권 있는 원문/ }) as HTMLInputElement).checked, within(form).queryByLabelText('업로드 미리보기')]).toEqual([false, null])
  expect((within(form).getByRole('button', { name: '업로드' }) as HTMLButtonElement).disabled).toBe(true)
})

it('올렸다는 문구는 올리기 전 미리보기 건수가 아니라 서버가 돌려준 문항 수를 쓴다(#868)', async () => {
  vi.spyOn(appContainer.resolve('llmDatasetRepository'), 'upload').mockResolvedValue(3)
  const detail = await openSets()
  const form = await within(panelOf(detail)).findByRole('form', { name: 'JSONL 업로드' })
  await waitFor(() => expect((within(form).getByLabelText('올릴 세트') as HTMLSelectElement).options.length).toBe(7))
  pickFile(form, 'a.jsonl', jsonl('a', 'b'))
  await within(form).findByLabelText('업로드 미리보기')
  fireEvent.click(within(form).getByRole('checkbox', { name: /저작권 있는 원문/ }))
  fireEvent.click(within(form).getByRole('button', { name: '업로드' }))
  await within(form).findByText("3개 문항을 'simulation.act' 세트에 올렸어요.")
})

it('올릴 세트는 늘 목록에 있는 세트다: 프롬프트의 짝 세트가 목록에 없고 세트가 하나뿐이어도 그 세트로 올라가, 파일과 저작권 확인만으로 올릴 수 있다(#868)', async () => {
  const repo = appContainer.resolve('llmDatasetRepository')
  vi.spyOn(repo, 'datasets').mockResolvedValue([{ name: 'only.set', prompt: null, itemCount: 1, description: null }])
  const upload = vi.spyOn(repo, 'upload').mockResolvedValue(1)
  const detail = await openSets()
  const form = await within(panelOf(detail)).findByRole('form', { name: 'JSONL 업로드' })
  const target = await within(form).findByLabelText<HTMLSelectElement>('올릴 세트')
  await waitFor(() => expect(target.options.length).toBe(1))
  pickFile(form, 'a.jsonl', jsonl('a'))
  await within(form).findByLabelText('업로드 미리보기')
  fireEvent.click(within(form).getByRole('checkbox', { name: /저작권 있는 원문/ }))
  fireEvent.click(within(form).getByRole('button', { name: '업로드' }))
  await within(form).findByText("1개 문항을 'only.set' 세트에 올렸어요.")   // 짝 세트(simulation.act)가 목록에 없어도 목록의 세트로 간다
  expect(upload.mock.calls[0][0]).toBe('only.set')
})

it('서버가 거절하면(400 DATASET_INVALID) 거절된 줄을 보이고 아무것도 올라가지 않았다고 알리며 입력은 유지하고, 새 파일을 고르면 거절 표시를 지운다(#868)', async () => {
  const errors = [{ line: 2, message: '서버 검사: input 형식이 맞지 않아요.' }, { line: 7, message: '서버 검사: metadata가 너무 커요.' }]
  vi.spyOn(appContainer.resolve('llmDatasetRepository'), 'upload').mockRejectedValue(new DatasetInvalid(errors))
  const detail = await openSets()
  const form = await within(panelOf(detail)).findByRole('form', { name: 'JSONL 업로드' })
  await waitFor(() => expect((within(form).getByLabelText('올릴 세트') as HTMLSelectElement).options.length).toBe(7))
  pickFile(form, 'a.jsonl', jsonl('a', 'b'))
  await within(form).findByLabelText('업로드 미리보기')
  fireEvent.click(within(form).getByRole('checkbox', { name: /저작권 있는 원문/ }))
  fireEvent.click(within(form).getByRole('button', { name: '업로드' }))
  expect((await within(form).findByRole('alert', { name: '' })).textContent).toContain('형식이 맞지 않는 줄이 2개 있어요. 고친 뒤 다시 올려 주세요.')
  const rejected = within(await within(form).findByLabelText('서버가 거절한 줄'))
  expect(rejected.getByText('서버가 거절한 줄(아무것도 올라가지 않았어요)')).toBeTruthy()
  expect(rejected.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['2번째 줄 · 서버 검사: input 형식이 맞지 않아요.', '7번째 줄 · 서버 검사: metadata가 너무 커요.'])
  expect(within(form).getByLabelText('업로드 미리보기').textContent).toContain('a.jsonl')   // 입력은 유지한다
  pickFile(form, 'b.jsonl', jsonl('c'))
  await within(form).findByText('b.jsonl')
  expect(within(form).queryByLabelText('서버가 거절한 줄')).toBeNull()
})

it('크레딧 탭은 회원을 고르면 상세 제목으로 초점을 옮기고, 같은 회원을 목록에서 다시 골라도 제목으로 되돌린다', async () => {
  await openMemberCredits()
  const heading = () => screen.getByRole('heading', { name: '연화봉러 님의 크레딧' })
  await waitFor(() => expect(document.activeElement).toBe(heading()))
  // 스크롤해 목록으로 올라와 같은 회원을 다시 고르면, 메뉴가 닫히며 초점이 ⋮로 돌아간 채 남지 않고 제목으로 간다.
  const row = screen.getByText('연화봉러', { selector: 'b' }).closest('tr') as HTMLElement
  fireEvent.click(openRowMenu(row).getByRole('menuitem', { name: '크레딧 보기·조정' }))
  expect(document.activeElement).toBe(heading())
})

// 이 파일의 다른 테스트가 데모 조치를 남기지 않으므로 마지막에 둡니다(픽스처 DB는 파일 안에서 공유됩니다).
it('픽스처(데모) 컨테이너에서는 데모 관리자 조치가 활동 로그에 남는다', async () => {
  const admin = appContainer.resolve('adminUseCase')
  const { chats: [chat] } = await admin.load()
  await admin.toggleChat(chat.id)
  renderAdmin('audit')
  await waitFor(() => expect(activityRows()).toHaveLength(1))
  within(activityRows()[0]).getByText('캐릭터챗 중지', { selector: 'b' })
  within(activityRows()[0]).getByText('수행자 관리자 · 대상 데모')
  within(activityRows()[0]).getByText(`${chat.w.title} · ${chat.character}`)
})

it('프롬프트 표는 에이전트별 서비스 반영 버전·모델·후보 수·코드 시드 대기를, 상세는 반영 중인 조합 요약과 버전별 상태·모델, 반영 중인 본문·모델로 채운 조합 폼을 보인다(#705)', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  vi.spyOn(llm, 'prompts').mockResolvedValue([
    // 목록은 production·seed 버전만 주고 후보 수는 따로 센다(#786).
    { name: 'orchestration.main', versions: [{ version: 3, labels: ['seed', 'latest'] }, { version: 2, labels: ['production'], model: 'gpt-x' }], candidates: 1 },
    { name: 'decision_guard.judge', versions: [{ version: 1, labels: ['production', 'seed'] }], candidates: 0 },
  ])
  vi.spyOn(llm, 'prompt').mockResolvedValue({ name: 'orchestration.main', candidates: 1, models: ['gpt-y', 'gpt-x'], versions: [
    { version: 4, labels: ['candidate-4'], model: 'gpt-y', prompt: '운영 지시' }, { version: 3, labels: ['seed', 'latest'], prompt: '새 시드' },
    { version: 2, labels: ['production'], model: 'gpt-x', prompt: '운영 지시' }] })
  // Langfuse 모델 정의(단가표)에는 AI가 부를 수 없는 모델도 있어 선택지가 아니다(#806).
  vi.spyOn(llm, 'models').mockResolvedValue([{ id: 'm9', modelName: 'claude-sonnet-5-5', matchPattern: 'c' }])
  const create = vi.spyOn(llm, 'createPromptVersion').mockResolvedValue(undefined)
  // 파이프라인 기록에 근거가 없는 경우(기본 모델 이름을 지어내지 않는다): 근거가 있는 경우는 아래 테스트가 본다(#857).
  vi.spyOn(llm, 'promptRecords').mockResolvedValue([])
  renderAdmin('llm', 'prompts&sub=prompts')

  const table = await screen.findByRole('region', { name: '프롬프트 표' })
  const cells = (name: RegExp) => [...(within(table).getByRole('button', { name }).closest('tr') as HTMLElement).querySelectorAll('td')].map((td) => td.textContent)
  expect(cells(/작가 요청 처리\(main\)/)).toEqual(['메인 에이전트 · 작가 요청 처리(main) orchestration.main', '2번 버전', 'gpt-x', '1개', '코드 시드 3번 버전 대기'])
  expect(cells(/요청 판정\(judge\)/)).toEqual(['Decision Guard · 요청 판정(judge) decision_guard.judge', '1번 버전', '기본 모델(환경 설정)', '—', '—'])   // 기록에 근거가 없으면 이름을 단정하지 않는다(#808)
  fireEvent.click(within(table).getByRole('button', { name: /작가 요청 처리\(main\)/ }))

  const detail = await screen.findByRole('region', { name: '프롬프트 상세' })
  const live = await within(detail).findByRole('group', { name: '서비스 반영 중인 조합' })
  expect(live.textContent).toContain('2번 버전')
  expect(live.textContent).toContain('gpt-x')
  within(detail).getByText(/코드 시드\(3번 버전\)가 서비스 반영 중인 본문과 달라요/)
  const versions = within(detail).getByRole('region', { name: '프롬프트 버전 표' })
  expect(within(versions).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['버전', '상태', '모델', '등록'])
  const row = (version: number) => within(versions).getByRole('cell', { name: String(version) }).closest('tr') as HTMLElement
  expect([within(row(4)).getByText('후보'), within(row(3)).getByText('코드 시드'), within(row(2)).getByText('서비스 반영 중')]).toHaveLength(3)
  expect(within(row(3)).queryByText('latest')).toBeNull()   // Langfuse가 관리하는 라벨은 숨긴다
  within(row(3)).getByRole('cell', { name: '기본 모델(환경 설정)' })
  // 후보 등록은 ⑤ 게이트, 서비스 반영은 ⑥ 서비스 반영 단계의 버튼이다(① 표에는 버튼이 없다).
  expect(within(versions).queryByRole('button')).toBeNull()
  fireEvent.click(within(detail).getByRole('button', { name: '게이트' }))
  const gate = await within(detail).findByRole('region', { name: '평가 게이트 버전 표' })
  const gateRow = (version: number) => within(within(gate).getByRole('cell', { name: String(version) }).closest('tr') as HTMLElement)
  gateRow(4).getByText('후보 등록됨')
  gateRow(3).getByRole('button', { name: 'orchestration.main 3번 버전 후보 등록' })
  gateRow(2).getByText('반영 중')
  fireEvent.click(within(detail).getByRole('button', { name: '서비스 반영' }))
  const serve = await within(detail).findByRole('region', { name: '서비스 반영 버전 표' })
  const serveRow = (version: number) => within(within(serve).getByRole('cell', { name: String(version) }).closest('tr') as HTMLElement)
  serveRow(4).getByRole('button', { name: 'orchestration.main 4번 버전 서비스에 반영' })
  expect([serveRow(3).queryByRole('button'), serveRow(2).queryByRole('button')]).toEqual([null, null])
  fireEvent.click(within(detail).getByRole('button', { name: '프롬프트' }))

  expect((await within(detail).findByLabelText('프롬프트 본문') as HTMLTextAreaElement).value).toBe('운영 지시')
  const model = within(detail).getByLabelText('모델') as HTMLSelectElement
  expect([...model.options].map((o) => [o.value, o.text])).toEqual([['', '기본 모델(환경 설정)'], ['gpt-x', 'gpt-x'], ['gpt-y', 'gpt-y']])
  expect(model.value).toBe('gpt-x')
  fireEvent.change(model, { target: { value: 'gpt-y' } })
  fireEvent.click(within(detail).getByRole('button', { name: '조합 저장' }))
  await waitFor(() => expect(create).toHaveBeenCalledWith('orchestration.main', '운영 지시', '', 'gpt-y'))
})

it('후보 등록과 서비스 반영은 그 버전 행의 버튼으로 하고, 반영은 확인을 받는다(#705)', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  vi.spyOn(llm, 'prompts').mockResolvedValue([{ name: 'qa', versions: [{ version: 1, labels: ['production'] }], candidates: 1 }])
  let promoted = false
  vi.spyOn(llm, 'prompt').mockImplementation(async () => ({ name: 'qa', candidates: 1, versions: [
    { version: 3, labels: [], prompt: '셋' }, { version: 2, labels: promoted ? ['candidate-2', 'production'] : ['candidate-2'], prompt: '둘' },
    { version: 1, labels: promoted ? [] : ['production'], prompt: '하나' }] }))
  vi.spyOn(llm, 'models').mockResolvedValue([])
  const candidate = vi.spyOn(llm, 'candidate').mockResolvedValue(undefined)
  const promote = vi.spyOn(llm, 'promote').mockImplementation(async () => { promoted = true })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  renderAdmin('llm', 'prompts&sub=prompts')
  fireEvent.click(await screen.findByRole('button', { name: 'qa' }))

  // 후보 등록은 ⑤ 게이트, 서비스 반영은 ⑥ 서비스 반영 단계에서 그 버전 행의 버튼으로 한다.
  fireEvent.click(await screen.findByRole('button', { name: '게이트' }))
  fireEvent.click(await screen.findByRole('button', { name: 'qa 3번 버전 후보 등록' }))
  await waitFor(() => expect(candidate).toHaveBeenCalledWith('qa', 3))
  fireEvent.click(screen.getByRole('button', { name: '서비스 반영' }))
  fireEvent.click(await screen.findByRole('button', { name: 'qa 2번 버전 서비스에 반영' }))
  expect(promote).not.toHaveBeenCalled()   // 확인 창에서 취소
  fireEvent.click(screen.getByRole('button', { name: 'qa 2번 버전 서비스에 반영' }))
  await waitFor(() => expect(promote).toHaveBeenCalledWith('qa', 2))
  expect(confirm).toHaveBeenCalledTimes(2)
  // 반영하면 그 행의 버튼이 사라지므로 초점은 상세 제목으로 옮긴다(키보드 위치를 잃지 않게).
  await waitFor(() => expect(screen.queryByRole('button', { name: 'qa 2번 버전 서비스에 반영' })).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'qa' })))
})

it('한 프롬프트에서 한 조치의 결과 안내는 다른 프롬프트 상세에 남지 않는다', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  vi.spyOn(llm, 'prompts').mockResolvedValue([{ name: 'qa', versions: [{ version: 1, labels: ['production'] }], candidates: 0 }, { name: 'other', versions: [{ version: 1, labels: ['production'] }], candidates: 0 }])
  vi.spyOn(llm, 'prompt').mockImplementation(async (name: string) => ({ name, candidates: 0, versions: [{ version: 2, labels: [], prompt: '둘' }, { version: 1, labels: ['production'], prompt: '하나' }] }))
  vi.spyOn(llm, 'models').mockResolvedValue([])
  vi.spyOn(llm, 'candidate').mockResolvedValue(undefined)
  renderAdmin('llm', 'prompts&sub=prompts')
  fireEvent.click(await screen.findByRole('button', { name: 'qa' }))
  fireEvent.click(await screen.findByRole('button', { name: '게이트' }))
  fireEvent.click(await screen.findByRole('button', { name: 'qa 2번 버전 후보 등록' }))
  const detail = await screen.findByRole('region', { name: '프롬프트 상세' })
  await within(detail).findByText(/qa 2번 버전을 후보로 등록했어요/)
  fireEvent.click(within(detail).getByRole('button', { name: '프롬프트 목록으로' }))
  fireEvent.click(await screen.findByRole('button', { name: 'other' }))
  await screen.findByRole('heading', { name: 'other' })
  expect(within(screen.getByRole('region', { name: '프롬프트 상세' })).queryByText(/qa 2번 버전을 후보로 등록했어요/)).toBeNull()
})

it('평가 세트가 있는 프롬프트의 상세는 후보 등록 조건을 안내한다(#787)', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  vi.spyOn(llm, 'prompts').mockResolvedValue([{ name: 'story_context.answer', candidates: 0, evaluationDataset: 'qa.grounding', versions: [{ version: 1, labels: ['production'] }] }])
  vi.spyOn(llm, 'prompt').mockResolvedValue({ name: 'story_context.answer', candidates: 0, evaluationDataset: 'qa.grounding', versions: [{ version: 1, labels: ['production'], prompt: '답' }] })
  vi.spyOn(llm, 'models').mockResolvedValue([])
  renderAdmin('llm', 'prompts&sub=prompts')
  fireEvent.click(await screen.findByRole('button', { name: /작품 질문 답변\(answer\)/ }))
  const region = await screen.findByRole('region', { name: '프롬프트 상세' })
  fireEvent.click(await within(region).findByRole('button', { name: '게이트' }))
  await within(region).findByText('후보 등록 조건: 평가 세트 qa.grounding의 회귀 평가를 통과해야 해요(그 버전의 가장 최근 평가 기준).')
})

it('평가 세트가 있는 프롬프트는 통과하지 않은 버전에 후보 등록 대신 이유를 보인다(#787)', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  vi.spyOn(llm, 'prompts').mockResolvedValue([{ name: 'story_context.answer', candidates: 0, evaluationDataset: 'qa.grounding', versions: [{ version: 1, labels: ['production'] }] }])
  vi.spyOn(llm, 'prompt').mockResolvedValue({ name: 'story_context.answer', candidates: 0, evaluationDataset: 'qa.grounding', versions: [
    { version: 3, labels: [], prompt: '셋', evaluation: { runId: 'r3', passed: true, createdAt: '2026-11-19T00:00:00Z' } },
    { version: 2, labels: [], prompt: '둘' },
    { version: 1, labels: ['production'], prompt: '답' }] })
  vi.spyOn(llm, 'models').mockResolvedValue([])
  renderAdmin('llm', 'prompts&sub=prompts')
  fireEvent.click(await screen.findByRole('button', { name: /작품 질문 답변\(answer\)/ }))
  fireEvent.click(await screen.findByRole('button', { name: '게이트' }))
  await screen.findByRole('button', { name: 'story_context.answer 3번 버전 후보 등록' })
  expect(screen.queryByRole('button', { name: 'story_context.answer 2번 버전 후보 등록' })).toBeNull()
  screen.getByText('평가 통과 후 가능')
})

it('Decisions API로 부르는 프롬프트는 새 버전에서 모델을 고를 수 없다', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  vi.spyOn(llm, 'prompt').mockResolvedValue({ name: 'decision_guard.judge', candidates: 0, versions: [{ version: 1, labels: ['production', 'seed'], prompt: '판정' }] })
  vi.spyOn(llm, 'prompts').mockResolvedValue([{ name: 'decision_guard.judge', candidates: 0, versions: [{ version: 1, labels: ['production', 'seed'] }] }])
  renderAdmin('llm', 'prompts&sub=prompts')
  fireEvent.click(await screen.findByRole('button', { name: /요청 판정\(judge\)/ }))
  const detail = await screen.findByRole('region', { name: '프롬프트 상세' })
  expect((await within(detail).findByLabelText('모델') as HTMLSelectElement).disabled).toBe(true)
  within(detail).getByText('Decisions API가 gpt-6-luna만 지원해 모델은 고정이에요. 프롬프트만 바꿀 수 있어요.')
  expect(within(detail).queryByText(/코드 시드\(/)).toBeNull()
  expect(within(detail).queryByText(/후보 등록 조건/)).toBeNull()   // 평가 세트가 없는 프롬프트
})

it('반영 중인 모델은 고를 수 있는 목록에 없어도 선택지에 남는다(#806)', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  vi.spyOn(llm, 'prompts').mockResolvedValue([{ name: 'qa', candidates: 0, versions: [{ version: 1, labels: ['production'], model: 'gpt-old' }] }])
  vi.spyOn(llm, 'prompt').mockResolvedValue({ name: 'qa', candidates: 0, models: ['gpt-6-luna'], versions: [{ version: 1, labels: ['production'], model: 'gpt-old', prompt: '지시' }] })
  vi.spyOn(llm, 'models').mockResolvedValue([])
  renderAdmin('llm', 'prompts&sub=prompts')
  fireEvent.click(await screen.findByRole('button', { name: 'qa' }))
  const model = await screen.findByLabelText('모델') as HTMLSelectElement
  expect([...model.options].map((o) => o.value)).toEqual(['', 'gpt-old', 'gpt-6-luna'])
  expect(model.value).toBe('gpt-old')
})

it('버전 표의 각 행에서 그 버전의 본문과 변경 메모를 펼쳐 본다(#807)', async () => {
  const llm = appContainer.resolve('llmOpsUseCase')
  vi.spyOn(llm, 'prompts').mockResolvedValue([{ name: 'qa', candidates: 0, versions: [{ version: 1, labels: ['production'] }] }])
  vi.spyOn(llm, 'prompt').mockResolvedValue({ name: 'qa', candidates: 0, versions: [
    { version: 2, labels: [], prompt: '새 지시', commitMessage: '말투 고침' }, { version: 1, labels: ['production'], prompt: '옛 지시' }] })
  vi.spyOn(llm, 'models').mockResolvedValue([])
  renderAdmin('llm', 'prompts&sub=prompts')
  fireEvent.click(await screen.findByRole('button', { name: 'qa' }))
  const versions = await screen.findByRole('region', { name: '프롬프트 버전 표' })
  const body = within(versions).getByText('2번 버전 본문 · 말투 고침').closest('details') as HTMLDetailsElement
  expect(body.open).toBe(false)
  expect(body.querySelector('pre')?.textContent).toBe('새 지시')
  expect(within(versions).getByText('1번 버전 본문').closest('details')?.querySelector('pre')?.textContent).toBe('옛 지시')
})
