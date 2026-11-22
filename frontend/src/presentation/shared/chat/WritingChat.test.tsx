// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CharacterSimulation } from '../../../domain/entities/characterSimulation'
import { chatPage, type ChatEvent, type ChatStep } from '../../../domain/entities/writingChat'
import { useWritingChatViewModel } from './useWritingChatViewModel'
import { WritingChat } from './WritingChat'

const { sessions, history, send, open, writingEpisode } = vi.hoisted(() => ({ sessions: vi.fn(), history: vi.fn(), send: vi.fn(), open: vi.fn(), writingEpisode: vi.fn() }))
vi.mock('../../../app/appContainer', () => ({ appContainer: { resolve: () => useCase } }))
const useCase = { sessions, history, send, open, writingEpisode }

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
  expect(screen.getByRole('button', { name: '이 메시지부터 지우기' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '이 메시지 고치기' }))
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

it('바로 쓴 원고의 승인 카드는 반영할 본문과 따로 사용한 계획을 보인다(#458)', async () => {
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
  history.mockResolvedValue({ threadId: 'a', title: '', turns: [{
    request: '다음 화를 기획하고 써줘',
    reply: { status: 'waiting', missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 2, steps: [{
      feature: 'writing_editing', status: 'completed', result: { text: '선장은 항구에 내렸다.', plan: { title: '항구의 밤', beats: ['선장이 도착한다.'] } } }] },
  }] })
  render(<WritingChat workId="w" basis={{ episode: 2, episodeVersionId: 'v2' }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByRole('heading', { name: '2화 초안에 반영할까요?' })
  expect(screen.getByLabelText('반영할 내용').textContent).toBe('선장은 항구에 내렸다.')
  expect(document.querySelector('.chat-plan')?.textContent).toBe('사용한 계획: 항구의 밤 — 선장이 도착한다.')
})

it('바로 쓴 원고의 승인 카드는 설정 없이 쓴 알림을 반영 본문과 따로 보인다(#523)', async () => {
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
  history.mockResolvedValue({ threadId: 'a', title: '', turns: [{
    request: '다음 화를 써줘',
    reply: { status: 'waiting', missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 2, steps: [{
      feature: 'writing_editing', status: 'completed', result: { text: '선장은 항구에 내렸다.', gaps: ['이 작품에 연결된 세계관이 없어 설정 없이 작성했어요.'] } }] },
  }] })
  render(<WritingChat workId="w" basis={{ episode: 2, episodeVersionId: 'v2' }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByRole('heading', { name: '2화 초안에 반영할까요?' })
  expect(screen.getByLabelText('반영할 내용').textContent).toBe('선장은 항구에 내렸다.')
  expect(document.querySelector('.chat-plan')?.textContent).toBe('확인 못 함: 이 작품에 연결된 세계관이 없어 설정 없이 작성했어요.')
})

it('승인 카드는 같은 턴에 끝난 다른 단계 결과도 짧게 보인다(#493)', async () => {
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
  history.mockResolvedValue({ threadId: 'a', title: '', turns: [{
    request: '1화 심의 등급을 판정하고 다음 장면도 써줘',
    reply: { status: 'waiting', missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 1, steps: [
      { feature: 'rating', status: 'failed', error: '판별 실패' },
      { feature: 'writing_editing', status: 'completed', result: { text: '선장은 항구에 내렸다.' } },
    ] },
  }] })
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v1' }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByRole('heading', { name: '1화 초안에 반영할까요?' })
  const others = screen.getByLabelText('같이 끝난 작업')
  expect(within(others).getByText('심의 등급')).toBeTruthy()
  expect(within(others).getByText('실패: 판별 실패')).toBeTruthy()
  expect(within(others).queryByText('선장은 항구에 내렸다.')).toBeNull()
})

it('승인 카드는 같은 턴의 후보 검수 결과를 반영할 내용 바로 아래에 따로 보인다(#538)', async () => {
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
  const finding = { category: 'spelling', quote: '웃엇다', reason: '맞춤법', status: 'confirmed', evidenceRefs: [], suggestion: '웃었다', start: 0, end: 3 }
  history.mockResolvedValue({ threadId: 'a', title: '', turns: [{
    request: '다음 장면 쓰고 검수해 줘',
    reply: { status: 'waiting', missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 1, steps: [
      { feature: 'writing_editing', status: 'completed', result: { text: '선장은 웃엇다.' } },
      { feature: 'manuscript_review', status: 'completed', manuscriptReview: { check: 'mechanical', episode: 1, revision: 4, findings: [finding], gaps: [], candidate: { selection: null } } },
    ] },
  }] })
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v1' }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByRole('heading', { name: '1화 초안에 반영할까요?' })
  expect(screen.getByLabelText('후보 검수 결과').textContent).toContain('"웃엇다"')
  expect(screen.queryByLabelText('같이 끝난 작업')).toBeNull()
})

// ── 인물 시뮬레이션 장면(#58): 대본·승인은 집필실 무대가 맡고, 채팅에는 상태 한 줄과 무대 열기만 남는다 ──
const turn = (index: number, name: string, prose: string): CharacterSimulation['turns'][number] => ({
  index, kind: 'character', pov: 'omniscient', characterId: `c${index}`, characterName: name, prose, editedByAuthor: false,
  checks: [{ kind: 'premise', passed: true, detail: '전제를 따랐어요.' }], regenerated: 0, evidence: [{ ref: 'card-1', source: 'graph' }],
})
const scene = (extra: Partial<CharacterSimulation> = {}): CharacterSimulation =>
  ({ mode: 'if', premise: '카엘이 성문을 열었다면?', beats: [], turns: [turn(0, '카엘', '카엘이 문을 열었다.')], notes: [], status: 'completed', stopReason: null, ...extra })
const simStep = (simulation: CharacterSimulation, extra: Partial<ChatStep> = {}): ChatStep => ({ feature: 'character_simulation', status: 'completed', simulation, ...extra })
const approval = (simulation: CharacterSimulation) => ({
  status: 'waiting', steps: [simStep(simulation)], missingInputs: [], awaitingApproval: 'character_simulation', approvalEpisode: 3,
})
const basis = { episode: 1, episodeVersionId: 'v' }
const renderChat = (onOpenStage?: () => void) =>
  render(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={['다음 장면 아이디어']} onOpenStage={onOpenStage} />)
const openThread = (turns: unknown[]) => {
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
  history.mockResolvedValue({ threadId: 'a', title: '', turns })
}

it('턴 사이에 멈춘 장면은 대본 대신 진행 상태 한 줄과 무대 열기만 보이고, 무대 열기가 호스트의 무대를 연다', async () => {
  openThread([{ request: '시뮬레이션', reply: { status: 'waiting', steps: [simStep(scene({ status: 'paused', turns: [turn(0, '카엘', '카엘이 문을 열었다.'), turn(1, '리안', '"저예요."')] }))], missingInputs: [], awaitingScene: 'character_simulation' } }])
  const open = vi.fn()
  renderChat(open)
  expect(await screen.findByText('시뮬레이션 진행 중 · 2턴')).toBeTruthy()
  expect(screen.queryByText('카엘이 문을 열었다.')).toBeNull()
  expect(document.querySelector('.stage')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '무대 열기' }))
  expect(open).toHaveBeenCalledTimes(1)
})

it('승인 대기 장면은 채팅에서 저장 버튼을 묻지 않고 무대에서 정하라고만 알린다(승인 전에는 반영됐다고 알리지 않는다)', async () => {
  openThread([{ request: '시뮬레이션', reply: approval(scene()) }])
  const open = vi.fn()
  renderChat(open)
  expect(await screen.findByText('시뮬레이션 완료 · 1턴 · 원고 반영을 기다려요')).toBeTruthy()
  for (const name of ['회차로 저장', '저장하지 않기', '초안에 반영', '반영하지 않기', '원고에 반영']) expect(screen.queryByRole('button', { name })).toBeNull()
  expect(screen.queryByText(/반영했어요/)).toBeNull()
  expect(send).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '무대 열기' }))
  expect(open).toHaveBeenCalledTimes(1)
})

it('무대가 없는 화면(세계관 작업실)은 무대 열기 대신 집필실에서 이어 갈 수 있다고 안내한다', async () => {
  openThread([{ request: '시뮬레이션', reply: approval(scene()) }])
  renderChat()
  expect(await screen.findByText('시뮬레이션 완료 · 1턴 · 원고 반영을 기다려요')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '무대 열기' })).toBeNull()
  expect(screen.getByText('시뮬레이션 무대는 집필실에서 열 수 있어요.')).toBeTruthy()
})

it('장면이 형식 오류로 실패한 승인 대기는 가짜 장면 없이 실패 사유만 보인다', async () => {
  openThread([{ request: '시뮬레이션', reply: {
    status: 'waiting', missingInputs: [], awaitingApproval: 'character_simulation',
    steps: [{ feature: 'character_simulation', status: 'failed', error: '인물 시뮬레이션 결과 형식을 확인할 수 없어요.' }],
  } }])
  renderChat()
  expect((await screen.findByRole('alert')).textContent).toBe('실패: 인물 시뮬레이션 결과 형식을 확인할 수 없어요.')
  expect(screen.queryByRole('button', { name: '무대 열기' })).toBeNull()
})

it('저장된 대화에서 끝난 장면은 카드 없이 말풍선 한 줄 요약과 반영 결과로 남는다', async () => {
  openThread([{ request: '시뮬레이션', reply: { status: 'completed', missingInputs: [], steps: [simStep(scene(), { applied: { episode: 3, revision: 5 } })] } }])
  renderChat()
  const bubble = (await screen.findByText(/^\[인물 시뮬레이션\] 완료 · 장면 1턴 · 검사 통과 1 · 위반 0/)).closest('.chat-msg') as HTMLElement
  expect(bubble.classList.contains('assistant')).toBe(true)
  expect(within(bubble).getByText(/→ 3화 초안에 반영했어요\./)).toBeTruthy()
  expect(screen.queryByText('카엘이 문을 열었다.')).toBeNull()
})

it('종합 답변이 있는 말풍선도 승인 뒤 반영 결과와 실패 단계는 접힌 단계별 결과 밖에 보인다', async () => {
  openThread([{ request: '이어 써줘', reply: { status: 'failed', message: '**답변**이에요.', missingInputs: [], steps: [
    { feature: 'writing_editing', status: 'completed', result: { text: '초안' }, applied: { episode: 3, revision: 5 } },
    { feature: 'web_research', status: 'failed', error: '검색 실패' },
  ] } }])
  renderChat()
  const details = (await screen.findByText('단계별 결과 보기')).closest('details') as HTMLElement
  const applied = screen.getAllByText('→ 3화 초안에 반영했어요.').find((e) => !details.contains(e))
  const failed = screen.getAllByText('[고증 조사] 실패: 검색 실패').find((e) => !details.contains(e))
  expect(applied && failed).toBeTruthy()
  // 좋아요·싫어요는 단계별 결과 줄의 오른쪽(같은 줄, 뒤쪽)에 있다.
  const foot = details.parentElement as HTMLElement
  expect(foot.lastElementChild?.contains(within(foot).getByRole('button', { name: '이 답변 좋아요' }))).toBe(true)
  expect(within(foot).getByRole('button', { name: '이 답변 싫어요' })).toBeTruthy()
})

it('함께 시작한 단계는 다른 단계의 결과가 먼저 와도 끝날 때까지 진행 중으로 보인다(#474 병렬 호출)', async () => {
  openThread([])
  let emit!: (event: ChatEvent) => void
  send.mockImplementation(async (_work: string, _thread: string, _input: unknown, onEvent: (event: ChatEvent) => void) => {
    emit = onEvent
    await new Promise<void>(() => {})
  })
  renderChat()
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '등급 보고 설정집도 검토해줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  const run = async (event: ChatEvent) => { await act(async () => { emit(event) }) }
  await run({ type: 'plan', steps: [{ feature: 'rating', status: 'not_started' }, { feature: 'world', task: 'check', status: 'not_started' }] })
  await run({ type: 'started', feature: 'rating' })
  await run({ type: 'started', feature: 'world' })
  const progress = screen.getByRole('status', { name: 'AI 진행 상황' })
  const states = () => within(progress).getAllByText(/./, { selector: '.chat-step-state' }).map((e) => e.textContent)
  expect(states()).toEqual(['진행 중', '진행 중'])
  await run({ type: 'step', step: { feature: 'world', task: 'check', status: 'failed', error: '검토 실패' } })
  expect(states()).toEqual(['진행 중', '실패'])
})

it('진행 중 step이 올 때마다 진행 표시는 상태 알림 안에 단계만 보이고 장면 한 줄은 그 밖에서 턴 수만 늘어난다', async () => {
  openThread([])
  let emit!: (event: ChatEvent) => void
  let finish!: () => void
  send.mockImplementation(async (_work: string, _thread: string, _input: unknown, onEvent: (event: ChatEvent) => void) => {
    emit = onEvent
    await new Promise<void>((resolve) => { finish = resolve })
  })
  renderChat(vi.fn())
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '만약 카엘이 성문을 열었다면?' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  const run = async (event: ChatEvent) => { await act(async () => { emit(event) }) }
  await run({ type: 'plan', steps: [{ feature: 'character_simulation', status: 'not_started' }] })
  expect(screen.queryByText(/시뮬레이션 진행 중/)).toBeNull()
  await run({ type: 'step', step: simStep(scene({ status: 'running' }), { status: 'not_started' }) })
  const line = screen.getByText('시뮬레이션 진행 중 · 1턴')
  const progress = screen.getByRole('status', { name: 'AI 진행 상황' })
  expect(progress.contains(line)).toBe(false)
  expect(within(progress).getByText('인물 시뮬레이션')).toBeTruthy()
  expect(within(progress).getByText('진행 중', { selector: '.chat-step-state' })).toBeTruthy()
  await run({ type: 'step', step: simStep(scene({ status: 'running', turns: [turn(0, '카엘', '카엘이 문을 열었다.'), turn(1, '리안', '"저예요."')] })) })
  expect(screen.getByText('시뮬레이션 진행 중 · 2턴')).toBeTruthy()
  await run({ type: 'step', step: simStep(scene({ status: 'stopped', stopReason: '멈췄어요.' })) })
  expect(within(progress).getByText('멈춤', { selector: '.chat-step-state' })).toBeTruthy()
  expect(within(progress).queryByText('완료', { selector: '.chat-step-state' })).toBeNull()
  history.mockResolvedValue({ threadId: 'a', title: '', turns: [] })
  await act(async () => { finish() })
})

it('턴 사이 대기(paused) 장면을 진행 표시에서 대기나 완료로 꾸미지 않고 진행 중으로 보인다', async () => {
  openThread([])
  let emit!: (event: ChatEvent) => void
  let finish!: () => void
  send.mockImplementation(async (_work: string, _thread: string, _input: unknown, onEvent: (event: ChatEvent) => void) => {
    emit = onEvent
    await new Promise<void>((resolve) => { finish = resolve })
  })
  renderChat()
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '시뮬레이션' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  await act(async () => { emit({ type: 'plan', steps: [{ feature: 'character_simulation', status: 'not_started' }] }) })
  await act(async () => { emit({ type: 'step', step: simStep(scene({ status: 'paused' }), { status: 'not_started' }) }) })
  const progress = screen.getByRole('status', { name: 'AI 진행 상황' })
  expect(within(progress).getByText('진행 중', { selector: '.chat-step-state' })).toBeTruthy()
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

it('집필 입력 대기는 근거·열린 회차가 아니라 멈춘 턴의 반영 회차로 장면 계획을 받는다(#635)', async () => {
  openThread([{ request: '이어 써 줘', reply: { status: 'waiting', steps: [], missingInputs: ['writing_editing'], awaitingApproval: null, approvalEpisode: 2 } }])
  send.mockResolvedValue(undefined)
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 3 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  fireEvent.change(within(form).getByLabelText(/쓸 장면 계획 · 2화/), { target: { value: '선장이 항구에 도착한다.' } })
  fireEvent.click(within(form).getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({
    resume: { approved: true, inputs: { writing_editing: { draft: { episodeNumber: 2, plan: '선장이 항구에 도착한다.' } } } },
  })
})

it('반영 회차를 모르면 장면 계획을 빈 입력으로 보내지 않고 이유를 알린다(#635)', async () => {
  openThread([{ request: '이어 써 줘', reply: { status: 'waiting', steps: [], missingInputs: ['writing_editing'], awaitingApproval: null } }])
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 3 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  fireEvent.change(await screen.findByLabelText(/쓸 장면 계획/), { target: { value: '선장이 도착한다.' } })
  expect(screen.getByText(/고칠 회차를 알 수 없어요/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
})

// 채팅 구간 입력(#497): 선택 구간 없는 부분 수정은 카드에서 반영 회차 초안의 구간을 골라 span으로 보낸다.
const PATCH_BODY = '그는 웃었다. 바람이 찼다.'
const waitingPatch = () => openThread([{ request: '3문단 말투만 고쳐 줘', reply: { status: 'waiting', missingInputs: ['writing_editing'], awaitingApproval: null, approvalEpisode: 2,
  steps: [{ feature: 'writing_editing', status: 'not_started', task: 'patch' }] } }])
const patchForm = async () => {
  waitingPatch()
  writingEpisode.mockResolvedValue({ number: 2, draft: { title: '2화', body: PATCH_BODY, revision: 4 }, versions: [], publishedVersionId: null, inherited: false, updatedAt: null, checkpointStatus: 'content_only', checkpoints: [] })
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  const draft = await within(form).findByLabelText(/수정할 초안/) as HTMLTextAreaElement
  return { form, draft }
}
const choose = (draft: HTMLTextAreaElement, start: number, end: number) => {
  draft.setSelectionRange(start, end)
  fireEvent.select(draft)
}

it('부분 수정(task=patch) 입력 대기는 반영 회차의 초안을 읽기 전용으로 보여 주고, 구간을 고르기 전에는 이어서 실행을 잠근다', async () => {
  const { form, draft } = await patchForm()
  expect(writingEpisode).toHaveBeenCalledWith('w', 2, expect.anything())
  expect(draft.value).toBe(PATCH_BODY)
  expect(draft.readOnly).toBe(true)
  expect(within(form).queryByLabelText(/쓸 장면 계획/)).toBeNull()
  expect(within(form).queryByText(/화면에서 채울 수 없어요/)).toBeNull()
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
  choose(draft, 0, 7)
  expect(within(form).getByText('선택한 글 7자')).toBeTruthy()
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', false)
  choose(draft, 3, 3)  // 선택을 풀면 다시 잠근다
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
})

it('고른 구간과 수정 지시를 writing_editing.span으로 보낸다', async () => {
  send.mockResolvedValue(undefined)
  const { form, draft } = await patchForm()
  choose(draft, 0, 7)
  fireEvent.change(within(form).getByLabelText(/수정 지시/), { target: { value: '더 차갑게' } })
  fireEvent.click(within(form).getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({
    targetEpisode: 2, resume: { approved: true, inputs: { writing_editing: { span: { episode: 2, revision: 4, start: 0, end: 7, instruction: '더 차갑게' } } } },
  })
})

it('5,000자를 넘는 구간은 이어서 실행을 막고 한도를 알린다', async () => {
  const { form, draft } = await patchForm()
  writingEpisode.mockResolvedValue(undefined)
  Object.defineProperty(draft, 'selectionStart', { value: 0, configurable: true })
  Object.defineProperty(draft, 'selectionEnd', { value: 5001, configurable: true })
  fireEvent.select(draft)
  expect(within(form).getByText('5,000자 이하로 골라 주세요.')).toBeTruthy()
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
})

it('수정 지시를 비우면 이번 요청 문장을 지시로 보낸다', async () => {
  send.mockResolvedValue(undefined)
  const { form, draft } = await patchForm()
  choose(draft, 8, 14)
  fireEvent.click(within(form).getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2].resume.inputs).toEqual({ writing_editing: { span: { episode: 2, revision: 4, start: 8, end: 14, instruction: '3문단 말투만 고쳐 줘' } } })
})

it('초안을 읽지 못하면 실패를 알리고 구간 고르기와 이어서 실행을 막으며, 다시 불러오면 초안을 보인다', async () => {
  waitingPatch()
  writingEpisode.mockRejectedValueOnce(new Error('offline'))
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  expect((await within(form).findByRole('alert')).textContent).toContain('초안을 읽지 못했어요')
  expect(within(form).queryByLabelText(/수정할 초안/)).toBeNull()
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
  writingEpisode.mockResolvedValue({ number: 2, draft: { title: '2화', body: PATCH_BODY, revision: 4 }, versions: [], publishedVersionId: null, inherited: false, updatedAt: null, checkpointStatus: 'content_only', checkpoints: [] })
  fireEvent.click(within(form).getByRole('button', { name: '다시 불러오기' }))
  expect(((await within(form).findByLabelText(/수정할 초안/)) as HTMLTextAreaElement).value).toBe(PATCH_BODY)
})

it('입력 대기 카드는 같은 턴에 이미 끝난 작업과 사실에 맞는 취소 안내를 보인다(#661)', async () => {
  openThread([{ request: '계획 추가하고 고증해 줘', reply: { status: 'waiting', missingInputs: ['research'], awaitingApproval: null, steps: [
    { feature: 'content_action', status: 'completed', approval: 'approved', result: { tool: 'story_plan_create', label: '플롯·장면 계획 추가' }, applied: { episode: 2, revision: 1 } },
    { feature: 'research', status: 'not_started' },
  ] } }])
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const others = await screen.findByLabelText('같이 끝난 작업')
  expect(within(others).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Content 작업플롯·장면 계획 추가 완료'])
  expect(screen.getByText(/취소하면 남은 작업은 실행하지 않아요. 이미 끝난 작업은 그대로예요./)).toBeTruthy()
})

it('조건부 수정 입력 대기는 따로 보이는 검수 결과를 끝난 작업 목록에 되풀이하지 않는다(#661)', async () => {
  const finding = { category: 'spelling', quote: '웃엇다', reason: '맞춤법', status: 'confirmed', evidenceRefs: [], suggestion: '웃었다', start: 0, end: 3 }
  openThread([{ request: '검수하고 고쳐 줘', reply: { status: 'waiting', missingInputs: ['writing_editing'], awaitingApproval: null, steps: [
    { feature: 'manuscript_review', status: 'completed', manuscriptReview: { check: 'mechanical', episode: 1, revision: 4, findings: [finding], gaps: [] } },
    { feature: 'writing_editing', when: 'if_issues_found', status: 'not_started' },
  ] } }])
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v' }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  expect((await screen.findByLabelText('검수 결과')).textContent).toContain('웃엇다')
  expect(screen.queryByLabelText('같이 끝난 작업')).toBeNull()
})

it('고증 조사 입력 대기는 질문을 적어야 이어서 실행하고, 질문을 research 단계 입력으로 보낸다(#545)', async () => {
  openThread([{ request: '고증 확인해 줘', reply: { status: 'waiting', steps: [], missingInputs: ['research'], awaitingApproval: null } }])
  send.mockResolvedValue(undefined)
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  expect(within(form).getByText(/고증 조사 단계가 입력을 기다려요/)).toBeTruthy()
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
  fireEvent.change(within(form).getByLabelText('조사할 질문'), { target: { value: '한양에서 동래까지 며칠?' } })
  fireEvent.click(within(form).getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true, inputs: { research: { question: '한양에서 동래까지 며칠?' } } } })
})

it('원고 검수 입력 대기는 검수 종류를 골라야 이어서 실행하고, 고른 종류를 단계 입력으로 보낸다', async () => {
  openThread([{ request: '검수해 줘', reply: { status: 'waiting', steps: [], missingInputs: ['manuscript_review'], awaitingApproval: null, approvalEpisode: 2 } }])
  send.mockResolvedValue(undefined)
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  expect(within(form).getByRole('group', { name: '검수 종류 · 2화 초안' })).toBeTruthy()
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
  fireEvent.click(within(form).getByRole('radio', { name: /설정·개연성/ }))
  fireEvent.click(within(form).getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true, inputs: { manuscript_review: { check: 'semantic' } } } })
})

it('조건부 수정 입력 대기는 확정 지적만 보기로 두고, 고른 지적 번호를 단계 입력으로 보낸다(#370)', async () => {
  const finding = (quote: string, status: string) => ({ category: 'spelling', quote, reason: `${quote} 오류`, status, evidenceRefs: [], suggestion: '', start: status === 'confirmed' ? 0 : null, end: status === 'confirmed' ? 1 : null })
  const review = { check: 'mechanical', episode: 2, revision: 4, gaps: [], findings: [finding('웃엇다', 'confirmed'), finding('비가', 'suspected'), finding('말햇다', 'confirmed')] }
  openThread([{ request: '검수하고 틀리면 고쳐 줘', reply: { status: 'waiting', missingInputs: ['writing_editing'], awaitingApproval: null, approvalEpisode: 2, steps: [
    { feature: 'manuscript_review', status: 'completed', manuscriptReview: review }, { feature: 'writing_editing', when: 'if_issues_found', status: 'not_started' }] } }])
  send.mockResolvedValue(undefined)
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  const group = within(form).getByRole('group', { name: '고칠 지적 · 2화 초안' })
  expect(within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['"웃엇다" — 웃엇다 오류', '"말햇다" — 말햇다 오류'])
  expect(within(form).queryByRole('textbox')).toBeNull()  // 장면 계획을 적는 새 원고 입력이 아니다
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
  fireEvent.click(within(group).getByRole('radio', { name: /말햇다/ }))
  fireEvent.click(within(form).getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true, inputs: { writing_editing: { fix: 2 } } } })
})

it('조건부 수정 지적 고르기 중에도 직전 검수 결과(제안·의심·확인 못 함)가 보인다(#391)', async () => {
  const finding = (quote: string, status: string) => ({ category: 'spelling', quote, reason: `${quote} 오류`, status, evidenceRefs: [], suggestion: `${quote} 고침`, start: status === 'confirmed' ? 0 : null, end: status === 'confirmed' ? 1 : null })
  const review = { check: 'mechanical', episode: 2, revision: 4, gaps: ['날짜 비교 대상 없음'], findings: [finding('웃엇다', 'confirmed'), finding('비가', 'suspected'), finding('말햇다', 'confirmed')] }
  openThread([{ request: '검수하고 틀리면 고쳐 줘', reply: { status: 'waiting', missingInputs: ['writing_editing'], awaitingApproval: null, steps: [
    { feature: 'manuscript_review', status: 'completed', manuscriptReview: review }, { feature: 'writing_editing', when: 'if_issues_found', status: 'not_started' }] } }])
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  const result = within(form).getByLabelText('검수 결과').textContent
  expect(result).toContain('제안: 웃엇다 고침')
  expect(result).toContain('"비가"')
  expect(result).toContain('확인 못 함: 날짜 비교 대상 없음')
})

it('건너뛴 조건부 수정 단계는 진행 표시에서 대기가 아니라 건너뜀으로 보인다(#370)', async () => {
  openThread([])
  let emit!: (event: ChatEvent) => void
  send.mockImplementation(async (_work: string, _thread: string, _input: unknown, onEvent: (event: ChatEvent) => void) => {
    emit = onEvent
    await new Promise<void>(() => {})
  })
  renderChat(vi.fn())
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '검수하고 틀리면 고쳐 줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  await act(async () => { emit({ type: 'plan', steps: [{ feature: 'manuscript_review', status: 'not_started' }, { feature: 'writing_editing', when: 'if_issues_found', status: 'not_started' }] }) })
  await act(async () => { emit({ type: 'step', step: { feature: 'manuscript_review', status: 'completed', manuscriptReview: { check: 'mechanical', episode: 2, revision: 4, findings: [], gaps: [] } } }) })
  await act(async () => { emit({ type: 'step', step: { feature: 'writing_editing', when: 'if_issues_found', status: 'skipped', error: '고칠 문제가 없어요.' } }) })
  const progress = screen.getByRole('status', { name: 'AI 진행 상황' })
  expect(within(progress).getByText('건너뜀', { selector: '.chat-step-state' })).toBeTruthy()
  expect(within(progress).queryByText('대기', { selector: '.chat-step-state' })).toBeNull()
})

it('빈 대화에는 IF·흐름 시뮬레이션 예시를 추천 칩으로 보이고 누르면 입력창에 글만 채운다', async () => {
  sessions.mockResolvedValue([])
  renderChat()
  const log = await screen.findByRole('log')
  for (const name of ['다음 장면 아이디어', 'IF 시뮬레이션: "만약 ~했다면?"', '흐름 시뮬레이션: 비트를 적어 요청']) expect(within(log).getByRole('button', { name })).toBeTruthy()
  fireEvent.click(within(log).getByRole('button', { name: 'IF 시뮬레이션: "만약 ~했다면?"' }))
  expect((screen.getByRole('textbox', { name: '메시지' }) as HTMLTextAreaElement).value).toBe('IF 시뮬레이션: "만약 ~했다면?"')
  expect(send).not.toHaveBeenCalled()
})

it('동의 체크 없이 바로 보내고 요청에 동의 값을 싣지 않는다(#542)', async () => {
  openThread([])
  send.mockResolvedValue(undefined)
  renderChat()
  await screen.findByText('새 대화', { selector: 'h3' })
  expect(screen.queryByRole('checkbox', { name: /OpenAI/ })).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '길드 규칙은?' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).not.toHaveProperty('consent')
})

it('AI 답변 아래에 좋아요·싫어요 아이콘 버튼만 두고, 눌러도 아무 요청을 보내지 않는다(저장은 #560)', async () => {
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
  history.mockResolvedValue({ threadId: 'a', title: '', turns: [{
    request: '주인공이 누구야?', reply: { status: 'completed', message: '주인공은 홍길동입니다.', steps: [] },
  }] })
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v' }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByText('주인공은 홍길동입니다.')
  const like = screen.getByRole('button', { name: '이 답변 좋아요' })
  const dislike = screen.getByRole('button', { name: '이 답변 싫어요' })
  expect(like.textContent).toBe('')
  fireEvent.click(like)
  fireEvent.click(dislike)
  expect(send).not.toHaveBeenCalled()
  expect(history).toHaveBeenCalledTimes(1)
  expect(screen.getAllByRole('button', { name: '이 답변 좋아요' })).toHaveLength(1)
})

// ── World 단계(#546): enrich 제안은 설정집 초안에 반영할지 묻고, 반영되면 세계관 화면(onWorldApplied)이 초안을 다시 읽는다 ──
const enrichStep: ChatStep = {
  feature: 'world', task: 'enrich', status: 'completed',
  world: { task: 'enrich', note: '북문 규칙에 맞췄어요.', fixes: [
    { cardId: 'c1', cardTitle: '카엘', target: 'soul', episode: null, text: '말수가 적고 단호하다.' },
    { cardId: 'c1', cardTitle: '카엘', target: 'episode', episode: 3, text: '3화에서 비밀을 안다.' },
  ] },
}
const worldApproval = () => openThread([{ request: '카엘 설정을 자세히 써 줘', reply: { status: 'waiting', missingInputs: [], awaitingApproval: 'world', approvalEpisode: 2, steps: [enrichStep] } }])

it('World 제안의 승인 카드는 설정집 초안에 반영할지 묻고, 회차 문구 없이 각 칸의 새 글을 승인 전에 보인다', async () => {
  worldApproval()
  renderChat()
  await screen.findByRole('heading', { name: '이 제안을 설정집 초안에 반영할까요?' })
  expect(screen.queryByRole('heading', { name: /화 초안에 반영할까요/ })).toBeNull()
  expect(screen.getByLabelText('반영할 내용').textContent).toBe('카엘 · SOUL\n말수가 적고 단호하다.\n\n카엘 · 3회차 문서\n3화에서 비밀을 안다.\n\n참고: 북문 규칙에 맞췄어요.')
  expect(screen.getByRole('button', { name: '설정집 초안에 반영' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '반영하지 않기' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '초안에 반영' })).toBeNull()
  expect(screen.getByText(/설정집 초안만 바뀌고 확정 버전은 남지 않아요/)).toBeTruthy()
})

it('승인을 기다리는 World 제안을 읽지 못하면(결과 형식 오류) 보이지 않는 제안을 반영하지 않도록 반영 버튼만 잠근다', async () => {
  openThread([{ request: '카엘 설정을 자세히 써 줘', reply: { status: 'waiting', missingInputs: [], awaitingApproval: 'world',
    steps: [{ feature: 'world', task: 'enrich', status: 'failed', error: '세계관 결과 형식을 확인할 수 없어요.' }] } }])
  renderChat()
  await screen.findByRole('heading', { name: '이 제안을 설정집 초안에 반영할까요?' })
  expect(within(screen.getByLabelText('같이 끝난 작업')).getByText('실패: 세계관 결과 형식을 확인할 수 없어요.')).toBeTruthy()
  expect(screen.getByRole('button', { name: '설정집 초안에 반영' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '반영하지 않기' })).toHaveProperty('disabled', false)
})

it('World 제안을 설정집 초안에 반영하면 승인으로, 반영하지 않기는 거절로 이어 보낸다', async () => {
  worldApproval()
  send.mockResolvedValue(undefined)
  renderChat()
  await screen.findByRole('heading', { name: '이 제안을 설정집 초안에 반영할까요?' })
  fireEvent.click(screen.getByRole('button', { name: '설정집 초안에 반영' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true } })
  fireEvent.click(await screen.findByRole('button', { name: '반영하지 않기' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(send.mock.calls[1][2]).toMatchObject({ resume: { approved: false } })
})

const worldStream = async (props: { onApplied?: () => void; onWorldApplied?: () => void }) => {
  openThread([])
  let emit!: (event: ChatEvent) => void
  send.mockImplementation(async (_work: string, _thread: string, _input: unknown, onEvent: (event: ChatEvent) => void) => {
    emit = onEvent
    await new Promise<void>(() => {})
  })
  const view = render(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={[]} {...props} />)
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '카엘 설정을 자세히 써 줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  return { view, run: async (event: ChatEvent) => { await act(async () => { emit(event) }) } }
}

it('World 반영(step.applied)은 설정집 초안 갱신(onWorldApplied)만 알리고 회차 초안 갱신(onApplied)은 부르지 않는다', async () => {
  const onApplied = vi.fn()
  const onWorldApplied = vi.fn()
  const { run } = await worldStream({ onApplied, onWorldApplied })
  await run({ type: 'step', step: { ...enrichStep, approval: 'approved', applied: { episode: 0, revision: 9 } } })
  expect(onWorldApplied).toHaveBeenCalledTimes(1)
  expect(onApplied).not.toHaveBeenCalled()
  await run({ type: 'step', step: { feature: 'writing_editing', status: 'completed', result: { text: '본문' }, approval: 'approved', applied: { episode: 2, revision: 3 } } })
  expect(onApplied).toHaveBeenCalledWith(2)
  expect(onWorldApplied).toHaveBeenCalledTimes(1)
})

it('반영 없이 끝난 World 단계(제안만 도착·반영 거절)는 설정집 초안 갱신을 알리지 않는다', async () => {
  const onWorldApplied = vi.fn()
  const { run } = await worldStream({ onWorldApplied })
  await run({ type: 'step', step: enrichStep })
  await run({ type: 'step', step: { ...enrichStep, approval: 'declined' } })
  expect(onWorldApplied).not.toHaveBeenCalled()
})

it('오래 걸린 스트림의 World 반영 알림은 시작할 때의 핸들러가 아니라 지금의 핸들러로 간다(저장하지 않은 변경 판단이 최신이어야 한다)', async () => {
  const first = vi.fn()
  const second = vi.fn()
  const { view, run } = await worldStream({ onWorldApplied: first })
  view.rerender(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={[]} onWorldApplied={second} />)
  await run({ type: 'step', step: { ...enrichStep, approval: 'approved', applied: { episode: 0, revision: 9 } } })
  expect(second).toHaveBeenCalledTimes(1)
  expect(first).not.toHaveBeenCalled()
})

it('생성이 끝나기 전에 답변 본문을 갱신하고, 초기화와 실패에는 비운다(#618)', async () => {
  const { run } = await worldStream({})
  await run({ type: 'answer', delta: '확인해 ' })
  await run({ type: 'answer', delta: '볼게요.' })
  const writing = screen.getByText('확인해 볼게요.')
  expect(writing.closest('[aria-live]')?.getAttribute('aria-live')).toBe('off') // 조각마다 읽어 주지 않는다
  await run({ type: 'answer', delta: null })
  expect(screen.queryByText('확인해 볼게요.')).toBeNull()
  await run({ type: 'answer', delta: '**반영**했어요.' })
  expect(screen.getByText('반영').tagName).toBe('STRONG')
  await run({ type: 'error', message: '응답이 중간에 끊겼어요.' })
  expect(screen.queryByText('반영')).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('응답이 중간에 끊겼어요.')
})

it('흐르는 답은 맨 아래에서 읽을 때만 따라 내려간다(#618)', async () => {
  const { run } = await worldStream({})
  const log = screen.getByRole('log', { name: '대화 내용' })
  let height = 900
  Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
  await run({ type: 'answer', delta: '첫 줄' })
  expect(log.scrollTop).toBe(900)
  log.scrollTop = 100 // 위로 올려 읽는 중
  fireEvent.scroll(log)
  height = 1200
  await run({ type: 'answer', delta: ' 다음 줄' })
  expect(log.scrollTop).toBe(100)
})

it('AI가 처리 중일 때 전송한 요청은 말풍선에 있고 입력창은 비어 있다', async () => {
  openThread([])
  send.mockImplementation(() => new Promise(() => {}))
  render(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByText('새 대화', { selector: 'h3' })
  const input = screen.getByRole('textbox', { name: '메시지' })
  fireEvent.change(input, { target: { value: '다음 장면을 써줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  expect(await screen.findByText('다음 장면을 써줘')).toBeTruthy()
  expect(screen.getByRole('status', { name: 'AI 진행 상황' })).toBeTruthy()
  expect(input).toHaveProperty('value', '')
})

it('저장된 제공사 분류 실패를 오류 말풍선으로 표시한다', async () => {
  openThread([
    { request: '요약해줘', reply: { status: 'failed', message: '요청 분류에 실패했습니다.', steps: [], missingInputs: [] } },
    { request: '다시 요약해줘', reply: { status: 'completed', message: '요약했어요.', steps: [], missingInputs: [] } },
  ])
  render(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  expect((await screen.findByText('요청 분류에 실패했습니다.')).closest('li')?.getAttribute('data-failed')).toBe('true')
  expect(screen.getByText('요약했어요.').closest('li')?.hasAttribute('data-failed')).toBe(false)
})

it('구간 카드는 다른 회차를 열어도 멈춘 턴의 반영 회차에 고정된다(#635)', async () => {
  send.mockResolvedValue(undefined)
  waitingPatch()
  writingEpisode.mockResolvedValue({ number: 2, draft: { title: '2화', body: PATCH_BODY, revision: 4 } })
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 3 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const draft = await screen.findByLabelText(/수정할 초안 · 2화/) as HTMLTextAreaElement
  choose(draft, 0, 7)
  fireEvent.click(screen.getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(writingEpisode.mock.calls.map(([, number]) => number)).toEqual([2])
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { inputs: { writing_editing: { span: { episode: 2 } } } } })
})

it('멈춘 턴의 반영 회차를 모르면 열린 회차로 대신하지 않는다(#635)', async () => {
  openThread([{ request: '고쳐 줘', reply: { status: 'waiting', missingInputs: ['writing_editing'], awaitingApproval: null,
    steps: [{ feature: 'writing_editing', status: 'not_started', task: 'patch' }] } }])
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 3 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  expect(await screen.findByText(/고칠 회차를 알 수 없어요/)).toBeTruthy()
  expect(writingEpisode).not.toHaveBeenCalled()
})

// ── 화면 맥락과 Content 쓰기 승인(#554) ──
const pendingAction = { tool: 'world_studio_edit_draft', label: '세계관 설정 카드 수정', args: { id: 'w1', request: { expectedDraftRevision: 4, cards: [{ id: 'k', body: '과묵한 기사. 십 년째 같은 자리에 선다.' }] } } }
const approvalTurn = () => openThread([{ request: '이 설정 설명을 더 자세히 써줘', reply: { status: 'waiting', steps: [], missingInputs: [], awaitingApproval: 'content_action', pendingAction } }])

it('새 메시지를 보낼 때만 지금 화면(page)을 싣고, 이어가기에는 싣지 않는다', async () => {
  openThread([])
  send.mockResolvedValue(undefined)
  const getPage = vi.fn(() => ({ path: '/studio/w?ep=2', kind: 'studio' as const, episode: 2, selection: '그는 웃었다.' }))
  render(<WritingChat workId="w" basis={basis} getPage={getPage} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '다듬어줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ request: '다듬어줘', page: { path: '/studio/w?ep=2', episode: 2, selection: '그는 웃었다.' } })
  cleanup()
  send.mockClear()
  approvalTurn()
  render(<WritingChat workId="w" basis={basis} getPage={getPage} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  fireEvent.click(await screen.findByRole('button', { name: '실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true } })
  expect(send.mock.calls[0][2]).not.toHaveProperty('page')
})

it('새 대화를 여는 동안 회차를 옮겨도 여는 것보다 먼저 읽은 화면을 싣는다(#635)', async () => {
  sessions.mockResolvedValue([])
  history.mockResolvedValue({ threadId: 'new', title: '', turns: [] })
  send.mockResolvedValue(undefined)
  let opened!: (id: string) => void
  open.mockReturnValue(new Promise<string>((resolve) => { opened = resolve }))
  const studio = (episode: number) => <WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: episode }}
    getPage={() => ({ path: `/studio/w?ep=${episode}`, kind: 'studio', episode })} emptyTitle="새 대화" emptyText="" suggestions={[]} />
  const view = render(studio(2))
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '다듬어줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(open).toHaveBeenCalled())
  view.rerender(studio(3))
  await act(async () => opened('new'))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ targetEpisode: 2, page: { episode: 2 } })
})

it('선택 글이 너무 길면 전송하지 않고 입력을 남긴다', async () => {
  openThread([])
  const getPage = () => chatPage({ path: '/studio/w', kind: 'studio', selection: '가'.repeat(5001) })
  render(<WritingChat workId="w" basis={basis} getPage={getPage} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByText('새 대화', { selector: 'h3' })
  const input = screen.getByRole('textbox', { name: '메시지' })
  fireEvent.change(input, { target: { value: '다듬어줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  expect((await screen.findByRole('alert')).textContent).toContain('5,000자')
  expect(input).toHaveProperty('value', '다듬어줘')
  expect(send).not.toHaveBeenCalled()
})

it('화면 정보가 없으면(getPage가 비었거나 undefined를 주면) page를 싣지 않는다', async () => {
  openThread([])
  send.mockResolvedValue(undefined)
  render(<WritingChat workId="w" basis={basis} getPage={() => undefined} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).not.toHaveProperty('page')
})

it('Content 쓰기 승인 카드는 모델의 요약이 아니라 실제 도구·인자와 카드의 수정 전·후를 보인다', async () => {
  approvalTurn()
  render(<WritingChat workId="w" basis={basis} cardOf={(id) => (id === 'k' ? { title: '카엘', body: '북문을 지키는 기사' } : undefined)} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  expect(await screen.findByRole('heading', { name: '세계관 설정 카드 수정을(를) 실행할까요?' })).toBeTruthy()
  const changes = screen.getByLabelText('바뀌는 내용')
  expect(changes.textContent).toContain('카엘 · 설명')
  expect(changes.textContent).toContain('수정 전: 북문을 지키는 기사')
  expect(changes.textContent).toContain('수정 후: 과묵한 기사. 십 년째 같은 자리에 선다.')
  const args = screen.getByLabelText('실행할 도구와 인자').textContent!
  expect(args).toContain('world_studio_edit_draft')
  expect(JSON.parse(args.slice('world_studio_edit_draft'.length))).toEqual(pendingAction.args)
})

it('Content 쓰기 승인 카드는 같은 턴에 먼저 끝난 단계를 실행 버튼 위에 보인다(#587)', async () => {
  openThread([{ request: '확인하고 고쳐줘', reply: { status: 'waiting', missingInputs: [], awaitingApproval: 'content_action', pendingAction, steps: [
    { feature: 'story_context', status: 'completed', result: { claims: [{ text: '카엘은 북문을 지킨다.' }] } },
    { feature: 'writing_editing', status: 'completed', result: { text: '카엘이 문을 닫았다.' } },
    { feature: 'content_action', status: 'completed', approval: 'approved', result: { tool: 'work_update', label: '작품 정보 수정' }, applied: { episode: 3, revision: 9 } },
    { feature: 'rating', status: 'not_started' },
  ] } }])
  render(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const others = await screen.findByLabelText('같이 끝난 작업')
  // 이 승인의 대상은 Content 작업이라 아직 반영을 묻지 않은 원고 제안도 앞 단계로 보인다
  expect(within(others).getAllByRole('listitem').map((item) => item.textContent)).toEqual(
    ['작품 질문카엘은 북문을 지킨다.', '기획·집필·수정카엘이 문을 닫았다.', 'Content 작업작품 정보 수정 완료'])
  expect(screen.getByText('같이 끝난 작업')).toBeTruthy() // 실행할 내용으로 읽히지 않게 이름이 화면에도 보인다
  expect(others.compareDocumentPosition(screen.getByRole('button', { name: '실행' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('앞 단계가 없는 Content 쓰기 승인 카드에는 빈 목록을 그리지 않는다(#587)', async () => {
  approvalTurn()
  render(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByRole('button', { name: '실행' })
  expect(screen.queryByLabelText('같이 끝난 작업')).toBeNull()
})

it('거절하면 실행하지 않는다는 resume을 보낸다', async () => {
  approvalTurn()
  send.mockResolvedValue(undefined)
  render(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  fireEvent.click(await screen.findByRole('button', { name: '실행하지 않기' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: false } })
})

it('저장하지 않은 편집이 있으면 승인 버튼을 막고 먼저 저장해 달라고 알린다(거절은 할 수 있다)', async () => {
  approvalTurn()
  render(<WritingChat workId="w" basis={basis} unsaved emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  await screen.findByRole('heading', { name: '세계관 설정 카드 수정을(를) 실행할까요?' })
  expect(screen.getByRole('button', { name: '실행' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '실행하지 않기' })).toHaveProperty('disabled', false)
  expect(screen.getByRole('alert').textContent).toContain('먼저 저장해 주세요')
  expect(send).not.toHaveBeenCalled()
})

it('저장 뒤 이전 제안은 승인할 수 없고 멈춘 자리에서 제안만 다시 받는다(#662)', async () => {
  approvalTurn()
  send.mockResolvedValue(undefined)
  const props = { workId: 'w', basis, emptyTitle: '새 대화', emptyText: '', suggestions: [], getPage: () => ({ kind: 'world' as const, path: '/worldstudio/w1', worldId: 'w1' }) }
  const view = render(<WritingChat {...props} worldDraft={{ id: 'w1', revision: 4 }} unsaved />)
  expect(await screen.findByRole('button', { name: '실행' })).toHaveProperty('disabled', true)
  view.rerender(<WritingChat {...props} worldDraft={{ id: 'w1', revision: 5 }} />)
  expect(screen.queryByRole('button', { name: '실행' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '저장한 초안으로 제안 다시 받기' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: false, refresh: true } })
  // 요청을 다시 실행하면 같은 턴에서 이미 저장한 쓰기까지 다시 제안된다
  expect(send.mock.calls[0][2]).not.toHaveProperty('request')
  expect(send.mock.calls[0][5]).toBeUndefined() // 메시지 수정(editIndex)이 아니다
})

it('실행할 인자를 읽지 못한 승인 대기는 가짜 카드 없이 알린다', async () => {
  openThread([{ request: '고쳐줘', reply: { status: 'waiting', steps: [], missingInputs: [], awaitingApproval: 'content_action' } }])
  render(<WritingChat workId="w" basis={basis} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  expect((await screen.findByRole('alert')).textContent).toContain('승인할 작업을 읽지 못했어요')
  expect(screen.queryByRole('button', { name: '실행' })).toBeNull()
})

it('승인한 Content 세계관 카드 수정이 반영되면 설정집을 다시 읽고, 다른 도구는 회차 초안 다시 읽기를 부른다', async () => {
  const onWorldApplied = vi.fn()
  const onApplied = vi.fn()
  const { run } = await worldStream({ onApplied, onWorldApplied })
  const done = (tool: string, revision: number): ChatStep => ({ feature: 'content_action', status: 'completed', approval: 'approved', result: { tool, label: '작업' }, applied: { episode: 3, revision } })
  await run({ type: 'step', step: done('world_studio_edit_draft', 5) })
  expect(onWorldApplied).toHaveBeenCalledTimes(1)
  expect(onApplied).not.toHaveBeenCalled()
  await run({ type: 'step', step: done('work_update', 9) })
  expect(onApplied).toHaveBeenCalledWith(3)
  // 진행 표시는 승인한 작업을 단계마다 덧붙인다(계획에 없던 단계도 사라지지 않는다).
  expect(screen.getAllByText('Content 작업').length).toBe(2)
})

// ── 계획 수정(#578): revise_plan 제안은 회차 초안이 아니라 저장된 계획에 저장할지 묻고, 저장돼도 회차 초안 갱신(onApplied)은 알리지 않는다 ──
const reviseStep: ChatStep = {
  feature: 'writing_editing', task: 'revise_plan', status: 'completed',
  planRevision: { kind: 'scene', before: { title: '재회', content: '카엘이 리나를 만난다.' }, after: { title: '재회', content: '카엘이 리나를 만나지만 이름을 부르지 못한다.' } },
}
const reviseApproval = (steps: ChatStep[] = [reviseStep]) =>
  openThread([{ request: '재회 장면을 더 긴장감 있게 고쳐줘', reply: { status: 'waiting', missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 2, steps } }])

it('계획 수정 제안의 승인 카드는 계획 제목으로 저장할지 묻고, 회차 초안 문구 없이 대상과 변경 전·후를 승인 전에 보인다', async () => {
  reviseApproval()
  renderChat()
  await screen.findByRole('heading', { name: "'재회' 계획에 저장할까요?" })
  expect(screen.queryByRole('heading', { name: /화 초안에 반영할까요/ })).toBeNull()
  expect(screen.getByLabelText('반영할 내용').textContent).toBe("장면 계획 '재회' 수정안\n수정 전: 카엘이 리나를 만난다.\n수정 후: 카엘이 리나를 만나지만 이름을 부르지 못한다.")
  expect(screen.getByRole('button', { name: '계획에 저장' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '저장하지 않기' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '초안에 반영' })).toBeNull()
  expect(screen.getByText(/계획의 제목·내용만 바뀌고 원고 초안은 바뀌지 않아요/)).toBeTruthy()
})

it('승인을 기다리는 계획 수정안을 읽지 못하면(결과 형식 오류) 보이지 않는 제안을 저장하지 않도록 저장 버튼만 잠근다', async () => {
  reviseApproval([{ feature: 'writing_editing', task: 'revise_plan', status: 'failed', error: '계획 수정안 형식을 확인할 수 없어요.' }])
  renderChat()
  await screen.findByRole('heading', { name: '이 제안을 계획에 저장할까요?' })
  expect(within(screen.getByLabelText('같이 끝난 작업')).getByText('실패: 계획 수정안 형식을 확인할 수 없어요.')).toBeTruthy()
  expect(screen.getByRole('button', { name: '계획에 저장' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '저장하지 않기' })).toHaveProperty('disabled', false)
})

it('계획에 저장은 승인으로, 저장하지 않기는 거절로 이어 보낸다', async () => {
  reviseApproval()
  send.mockResolvedValue(undefined)
  renderChat()
  await screen.findByRole('heading', { name: "'재회' 계획에 저장할까요?" })
  fireEvent.click(screen.getByRole('button', { name: '계획에 저장' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true } })
  fireEvent.click(await screen.findByRole('button', { name: '저장하지 않기' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(send.mock.calls[1][2]).toMatchObject({ resume: { approved: false } })
})

it('계획 수정 저장(step.applied)은 회차 초안 갱신(onApplied)도 설정집 갱신(onWorldApplied)도 알리지 않는다', async () => {
  const onApplied = vi.fn()
  const onWorldApplied = vi.fn()
  const { run } = await worldStream({ onApplied, onWorldApplied })
  await run({ type: 'step', step: { ...reviseStep, approval: 'approved', applied: { episode: 2, revision: 6 } } })
  expect(onApplied).not.toHaveBeenCalled()
  expect(onWorldApplied).not.toHaveBeenCalled()
})

// 집필실처럼 chat을 직접 만드는 화면은 계획 재조회 콜백(#637)을 그 Hook에 넘긴다.
const planStream = async (callbacks: { onApplied?: (episode: number) => void; onWorldApplied?: () => void; onPlanApplied?: () => void }) => {
  openThread([])
  let emit!: (event: ChatEvent) => void
  send.mockImplementation(async (_work: string, _thread: string, _input: unknown, onEvent: (event: ChatEvent) => void) => {
    emit = onEvent
    await new Promise<void>(() => {})
  })
  function StudioChat() {
    const chat = useWritingChatViewModel('w', basis, callbacks.onApplied, callbacks.onWorldApplied, undefined, callbacks.onPlanApplied)
    return <WritingChat workId="w" chat={chat} emptyTitle="새 대화" emptyText="" suggestions={[]} />
  }
  render(<StudioChat />)
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '재회 장면 계획을 바꿔 줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  return { run: async (event: ChatEvent) => { await act(async () => { emit(event) }) } }
}

it('계획 수정 저장(step.applied)은 계획 재조회(onPlanApplied)만 알리고 회차 초안·설정집 갱신은 알리지 않는다(#637)', async () => {
  const onApplied = vi.fn()
  const onWorldApplied = vi.fn()
  const onPlanApplied = vi.fn()
  const { run } = await planStream({ onApplied, onWorldApplied, onPlanApplied })
  await run({ type: 'step', step: reviseStep })  // 제안만 도착: 저장 전이라 아무것도 다시 읽지 않는다
  expect(onPlanApplied).not.toHaveBeenCalled()
  await run({ type: 'step', step: { ...reviseStep, approval: 'declined' } })
  expect(onPlanApplied).not.toHaveBeenCalled()
  await run({ type: 'step', step: { ...reviseStep, approval: 'approved', applied: { episode: 2, revision: 6 } } })
  expect(onPlanApplied).toHaveBeenCalledTimes(1)
  expect(onApplied).not.toHaveBeenCalled()
  expect(onWorldApplied).not.toHaveBeenCalled()
})

it('승인한 Content 계획 도구(story_plan_create·story_plan_update)도 계획 재조회만 알린다(#637)', async () => {
  const onApplied = vi.fn()
  const onPlanApplied = vi.fn()
  const { run } = await planStream({ onApplied, onPlanApplied })
  const done = (tool: string, revision: number): ChatStep => ({ feature: 'content_action', status: 'completed', approval: 'approved', result: { tool, label: '작업' }, applied: { episode: 3, revision } })
  await run({ type: 'step', step: done('story_plan_create', 2) })
  await run({ type: 'step', step: done('story_plan_update', 3) })
  expect(onPlanApplied).toHaveBeenCalledTimes(2)
  expect(onApplied).not.toHaveBeenCalled()
})

// 첨부(#617): 고른 파일을 Base64로 읽어 새 요청 본문의 attachments로 보내고, 진행 중 턴과 기록의 내 메시지에는 이름만 칩으로 보인다.
describe('집필 AI 채팅 첨부(#617)', () => {
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], '지도.png', { type: 'image/png' })
  const note = (text = '북문은 밤에 닫힌다.') => new File([text], '메모.md', { type: '' })
  const attach = (...files: File[]) => fireEvent.drop(document.querySelector('.chat-card')!, { dataTransfer: { files } })
  const ask = (text: string) => { fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: text } }); fireEvent.click(screen.getByRole('button', { name: '전송' })) }
  const chipsOf = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('listitem').map((li) => li.textContent)

  it('고른 이미지·텍스트를 Base64로 읽어 새 요청에 싣고, 보낸 첨부는 입력창에서 비운다', async () => {
    openThread([])
    send.mockResolvedValue(undefined)
    renderChat()
    await screen.findByText('새 대화', { selector: 'h3' })
    attach(png(), note())
    ask('이 자료로 장면을 이어 줘')
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][2]).toMatchObject({
      episode: 1, episodeVersionId: 'v', request: '이 자료로 장면을 이어 줘',
      attachments: [
        { name: '지도.png', mediaType: 'image/png', data: btoa(String.fromCharCode(137, 80, 78, 71)) },
        { name: '메모.md', mediaType: 'text/markdown', data: btoa(String.fromCharCode(...new TextEncoder().encode('북문은 밤에 닫힌다.'))) },
      ],
    })
    await waitFor(() => expect(screen.queryByRole('list', { name: '보낼 첨부' })).toBeNull())
  })

  it('첨부를 읽는 동안 회차를 옮겨도 보낸 때의 화면과 반영 회차를 싣는다(#635)', async () => {
    openThread([])
    send.mockResolvedValue(undefined)
    const studio = (episode: number, selection: string) => <WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: episode }}
      getPage={() => ({ path: `/studio/w?ep=${episode}`, kind: 'studio', episode, selection })} emptyTitle="새 대화" emptyText="" suggestions={[]} />
    const view = render(studio(2, '2화에서 고른 글'))
    await screen.findByText('새 대화', { selector: 'h3' })
    attach(note())
    ask('다듬어줘')
    view.rerender(studio(3, '3화에서 고른 글'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][2]).toMatchObject({ targetEpisode: 2, page: { episode: 2, selection: '2화에서 고른 글' } })
  })

  it('첨부 없이 보낸 요청은 attachments 키 없이 예전과 같은 본문이다', async () => {
    openThread([])
    send.mockResolvedValue(undefined)
    renderChat()
    await screen.findByText('새 대화', { selector: 'h3' })
    ask('첨부 없는 질문')
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][2]).toEqual({ episode: 1, episodeVersionId: 'v', request: '첨부 없는 질문' })
  })

  it('진행 중인 내 메시지에 첨부 칩이 보이고, 끝난 뒤 이력을 다시 읽으면 기록의 칩으로 이어진다', async () => {
    openThread([])
    let finish!: () => void
    send.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    renderChat()
    await screen.findByText('새 대화', { selector: 'h3' })
    attach(png(), note())
    ask('이 자료를 봐줘')
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(chipsOf('첨부')).toEqual(['이미지 · 지도.png', '텍스트 · 메모.md'])
    history.mockResolvedValue({ threadId: 'a', title: '', turns: [{
      request: '이 자료를 봐줘', reply: { status: 'completed', message: '봤어요.', steps: [], missingInputs: [] },
      attachments: [{ name: '지도.png', kind: 'image' }, { name: '메모.md', kind: 'text' }],
    }] })
    await act(async () => finish())
    expect(await screen.findByText('봤어요.')).toBeTruthy()
    expect(chipsOf('첨부')).toEqual(['이미지 · 지도.png', '텍스트 · 메모.md'])
  })

  it('이력의 첨부 없는 턴과 옛 기록(첨부 키 없음)에는 칩이 없다', async () => {
    openThread([{ request: '옛 질문', reply: null }, { request: '새 질문', reply: null, attachments: [] }])
    renderChat()
    await screen.findByText('옛 질문')
    expect(screen.queryByRole('list', { name: '첨부' })).toBeNull()
  })

  it('텍스트가 20,000자를 넘으면 보내지 않고 이유를 알리며 글과 첨부를 그대로 둔다', async () => {
    openThread([])
    renderChat()
    await screen.findByText('새 대화', { selector: 'h3' })
    attach(note('가'.repeat(20001)))
    ask('이 글을 봐줘')
    expect(await screen.findByText('메모.md: 텍스트 파일은 20,000자까지 보낼 수 있어요.')).toBeTruthy()
    expect(send).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox', { name: '메시지' }) as HTMLTextAreaElement).value).toBe('이 글을 봐줘')
    expect(chipsOf('보낼 첨부')).toEqual(['텍스트 · 메모.md×'])
  })

  it('승인·입력 이어가기와 메시지 고치기에는 첨부를 싣지 않는다', async () => {
    openThread([{ request: '이어 써 줘', reply: { status: 'waiting', steps: [{ feature: 'writing_editing', status: 'completed', result: { text: '선장은 내렸다.' } }], missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 1 },
      attachments: [{ name: '지도.png', kind: 'image' }] }])
    send.mockResolvedValue(undefined)
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: '초안에 반영' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][2]).toEqual({ episode: 1, episodeVersionId: 'v', resume: { approved: true } })
  })

  it('고친 메시지는 첨부 없이 글만 다시 보내고 고친 턴의 기록에는 칩이 남지 않는다', async () => {
    openThread([{ request: '첫 질문', reply: { status: 'completed', message: '답', steps: [], missingInputs: [] }, attachments: [{ name: '지도.png', kind: 'image' }] }])
    send.mockResolvedValue(undefined)
    renderChat()
    await screen.findByText('첫 질문')
    fireEvent.click(screen.getByRole('button', { name: '이 메시지 고치기' }))
    fireEvent.change(screen.getByLabelText('고칠 메시지'), { target: { value: '고친 질문' } })
    history.mockResolvedValue({ threadId: 'a', title: '', turns: [{ request: '고친 질문', reply: null, attachments: [] }] })
    fireEvent.click(screen.getByRole('button', { name: '고쳐서 다시 보내기' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][2]).toEqual({ episode: 1, episodeVersionId: 'v', request: '고친 질문' })
    expect(send.mock.calls[0][5]).toBe(0)
    await screen.findByText('고친 질문')
    expect(screen.queryByRole('list', { name: '첨부' })).toBeNull()
  })

  it('이어가는 중에도 멈춘 턴의 첨부 칩을 그 턴의 내 메시지에 그대로 보인다', async () => {
    openThread([{ request: '이 지도로 이어 써 줘', reply: { status: 'waiting', steps: [], missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 1 },
      attachments: [{ name: '지도.png', kind: 'image' }] }])
    send.mockImplementation(() => new Promise<void>(() => {}))
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: '초안에 반영' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(chipsOf('첨부')).toEqual(['이미지 · 지도.png'])
  })
})
