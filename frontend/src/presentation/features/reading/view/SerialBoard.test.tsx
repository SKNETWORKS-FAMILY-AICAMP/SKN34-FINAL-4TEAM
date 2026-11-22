// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { INSUFFICIENT_CREDIT_MESSAGE, type SerialBoardView } from '../../../../domain/entities/aiSerial'
import { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { board as baseBoard, fakeSerialRepo, opinion, serverWork as work } from '../../../../test/serialFixtures'
import { kstDateTime } from '../../../shared/format'
import { SerialBoard } from './SerialBoard'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const simulation = opinion({ id: 'o2', authorName: '독자B', kind: 'simulation', body: '편지를 읽었다면', votes: 7, simulation: { premise: '편지를 읽었다면', beats: ['문을 연다', '편지를 펼친다'], scene: '비가 그친 새벽, 그는 편지를 펼쳤다.' } })
const board = (extra: Partial<SerialBoardView> = {}) => baseBoard({ opinions: [simulation, opinion()], ...extra })
const fakeRepo = (view = board()) => fakeSerialRepo({ view })
const open = (repo = fakeRepo(), session: Parameters<typeof createAppStore>[0] = { role: 'user', memberId: 'member-2' }) => {
  const store = createAppStore(session)
  const view = render(<Provider store={store}><MemoryRouter><SerialBoard work={work} useCase={new SerialUseCase(repo)} /></MemoryRouter></Provider>)
  return { repo, store, ...view }
}
const ready = () => screen.findByRole('heading', { level: 2, name: '다음 회차 의견' })
const rowOf = (author: string) => screen.getByText(author).closest('li') as HTMLElement

it('열린 게시판이 없으면(또는 읽는 중이면) 섹션을 그리지 않는다', async () => {
  const { repo, container } = open(fakeRepo(board({ board: null, opinions: [], summary: '지난 종합' })))
  expect(container.textContent).toBe('')
  await waitFor(() => expect(repo.board).toHaveBeenCalled())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  expect(container.textContent).toBe('')
})

it('열린 게시판의 질문·안내와 의견 목록(작성자·유형·본문·득표수)을 서버 순서대로 보인다', async () => {
  open(fakeRepo(board({ summary: '지난 회차는 편지를 둘러싼 갈등을 모았어요.' })))
  await ready()
  expect(screen.getByText('다음 회차는 어떻게 흘러갈까요?')).toBeTruthy()
  expect(screen.getByText(/5화에 담길 이야기/)).toBeTruthy()
  expect(screen.getByText('지난 회차는 편지를 둘러싼 갈등을 모았어요.')).toBeTruthy()
  // 의견 줄만 센다(시뮬레이션 의견 안의 비트 목록 항목은 제외).
  const rows = Array.from(screen.getByRole('list', { name: '의견 목록' }).children)
  expect(rows.map((row) => row.querySelector('b')?.textContent)).toEqual(['독자B', '독자A'])
  const general = within(rowOf('독자A'))
  expect(general.getByText('일반 의견')).toBeTruthy()
  expect(general.getByText('반전이 좋겠어요')).toBeTruthy()
  expect(general.getByText('3표')).toBeTruthy()
  expect(general.getByText(kstDateTime('2026-11-22T01:00:00Z'))).toBeTruthy()
})

it('시뮬레이션 의견은 전제·비트와 AI 장면 미리보기를 보이고, 미리보기가 없으면 그렇게 알린다', async () => {
  open(fakeRepo(board({ opinions: [simulation, opinion({ id: 'o3', authorName: '독자C', kind: 'simulation', body: '전제만', votes: 0, simulation: { premise: '전제만', beats: [], scene: null } })] })))
  await ready()
  const full = within(rowOf('독자B'))
  expect(full.getByText('시뮬레이션')).toBeTruthy()
  expect(full.getByText('편지를 읽었다면')).toBeTruthy()
  expect(full.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['문을 연다', '편지를 펼친다'])
  expect(full.getByText('비가 그친 새벽, 그는 편지를 펼쳤다.')).toBeTruthy()
  expect(full.getByText('7표')).toBeTruthy()
  expect(within(rowOf('독자C')).getByText(/장면 미리보기가 아직 없어요/)).toBeTruthy()
})

it('비로그인은 목록만 보이고 투표·입력 대신 로그인 안내를 보인다 (누르면 로그인 뒤 이 작품으로 돌아온다)', async () => {
  const { store } = open(fakeRepo(), { role: null, memberId: null })
  await ready()
  expect(screen.queryByRole('button', { name: /투표|옮기기/ })).toBeNull()
  expect(screen.queryByRole('form', { name: '의견 쓰기' })).toBeNull()
  const login = screen.getByRole('link', { name: '로그인' })
  expect(login.getAttribute('href')).toBe('/login')
  fireEvent.click(login)
  expect(store.getState().session.next).toBe('/work/postman')
})

it('투표하지 않은 로그인 회원은 의견마다 투표 버튼이 있고, 누르면 투표하고 서버 값을 다시 읽는다', async () => {
  const repo = fakeRepo()
  open(repo)
  await ready()
  repo.board.mockResolvedValue(board({ myVoteOpinionId: 'o1' }))
  fireEvent.click(within(rowOf('독자A')).getByRole('button', { name: '투표' }))
  await waitFor(() => expect(repo.vote).toHaveBeenCalledWith('postman', 'o1', expect.any(AbortSignal)))
  expect((await screen.findByRole('status')).textContent).toContain('투표했어요')
  // 다시 읽은 서버 값: 내 투표가 독자A의 의견이므로 취소 버튼과 옮기기 버튼으로 바뀐다.
  expect(await within(rowOf('독자A')).findByRole('button', { name: '투표 취소' })).toBeTruthy()
  expect(within(rowOf('독자B')).getByRole('button', { name: '여기로 옮기기' })).toBeTruthy()
})

it('이미 투표했으면 그 의견은 투표 취소(눌린 상태), 다른 의견은 여기로 옮기기이고 각각 동작한다', async () => {
  const repo = fakeRepo(board({ myVoteOpinionId: 'o1' }))
  open(repo)
  await ready()
  expect(within(rowOf('독자A')).getByRole('button', { name: '투표 취소' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(within(rowOf('독자B')).getByRole('button', { name: '여기로 옮기기' }))
  await waitFor(() => expect(repo.vote).toHaveBeenCalledWith('postman', 'o2', expect.any(AbortSignal)))
  expect((await screen.findByRole('status')).textContent).toContain('투표를 옮겼어요')
  fireEvent.click(within(rowOf('독자A')).getByRole('button', { name: '투표 취소' }))
  await waitFor(() => expect(repo.cancelVote).toHaveBeenCalledWith('postman', expect.any(AbortSignal)))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('투표를 취소했어요'))
})

it('이미 의견을 냈으면 의견 쓰기 폼은 없고 안내와 내 의견 표시만 보인다', async () => {
  open(fakeRepo(board({ myOpinionId: 'o1' })))
  await ready()
  expect(screen.queryByRole('form', { name: '의견 쓰기' })).toBeNull()
  expect(screen.getByText(/이미 의견을 냈어요/)).toBeTruthy()
  expect(within(rowOf('독자A')).getByText('내 의견')).toBeTruthy()
  expect(within(rowOf('독자B')).queryByText('내 의견')).toBeNull()
})

it('일반 의견을 쓰면 요청을 보내고 성공 뒤 입력 칸을 비운다', async () => {
  const repo = fakeRepo()
  open(repo)
  await ready()
  const form = within(screen.getByRole('form', { name: '의견 쓰기' }))
  const submit = form.getByRole('button', { name: '의견 올리기' }) as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  const text = form.getByLabelText('다음 전개 의견') as HTMLTextAreaElement
  fireEvent.change(text, { target: { value: ' 둘이 화해하면 좋겠어요 ' } })
  expect(submit.disabled).toBe(false)
  fireEvent.click(submit)
  await waitFor(() => expect(repo.submitOpinion).toHaveBeenCalledWith('postman', { kind: 'general', body: '둘이 화해하면 좋겠어요' }, expect.any(AbortSignal)))
  await waitFor(() => expect(text.value).toBe(''))
  expect((await screen.findByRole('status')).textContent).toContain('의견을 냈어요')
})

it('시뮬레이션을 고르면 전제·비트 입력과 크레딧 차감 안내가 나오고, 비트는 5개까지만 보낼 수 있다', async () => {
  const repo = fakeRepo()
  open(repo)
  await ready()
  const form = within(screen.getByRole('form', { name: '의견 쓰기' }))
  expect(form.queryByText(/크레딧이 차감됩니다/)).toBeNull()
  fireEvent.click(form.getByRole('radio', { name: '시뮬레이션' }))
  expect(form.getByText(/크레딧이 차감됩니다/)).toBeTruthy()
  expect(form.queryByLabelText('다음 전개 의견')).toBeNull()
  fireEvent.change(form.getByLabelText('시뮬레이션 전제'), { target: { value: '편지를 읽었다면' } })
  const submit = form.getByRole('button', { name: '의견 올리기' }) as HTMLButtonElement
  fireEvent.change(form.getByLabelText('장면 비트'), { target: { value: '하나\n둘\n셋\n넷\n다섯\n여섯' } })
  expect(form.getByText(/5개까지/)).toBeTruthy()
  expect(submit.disabled).toBe(true)
  fireEvent.change(form.getByLabelText('장면 비트'), { target: { value: '문을 연다\n\n편지를 펼친다' } })
  expect(submit.disabled).toBe(false)
  fireEvent.click(submit)
  await waitFor(() => expect(repo.submitOpinion).toHaveBeenCalledWith('postman', { kind: 'simulation', body: '', simulation: { premise: '편지를 읽었다면', beats: ['문을 연다', '편지를 펼친다'] } }, expect.any(AbortSignal)))
})

it('시뮬레이션을 보내는 동안은 미리보기를 만드는 중임을 알리고 다시 보내지 못한다', async () => {
  const repo = fakeRepo()
  let finish = () => {}
  repo.submitOpinion.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  open(repo)
  await ready()
  const form = within(screen.getByRole('form', { name: '의견 쓰기' }))
  fireEvent.click(form.getByRole('radio', { name: '시뮬레이션' }))
  fireEvent.change(form.getByLabelText('시뮬레이션 전제'), { target: { value: '전제' } })
  fireEvent.click(form.getByRole('button', { name: '의견 올리기' }))
  expect((await screen.findByRole('status')).textContent).toContain('장면 미리보기를 만들고 있어요')
  expect((form.getByRole('button', { name: '의견 올리기' }) as HTMLButtonElement).disabled).toBe(true)
  finish()
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('크레딧'))
})

it('이미 낸 의견·크레딧 부족 같은 거절은 코드별 문구를 경고로 알리고 입력은 그대로 둔다', async () => {
  const repo = fakeRepo()
  repo.submitOpinion.mockRejectedValueOnce(new Error(INSUFFICIENT_CREDIT_MESSAGE))
  open(repo)
  await ready()
  const form = within(screen.getByRole('form', { name: '의견 쓰기' }))
  fireEvent.click(form.getByRole('radio', { name: '시뮬레이션' }))
  fireEvent.change(form.getByLabelText('시뮬레이션 전제'), { target: { value: '편지를 읽었다면' } })
  fireEvent.click(form.getByRole('button', { name: '의견 올리기' }))
  expect((await screen.findByRole('alert')).textContent).toContain(INSUFFICIENT_CREDIT_MESSAGE)
  expect((form.getByLabelText('시뮬레이션 전제') as HTMLTextAreaElement).value).toBe('편지를 읽었다면')
})

it('작품 소유자에게만 의견 숨기기 버튼이 있고, 누르면 확인 뒤 숨긴다', async () => {
  const reader = open(fakeRepo())
  await ready()
  expect(screen.queryByRole('button', { name: '숨기기' })).toBeNull()
  reader.unmount()
  const repo = fakeRepo()
  open(repo, { role: 'user', memberId: 'member-1' })
  await ready()
  vi.spyOn(window, 'confirm').mockReturnValue(true) // 확인 대화 취소는 뷰모델 테스트가 본다.
  fireEvent.click(within(rowOf('독자A')).getByRole('button', { name: '숨기기' }))
  await waitFor(() => expect(repo.hideOpinion).toHaveBeenCalledWith('postman', 'o1', expect.any(AbortSignal)))
})

it('의견이 하나도 없으면 첫 의견을 권한다', async () => {
  open(fakeRepo(board({ opinions: [] })))
  await ready()
  expect(screen.getByText(/아직 의견이 없어요/)).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
})

it('게시판을 읽지 못하면 빈 섹션으로 숨기지 않고 실패와 다시 불러오기를 보인다', async () => {
  const repo = fakeRepo()
  repo.board.mockRejectedValueOnce(new Error('서버 오류'))
  open(repo)
  expect((await screen.findByRole('alert')).textContent).toContain('불러오지 못했어요')
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await ready()
})

it('규칙을 넘은 입력은 이유를 보이고, 입력 칸과 보내기 버튼이 그 문구를 aria-describedby로 가리킨다', async () => {
  open(fakeRepo())
  await ready()
  const form = within(screen.getByRole('form', { name: '의견 쓰기' }))
  const text = form.getByLabelText('다음 전개 의견')
  expect(text.getAttribute('aria-describedby')).toBeNull() // 문제가 없으면 연결하지 않는다
  fireEvent.change(text, { target: { value: '가'.repeat(1001) } })
  const hint = form.getByText(/1,000자까지/)
  expect(hint.id).not.toBe('')
  for (const el of [text, form.getByRole('button', { name: '의견 올리기' })]) expect(el.getAttribute('aria-describedby')).toBe(hint.id)
  fireEvent.click(form.getByRole('radio', { name: '시뮬레이션' }))
  fireEvent.change(form.getByLabelText('시뮬레이션 전제'), { target: { value: '전제' } })
  fireEvent.change(form.getByLabelText('장면 비트'), { target: { value: '1\n2\n3\n4\n5\n6' } })
  const beatsHint = form.getByText(/5개까지/)
  for (const el of [form.getByLabelText('시뮬레이션 전제'), form.getByLabelText('장면 비트'), form.getByRole('button', { name: '의견 올리기' })]) expect(el.getAttribute('aria-describedby')).toBe(beatsHint.id)
})
