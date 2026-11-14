// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CharacterSimulation } from '../../../domain/entities/characterSimulation'
import type { ChatEvent, ChatStep } from '../../../domain/entities/writingChat'
import { WritingChat } from './WritingChat'

const { sessions, history, send } = vi.hoisted(() => ({ sessions: vi.fn(), history: vi.fn(), send: vi.fn() }))
vi.mock('../../../app/appContainer', () => ({ appContainer: { resolve: () => useCase } }))
const useCase = { sessions, history, send }

afterEach(() => { cleanup(); vi.resetAllMocks() })

it('discards a message edit when switching to another conversation', async () => {
  sessions.mockResolvedValue([
    { threadId: 'a', title: '첫 대화', updatedAt: '' },
    { threadId: 'b', title: '둘째 대화', updatedAt: '' },
  ])
  history.mockImplementation(async (_work: string, thread: string) => ({
    threadId: thread, title: '', turns: [{ request: thread === 'a' ? '첫 질문' : '둘째 질문', reply: null }],
  }))
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v' }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  expect(await screen.findByText('첫 질문')).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '수정' }))
  expect(screen.getByLabelText('고칠 메시지')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('대화 고르기'), { target: { value: 'b' } })
  expect(await screen.findByText('둘째 질문')).toBeTruthy()
  expect(screen.queryByLabelText('고칠 메시지')).toBeNull()
})

it('shows the saved approval episode even when a different episode is open', async () => {
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
  history.mockResolvedValue({ threadId: 'a', title: '', turns: [{
    request: '이어 써줘',
    reply: { status: 'waiting', steps: [], missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 1 },
  }] })
  render(<WritingChat workId="w" basis={{ episode: 3, episodeVersionId: 'v3' }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  expect(await screen.findByRole('heading', { name: '1화 초안에 반영할까요?' })).toBeTruthy()
})

// ── 인물 시뮬레이션 장면(#58) ──
const turn = (index: number, name: string, prose: string): CharacterSimulation['turns'][number] => ({
  index, kind: 'character', characterId: `c${index}`, characterName: name, prose, editedByAuthor: false,
  checks: [{ kind: 'premise', passed: true, detail: '전제를 따랐어요.' }], regenerated: 0, evidence: [{ ref: 'card-1', source: 'graph' }],
})
const scene = (extra: Partial<CharacterSimulation> = {}): CharacterSimulation =>
  ({ mode: 'if', premise: '카엘이 성문을 열었다면?', beats: [], turns: [turn(0, '카엘', '카엘이 문을 열었다.')], notes: [], status: 'completed', stopReason: null, ...extra })
const simStep = (simulation: CharacterSimulation, extra: Partial<ChatStep> = {}): ChatStep => ({ feature: 'character_simulation', status: 'completed', simulation, ...extra })
const waiting = (simulation: CharacterSimulation) => ({
  status: 'waiting', steps: [simStep(simulation)], missingInputs: [], awaitingApproval: 'character_simulation', approvalEpisode: 3,
})
const basis = { episode: 1, episodeVersionId: 'v' }
const renderChat = (onApplied?: () => void) =>
  render(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={['다음 장면 아이디어']} onApplied={onApplied} />)
const openThread = (turns: unknown[]) => {
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
  history.mockResolvedValue({ threadId: 'a', title: '', turns })
}

it('시뮬레이션 승인 대기는 장면 카드와 회차 저장·저장하지 않기 버튼으로 묻고 승인 전에는 반영됐다고 알리지 않는다', async () => {
  openThread([{ request: '만약 카엘이 성문을 열었다면?', reply: waiting(scene()) }])
  send.mockResolvedValue(undefined)
  const onApplied = vi.fn()
  renderChat(onApplied)
  const ask = await screen.findByRole('region', { name: '이 장면을 3화 초안에 저장할까요?' })
  expect(within(ask).getByRole('region', { name: 'IF 전제' })).toBeTruthy()
  expect(within(ask).getByText('카엘이 문을 열었다.')).toBeTruthy()
  expect(within(ask).getByText(/승인하면 이 장면이 3화 초안 뒤에 이어 붙어요\./)).toBeTruthy()
  for (const name of ['초안에 반영', '반영하지 않기']) expect(screen.queryByRole('button', { name })).toBeNull()
  expect(screen.queryByText(/반영했어요/)).toBeNull()
  expect(onApplied).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '회차로 저장' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true } })
})

it('저장하지 않기는 승인 없이 답하고, 대상 회차를 모르면 회차 번호 없이 안내한다', async () => {
  openThread([{ request: '시뮬레이션', reply: { ...waiting(scene()), approvalEpisode: null } }])
  send.mockResolvedValue(undefined)
  renderChat()
  const ask = await screen.findByRole('region', { name: '이 장면을 초안에 저장할까요?' })
  expect(within(ask).getByText(/승인하면 이 장면이 초안 뒤에 이어 붙어요\./)).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '저장하지 않기' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: false } })
})

it('멈춘 장면은 승인 대신 멈춘 이유와 채팅으로 요청하라는 안내만 보이고 저장 버튼을 두지 않는다', async () => {
  openThread([{ request: '시뮬레이션', reply: waiting(scene({ status: 'stopped', stopReason: '말투가 섞여 멈췄어요.' })) }])
  renderChat()
  const ask = await screen.findByRole('region', { name: '이 장면은 저장할 수 없어요' })
  expect(within(ask).getByText('멈춘 이유').parentElement?.textContent).toBe('멈춘 이유 말투가 섞여 멈췄어요.')
  expect(within(ask).getByText('흐름 수정이나 다시 시도는 채팅으로 요청해 주세요.')).toBeTruthy()
  for (const name of ['회차로 저장', '저장하지 않기', '초안에 반영']) expect(screen.queryByRole('button', { name })).toBeNull()
})

it('장면이 형식 오류로 실패한 승인 대기는 가짜 장면 없이 실패 사유만 보이고 저장하지 못하게 한다', async () => {
  openThread([{ request: '시뮬레이션', reply: {
    status: 'waiting', missingInputs: [], awaitingApproval: 'character_simulation',
    steps: [{ feature: 'character_simulation', status: 'failed', error: '인물 시뮬레이션 결과 형식을 확인할 수 없어요.' }],
  } }])
  renderChat()
  const ask = await screen.findByRole('region', { name: '이 장면은 저장할 수 없어요' })
  expect(within(ask).getByRole('alert').textContent).toBe('실패: 인물 시뮬레이션 결과 형식을 확인할 수 없어요.')
  expect(within(ask).queryByRole('region')).toBeNull()
  expect(screen.queryByRole('button', { name: '회차로 저장' })).toBeNull()
})

it('저장된 대화에서도 끝난 장면을 카드로 다시 보이고 반영 결과는 말풍선 글로 잇는다', async () => {
  openThread([{ request: '시뮬레이션', reply: { status: 'completed', missingInputs: [], steps: [simStep(scene(), { applied: { episode: 3, revision: 5 } })] } }])
  renderChat()
  const card = await screen.findByRole('region', { name: 'IF 전제' })
  const bubble = card.closest('.chat-msg') as HTMLElement
  expect(bubble.classList.contains('assistant')).toBe(true)
  expect(within(bubble).getByText(/^\[인물 시뮬레이션\] 완료 · 장면 1턴 · 검사 통과 1 · 위반 0/).textContent).toContain('→ 3화 초안에 반영했어요.')
  expect(within(card).getByText('카엘이 문을 열었다.')).toBeTruthy()
})

it('진행 중 step이 올 때마다 같은 카드가 이어서 늘어나고 진행 표시 안(상태 알림)에는 장면을 넣지 않는다', async () => {
  openThread([])
  let emit!: (event: ChatEvent) => void
  let finish!: () => void
  send.mockImplementation(async (_work: string, _thread: string, _input: unknown, onEvent: (event: ChatEvent) => void) => {
    emit = onEvent
    await new Promise<void>((resolve) => { finish = resolve })
  })
  renderChat()
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '만약 카엘이 성문을 열었다면?' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  const run = async (event: ChatEvent) => { await act(async () => { emit(event) }) }
  await run({ type: 'plan', steps: [{ feature: 'character_simulation', status: 'not_started' }] })
  expect(screen.queryByRole('region', { name: 'IF 전제' })).toBeNull()
  await run({ type: 'step', step: simStep(scene({ status: 'running' }), { status: 'not_started' }) })
  const card = screen.getByRole('region', { name: 'IF 전제' })
  expect(card.querySelectorAll('.sim-turns > li')).toHaveLength(1)
  const progress = screen.getByRole('status', { name: 'AI 진행 상황' })
  expect(progress.contains(card)).toBe(false)
  expect(within(progress).getByText('인물 시뮬레이션')).toBeTruthy()
  expect(within(progress).getByText('진행 중', { selector: '.chat-step-state' })).toBeTruthy()
  await run({ type: 'step', step: simStep(scene({ status: 'running', turns: [turn(0, '카엘', '카엘이 문을 열었다.'), turn(1, '리안', '"저예요."')] })) })
  expect(screen.getByRole('region', { name: 'IF 전제' })).toBe(card)
  expect(card.querySelectorAll('.sim-turns > li')).toHaveLength(2)
  await run({ type: 'step', step: simStep(scene({ status: 'stopped', stopReason: '멈췄어요.' })) })
  expect(within(progress).getByText('멈춤', { selector: '.chat-step-state' })).toBeTruthy()
  expect(within(progress).queryByText('완료', { selector: '.chat-step-state' })).toBeNull()
  history.mockResolvedValue({ threadId: 'a', title: '', turns: [] })
  await act(async () => { finish() })
})

it('시뮬레이션 단계가 전제·비트를 기다리면 화면에서 채울 수 없다고 알리고 이어서 실행은 잠그며 취소만 받는다', async () => {
  openThread([{ request: '시뮬레이션 해 줘', reply: { status: 'waiting', steps: [], missingInputs: ['character_simulation'], awaitingApproval: null } }])
  renderChat()
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  expect(within(form).getByText(/인물 시뮬레이션 단계가 입력을 기다려요/)).toBeTruthy()
  expect(within(form).getByText(/화면에서 채울 수 없어요/)).toBeTruthy()
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
  expect(within(form).getByRole('button', { name: '취소' })).toHaveProperty('disabled', false)
})

it('빈 대화에는 IF·흐름 시뮬레이션 예시를 추천 칩으로 보이고 누르면 입력창에 글만 채운다', async () => {
  sessions.mockResolvedValue([])
  renderChat()
  const log = await screen.findByRole('log')
  for (const name of ['다음 장면 아이디어', 'IF 시뮬레이션: "만약 ~했다면?"', '흐름 시뮬레이션: 비트를 적어 요청']) expect(within(log).getByRole('button', { name })).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(within(log).getByRole('button', { name: 'IF 시뮬레이션: "만약 ~했다면?"' }))
  expect((screen.getByRole('textbox', { name: '메시지' }) as HTMLTextAreaElement).value).toBe('IF 시뮬레이션: "만약 ~했다면?"')
  expect(send).not.toHaveBeenCalled()
})
