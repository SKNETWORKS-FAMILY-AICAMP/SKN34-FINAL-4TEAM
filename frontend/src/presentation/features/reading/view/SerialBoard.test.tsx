// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { SerialBoardView } from '../../../../domain/entities/aiSerial'
import type { Work } from '../../../../domain/entities/work'
import { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { board as baseBoard, fakeSerialRepo, fourChoices, proposal, serverWork as work } from '../../../../test/serialFixtures'
import { kstDateTime } from '../../../shared/format'
import { useSerialBoardRead } from '../viewmodel/useSerialBoardViewModel'
import { SerialBoard } from './SerialBoard'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const simulation = proposal({
  id: 'p2', authorName: '독자B', kind: 'simulation', title: '편지를 읽는 장면', body: '편지를 읽었다면 어떨까요', likes: 7, createdAt: '2026-11-22T02:00:00Z',
  simulation: { premise: '편지를 읽었다면', beats: ['문을 연다', '편지를 펼친다'], scene: '비가 그친 새벽, 그는 편지를 펼쳤다.' },
})
const board = (extra: Partial<SerialBoardView> = {}) => baseBoard({ proposals: [simulation, proposal()], ...extra })
const fakeRepo = (view = board()) => fakeSerialRepo({ view })
/** 소설 상세가 읽기(useSerialBoardRead)를 한 번 하고 결과를 탭 안 내용에 넘기는 모양 그대로다. */
function Page({ target, useCase }: { target: Work; useCase: SerialUseCase }) {
  const read = useSerialBoardRead(target, useCase)
  return <SerialBoard work={target} read={read} useCase={useCase} />
}
const open = (repo = fakeRepo(), session: Parameters<typeof createAppStore>[0] = { role: 'user', memberId: 'member-2' }) => {
  const store = createAppStore(session)
  const useCase = new SerialUseCase(repo)
  const view = render(<Provider store={store}><MemoryRouter><Page target={work} useCase={useCase} /></MemoryRouter></Provider>)
  return { repo, store, ...view }
}
const ready = () => screen.findByRole('tablist', { name: '다음 회차 하위 탭' })
const subTab = (name: string) => screen.getByRole('tab', { name })
const toBoard = async (repo = fakeRepo(), session?: Parameters<typeof createAppStore>[0]) => {
  const view = open(repo, session)
  await ready()
  fireEvent.click(subTab('제안 게시판'))
  return view
}
const titles = () => Array.from(screen.getByRole('list', { name: '제안 목록' }).children, (li) => li.querySelector('.ws-title')?.textContent)

it('하위 탭은 투표·제안 게시판 둘이고 투표가 처음 열리며, 방향키·Home·End로 옮기고 선택한 탭만 Tab 순서에 들어간다', async () => {
  open()
  await ready()
  const stops = () => ['투표', '제안 게시판'].map((name) => subTab(name).tabIndex)
  expect(subTab('투표').getAttribute('aria-selected')).toBe('true')
  expect(stops()).toEqual([0, -1])
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(subTab('투표').id)
  subTab('투표').focus()
  fireEvent.keyDown(subTab('투표'), { key: 'ArrowRight' })
  expect(document.activeElement).toBe(subTab('제안 게시판'))
  expect(subTab('제안 게시판').getAttribute('aria-selected')).toBe('true')
  expect(stops()).toEqual([-1, 0])
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(subTab('제안 게시판').id)
  fireEvent.keyDown(subTab('제안 게시판'), { key: 'ArrowRight' })
  expect(document.activeElement).toBe(subTab('투표'))
  fireEvent.keyDown(subTab('투표'), { key: 'End' })
  expect(document.activeElement).toBe(subTab('제안 게시판'))
  fireEvent.keyDown(subTab('제안 게시판'), { key: 'Home' })
  expect(document.activeElement).toBe(subTab('투표'))
})

it('투표: 대상 회차 안내와 선택지 4개(번호·글·득표)를 서버가 준 순서대로 보인다', async () => {
  open()
  await ready()
  expect(screen.getByText('다음 회차는 어떻게 흘러갈까요?')).toBeTruthy()
  expect(screen.getByText(/5화에 이어질 전개/)).toBeTruthy()
  expect(screen.getByText(/추천을 많이 받은 제안 글 3개/)).toBeTruthy() // 제안과 추천이 다음 회차에 쓰이는 길을 알린다
  const rows = Array.from(screen.getByRole('list', { name: '다음 전개 선택지' }).children)
  expect(rows).toHaveLength(4)
  expect(rows.map((row) => row.querySelector('.ws-no')?.textContent)).toEqual(['1', '2', '3', '4'])
  expect(rows.map((row) => row.querySelector('.ws-ctext')?.textContent)).toEqual(fourChoices().map((c) => c.text))
  expect(rows.map((row) => row.querySelector('.ws-votes')?.textContent)).toEqual(['3표', '0표', '1표', '2표'])
})

it('투표: 로그인 회원은 선택지를 골라 투표하고 서버 값을 다시 읽어 내 선택을 표시하며, 다른 선택지로 옮기거나 취소할 수 있다', async () => {
  const repo = fakeRepo()
  open(repo)
  await ready()
  const radio = (n: number) => screen.getByRole('radio', { name: new RegExp('^' + n + '번') }) as HTMLInputElement
  expect([1, 2, 3, 4].map((n) => radio(n).checked)).toEqual([false, false, false, false])
  expect(screen.queryByRole('button', { name: '투표 취소' })).toBeNull()
  repo.board.mockResolvedValue(board({ myChoiceId: 'c2' }))
  fireEvent.click(radio(2))
  await waitFor(() => expect(repo.vote).toHaveBeenCalledWith('postman', 'c2', expect.any(AbortSignal)))
  expect((await screen.findByRole('status')).textContent).toBe('투표했어요.')
  await waitFor(() => expect(radio(2).checked).toBe(true))
  expect(within(radio(2).closest('li')!).getByText('내 선택')).toBeTruthy()
  repo.board.mockResolvedValue(board({ myChoiceId: 'c4' }))
  fireEvent.click(radio(4))
  await waitFor(() => expect(repo.vote).toHaveBeenLastCalledWith('postman', 'c4', expect.any(AbortSignal)))
  expect((await screen.findByRole('status')).textContent).toBe('투표를 옮겼어요.')
  await waitFor(() => expect(radio(4).checked).toBe(true))
  repo.board.mockResolvedValue(board())
  fireEvent.click(screen.getByRole('button', { name: '투표 취소' }))
  await waitFor(() => expect(repo.cancelVote).toHaveBeenCalledWith('postman', expect.any(AbortSignal)))
  await waitFor(() => expect(screen.queryByRole('button', { name: '투표 취소' })).toBeNull())
  expect(radio(4).checked).toBe(false)
})

it('투표: 비로그인은 선택지를 읽기만 하고 투표 자리에 로그인 안내를 보인다 (누르면 로그인 뒤 이 작품으로 돌아온다)', async () => {
  const { store } = open(fakeRepo(), { role: null, memberId: null })
  await ready()
  expect(screen.getByRole('list', { name: '다음 전개 선택지' }).children).toHaveLength(4)
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.queryByRole('button', { name: '투표 취소' })).toBeNull()
  const login = screen.getByRole('link', { name: '로그인' })
  expect(login.getAttribute('href')).toBe('/login')
  fireEvent.click(login)
  expect(store.getState().session.next).toBe('/work/postman')
})

it('투표: 선택지가 아직 없으면 준비 중이라고 알리고, 게시판이 없으면(다음 회차를 쓰는 중) 그렇게 알리며 마지막 종합 문장을 보인다', async () => {
  const waiting = open(fakeRepo(board({ choices: [] })))
  await ready()
  expect(screen.getByText('선택지를 준비하고 있어요')).toBeTruthy()
  expect(screen.queryByRole('list', { name: '다음 전개 선택지' })).toBeNull()
  waiting.unmount()
  open(fakeRepo(board({ board: null, choices: [], proposals: [], summary: '지난 회차는 편지를 둘러싼 갈등을 모았어요.' })))
  await ready()
  expect(screen.getByText('다음 회차를 쓰고 있어요')).toBeTruthy()
  expect(screen.getByText('지난 회차는 편지를 둘러싼 갈등을 모았어요.')).toBeTruthy()
  expect(screen.queryByRole('list', { name: '다음 전개 선택지' })).toBeNull()
})

it('제안 게시판: 목록은 제목·작성자·추천 수·작성 시각을 보이고 처음엔 최신순이며, 추천순으로 바꾸면 추천이 많은 글부터다', async () => {
  const posts = [proposal({ id: 'a', title: '가 글', likes: 1, createdAt: '2026-11-22T01:00:00Z' }), proposal({ id: 'b', title: '나 글', likes: 5, createdAt: '2026-11-22T02:00:00Z' }), proposal({ id: 'c', title: '다 글', likes: 3, createdAt: '2026-11-22T03:00:00Z' })]
  await toBoard(fakeRepo(board({ proposals: posts })))
  const sort = within(screen.getByRole('group', { name: '제안 정렬' }))
  expect(sort.getByRole('button', { name: '최신순' }).getAttribute('aria-pressed')).toBe('true')
  expect(sort.getByRole('button', { name: '추천순' }).getAttribute('aria-pressed')).toBe('false')
  expect(titles()).toEqual(['다 글', '나 글', '가 글'])
  const first = screen.getByRole('list', { name: '제안 목록' }).children[0]
  expect(first.textContent).toContain('독자A')
  expect(first.textContent).toContain('추천 3')
  expect(within(first as HTMLElement).getByText(kstDateTime('2026-11-22T03:00:00Z'))).toBeTruthy()
  fireEvent.click(sort.getByRole('button', { name: '추천순' }))
  expect(sort.getByRole('button', { name: '추천순' }).getAttribute('aria-pressed')).toBe('true')
  expect(titles()).toEqual(['나 글', '다 글', '가 글'])
})

it('제안 게시판: 글을 누르면 본문·시뮬레이션 미리보기가 펼쳐지고 다시 누르면 접히며, 하나만 펼쳐진다', async () => {
  await toBoard(fakeRepo(board({ proposals: [simulation, proposal({ id: 'p3', title: '전제만 있는 글', kind: 'simulation', body: '전제만', simulation: { premise: '전제만', beats: [], scene: null } }), proposal()] })))
  const toggle = (name: string) => screen.getByRole('button', { name })
  expect(screen.queryByText('편지를 읽었다면 어떨까요')).toBeNull()
  expect(toggle('편지를 읽는 장면').getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle('편지를 읽는 장면'))
  expect(toggle('편지를 읽는 장면').getAttribute('aria-expanded')).toBe('true')
  const detail = within(document.getElementById(toggle('편지를 읽는 장면').getAttribute('aria-controls')!)!)
  expect(within(toggle('편지를 읽는 장면').closest('li') as HTMLElement).getByText('시뮬레이션')).toBeTruthy() // 유형 표시는 접힌 줄에도 있다
  expect(detail.getByText('편지를 읽었다면 어떨까요')).toBeTruthy()
  expect(detail.getByText('편지를 읽었다면')).toBeTruthy()
  expect(detail.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['문을 연다', '편지를 펼친다'])
  expect(detail.getByText('비가 그친 새벽, 그는 편지를 펼쳤다.')).toBeTruthy()
  fireEvent.click(toggle('전제만 있는 글'))
  expect(toggle('편지를 읽는 장면').getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText(/장면 미리보기가 아직 없어요/)).toBeTruthy()
  fireEvent.click(toggle('전제만 있는 글'))
  expect(screen.queryByText(/장면 미리보기가 아직 없어요/)).toBeNull()
})

it('제안 게시판: 로그인 회원은 펼친 글에서 추천·추천 취소를 하고 서버 값을 다시 읽는다', async () => {
  const repo = fakeRepo(board({ proposals: [proposal({ id: 'p1', likes: 3, likedByMe: false })] }))
  await toBoard(repo)
  fireEvent.click(screen.getByRole('button', { name: '반전이 좋겠어요' }))
  repo.board.mockResolvedValue(board({ proposals: [proposal({ id: 'p1', likes: 4, likedByMe: true })] }))
  fireEvent.click(screen.getByRole('button', { name: '추천' }))
  await waitFor(() => expect(repo.likeProposal).toHaveBeenCalledWith('postman', 'p1', expect.any(AbortSignal)))
  expect((await screen.findByRole('status')).textContent).toBe('추천했어요.')
  const liked = await screen.findByRole('button', { name: '추천 취소' })
  expect(liked.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('list', { name: '제안 목록' }).textContent).toContain('추천 4')
  repo.board.mockResolvedValue(board({ proposals: [proposal({ id: 'p1', likes: 3, likedByMe: false })] }))
  fireEvent.click(liked)
  await waitFor(() => expect(repo.unlikeProposal).toHaveBeenCalledWith('postman', 'p1', expect.any(AbortSignal)))
  await screen.findByRole('button', { name: '추천' })
})

it('제안 게시판: 비로그인은 읽기만 하고 글쓰기·추천 자리에 로그인 안내를 보인다', async () => {
  const { store } = await toBoard(fakeRepo(), { role: null, memberId: null })
  fireEvent.click(screen.getByRole('button', { name: '반전이 좋겠어요' }))
  expect(screen.queryByRole('button', { name: '글쓰기' })).toBeNull()
  expect(screen.queryByRole('button', { name: '추천' })).toBeNull()
  expect(screen.queryByRole('button', { name: '추천 취소' })).toBeNull()
  expect(screen.getByText('편지의 주인이 사실 죽은 줄 알았던 동생이면 어떨까요?')).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: '로그인' }))
  expect(store.getState().session.next).toBe('/work/postman')
})

it('제안 게시판: 숨기기 버튼은 작품 소유자에게만 있고, 누르면 확인한 뒤 숨긴다', async () => {
  await toBoard(fakeRepo())
  fireEvent.click(screen.getByRole('button', { name: '반전이 좋겠어요' }))
  expect(screen.queryByRole('button', { name: '숨기기' })).toBeNull()
  cleanup()
  const repo = fakeRepo()
  await toBoard(repo, { role: 'user', memberId: 'member-1' })
  fireEvent.click(screen.getByRole('button', { name: '반전이 좋겠어요' }))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: '숨기기' }))
  expect(repo.hideProposal).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: '숨기기' }))
  await waitFor(() => expect(repo.hideProposal).toHaveBeenCalledWith('postman', 'p1', expect.any(AbortSignal)))
  expect((await screen.findByRole('status')).textContent).toBe('제안 글을 숨겼어요.')
})

it('제안 게시판: 글쓰기 버튼이 폼을 열고 일반 글을 올리면 요청을 보내고 성공을 알리며 폼을 닫는다', async () => {
  const repo = fakeRepo()
  await toBoard(repo)
  expect(screen.queryByRole('form', { name: '제안 글 쓰기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '글쓰기' }))
  const form = within(screen.getByRole('form', { name: '제안 글 쓰기' }))
  expect((form.getByRole('button', { name: '제안 올리기' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(form.getByLabelText('제안 제목'), { target: { value: ' 새 제안 ' } })
  fireEvent.change(form.getByLabelText('제안 내용'), { target: { value: '새 내용이에요' } })
  repo.board.mockResolvedValue(board({ proposals: [proposal({ id: 'p9', title: '새 제안', mine: true }), proposal()] }))
  fireEvent.click(form.getByRole('button', { name: '제안 올리기' }))
  await waitFor(() => expect(repo.submitProposal).toHaveBeenCalledWith('postman', { kind: 'general', title: '새 제안', body: '새 내용이에요' }, expect.any(AbortSignal)))
  expect((await screen.findByRole('status')).textContent).toBe('제안 글을 올렸어요.')
  await waitFor(() => expect(screen.queryByRole('form', { name: '제안 글 쓰기' })).toBeNull())
  await screen.findByRole('button', { name: '새 제안' })
  expect(screen.getByText('내 글', { exact: false })).toBeTruthy()
})

it('제안 게시판: 시뮬레이션을 고르면 전제·비트 입력과 크레딧 안내가 나오고, 비트는 5개까지만 보낼 수 있으며, 보내는 동안은 미리보기를 만드는 중임을 알린다', async () => {
  const repo = fakeRepo()
  await toBoard(repo)
  fireEvent.click(screen.getByRole('button', { name: '글쓰기' }))
  const form = within(screen.getByRole('form', { name: '제안 글 쓰기' }))
  expect(form.queryByLabelText('시뮬레이션 전제')).toBeNull()
  fireEvent.click(form.getByRole('radio', { name: /시뮬레이션/ }))
  expect(form.getByText(/크레딧이 차감/)).toBeTruthy()
  fireEvent.change(form.getByLabelText('제안 제목'), { target: { value: '편지 장면' } })
  fireEvent.change(form.getByLabelText('제안 내용'), { target: { value: '읽는 장면' } })
  fireEvent.change(form.getByLabelText('시뮬레이션 전제'), { target: { value: '편지를 읽었다면' } })
  fireEvent.change(form.getByLabelText('장면 비트'), { target: { value: '하나\n둘\n셋\n넷\n다섯\n여섯' } })
  const send = form.getByRole('button', { name: '제안 올리기' }) as HTMLButtonElement
  expect(send.disabled).toBe(true)
  expect(form.getByText(/5개까지/).id).toBe(send.getAttribute('aria-describedby'))
  expect(form.getByLabelText('장면 비트').getAttribute('aria-describedby')).toBe(send.getAttribute('aria-describedby'))
  fireEvent.change(form.getByLabelText('장면 비트'), { target: { value: '문을 연다\n편지를 펼친다' } })
  expect(send.disabled).toBe(false)
  expect(send.hasAttribute('aria-describedby')).toBe(false)
  let finish = () => {}
  repo.submitProposal.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  fireEvent.click(send)
  expect((await form.findByRole('status')).textContent).toContain('장면 미리보기를 만들고 있어요')
  expect(send.disabled).toBe(true)
  await act(async () => { finish() })
  expect(repo.submitProposal).toHaveBeenCalledWith('postman', { kind: 'simulation', title: '편지 장면', body: '읽는 장면', simulation: { premise: '편지를 읽었다면', beats: ['문을 연다', '편지를 펼친다'] } }, expect.any(AbortSignal))
})

it('제안 게시판: 올리지 못하면 서버 문구를 경고로 알리고 입력과 폼을 그대로 두며, 취소하면 폼을 닫는다', async () => {
  const repo = fakeRepo()
  repo.submitProposal.mockRejectedValueOnce(new Error('열린 게시판이 없어요.'))
  await toBoard(repo)
  fireEvent.click(screen.getByRole('button', { name: '글쓰기' }))
  const form = within(screen.getByRole('form', { name: '제안 글 쓰기' }))
  fireEvent.change(form.getByLabelText('제안 제목'), { target: { value: '제목' } })
  fireEvent.change(form.getByLabelText('제안 내용'), { target: { value: '내용' } })
  fireEvent.click(form.getByRole('button', { name: '제안 올리기' }))
  expect((await screen.findByRole('alert')).textContent).toContain('열린 게시판이 없어요.')
  expect((form.getByLabelText('제안 제목') as HTMLInputElement).value).toBe('제목')
  fireEvent.click(form.getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('form', { name: '제안 글 쓰기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '글쓰기' }))
  expect((screen.getByLabelText('제안 제목') as HTMLInputElement).value).toBe('')
})

it('제안 게시판: 열린 게시판이 없으면 글쓰기를 잠그고 이유를 알리며, 제안이 하나도 없으면 첫 제안을 권한다', async () => {
  await toBoard(fakeRepo(board({ board: null, choices: [], proposals: [] })))
  const write = screen.getByRole('button', { name: '글쓰기' }) as HTMLButtonElement
  expect(write.disabled).toBe(true)
  expect(screen.getByText(/열린 게시판이 없어요/).id).toBe(write.getAttribute('aria-describedby'))
  cleanup()
  await toBoard(fakeRepo(board({ proposals: [] })))
  expect(screen.getByText(/아직 제안이 없어요/)).toBeTruthy()
  expect(screen.queryByRole('list', { name: '제안 목록' })).toBeNull()
})

it('게시판을 읽지 못하면 빈 게시판으로 숨기지 않고 실패와 다시 불러오기를 보인다', async () => {
  const repo = fakeRepo()
  repo.board.mockRejectedValueOnce(new Error('서버 오류'))
  open(repo)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('불러오지 못했어요')
  expect(screen.queryByRole('tablist')).toBeNull()
  fireEvent.click(within(alert).getByRole('button', { name: '다시 불러오기' }))
  await ready()
  expect(screen.queryByRole('alert')).toBeNull()
})
