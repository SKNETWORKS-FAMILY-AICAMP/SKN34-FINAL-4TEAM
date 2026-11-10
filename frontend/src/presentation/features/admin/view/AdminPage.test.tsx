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
import { HttpOperationsCommentRepository, HttpOperationsWorkRepository } from '../../../../data/api/operationsApi'
import type { OperationsComment } from '../../../../domain/entities/operationsComment'
import type { OperationsWork } from '../../../../domain/entities/operationsWork'
import { OperationsCommentUseCase } from '../../../../domain/usecases/OperationsCommentUseCase'
import { OperationsWorkUseCase } from '../../../../domain/usecases/OperationsWorkUseCase'
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
    if (!target) return Response.json({ items: rows })
    if (failRestriction) return Response.json({ code: 'BAD_GATEWAY', message: 'content down' }, { status: 502 })
    const row = rows.find((w) => w.workId === target)!
    row.restricted = init?.method === 'PUT'
    return Response.json({ workId: row.workId, ownerId: row.ownerId, title: row.title, restricted: row.restricted })
  })
  const http = new OperationsWorkUseCase(new HttpOperationsWorkRepository(fetcher))
  const works = appContainer.resolve('operationsWorkUseCase')
  vi.spyOn(works, 'list').mockImplementation(() => http.list())
  vi.spyOn(works, 'setRestriction').mockImplementation((id, restricted) => http.setRestriction(id, restricted))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const requests = () => fetcher.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)

  renderAdmin('works')
  const open = (await screen.findByText('달빛 도서관', { selector: 'b' })).closest('tr') as HTMLElement
  const fork = screen.getByText('달빛 도서관 외전', { selector: 'b' }).closest('tr') as HTMLElement
  expect(screen.getByText('운영 API 연결')).toBeTruthy()
  expect(screen.queryByText('목업 작품 데이터')).toBeNull()
  expect(requests()).toEqual(['GET /api/v1/operations/works'])
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer w-bearer' } })
  expect(cells(open)).toEqual(['달빛 도서관', '연화', '원작', '원작 · 권리 확인됨', '공개', '운영 제한'])
  expect(cells(fork)).toEqual(['달빛 도서관 외전', '하늘', '포크', '외부 2차 창작 · 권리 미확인', '비공개', '운영 제한'])

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
  expect(cells(hidden)).toEqual(['숨긴 댓글의 원문', '달빛 도서관', '하늘', '9', '숨김', '게시 복구'])
  expect(cells(open)).toEqual(['첫 감상', '달빛 도서관', '연화', '3', '게시', '숨김'])
  expect(within(hidden).getByText('숨김', { selector: '.chip' }).className).toContain('wait')
  expect(within(open).getByText('게시', { selector: '.chip' }).className).toContain('ok')

  // 숨김은 서버에 보낸 뒤 목록을 다시 읽어 상태를 바꾼다.
  fireEvent.click(within(open).getByRole('button', { name: '숨김' }))
  await within(open).findByRole('button', { name: '게시 복구' })
  expect(requests()).toEqual(['GET /api/v1/operations/comments', 'PUT /api/v1/operations/comments/c-open/hidden', 'GET /api/v1/operations/comments'])
  expect(cells(open)[4]).toBe('숨김')
  expect(within(hidden).getByRole('button', { name: '게시 복구' })).toBeTruthy()

  // 게시 복구는 DELETE로 보내고 목록을 다시 읽어 게시 상태로 돌아온다.
  fireEvent.click(within(open).getByRole('button', { name: '게시 복구' }))
  await within(open).findByRole('button', { name: '숨김' })
  expect(requests().slice(3)).toEqual(['DELETE /api/v1/operations/comments/c-open/hidden', 'GET /api/v1/operations/comments'])
  expect(cells(open)[4]).toBe('게시')

  // 서버(Content) 실패는 성공으로 바꾸지 않고 오류를 보이며 목록도 다시 읽지 않는다.
  failAction = true
  fireEvent.click(within(hidden).getByRole('button', { name: '게시 복구' }))
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
  expect(new Set(column(2))).toEqual(new Set(['구운몽']))
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
