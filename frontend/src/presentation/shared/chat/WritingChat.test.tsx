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
  expect(screen.getByText('사용한 계획: 항구의 밤 — 선장이 도착한다.')).toBeTruthy()
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

it('함께 시작한 단계는 다른 단계의 결과가 먼저 와도 끝날 때까지 진행 중으로 보인다(#474 병렬 호출)', async () => {
  openThread([])
  let emit!: (event: ChatEvent) => void
  send.mockImplementation(async (_work: string, _thread: string, _input: unknown, onEvent: (event: ChatEvent) => void) => {
    emit = onEvent
    await new Promise<void>(() => {})
  })
  renderChat()
  await screen.findByText('새 대화', { selector: 'h3' })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '등급 보고 설정집도 검토해줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  const run = async (event: ChatEvent) => { await act(async () => { emit(event) }) }
  await run({ type: 'plan', steps: [{ feature: 'rating', status: 'not_started' }, { feature: 'world_review', status: 'not_started' }] })
  await run({ type: 'started', feature: 'rating' })
  await run({ type: 'started', feature: 'world_review' })
  const progress = screen.getByRole('status', { name: 'AI 진행 상황' })
  const states = () => within(progress).getAllByText(/./, { selector: '.chat-step-state' }).map((e) => e.textContent)
  expect(states()).toEqual(['진행 중', '진행 중'])
  await run({ type: 'step', step: { feature: 'world_review', status: 'failed', error: '검토 실패' } })
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
  fireEvent.click(screen.getByRole('checkbox'))
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
  fireEvent.click(screen.getByRole('checkbox'))
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

it('집필 입력 대기는 근거 회차가 아니라 열린(반영) 회차의 장면 계획을 받고, 요청에 반영 회차를 싣는다', async () => {
  openThread([{ request: '이어 써 줘', reply: { status: 'waiting', steps: [], missingInputs: ['writing_editing'], awaitingApproval: null } }])
  send.mockResolvedValue(undefined)
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  fireEvent.change(within(form).getByLabelText(/쓸 장면 계획 · 2화/), { target: { value: '선장이 항구에 도착한다.' } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(within(form).getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({
    episode: 1, episodeVersionId: 'v', targetEpisode: 2,
    resume: { approved: true, inputs: { writing_editing: { draft: { episodeNumber: 2, plan: '선장이 항구에 도착한다.' } } } },
  })
})

it('부분 수정(task=patch) 입력 대기는 새 원고 계획 칸을 띄우지 않고, 채팅에서 채울 수 없다고 알린다', async () => {
  openThread([{ request: '3문단 말투만 고쳐 줘', reply: { status: 'waiting', missingInputs: ['writing_editing'], awaitingApproval: null,
    steps: [{ feature: 'writing_editing', status: 'not_started', task: 'patch' }] } }])
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  expect(within(form).queryByLabelText(/쓸 장면 계획/)).toBeNull()
  expect(within(form).getByText(/화면에서 채울 수 없어요/)).toBeTruthy()
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
})

it('원고 검수 입력 대기는 검수 종류를 골라야 이어서 실행하고, 고른 종류를 단계 입력으로 보낸다', async () => {
  openThread([{ request: '검수해 줘', reply: { status: 'waiting', steps: [], missingInputs: ['review'], awaitingApproval: null } }])
  send.mockResolvedValue(undefined)
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  expect(within(form).getByRole('group', { name: '검수 종류 · 2화 초안' })).toBeTruthy()
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
  fireEvent.click(within(form).getByRole('radio', { name: /설정·개연성/ }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(within(form).getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true, inputs: { review: { check: 'semantic' } } } })
})

it('조건부 수정 입력 대기는 확정 지적만 보기로 두고, 고른 지적 번호를 단계 입력으로 보낸다(#370)', async () => {
  const finding = (quote: string, status: string) => ({ category: 'spelling', quote, reason: `${quote} 오류`, status, evidenceRefs: [], suggestion: '', start: status === 'confirmed' ? 0 : null, end: status === 'confirmed' ? 1 : null })
  const review = { check: 'mechanical', episode: 2, revision: 4, gaps: [], findings: [finding('웃엇다', 'confirmed'), finding('비가', 'suspected'), finding('말햇다', 'confirmed')] }
  openThread([{ request: '검수하고 틀리면 고쳐 줘', reply: { status: 'waiting', missingInputs: ['writing_editing'], awaitingApproval: null, steps: [
    { feature: 'review', status: 'completed', review }, { feature: 'writing_editing', when: 'if_issues_found', status: 'not_started' }] } }])
  send.mockResolvedValue(undefined)
  render(<WritingChat workId="w" basis={{ episode: 1, episodeVersionId: 'v', targetEpisode: 2 }} emptyTitle="새 대화" emptyText="" suggestions={[]} />)
  const form = (await screen.findByRole('heading', { name: '작업에 필요한 내용을 알려 주세요' })).closest('form') as HTMLElement
  const group = within(form).getByRole('group', { name: '고칠 지적 · 2화 초안' })
  expect(within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['"웃엇다" — 웃엇다 오류', '"말햇다" — 말햇다 오류'])
  expect(within(form).queryByRole('textbox')).toBeNull()  // 장면 계획을 적는 새 원고 입력이 아니다
  expect(within(form).getByRole('button', { name: '이어서 실행' })).toHaveProperty('disabled', true)
  fireEvent.click(within(group).getByRole('radio', { name: /말햇다/ }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(within(form).getByRole('button', { name: '이어서 실행' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true, inputs: { writing_editing: { fix: 2 } } } })
})

it('조건부 수정 지적 고르기 중에도 직전 검수 결과(제안·의심·확인 못 함)가 보인다(#391)', async () => {
  const finding = (quote: string, status: string) => ({ category: 'spelling', quote, reason: `${quote} 오류`, status, evidenceRefs: [], suggestion: `${quote} 고침`, start: status === 'confirmed' ? 0 : null, end: status === 'confirmed' ? 1 : null })
  const review = { check: 'mechanical', episode: 2, revision: 4, gaps: ['날짜 비교 대상 없음'], findings: [finding('웃엇다', 'confirmed'), finding('비가', 'suspected'), finding('말햇다', 'confirmed')] }
  openThread([{ request: '검수하고 틀리면 고쳐 줘', reply: { status: 'waiting', missingInputs: ['writing_editing'], awaitingApproval: null, steps: [
    { feature: 'review', status: 'completed', review }, { feature: 'writing_editing', when: 'if_issues_found', status: 'not_started' }] } }])
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
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByRole('textbox', { name: '메시지' }), { target: { value: '검수하고 틀리면 고쳐 줘' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  await act(async () => { emit({ type: 'plan', steps: [{ feature: 'review', status: 'not_started' }, { feature: 'writing_editing', when: 'if_issues_found', status: 'not_started' }] }) })
  await act(async () => { emit({ type: 'step', step: { feature: 'review', status: 'completed', review: { check: 'mechanical', episode: 2, revision: 4, findings: [], gaps: [] } } }) })
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
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(within(log).getByRole('button', { name: 'IF 시뮬레이션: "만약 ~했다면?"' }))
  expect((screen.getByRole('textbox', { name: '메시지' }) as HTMLTextAreaElement).value).toBe('IF 시뮬레이션: "만약 ~했다면?"')
  expect(send).not.toHaveBeenCalled()
})
