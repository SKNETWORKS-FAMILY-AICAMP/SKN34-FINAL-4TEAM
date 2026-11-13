// @vitest-environment jsdom
import '../../../../test/fixtureApp'

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { asValue } from 'awilix/browser'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { CommentSort, EpisodeComment } from '../../../../domain/entities/episodeComment'
import type { Work } from '../../../../domain/entities/work'
import type { WorkNotice, WorkNoticeInput } from '../../../../domain/entities/workNotice'
import type { EpisodeCommentRepository } from '../../../../domain/repositories/EpisodeCommentRepository'
import { SessionExpired } from '../../../../domain/repositories/ProfileRepository'
import type { WorkNoticeRepository } from '../../../../domain/repositories/WorkNoticeRepository'
import { EpisodeCommentUseCase } from '../../../../domain/usecases/EpisodeCommentUseCase'
import { WorkNoticeUseCase } from '../../../../domain/usecases/WorkNoticeUseCase'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); document.title = 'STORYFORK'; vi.restoreAllMocks() })

const expectOneMain = () => {
  const mains = document.querySelectorAll('main')
  expect(mains).toHaveLength(1)
  expect(mains[0].id).toBe('main')
  expect(mains[0].getAttribute('tabindex')).toBe('-1')
  return mains[0]
}

it('소설 상세는 id가 main인 랜드마크 하나와 h1 하나를 갖고 탭 제목은 작품 제목이다', async () => {
  renderApp('/work/postman', createAppStore({ role: 'user' }))
  const title = await screen.findByRole('heading', { name: '회색 도시의 우편배달부', level: 1 })
  expect(expectOneMain().contains(title)).toBe(true)
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  await waitFor(() => expect(document.title).toBe('회색 도시의 우편배달부 · STORYFORK'))
})

it('소설 상세의 제목은 단계를 건너뛰지 않는다', async () => {
  renderApp('/work/postman', createAppStore({ role: 'user' }))
  await screen.findByRole('heading', { name: '회색 도시의 우편배달부', level: 1 })
  // 오른쪽 포크 안내 상자의 제목은 h1 바로 아래 구역 제목이다(화면 읽기 프로그램의 제목 이동이 끊기지 않게).
  expect(screen.getByRole('heading', { name: '이 소설, 다르게 쓰고 싶다면', level: 2 })).toBeTruthy()
  const levels = screen.getAllByRole('heading').map((h) => Number(h.getAttribute('aria-level') ?? h.tagName.slice(1)))
  expect(levels.filter((level, i) => i > 0 && level > levels[i - 1] + 1)).toEqual([])
})

it('볼 수 없는 소설 안내도 main 하나와 h1 하나이며 탭 제목은 일반 화면 이름이다', async () => {
  renderApp('/work/nope')
  await screen.findByRole('heading', { name: '소설을 찾을 수 없거나 볼 수 없어요.', level: 1 })
  expectOneMain()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  await waitFor(() => expect(document.title).toBe('소설 상세 · STORYFORK'))
})

/** 시드 작품을 서버(정본) 작품으로 표시하고 좋아요 저장소를 대역으로 바꾼다. 서버가 없는 CI에서 화면 조립만 확인한다(HTTP 계약은 data 단위 테스트). */
function serverWorks() {
  const works = appContainer.resolve('mockDb').works
  for (const work of works) { work.canonical = true; work.statisticsSupported = false }
  const likes = appContainer.resolve('workLikeRepository')
  const read = vi.spyOn(likes, 'read'), like = vi.spyOn(likes, 'like'), unlike = vi.spyOn(likes, 'unlike')
  return { read, like, unlike, restore: () => { for (const work of works) { delete work.canonical; delete work.statisticsSupported } } }
}
const heart = () => screen.findByRole('button', { name: '좋아요' })
const count = () => document.getElementById('lkc')!.textContent

it('서버 작품 상세는 서버가 알려 준 좋아요 수와 내 좋아요 상태를 보여 주고 자리표시 조회·댓글 지표는 그리지 않는다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 12, liked: true })
  try {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    expect((await heart()).getAttribute('aria-pressed')).toBe('true')
    expect(count()).toBe('12')
    expect(server.read).toHaveBeenCalledWith('guunmong')
    expect(document.querySelector('.stats')!.textContent).not.toMatch(/조회|댓글/)
    expect(document.querySelectorAll('.stats svg')).toHaveLength(2) // 좋아요·포크 아이콘만(조회·댓글 아이콘 없음)
  } finally { server.restore() }
})

it('좋아요를 누르면 서버에 보내고 서버가 확정한 새 수와 상태로 바뀌며 다시 누르면 취소한다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValueOnce({ likes: 3, liked: false }).mockResolvedValue({ likes: 4, liked: true })
  server.like.mockResolvedValue({ likes: 4, liked: true })
  server.unlike.mockResolvedValue({ likes: 3, liked: false })
  try {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    expect((await heart()).getAttribute('aria-pressed')).toBe('false')
    expect(count()).toBe('3')
    fireEvent.click(await heart())
    await screen.findByText('좋아요를 눌렀어요')
    await waitFor(() => expect(count()).toBe('4'))
    expect(server.like).toHaveBeenCalledWith('guunmong')
    expect((await heart()).getAttribute('aria-pressed')).toBe('true')
    server.read.mockResolvedValue({ likes: 3, liked: false })
    fireEvent.click(await heart())
    await screen.findByText('좋아요를 취소했어요')
    await waitFor(() => expect(count()).toBe('3'))
    expect(server.unlike).toHaveBeenCalledWith('guunmong')
    expect((await heart()).getAttribute('aria-pressed')).toBe('false')
  } finally { server.restore() }
})

it('좋아요 실패는 성공으로 숨기지 않고 서버 안내를 보이며 수와 상태를 그대로 둔다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 3, liked: false })
  server.like.mockRejectedValue(new Error('공개 작품을 찾을 수 없어요.'))
  try {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    fireEvent.click(await heart())
    await screen.findByText('공개 작품을 찾을 수 없어요.')
    expect(count()).toBe('3')
    expect((await heart()).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByText('좋아요를 눌렀어요')).toBeNull()
    expect(server.read).toHaveBeenCalledTimes(1)
  } finally { server.restore() }
})

it('로그인이 만료됐으면 만료를 알리고 로그아웃해 다시 로그인하게 한다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 3, liked: false })
  server.like.mockRejectedValue(new SessionExpired())
  try {
    const { store } = renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    fireEvent.click(await heart())
    await screen.findByText('세션이 만료됐어요. 다시 로그인해 주세요.')
    expect(store.getState().session.role).toBeNull()
  } finally { server.restore() }
})

it('비로그인이 서버 작품의 좋아요를 누르면 서버를 부르지 않고 로그인 안내로 보낸다', async () => {
  const server = serverWorks()
  try {
    const { store } = renderApp('/work/guunmong')
    fireEvent.click(await heart())
    await screen.findByRole('heading', { name: '로그인', level: 1 })
    screen.getByText('좋아요는 로그인한 회원만 누를 수 있어요.')
    expect(store.getState().session.next).toBe('/work/guunmong')
    expect(server.like).not.toHaveBeenCalled()
    expect(server.read).not.toHaveBeenCalled()
  } finally { server.restore() }
})

it('소설 상세 소식 탭은 고정 소식을 펼쳐 보이고 독자에게는 작성 폼을 숨긴다', async () => {
  renderApp('/work/postman', createAppStore({ role: 'user' }))
  fireEvent.click(await screen.findByRole('tab', { name: '소식' }))
  expect(screen.getByRole('tab', { name: '소식' }).getAttribute('aria-selected')).toBe('true')
  await screen.findByText('연재 일정 안내')
  screen.getByText(/데모 소식이에요/)
  expect(screen.queryByLabelText('소식 제목')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '회차' }))
  expect(document.getElementById('eplist')).not.toBeNull()
})

it('운영자는 소설 상세 소식 탭에서 소식을 등록하고 고정 소식이 맨 위에 온다', async () => {
  renderApp('/work/postman', createAppStore({ role: 'admin' }))
  fireEvent.click(await screen.findByRole('tab', { name: '소식' }))
  await screen.findByText('연재 일정 안내')
  fireEvent.change(screen.getByLabelText('소식 제목'), { target: { value: '휴재 안내' } })
  fireEvent.change(screen.getByLabelText('소식 내용'), { target: { value: '이번 주는 쉬어요.' } })
  fireEvent.click(screen.getByLabelText('상단 고정'))
  fireEvent.click(screen.getByRole('button', { name: '소식 등록' }))
  await waitFor(() => expect([...document.querySelectorAll('.wn-item h2')].map((b) => b.textContent)).toEqual(['휴재 안내', '연재 일정 안내', '이번 주 휴재 안내', '연재를 시작합니다']))
})

it('소설 상세 정보 탭은 작품 소개·연재 주기·작가를 보이고 상단에도 연재 요일을 표시한다', async () => {
  renderApp('/work/postman', createAppStore({ role: 'user' }))
  await screen.findByRole('heading', { name: '회색 도시의 우편배달부', level: 1 })
  expect(document.querySelector('.whero .wsched')!.textContent).toBe('화·금 연재')
  fireEvent.click(screen.getByRole('tab', { name: '정보' }))
  screen.getByRole('heading', { name: '작품 소개', level: 2 })
  const dl = document.querySelector('.wi-dl')!.textContent!
  expect(dl).toContain('글윤서하')
  expect(dl).toContain('연재화·금 연재')
})

it('정보 탭 상세 정보는 값이 없는 연재 상태·연재·연령 등급 행을 미등록으로 보이지 않고 감춘다', async () => {
  const work = appContainer.resolve('mockDb').works.find((w) => w.id === 'postman')!
  const saved = { serial: work.serial, schedule: work.schedule, rating: work.rating }
  delete work.serial
  delete work.schedule
  delete work.rating
  try {
    renderApp('/work/postman', createAppStore({ role: 'user' }))
    fireEvent.click(await screen.findByRole('tab', { name: '정보' }))
    expect([...document.querySelectorAll('.wi-dl dt')].map((el) => el.textContent)).toEqual(['글', '장르', '창작 유형', '총 회차', '최근 업데이트'])
    expect(document.querySelector('.wi-dl')!.textContent).not.toContain('미등록')
  } finally { Object.assign(work, saved) }
})

it('소식은 탭을 옮겨도 유지되고 다른 작품으로 옮기면 섞이지 않으며 돌아오면 다시 보인다', async () => {
  renderApp('/work/guunmong', createAppStore({ role: 'admin' }))
  fireEvent.click(await screen.findByRole('tab', { name: '소식' }))
  fireEvent.change(screen.getByLabelText('소식 제목'), { target: { value: '구운몽 소식' } })
  fireEvent.change(screen.getByLabelText('소식 내용'), { target: { value: '본문' } })
  fireEvent.click(screen.getByRole('button', { name: '소식 등록' }))
  await screen.findByText('구운몽 소식')
  fireEvent.click(screen.getByRole('tab', { name: '회차' }))
  fireEvent.click(screen.getByRole('tab', { name: '소식' }))
  await screen.findByText('구운몽 소식')
  fireEvent.change(screen.getByLabelText('소식 제목'), { target: { value: '쓰다 만 제목' } })
  fireEvent.click(document.querySelector('a[href="/work/gate"]')!)
  await screen.findByRole('heading', { name: '구운몽: 저승의 문', level: 1 })
  await screen.findByText('연재 일정 안내')
  expect(screen.queryByText('구운몽 소식')).toBeNull()
  expect(screen.getByLabelText('소식 제목')).toHaveProperty('value', '')
  fireEvent.click(screen.getByRole('link', { name: '원작으로 가기' }))
  await screen.findByRole('heading', { name: '구운몽', level: 1 })
  await screen.findByText('구운몽 소식')
})

const serverNotice = (id: string, over: Partial<WorkNotice> = {}): WorkNotice => ({
  id, workId: 'guunmong', category: 'info', title: `소식 ${id}`, body: `본문 ${id}`, pinned: false,
  createdAt: '2026-11-09T01:00:00Z', updatedAt: '2026-11-09T01:00:00Z', ...over,
})
/** 서버 작품 소식 UseCase 대역: 서버처럼 고정 먼저 답하고 쓰기는 목록에 반영하며 호출은 vi.fn에 남긴다. 쓰는 쪽이 끝나면 restore로 되돌린다(HTTP 계약은 data 단위 테스트). */
function workNotices(initial: WorkNotice[]) {
  const original = appContainer.resolve('workNoticeUseCase')
  let rows = [...initial]
  const repo = {
    list: vi.fn(async (_workId: string, _signal?: AbortSignal) => [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned))),
    create: vi.fn(async (workId: string, input: WorkNoticeInput, _signal?: AbortSignal) => {
      const made = serverNotice(`new${rows.length}`, { ...input, workId })
      rows = [made, ...rows]
      return made
    }),
    update: vi.fn(async (_workId: string, id: string, input: WorkNoticeInput, _signal?: AbortSignal) => {
      const found = rows.find((n) => n.id === id)
      if (!found) throw new Error('소식을 찾을 수 없어요.')
      const edited = { ...found, ...input }
      rows = rows.map((n) => (n.id === id ? edited : n))
      return edited
    }),
    remove: vi.fn(async (_workId: string, id: string, _signal?: AbortSignal) => { rows = rows.filter((n) => n.id !== id) }),
  } satisfies WorkNoticeRepository
  appContainer.register({ workNoticeUseCase: asValue(new WorkNoticeUseCase(repo)) })
  return { repo, restore: () => appContainer.register({ workNoticeUseCase: asValue(original) }) }
}
/** 시드 작품을 서버(정본) 작품으로 표시하고 소식 UseCase도 대역으로 바꾼다. */
function serverNotices(initial: WorkNotice[]) {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 1, liked: false })
  const notices = workNotices(initial)
  return { repo: notices.repo, restore: () => { notices.restore(); server.restore() } }
}
const openNotices = async (role: 'user' | 'admin') => {
  renderApp('/work/guunmong', createAppStore({ role }))
  fireEvent.click(await screen.findByRole('tab', { name: '소식' }))
}
const noticePanel = () => screen.getByRole('tabpanel')
const noticeItem = (title: string) => within(screen.getByRole('article', { name: title }))
const shownNotices = () => [...document.querySelectorAll('.wn-item h2')].map((h) => h.textContent)
const fillNotice = (title: string, body: string) => {
  fireEvent.change(screen.getByLabelText('소식 제목'), { target: { value: title } })
  fireEvent.change(screen.getByLabelText('소식 내용'), { target: { value: body } })
}

it('서버 작품 소식은 서버가 준 순서 그대로 분류·한국시간 날짜와 함께 보이고 독자에게는 관리 버튼도 데모 안내도 없다', async () => {
  const lines = '첫 줄입니다.\n화·금에 올라와요.\n\n마지막 줄'
  const s = serverNotices([serverNotice('a', { pinned: true, category: 'event', createdAt: '2026-11-09T15:30:00Z', body: lines }), serverNotice('b', { category: 'hiatus' }), serverNotice('c')])
  try {
    await openNotices('user')
    await screen.findByText('소식 a')
    expect(s.repo.list).toHaveBeenCalledWith('guunmong', expect.any(AbortSignal))
    expect(shownNotices()).toEqual(['소식 a', '소식 b', '소식 c'])
    expect(noticeItem('소식 a').getByText('📌 고정')).toBeTruthy()
    expect(noticeItem('소식 a').getByText('이벤트')).toBeTruthy()
    expect(noticeItem('소식 b').getByText('휴재')).toBeTruthy()
    expect(noticeItem('소식 c').getByText('안내')).toBeTruthy()
    expect(noticeItem('소식 a').getByText('26.11.10')).toBeTruthy()
    expect(screen.getByRole('article', { name: '소식 a' }).querySelector('.wn-body')!.textContent).toBe(lines)
    expect(within(noticePanel()).queryByText(/데모 소식이에요/)).toBeNull()
    expect(within(noticePanel()).queryByLabelText('소식 제목')).toBeNull()
    expect(within(noticePanel()).queryByRole('button', { name: /수정|삭제|고정/ })).toBeNull()
  } finally { s.restore() }
})

it('서버 작품 소식은 읽는 동안 불러오는 중임을, 비어 있으면 빈 상태를 실제 응답대로 보인다', async () => {
  const s = serverNotices([])
  s.repo.list.mockImplementationOnce(() => new Promise<WorkNotice[]>(() => {}))
  try {
    await openNotices('user')
    expect(within(noticePanel()).getByRole('status').textContent).toBe('소식을 불러오고 있어요…')
    expect(within(noticePanel()).queryByText('아직 소식이 없어요.')).toBeNull()
    cleanup()
    await openNotices('user')
    await within(noticePanel()).findByText('아직 소식이 없어요.')
    expect(within(noticePanel()).queryByRole('status')).toBeNull()
  } finally { s.restore() }
})

it('소식 목록을 읽지 못하면 빈 목록으로 숨기지 않고 안내와 다시 불러오기를 보인다', async () => {
  const s = serverNotices([serverNotice('a')])
  s.repo.list.mockRejectedValueOnce(new Error('offline'))
  try {
    await openNotices('user')
    const alert = await within(noticePanel()).findByRole('alert')
    expect(alert.textContent).toContain('소식을 불러오지 못했어요')
    expect(within(noticePanel()).queryByText('아직 소식이 없어요.')).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: '다시 불러오기' }))
    await within(noticePanel()).findByText('소식 a')
    expect(within(noticePanel()).queryByRole('alert')).toBeNull()
  } finally { s.restore() }
})

it('소유자·운영자가 소식을 쓰면 공백을 지운 값이 서버로 가고 목록을 다시 읽어 새 소식을 보이며 폼을 비우고 알린다', async () => {
  const s = serverNotices([serverNotice('a')])
  try {
    await openNotices('admin')
    await screen.findByText('소식 a')
    fireEvent.change(screen.getByLabelText('소식 분류'), { target: { value: 'event' } })
    fillNotice('  새 이벤트  ', ' 내용입니다\n화·금에 올라와요 ')
    fireEvent.click(screen.getByLabelText('상단 고정'))
    fireEvent.click(screen.getByRole('button', { name: '소식 등록' }))
    await screen.findByText('소식을 등록했어요')
    expect(s.repo.create).toHaveBeenCalledWith('guunmong', { category: 'event', title: '새 이벤트', body: '내용입니다\n화·금에 올라와요', pinned: true }, expect.any(AbortSignal))
    await waitFor(() => expect(shownNotices()).toEqual(['새 이벤트', '소식 a']))
    expect(s.repo.list).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('소식 제목')).toHaveProperty('value', '')
    expect(screen.getByLabelText('소식 분류')).toHaveProperty('value', 'info')
  } finally { s.restore() }
})

it('소식을 보내는 동안에는 다시 보낼 수 없다 — 버튼이 잠기고 같은 폼을 또 제출해도 한 번만 간다', async () => {
  const s = serverNotices([serverNotice('a')])
  s.repo.create.mockImplementationOnce(() => new Promise<WorkNotice>(() => {}))
  try {
    await openNotices('admin')
    await screen.findByText('소식 a')
    fillNotice('새 소식', '내용')
    fireEvent.click(screen.getByRole('button', { name: '소식 등록' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '소식 등록' }).hasAttribute('disabled')).toBe(true))
    fireEvent.submit(screen.getByRole('form', { name: '소식 작성' }))
    expect(s.repo.create).toHaveBeenCalledTimes(1)
    expect(noticeItem('소식 a').getByRole('button', { name: '삭제' }).hasAttribute('disabled')).toBe(true)
  } finally { s.restore() }
})

it('빈 입력을 제출하면(버튼 잠금을 우회해도) 서버로 보내지 않고 안내만 하며 곧바로 다시 보낼 수 있다', async () => {
  const s = serverNotices([serverNotice('a')])
  try {
    await openNotices('admin')
    await screen.findByText('소식 a')
    fireEvent.submit(screen.getByRole('form', { name: '소식 작성' }))
    await screen.findByText('소식 제목을 입력해 주세요.')
    expect(s.repo.create).not.toHaveBeenCalled()
    fillNotice('새 소식', '내용')
    await waitFor(() => expect(screen.getByRole('button', { name: '소식 등록' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '소식 등록' }))
    await waitFor(() => expect(s.repo.create).toHaveBeenCalledTimes(1))
  } finally { s.restore() }
})

it('소식을 보내지 못하면 서버 안내를 알리고 입력을 그대로 두며 목록을 다시 읽지 않는다', async () => {
  const s = serverNotices([serverNotice('a')])
  s.repo.create.mockRejectedValueOnce(new Error('작품 소식을 관리할 권한이 없어요.'))
  try {
    await openNotices('admin')
    await screen.findByText('소식 a')
    fillNotice('새 소식', '내용')
    fireEvent.click(screen.getByRole('button', { name: '소식 등록' }))
    await screen.findByText('작품 소식을 관리할 권한이 없어요.')
    expect(screen.getByLabelText('소식 제목')).toHaveProperty('value', '새 소식')
    expect(screen.getByLabelText('소식 내용')).toHaveProperty('value', '내용')
    await waitFor(() => expect(screen.getByRole('button', { name: '소식 등록' }).hasAttribute('disabled')).toBe(false))
    expect(s.repo.list).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '소식 등록' }))
    await waitFor(() => expect(shownNotices()).toEqual(['새 소식', '소식 a']))
  } finally { s.restore() }
})

it('소식을 고치면 그 소식의 폼에서 전체 내용을 보내 반영하고, 취소하면 보내지 않고 닫는다', async () => {
  const s = serverNotices([serverNotice('a', { category: 'hiatus', pinned: true }), serverNotice('b')])
  try {
    await openNotices('admin')
    await screen.findByText('소식 a')
    fireEvent.click(noticeItem('소식 a').getByRole('button', { name: '수정' }))
    expect(within(screen.getByRole('form', { name: '소식 수정' })).getByLabelText('소식 제목')).toHaveProperty('value', '소식 a')
    fireEvent.click(within(screen.getByRole('form', { name: '소식 수정' })).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('form', { name: '소식 수정' })).toBeNull()
    expect(s.repo.update).not.toHaveBeenCalled()
    fireEvent.click(noticeItem('소식 a').getByRole('button', { name: '수정' }))
    const edit = within(screen.getByRole('form', { name: '소식 수정' }))
    fireEvent.change(edit.getByLabelText('소식 제목'), { target: { value: '고친 소식' } })
    fireEvent.click(edit.getByRole('button', { name: '저장' }))
    await screen.findByText('소식을 고쳤어요')
    expect(s.repo.update).toHaveBeenCalledWith('guunmong', 'a', { category: 'hiatus', title: '고친 소식', body: '본문 a', pinned: true }, expect.any(AbortSignal))
    await waitFor(() => expect(shownNotices()).toEqual(['고친 소식', '소식 b']))
    expect(screen.queryByRole('form', { name: '소식 수정' })).toBeNull()
  } finally { s.restore() }
})

it('고정 전환은 지금 내용을 그대로 두고 고정 여부만 바꿔 보내고, 삭제는 확인한 뒤에만 서버로 간다', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  const s = serverNotices([serverNotice('a'), serverNotice('b', { category: 'event' })])
  try {
    await openNotices('admin')
    await screen.findByText('소식 a')
    fireEvent.click(noticeItem('소식 b').getByRole('button', { name: '상단 고정' }))
    await screen.findByText('상단에 고정했어요')
    expect(s.repo.update).toHaveBeenCalledWith('guunmong', 'b', { category: 'event', title: '소식 b', body: '본문 b', pinned: true }, expect.any(AbortSignal))
    await waitFor(() => expect(shownNotices()).toEqual(['소식 b', '소식 a']))
    fireEvent.click(noticeItem('소식 b').getByRole('button', { name: '고정 해제' }))
    await screen.findByText('상단 고정을 풀었어요')
    await waitFor(() => expect(shownNotices()).toEqual(['소식 a', '소식 b']))
    fireEvent.click(noticeItem('소식 b').getByRole('button', { name: '삭제' }))
    expect(confirm).toHaveBeenCalledWith('이 소식을 삭제할까요?')
    expect(s.repo.remove).not.toHaveBeenCalled()
    fireEvent.click(noticeItem('소식 b').getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(s.repo.remove).toHaveBeenCalledWith('guunmong', 'b', expect.any(AbortSignal)))
    await waitFor(() => expect(shownNotices()).toEqual(['소식 a']))
  } finally { s.restore() }
})

it('소식은 10개씩 페이지로 나뉘고 서버가 준 순서를 지킨다', async () => {
  const s = serverNotices(Array.from({ length: 12 }, (_, i) => serverNotice(`p${i}`)))
  try {
    await openNotices('user')
    await screen.findByText('소식 p0')
    expect(shownNotices()).toEqual(Array.from({ length: 10 }, (_, i) => `소식 p${i}`))
    // 서재·작품 관리와 같은 공용 쪽 이동(이전·쪽 번호·다음)을 쓴다.
    const pages = within(within(noticePanel()).getByRole('navigation', { name: '페이지' }))
    expect(pages.getByRole('button', { name: '1' }).getAttribute('aria-current')).toBe('page')
    expect(pages.getByRole<HTMLButtonElement>('button', { name: '이전' }).disabled).toBe(true)
    fireEvent.click(pages.getByRole('button', { name: '2' }))
    expect(shownNotices()).toEqual(['소식 p10', '소식 p11'])
    expect(pages.getByRole<HTMLButtonElement>('button', { name: '다음' }).disabled).toBe(true)
    fireEvent.click(pages.getByRole('button', { name: '이전' }))
    expect(shownNotices()[0]).toBe('소식 p0')
  } finally { s.restore() }
})

it('공개 전 서버 작품은 소식을 요청하지 않고 공개 뒤에 쓸 수 있다고 안내한다', async () => {
  const s = serverNotices([serverNotice('a')])
  const work = appContainer.resolve('mockDb').works.find((w) => w.id === 'starlight')!
  const was = work.private
  work.private = true
  try {
    renderApp('/work/starlight', createAppStore({ role: 'user' }))
    fireEvent.click(await screen.findByRole('tab', { name: '소식' }))
    within(noticePanel()).getByText('공개한 뒤에 소식을 보고 올릴 수 있어요.')
    expect(within(noticePanel()).queryByLabelText('소식 제목')).toBeNull()
    expect(s.repo.list).not.toHaveBeenCalled()
  } finally { work.private = was; s.restore() }
})

it('메모리 데모 작품의 소식은 서버 소식 UseCase를 부르지 않고 데모임을 알린다', async () => {
  const s = workNotices([serverNotice('a')])
  try {
    renderApp('/work/postman', createAppStore({ role: 'user' }))
    fireEvent.click(await screen.findByRole('tab', { name: '소식' }))
    await screen.findByText('연재 일정 안내')
    screen.getByText(/데모 소식이에요/)
    expect(s.repo.list).not.toHaveBeenCalled()
  } finally { s.restore() }
})

it('소설 상세 탭은 방향키·Home·End로 옮기고 선택한 탭만 Tab 순서에 들어간다', async () => {
  renderApp('/work/postman', createAppStore({ role: 'user' }))
  await screen.findByRole('tablist', { name: '소설 상세 탭' })
  const tab = (name: string) => screen.getByRole('tab', { name })
  const stops = () => ['회차', '정보', '소식'].map((name) => tab(name).tabIndex)
  expect(stops()).toEqual([0, -1, -1])
  tab('회차').focus()
  fireEvent.keyDown(tab('회차'), { key: 'ArrowRight' })
  expect(document.activeElement).toBe(tab('정보'))
  expect(tab('정보').getAttribute('aria-selected')).toBe('true')
  expect(stops()).toEqual([-1, 0, -1])
  fireEvent.keyDown(tab('정보'), { key: 'End' })
  expect(document.activeElement).toBe(tab('소식'))
  fireEvent.keyDown(tab('소식'), { key: 'ArrowRight' })
  expect(document.activeElement).toBe(tab('회차'))
  fireEvent.keyDown(tab('회차'), { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(tab('소식'))
  fireEvent.keyDown(tab('소식'), { key: 'Home' })
  expect(document.activeElement).toBe(tab('회차'))
  expect(stops()).toEqual([0, -1, -1])
})

it('회차 정렬 토글은 그룹 이름과 눌림 상태를 알리고 누르면 바뀐다', async () => {
  renderApp('/work/guunmong', createAppStore({ role: 'user' }))
  const group = within(await screen.findByRole('group', { name: '회차 정렬' }))
  expect(group.getByRole('button', { name: '1화부터' }).getAttribute('aria-pressed')).toBe('true')
  expect(group.getByRole('button', { name: '최신순' }).getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(group.getByRole('button', { name: '최신순' }))
  expect(group.getByRole('button', { name: '최신순' }).getAttribute('aria-pressed')).toBe('true')
  expect(group.getByRole('button', { name: '1화부터' }).getAttribute('aria-pressed')).toBe('false')
})

it('연재 상태를 상단 배지와 정보 탭에 보이고 완결은 요일 대신 완결만 보인다', async () => {
  renderApp('/work/guunmong', createAppStore({ role: 'user' }))
  await screen.findByRole('heading', { name: '구운몽', level: 1 })
  expect(document.querySelector('.whero .chip')!.textContent).toBe('완결')
  expect(document.querySelector('.whero .wsched')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '정보' }))
  const dl = document.querySelector('.wi-dl')!.textContent!
  expect(dl).toContain('연재 상태완결')
  expect(dl).toContain('연재완결')
  cleanup()
  renderApp('/work/postman', createAppStore({ role: 'user' }))
  await screen.findByRole('heading', { name: '회색 도시의 우편배달부', level: 1 })
  expect(document.querySelector('.whero .chip')!.textContent).toBe('연재 중')
  expect(document.querySelector('.whero .wsched')!.textContent).toBe('화·금 연재')
})

it('서버 작품 상세는 공개 상세의 회차별 누적 조회 수를 자체 회차에만 보인다 (상속 회차는 원작 몫)', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 1, liked: false })
  const views = vi.spyOn(appContainer.resolve('workSearchRepository'), 'episodeViews')
  const rows = () => [...document.querySelectorAll('#eplist .ep .d')].map((el) => el.textContent ?? '')
  try {
    views.mockResolvedValue({ 1: 1500 })
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    await waitFor(() => expect(rows()[0]).toContain('조회 1.5천'))
    expect(rows()[1]).toContain('조회 0')
    expect(views).toHaveBeenCalledWith('guunmong', expect.any(AbortSignal))
    cleanup()
    views.mockResolvedValue({ 1: 99, 2: 99, 3: 7 })
    renderApp('/work/cloud', createAppStore({ role: 'user' }))
    await waitFor(() => expect(rows()[2]).toContain('조회 7'))
    expect(rows()[0]).not.toContain('조회 99')
    expect(rows()[1]).not.toContain('조회 99')
  } finally { server.restore() }
})

it('포크 소설의 정보 탭은 원작 링크를 보이고 원작을 열 수 없으면 제목만 보인다', async () => {
  renderApp('/work/cloud', createAppStore({ role: 'user' }))
  fireEvent.click(await screen.findByRole('tab', { name: '정보' }))
  expect(screen.getByRole('link', { name: '「구운몽」 2화에서 분기' }).getAttribute('href')).toBe('/work/guunmong')
  cleanup()
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 1, liked: false })
  const works = appContainer.resolve('mockDb').works
  const at = works.findIndex((w) => w.id === 'guunmong')
  const [source] = works.splice(at, 1)
  works.find((w) => w.id === 'cloud')!.parentTitle = '구운몽'
  try {
    renderApp('/work/cloud', createAppStore({ role: 'user' }))
    fireEvent.click(await screen.findByRole('tab', { name: '정보' }))
    expect(document.querySelector('.wi-dl')!.textContent).toContain('원작「구운몽」 2화에서 분기')
    expect(screen.queryByRole('link', { name: '「구운몽」 2화에서 분기' })).toBeNull()
  } finally {
    delete works.find((w) => w.id === 'cloud')!.parentTitle
    works.splice(at, 0, source)
    server.restore()
  }
})

it('링크 복사가 안 되면 성공으로 숨기지 않고 주소를 알려 준다 — 클립보드가 없거나 예외를 던지거나 거부해도 같다', async () => {
  const href = window.location.href
  const clipboards = [undefined, { writeText: () => { throw new Error('denied') } }, { writeText: () => Promise.reject(new Error('denied')) }]
  try {
    for (const clipboard of clipboards) {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
      renderApp('/work/postman', createAppStore({ role: 'user' }))
      fireEvent.click(await screen.findByRole('button', { name: '공유' }))
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe(`링크를 복사하지 못했어요 · ${href}`))
      cleanup()
    }
  } finally { Reflect.deleteProperty(navigator, 'clipboard') }
})

const serverComment = (id: string, over: Partial<EpisodeComment> = {}): EpisodeComment => ({
  id, workId: 'guunmong', episodeNumber: 2, publishedVersionId: 'v1', authorName: '독자', body: `본문 ${id}`, quote: null, spoiler: false,
  likeCount: 0, liked: false, mine: false, edited: false, hidden: false, createdAt: '2026-11-09T01:00:00Z', updatedAt: '2026-11-09T01:00:00Z', ...over,
})
/** 작품 전체 댓글 대역: 서버처럼 정렬해 답하고 호출은 vi.fn에 남긴다. 쓰는 쪽이 끝나면 원래 UseCase로 되돌린다. */
function workComments(list: EpisodeComment[]) {
  const original = appContainer.resolve('episodeCommentUseCase')
  const listByWork = vi.fn(async (_id: string, sort: CommentSort) => (sort === 'likes' ? [...list].sort((a, b) => b.likeCount - a.likeCount) : [...list]))
  const unused = vi.fn(async () => { throw new Error('unused') })
  appContainer.register({ episodeCommentUseCase: asValue(new EpisodeCommentUseCase({ list: unused, listByWork, create: unused, update: unused, remove: unused, like: unused, unlike: unused } satisfies EpisodeCommentRepository)) })
  return { listByWork, restore: () => appContainer.register({ episodeCommentUseCase: asValue(original) }) }
}
const commentsSection = () => screen.getByRole('region', { name: /전체 댓글/ })

it('작품 전체 댓글은 BEST 3개를 위에 보이고 정렬을 바꾸면 서버에 다시 묻는다 — 작성·좋아요 버튼은 없다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 1, liked: false })
  const comments = workComments([
    serverComment('a', { likeCount: 5, episodeNumber: 3 }), serverComment('b', { likeCount: 3, episodeNumber: 1 }),
    serverComment('c', { likeCount: 3, spoiler: true, createdAt: '2026-11-09T05:00:00Z' }), serverComment('d', { likeCount: 1 }),
    serverComment('e'), serverComment('f', { likeCount: 9, hidden: true, body: '' }),
  ])
  try {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    await screen.findByRole('heading', { name: '전체 댓글 6', level: 2 })
    expect(comments.listByWork).toHaveBeenCalledWith('guunmong', 'latest')
    const best = within(commentsSection()).getByRole('group', { name: '베스트 댓글' })
    expect(within(best).getAllByText('BEST')).toHaveLength(3)
    expect([...best.querySelectorAll('.cbody')].map((el) => el.textContent)).toEqual(['본문 a', '본문 c', '본문 b'])
    expect(within(commentsSection()).getByText('운영 정책으로 숨겨진 댓글입니다.')).toBeTruthy()
    expect(within(best).getByText('스포일러 댓글 보기')).toBeTruthy()
    expect(within(best).getByRole('link', { name: '3화' }).getAttribute('href')).toBe('/read/guunmong/3')
    expect(within(commentsSection()).queryByRole('button', { name: /수정|삭제|등록|좋아요 \d/ })).toBeNull()
    expect(within(commentsSection()).queryByRole('textbox')).toBeNull()
    fireEvent.click(within(within(commentsSection()).getByRole('group', { name: '댓글 정렬' })).getByRole('button', { name: '좋아요순' }))
    await waitFor(() => expect(comments.listByWork).toHaveBeenLastCalledWith('guunmong', 'likes'))
  } finally { comments.restore(); server.restore() }
})

it('작품 전체 댓글을 읽지 못하면 빈 목록으로 숨기지 않고 안내와 다시 불러오기를 보인다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 1, liked: false })
  const comments = workComments([serverComment('a')])
  comments.listByWork.mockRejectedValueOnce(new Error('offline'))
  try {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    const alert = await within(await screen.findByRole('region', { name: '전체 댓글' })).findByRole('alert')
    expect(alert.textContent).toContain('댓글을 불러오지 못했어요')
    expect(screen.queryByText(/아직 댓글이 없어요/)).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: '다시 불러오기' }))
    await screen.findByText('본문 a')
    expect(within(commentsSection()).queryByRole('alert')).toBeNull()
  } finally { comments.restore(); server.restore() }
})

it('작품 전체 댓글이 없으면 빈 상태를 보이고 데모 작품은 지원하지 않는다고 알린다', async () => {
  const server = serverWorks()
  server.read.mockResolvedValue({ likes: 1, liked: false })
  const comments = workComments([])
  try {
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    await screen.findByRole('heading', { name: '전체 댓글 0', level: 2 })
    screen.getByText(/아직 댓글이 없어요/)
    // 빈 상태 링크는 히어로 '읽기 시작'과 같은 회차다(픽스처에 읽던 기록이 있어 1화가 아닐 수 있다).
    const startHref = screen.getByRole('link', { name: '읽기 시작' }).getAttribute('href')
    expect(within(commentsSection()).getByRole('link', { name: /^\d+화$/ }).getAttribute('href')).toBe(startHref)
    expect(screen.queryByRole('group', { name: '댓글 정렬' })).toBeNull()
  } finally { server.restore() }
  try {
    cleanup()
    comments.listByWork.mockClear()
    renderApp('/work/guunmong', createAppStore({ role: 'user' }))
    await screen.findByText(/데모에서는 지원하지 않아요/)
    expect(comments.listByWork).not.toHaveBeenCalled()
  } finally { comments.restore() }
})

/** 추천 섹션: 제목 h2가 속한 section */
const recSection = (name: string) => screen.getByRole('heading', { name, level: 2 }).closest('section')!
const recTitles = (name: string) => [...recSection(name).querySelectorAll('.rg .ri b')].map((b) => b.textContent)

it('비슷한 작품은 오른쪽 포크 박스와 겹치는 현재 작품의 포크를 빼서, 같은 장르 작품이 자기 포크뿐인 구운몽은 추천 섹션을 만들지 않는다 (데모 작품)', async () => {
  renderApp('/work/guunmong', createAppStore({ role: 'user' }))
  await screen.findByRole('heading', { name: '구운몽', level: 1 })
  await waitFor(() => expect(document.querySelector('.wrecs')).toBeNull())
  expect(screen.queryByRole('heading', { name: '비슷한 작품' })).toBeNull()
  expect(screen.queryByRole('heading', { name: '이 작가의 다른 작품' })).toBeNull()
})

it('같은 작가의 다른 작품은 작가명이 정확히 같은 작품만, 비슷한 작품은 그 작품을 뺀 첫 장르 작품을 태그 겹침 순으로 보인다', async () => {
  renderApp('/work/postman', createAppStore({ role: 'user' }))
  const search = vi.spyOn(appContainer.resolve('workSearchRepository'), 'search')
  const base = appContainer.resolve('mockDb').works.find((w) => w.id === 'postman')!
  const book = (id: string, over: Partial<Work> = {}): Work => ({ ...structuredClone(base), id, title: id, ...over })
  search.mockImplementation(async (query) => (query.f === 'author'
    ? [book('postman'), book('same-1', { author: '윤서하' }), book('part', { author: '윤서하하' })]
    : [book('same-1', { author: '윤서하' }), book('sim-2', { author: '다른 작가', hash: [] }), book('sim-1', { author: '또 다른 작가', hash: ['#디스토피아'] })]))
  await screen.findByRole('heading', { name: '이 작가의 다른 작품', level: 2 })
  expect(recTitles('이 작가의 다른 작품')).toEqual(['same-1'])
  expect(recTitles('비슷한 작품')).toEqual(['sim-1', 'sim-2'])
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: '윤서하', f: 'author', sort: 'like' }), expect.anything())
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: 'SF', f: 'genre', sort: 'like' }), expect.anything())
})

it('추천 검색이 실패하면 빈 목록으로 숨기지 않고 그 섹션에 안내와 다시 불러오기를 보인다', async () => {
  renderApp('/work/guunmong', createAppStore({ role: 'user' }))
  const search = vi.spyOn(appContainer.resolve('workSearchRepository'), 'search')
  const memory = search.getMockImplementation()!
  const base = appContainer.resolve('mockDb').works.find((w) => w.id === 'postman')!
  const book = (id: string): Work => ({ ...structuredClone(base), id, title: id })
  search.mockImplementation(async (query, signal) => { if (query.f === 'genre') throw new Error('offline'); return memory(query, signal) })
  await screen.findByRole('heading', { name: '비슷한 작품', level: 2 })
  expect(within(recSection('비슷한 작품')).getByRole('alert').textContent).toContain('추천 소설을 불러오지 못했어요')
  expect(document.querySelectorAll('.wrecs .rg')).toHaveLength(0)
  search.mockImplementation(async (query, signal) => (query.f === 'genre' ? [book('sim-1'), book('sim-2'), book('sim-3')] : memory(query, signal)))
  fireEvent.click(within(recSection('비슷한 작품')).getByRole('button', { name: '다시 불러오기' }))
  await waitFor(() => expect(document.querySelectorAll('.wrecs .rg')).toHaveLength(3))
  expect(document.querySelector('.wrecs [role="alert"]')).toBeNull()
})

it('추천이 모두 비면 추천 섹션을 만들지 않는다', async () => {
  renderApp('/work/guunmong', createAppStore({ role: 'user' }))
  const search = vi.spyOn(appContainer.resolve('workSearchRepository'), 'search').mockResolvedValue([])
  await screen.findByRole('heading', { name: '구운몽', level: 1 })
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(document.querySelector('.wrecs')).toBeNull())
  expect(screen.queryByRole('heading', { name: '비슷한 작품' })).toBeNull()
})
