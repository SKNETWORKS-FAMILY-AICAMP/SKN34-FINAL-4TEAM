// @vitest-environment jsdom
import '../../../../test/fixtureApp'
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
  expect(screen.getByText('운영 API 연결')).toBeTruthy()
  expect(screen.queryByText('목업 작품 데이터')).toBeNull()
  // 운영 제한·해제는 신고 사건이 아니라 활동 로그(72)에 남는다.
  expect(screen.getByText(/신고 사건에는 남기지 않고 활동 로그에만 기록해요/)).toBeTruthy()
  expect(requests()).toEqual(['GET /api/v1/operations/works'])
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer w-bearer' } })
  expect(cells(open)).toEqual(['달빛 도서관', '연화', '원작', '원작 · 권리 확인됨', '공개', '운영 제한'])
  expect(cells(fork)).toEqual(['달빛 도서관 외전', '하늘', '포크', '외부 2차 창작 · 권리 미확인', '비공개', '운영 제한포크 정합성 점검'])

  // 제한은 확인을 거쳐야 보내고, 취소하면 요청도 목록 재조회도 없다.
  fireEvent.click(within(open).getByRole('button', { name: '운영 제한' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(requests()).toEqual(['GET /api/v1/operations/works'])
  confirm.mockReturnValue(true)
  fireEvent.click(within(open).getByRole('button', { name: '운영 제한' }))
  await within(open).findByRole('button', { name: '제한 해제' })
  expect(requests()).toEqual(['GET /api/v1/operations/works', 'PUT /api/v1/operations/works/w-open/restriction', 'GET /api/v1/operations/works'])
  expect(cells(open)[4]).toBe('운영 제한')
  expect(within(open).getByText('운영 제한', { selector: '.chip' }).className).toContain('wait')
  expect(within(fork).getByRole('button', { name: '운영 제한' })).toBeTruthy()

  // 해제는 확인 없이 보내고 목록을 다시 읽어 공개 상태로 돌아온다.
  confirm.mockClear()
  fireEvent.click(within(open).getByRole('button', { name: '제한 해제' }))
  await within(open).findByRole('button', { name: '운영 제한' })
  expect(confirm).not.toHaveBeenCalled()
  expect(requests().slice(3)).toEqual(['DELETE /api/v1/operations/works/w-open/restriction', 'GET /api/v1/operations/works'])
  expect(cells(open)[4]).toBe('공개')

  // 서버(Content) 실패는 성공으로 바꾸지 않고 오류를 보이며 목록도 다시 읽지 않는다.
  failRestriction = true
  fireEvent.click(within(fork).getByRole('button', { name: '운영 제한' }))
  expect((await screen.findByRole('alert')).textContent).toBe('연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.')
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
  expect(screen.getByText('운영 API 연결')).toBeTruthy()
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
  expect((await screen.findByRole('alert')).textContent).toBe('연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.')
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
  expect(screen.getByText('운영 API 연결')).toBeTruthy()
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

// 이 파일의 다른 테스트가 데모 조치를 남기지 않으므로 마지막에 둡니다(픽스처 DB는 파일 안에서 공유됩니다).
it('픽스처(데모) 컨테이너에서는 데모 관리자 조치가 활동 로그에 남는다', async () => {
  await appContainer.resolve('adminUseCase').runJob('notification-cleanup')
  renderAdmin('audit')
  await waitFor(() => expect(activityRows()).toHaveLength(1))
  within(activityRows()[0]).getByText('정기 작업 재시도 시연', { selector: 'b' })
  within(activityRows()[0]).getByText('수행자 관리자 · 대상 데모')
  within(activityRows()[0]).getByText('알림 90일 보관기간 정리')
})
