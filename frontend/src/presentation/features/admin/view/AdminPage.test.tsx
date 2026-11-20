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
import type { AdminActivity } from '../../../../domain/entities/adminActivity'
import type { OperationsComment } from '../../../../domain/entities/operationsComment'
import type { OperationsWork } from '../../../../domain/entities/operationsWork'
import { AdminActivityUseCase } from '../../../../domain/usecases/AdminActivityUseCase'
import { OperationsCommentUseCase } from '../../../../domain/usecases/OperationsCommentUseCase'
import { OperationsWorkUseCase } from '../../../../domain/usecases/OperationsWorkUseCase'
import { kstDateTime } from '../../../shared/format'
import { AdminPage } from './AdminPage'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.title = 'STORYFORK' })

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

// users·admins·rights 표는 운영 API 응답이 있어야 그려지므로(rights는 이 환경에서 유일하던 예시 격리 점검 표를 지웠다), notices·events는 표 없이 목록 패널만 그리므로, data(관리 개요)는 표 없이 숫자 카드와 차트만 그리므로(아래 별도 테스트) 렌더 통합 대상에서 뺍니다.
it.each(['llm', 'works', 'characterChats', 'comments', 'feedback', 'jobs', 'credits'])(
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

// 관리 개요는 표가 아니라 숫자 카드와 차트라, 표의 캡션·열 머리 범위 대신 카드의 이름·값 글자와 차트의 캡션·role=img·요약 aria-label로 읽힙니다.
it('data 탭의 숫자 카드는 이름과 값을 글자로 갖고 차트는 캡션과 role=img 요약 aria-label을 갖는다', async () => {
  renderAdmin('data')
  await waitFor(() => {
    expect(document.querySelectorAll('.kpi > div').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.admin-chart').length).toBeGreaterThan(0)
  })
  for (const card of document.querySelectorAll('.kpi > div')) {
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
  expect((within(row).getByRole('button', { name: '연화봉러 이용 제한' }) as HTMLButtonElement).disabled).toBe(false)
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
  expect(cells(open)).toEqual(['달빛 도서관', '연화', '원작', '원작 · 권리 확인됨', '공개', '운영 제한'])
  expect(cells(fork)).toEqual(['달빛 도서관 외전', '하늘', '포크', '외부 2차 창작 · 권리 미확인', '비공개', '운영 제한포크 정합성 점검'])

  // 제한은 확인을 거쳐야 보내고, 취소하면 요청도 목록 재조회도 없다.
  fireEvent.click(within(open).getByRole('button', { name: '「달빛 도서관」 운영 제한' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(requests()).toEqual(['GET /api/v1/operations/works'])
  confirm.mockReturnValue(true)
  fireEvent.click(within(open).getByRole('button', { name: '「달빛 도서관」 운영 제한' }))
  await within(open).findByRole('button', { name: '「달빛 도서관」 제한 해제' })
  expect(requests()).toEqual(['GET /api/v1/operations/works', 'PUT /api/v1/operations/works/w-open/restriction', 'GET /api/v1/operations/works'])
  expect(cells(open)[4]).toBe('운영 제한')
  expect(within(open).getByText('운영 제한', { selector: '.chip' }).className).toContain('wait')
  expect(within(fork).getByRole('button', { name: '「달빛 도서관 외전」 운영 제한' })).toBeTruthy()
  // 완료 안내는 화면 위 한 줄에 대상 이름과 함께 한 번만 보인다(같은 문구를 조치 상태 줄로 또 그리지 않는다).
  const done = screen.getAllByText('작품을 운영 제한했어요.')
  expect(done).toHaveLength(1)
  expect(done[0].getAttribute('role')).toBe('status')
  expect(done[0].textContent).toBe('「달빛 도서관」 · 작품을 운영 제한했어요.')

  // 해제는 확인 없이 보내고 목록을 다시 읽어 공개 상태로 돌아온다.
  confirm.mockClear()
  fireEvent.click(within(open).getByRole('button', { name: '「달빛 도서관」 제한 해제' }))
  await within(open).findByRole('button', { name: '「달빛 도서관」 운영 제한' })
  expect(confirm).not.toHaveBeenCalled()
  expect(requests().slice(3)).toEqual(['DELETE /api/v1/operations/works/w-open/restriction', 'GET /api/v1/operations/works'])
  expect(cells(open)[4]).toBe('공개')

  // 서버(Content) 실패는 성공으로 바꾸지 않고 오류를 보이며 목록도 다시 읽지 않는다.
  failRestriction = true
  fireEvent.click(within(fork).getByRole('button', { name: '「달빛 도서관 외전」 운영 제한' }))
  // 실패 안내는 어느 작품의 조치인지 이름과 함께 알린다.
  expect((await screen.findByRole('alert')).textContent).toBe('「달빛 도서관 외전」 · 연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.')
  expect(cells(fork)[4]).toBe('비공개')
  expect(requests()).toHaveLength(6)

  expect(within(open).queryByRole('button', { name: /포크 정합성 점검/ })).toBeNull()
  fireEvent.click(within(fork).getByRole('button', { name: '「달빛 도서관 외전」 포크 정합성 점검' }))
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
  return { row, checks, button: () => within(row).getByRole('button', { name: '「달빛 도서관 외전」 포크 정합성 점검' }) }
}
const integrityReport = { basisEpisode: 2, forkHash: 'a'.repeat(64), sourceHash: 'a'.repeat(64), matches: true, characterStateStatus: 'unavailable' }

it('포크 정합성 점검은 결과 제목으로 포커스를 옮기고, 닫으면 누른 점검 버튼으로 되돌리며, 점검 중인 행을 표시한다', async () => {
  const { row, button } = await openForkTab(() => Response.json(integrityReport))
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
  expect(document.activeElement).toBe(button())
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
  fireEvent.click((await screen.findAllByRole('button', { name: /포크 정합성 점검$/ }))[0])
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
  expect(cells(hidden)).toEqual(['숨긴 댓글의 원문', '달빛 도서관 · 2화', '하늘', '9', '숨김', kstDateTime('2026-11-09T01:00:00Z'), '게시 복구'])
  expect(cells(open)).toEqual(['첫 감상', '달빛 도서관 · 2화', '연화', '3', '게시', kstDateTime('2026-11-09T01:00:00Z'), '숨김'])
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
  fireEvent.click(within(open).getByRole('button', { name: '연화 댓글 숨김' }))
  expect(confirm).toHaveBeenCalledWith('「달빛 도서관」의 댓글을 숨길까요? 독자에게는 자리표시로만 보여요.')
  expect(requests()).toEqual(['GET /api/v1/operations/comments'])
  // 승인하면 서버에 보낸 뒤 목록을 다시 읽어 상태를 바꾼다.
  confirm.mockReturnValue(true)
  fireEvent.click(within(open).getByRole('button', { name: '연화 댓글 숨김' }))
  await within(open).findByRole('button', { name: '연화 댓글 게시 복구' })
  confirm.mockClear()
  expect(requests()).toEqual(['GET /api/v1/operations/comments', 'PUT /api/v1/operations/comments/c-open/hidden', 'GET /api/v1/operations/comments'])
  expect(cells(open)[4]).toBe('숨김')
  expect(within(hidden).getByRole('button', { name: '하늘 댓글 게시 복구' })).toBeTruthy()

  // 게시 복구는 DELETE로 보내고 목록을 다시 읽어 게시 상태로 돌아온다.
  fireEvent.click(within(open).getByRole('button', { name: '연화 댓글 게시 복구' }))
  await within(open).findByRole('button', { name: '연화 댓글 숨김' })
  expect(requests().slice(3)).toEqual(['DELETE /api/v1/operations/comments/c-open/hidden', 'GET /api/v1/operations/comments'])
  expect(cells(open)[4]).toBe('게시')
  // 게시 복구는 확인 없이 바로 보낸다.
  expect(confirm).not.toHaveBeenCalled()

  // 서버(Content) 실패는 성공으로 바꾸지 않고 오류를 보이며 목록도 다시 읽지 않는다.
  failAction = true
  fireEvent.click(within(hidden).getByRole('button', { name: '하늘 댓글 게시 복구' }))
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
  // 개요는 묶음 없이 메뉴 맨 위 단독 항목이다.
  expect(within(menu).getByRole('link', { name: '개요' }).closest('[role="group"]')).toBeNull()
})

it('표의 행 버튼은 이름이 같은 버튼끼리 구분되도록 대상 이름을 함께 읽는다', async () => {
  renderAdmin('jobs')
  const retry = await screen.findByRole('button', { name: 'manuscript_preprocessing 실행 job-failed-1 다시 실행' })
  expect(retry.textContent).toBe('다시 실행')
  cleanup()
  renderAdmin('characterChats')
  const chat = (await screen.findAllByRole('button', { name: /(중지|운영 재개)$/ }))[0]
  const cells = within(chat.closest('tr') as HTMLElement).getAllByRole('cell').map((cell) => cell.textContent)
  expect(chat.getAttribute('aria-label')).toBe(`${cells[1]} ${cells[2]} ${chat.textContent}`)
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
  await visit('개요', rect(-60, -22))
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

it('API 표시는 데모 탭에만 둔다: 메뉴 ‘데모’ 배지와 제목 옆 ‘데모 화면’ 칩은 데모 탭(캐릭터챗·크레딧)에만 있고 실제 API 탭에는 둘 다, 범례 줄도 없다', async () => {
  renderAdmin('works')
  const menu = await screen.findByRole('navigation', { name: '관리자 업무' })
  // 실제 API 탭: 배지도, 설명 연결도 없다.
  for (const name of ['개요', '사용자', '작품', '신고·권리', '경고', '추적·지표', '활동 로그']) {
    const link = within(menu).getByRole('link', { name })
    expect([link.querySelector('.nav-demo'), link.getAttribute('aria-describedby')], name).toEqual([null, null])
  }
  expect(menu.querySelector('.nav-live, .nav-legend')).toBeNull()
  expect(document.querySelector('.admin-head .chip')).toBeNull()
  // 데모 탭: 배지는 읽지 않게(aria-hidden) 두고, 링크 이름은 그대로 둔 채 설명으로 데모임을 알린다.
  for (const name of ['캐릭터챗', '크레딧']) {
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
  renderAdmin('llm')
  const status = await screen.findByLabelText('상태')
  expect([status.closest('.admin-filter') !== null, status.closest('.table-head')]).toEqual([true, null])
  expect(status.closest('section')!.querySelector('.table-head h2')?.textContent).toBe('운영 경고')
})

it('개요 탭의 새로고침도 다른 탭처럼 제목 줄 오른쪽(.admin-head)에 있고 설명 아래 혼자 차지하는 줄이 없다', async () => {
  renderAdmin('data')
  const refresh = await screen.findByRole('button', { name: '새로고침' })
  expect(document.querySelector('.admin-head')!.contains(refresh)).toBe(true)
  expect(document.querySelector('.admin-refresh')).toBeNull()
})

// 날짜·시각이 공백에서 두 줄('26. 11. 20. 오전 / 12:03')로 꺾이면 표가 어색하고 넓은 칸이 폭을 다 가져간다: 날짜만 담은 표 칸은 모두 admin-date(한 줄·고정 폭 숫자)를 쓴다.
it('날짜·시각만 담은 표 칸(td)은 admin-date 없이 맨 td로 그리지 않는다', () => {
  for (const file of ['AdminPage.tsx', 'JobMonitor.tsx', 'LlmAlerts.tsx', 'LlmOps.tsx', 'LlmOpsManage.tsx']) {
    expect(readFileSync(new URL(file, import.meta.url), 'utf8').match(/<td>\{[^}]*kstDateTime\(/g), file).toBeNull()
  }
})

// LLM Ops는 탭 하나 안의 칩 여덟 개가 아니라 사이드바 네 메뉴(주소 ?tab=llm&view=)로 나뉜다. 쪽마다 두 패널(평가·누설 검사는 셋)을 위아래로 쌓는다.
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const region = (name: string) => screen.findByRole('region', { name })
const llmMenu = async () => within(await screen.findByRole('navigation', { name: '관리자 업무' })).getByRole('group', { name: 'LLM Ops' })

it('LLM Ops 추적·지표 쪽(view=traces)은 추적 패널 아래에 지표 패널을 쌓고 칩 줄은 없다', async () => {
  renderAdmin('llm', 'traces')
  const traces = await region('LLM 추적')
  const metrics = await region('LLM 지표')
  expect(before(traces, metrics)).toBe(true)
  expect([document.querySelector('.admin-subnav'), screen.queryByRole('navigation', { name: 'LLM Ops 보기' })]).toEqual([null, null])
  expect(screen.queryByRole('region', { name: '운영 경고' })).toBeNull()
})

it('LLM Ops는 view가 없거나 모르는 값이면 경고 쪽이다: 운영 경고 목록 아래에 경고 기준을 쌓는다', async () => {
  for (const view of [undefined, 'nope', 'metrics']) {
    renderAdmin('llm', view)
    const alerts = await region('운영 경고')
    expect(before(alerts, await region('경고 기준')), view).toBe(true)
    expect(screen.queryByRole('region', { name: 'LLM 추적' }), view).toBeNull()
    cleanup()
  }
})

it('LLM Ops 프롬프트·모델 쪽(view=prompts)은 프롬프트 패널 아래에 모델 패널을, 평가·누설 검사 쪽(view=quality)은 평가·누설 검사 기록·표본 비율 폼을 쌓는다', async () => {
  renderAdmin('llm', 'prompts')
  expect(before(await region('프롬프트'), await region('모델 단가'))).toBe(true)
  cleanup()
  renderAdmin('llm', 'quality')
  const evaluations = await region('회귀 평가')
  const leaks = await region('정보 누설 검사')
  const rate = await region('누설 검사 표본 비율')
  expect([before(evaluations, leaks), before(leaks, rate)]).toEqual([true, true])
  // 표본 비율 폼은 경고 기준과 따로 이 쪽에 있고, 경고 기준 표는 경고 쪽에만 있다.
  within(rate).getByLabelText('표본 비율(0~1)')
  within(rate).getByRole('button', { name: '표본 비율 저장' })
  expect(screen.queryByRole('region', { name: '경고 기준' })).toBeNull()
})

it('사이드바는 서비스 운영 묶음 위에 LLM Ops 묶음(경고·추적·지표·프롬프트·모델·평가·누설 검사)을 두고, 현재 표시는 탭과 view가 모두 같은 메뉴에만 있다', async () => {
  renderAdmin('llm', 'prompts')
  const group = await llmMenu()
  const links = within(group).getAllByRole('link')
  expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['경고', '/admin?tab=llm'], ['추적·지표', '/admin?tab=llm&view=traces'], ['프롬프트·모델', '/admin?tab=llm&view=prompts'], ['평가·누설 검사', '/admin?tab=llm&view=quality'],
  ])
  expect(links.map((link) => [link.getAttribute('aria-current'), link.classList.contains('on')])).toEqual([[null, false], [null, false], ['page', true], [null, false]])
  const menu = screen.getByRole('navigation', { name: '관리자 업무' })
  expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['회원 관리', '콘텐츠 관리', '소통 관리', 'LLM Ops', '서비스 운영'])
  expect(within(within(menu).getByRole('group', { name: '서비스 운영' })).queryByRole('link', { name: /LLM/ })).toBeNull()
  // 모르는 view는 경고 메뉴가 켜지고, 다른 탭에서는 네 메뉴 모두 꺼진다.
  cleanup()
  renderAdmin('llm', 'nope')
  expect(within(await llmMenu()).getAllByRole('link').map((link) => link.getAttribute('aria-current'))).toEqual(['page', null, null, null])
  cleanup()
  renderAdmin('jobs')
  expect(within(await llmMenu()).getAllByRole('link').map((link) => link.getAttribute('aria-current'))).toEqual([null, null, null, null])
})

it('LLM Ops 화면 제목과 문서 제목은 쪽 이름을 붙인다', async () => {
  for (const [view, title] of [[undefined, 'LLM Ops · 경고'], ['traces', 'LLM Ops · 추적·지표'], ['prompts', 'LLM Ops · 프롬프트·모델'], ['quality', 'LLM Ops · 평가·누설 검사']] as const) {
    renderAdmin('llm', view)
    await screen.findByRole('heading', { level: 1, name: title })
    await waitFor(() => expect(document.title).toBe(`관리자 · ${title} · STORYFORK`))
    cleanup()
  }
})

it('LLM Ops는 쪽을 옮기면 열어 둔 추적 상세를 닫아, 돌아오면 목록부터 보인다', async () => {
  renderAdmin('llm', 'traces')
  const menu = await screen.findByRole('navigation', { name: '관리자 업무' })
  fireEvent.click((await screen.findAllByRole('button', { name: / 단계 상세$/ }))[0])
  await region('추적 상세')
  // 상세가 열려 있는 동안은 그 상세만 보인다(지표 패널은 목록으로 돌아오면 다시 나온다).
  expect(screen.queryByRole('region', { name: 'LLM 지표' })).toBeNull()
  fireEvent.click(within(menu).getByRole('link', { name: '프롬프트·모델' }))
  await region('프롬프트')
  fireEvent.click(within(menu).getByRole('link', { name: '추적·지표' }))
  await region('LLM 추적')
  expect(screen.queryByRole('region', { name: '추적 상세' })).toBeNull()
  await region('LLM 지표')
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
