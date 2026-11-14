// @vitest-environment jsdom
// 시뮬레이션 무대(#58): 공용 채팅 ViewModel + 무대 ViewModel + 무대 화면을 가짜 서버(턴마다 SSE를 흘리고 체크포인트를 갱신)와 함께 검증한다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import { sceneLine, type CharacterSimulation, type SimulationTurn } from '../../../domain/entities/characterSimulation'
import type { StoryPlan } from '../../../domain/entities/storyPlan'
import type { ChatEvent, ChatMessageInput, ChatReply, ChatStep } from '../../../domain/entities/writingChat'
import { SimulationStage } from './SimulationStage'
import { useSimulationStageViewModel } from './useSimulationStageViewModel'
import { useWritingChatViewModel } from './useWritingChatViewModel'

const { sessions, history, send, open, list, references } = vi.hoisted(() => ({ sessions: vi.fn(), history: vi.fn(), send: vi.fn(), open: vi.fn(), list: vi.fn(), references: vi.fn() }))
// 채팅은 실제 WritingChatUseCase(장면 조작·시작 값 검증·정리) 위에 가짜 Repository를 얹어 와이어에 닿는 값을 본다. 장면 계획은 대역 UseCase다.
vi.mock('../../../app/appContainer', async () => {
  const { WritingChatUseCase } = await import('../../../domain/usecases/WritingChatUseCase')
  const chat = new WritingChatUseCase({ sessions, history, send, open } as never)
  const plans = { list, references }
  return { appContainer: { resolve: (key: string) => (key === 'storyPlanUseCase' ? plans : chat) } }
})

// ── 시작 양식이 읽는 장면 계획·세계관 인물(기존 StoryPlanUseCase 대역) ──
const CHARACTERS = [{ id: 'c1', name: '카엘' }, { id: 'c2', name: '리안' }, { id: 'c3', name: '도윤' }, { id: 'c4', name: '서연' }, { id: 'c5', name: '하준' }, { id: 'c6', name: '지우' }, { id: 'c7', name: '민서' }]
const plan = (id: string, title: string, content: string, extra: Partial<StoryPlan> = {}): StoryPlan =>
  ({ id, workId: 'w', kind: 'scene', parentId: 'p1', title, content, episodeNumber: 4, characterIds: [], placeIds: [], revision: 1, episodeMissing: false, ...extra })

// ── 가짜 서버: 저장된 응답(체크포인트)과 요청마다의 동작 ──
const store: { request: string; reply: ChatReply | null } = { request: '', reply: null }
type Emit = (event: ChatEvent) => void
type Handler = (input: ChatMessageInput, emit: Emit) => void | Promise<void>
let handlers: Handler[] = []
const inputs = () => send.mock.calls.map((call) => call[2] as ChatMessageInput)
const resumes = () => inputs().map((input) => ('resume' in input ? input.resume : null))

const turn = (index: number, kind: 'narration' | 'character', name: string, prose: string, extra: Partial<SimulationTurn> = {}): SimulationTurn => ({
  index, kind, pov: 'omniscient', characterId: kind === 'narration' ? null : `c${index}`, characterName: name, prose,
  checks: kind === 'narration' ? [] : [{ kind: 'voice_mix', passed: true, detail: '말투가 같아요.' }],
  regenerated: 0, evidence: kind === 'narration' ? [] : [{ ref: 'card:1', source: 'graph' }], editedByAuthor: false, ...extra,
})
const narrate = (index: number, prose = '성문은 닫혀 있었다.') => turn(index, 'narration', '나레이션', prose)
const speak = (index: number, name = '카엘', prose = '"열어라."') => turn(index, 'character', name, prose)
const scene = (turns: SimulationTurn[], extra: Partial<CharacterSimulation> = {}): CharacterSimulation =>
  ({ mode: 'flow', premise: null, beats: [], turns, notes: [], status: 'paused', stopReason: null, ...extra })
const stepOf = (simulation: CharacterSimulation, extra: Partial<ChatStep> = {}): ChatStep => ({ feature: 'character_simulation', status: 'completed', simulation, ...extra })

/** 턴 하나를 만든 뒤 턴 사이 대기로 멈춘다(step → waiting → done, 체크포인트도 갱신). */
const pauseAt = (emit: Emit, simulation: CharacterSimulation) => {
  const steps = [stepOf(simulation)]
  store.reply = { status: 'waiting', steps, missingInputs: [], awaitingScene: 'character_simulation' }
  emit({ type: 'step', step: steps[0] })
  emit({ type: 'waiting', steps, missingInputs: [], awaitingScene: 'character_simulation' })
  emit({ type: 'done', reply: store.reply })
}
/** 장면이 끝나 작가의 승인을 기다린다. */
const reviewAt = (emit: Emit, simulation: CharacterSimulation) => {
  const steps = [stepOf(simulation)]
  store.reply = { status: 'waiting', steps, missingInputs: [], awaitingApproval: 'character_simulation', approvalEpisode: 3 }
  emit({ type: 'step', step: steps[0] })
  emit({ type: 'waiting', steps, missingInputs: [], awaitingApproval: 'character_simulation' })
  emit({ type: 'done', reply: store.reply })
}
const finish = (emit: Emit, simulation: CharacterSimulation, extra: Partial<ChatStep> = {}) => {
  store.reply = { status: 'completed', steps: [stepOf(simulation, extra)], missingInputs: [] }
  emit({ type: 'step', step: store.reply.steps[0] })
  emit({ type: 'done', reply: store.reply })
}
const serve = (...next: Handler[]) => { handlers = next }

const BASIS = { episode: 3, episodeVersionId: 'v3' }
const onApplied = vi.fn()
function Host({ basis = BASIS }: { basis?: typeof BASIS | null }) {
  const chat = useWritingChatViewModel('w', basis, onApplied)
  const stage = useSimulationStageViewModel(chat)
  return <>
    <button type="button" onClick={stage.show}>시뮬레이션</button>
    {stage.open && <SimulationStage stage={stage} workId="w" episode={3} planEpisode={4} plotLink={<a href="/plot">플롯 화면</a>} onClose={stage.hide} />}
    <p data-testid="chat-line">{chat.simulation ? sceneLine(chat.simulation) : ''}</p>
  </>
}
const stage = () => screen.getByRole('region', { name: '인물 시뮬레이션 무대' })
const box = () => within(stage())
const lines = () => within(box().getByRole('list', { name: '장면 대본' })).getAllByRole('listitem').filter((li) => li.classList.contains('stage-turn'))
const consent = () => fireEvent.click(box().getByRole('checkbox', { name: /OpenAI/ }))
const PREMISE = '만약 카엘이 성문을 열었다면?'
/** 시작 양식(IF)을 채워 시작한다: 전제와 인물 한 명. 양식은 장면 계획·인물을 읽은 뒤에야 나온다. */
const begin = async (premise = PREMISE) => {
  fireEvent.click(screen.getByRole('button', { name: '시뮬레이션' }))
  fireEvent.change(await box().findByRole('textbox', { name: '전제' }), { target: { value: premise } })
  fireEvent.click(box().getByRole('checkbox', { name: '카엘' }))
  consent()
  fireEvent.click(box().getByRole('button', { name: '시뮬레이션 시작' }))
}
const setup = (...next: Handler[]) => { serve(...next); return render(<Provider store={createAppStore()}><Host /></Provider>) }
const pause = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
/** 서버를 거치지 않고 저장된 대화에서 시작한다(새로 고침 뒤). */
const reload = (reply: ChatReply) => { store.request = '시뮬레이션'; store.reply = reply; sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }]) }

beforeEach(() => {
  store.request = ''; store.reply = null; handlers = []
  list.mockResolvedValue([])
  references.mockResolvedValue({ characters: CHARACTERS, places: [], episodes: [{ number: 4, title: '넷째' }] })
  sessions.mockResolvedValue([])
  open.mockResolvedValue('a')
  history.mockImplementation(async () => ({ threadId: 'a', title: '', turns: store.reply ? [{ request: store.request, reply: store.reply }] : [] }))
  send.mockImplementation(async (_work: string, _thread: string, input: ChatMessageInput, onEvent: Emit) => {
    if ('request' in input) store.request = input.request
    const next = handlers.shift()
    if (!next) throw new Error('예상하지 못한 요청')
    await next(input, onEvent)
  })
})
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks() })

// ── 시작 양식(버튼 진입) ──
const openForm = async () => {
  fireEvent.click(screen.getByRole('button', { name: '시뮬레이션' }))
  await box().findByRole('group', { name: '시뮬레이션 방식' })
}
const startButton = () => box().getByRole('button', { name: '시뮬레이션 시작' }) as HTMLButtonElement
const pick = (...names: string[]) => names.forEach((name) => fireEvent.click(box().getByRole('checkbox', { name })))

it('시뮬레이션 버튼으로 무대를 열면 IF 양식이 먼저 나와 예시 placeholder의 전제와 세계관 인물 목록을 보이고, 전제·인물·동의가 갖춰져야 시작할 수 있다', async () => {
  setup()
  await openForm()
  expect((box().getByRole('radio', { name: /IF/ }) as HTMLInputElement).checked).toBe(true)
  const premise = box().getByRole('textbox', { name: '전제' }) as HTMLInputElement
  expect(premise.placeholder).toMatch(/만약 .*다면/)
  expect(premise.maxLength).toBe(500)
  expect(within(box().getByRole('group', { name: '참여 인물 (1~6명)' })).getAllByRole('checkbox').map((c) => (c as HTMLInputElement).labels?.[0]?.textContent)).toEqual(CHARACTERS.map((c) => c.name))
  expect(startButton().disabled).toBe(true)
  fireEvent.change(premise, { target: { value: PREMISE } })
  pick('카엘')
  expect(startButton().disabled).toBe(true)
  expect(box().getByText('동의에 체크하면 보낼 수 있어요.')).toBeTruthy()
  consent()
  expect(startButton().disabled).toBe(false)
  expect(list).toHaveBeenCalledWith('w', expect.anything())
  expect(send).not.toHaveBeenCalled()
})

it('IF 시작은 operation과 simulation(전제·인물)을 싣고 요청 문장은 모드와 전제를 알린다(의도 분류를 건너뛴다)', async () => {
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0)])) }, () => {})
  await begin()
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(inputs()[0]).toEqual({
    ...BASIS, consent: true, request: `IF 모드 시뮬레이션: ${PREMISE}`, operation: 'character_simulation',
    simulation: { mode: 'if', premise: PREMISE, characterIds: ['c1'] },
  })
  serve()
})

it('참여 인물은 6명까지만 고를 수 있다', async () => {
  setup()
  await openForm()
  pick('카엘', '리안', '도윤', '서연', '하준', '지우')
  expect((box().getByRole('checkbox', { name: '민서' }) as HTMLInputElement).disabled).toBe(true)
  expect(box().getByText('6명 선택')).toBeTruthy()
  pick('지우')
  expect((box().getByRole('checkbox', { name: '민서' }) as HTMLInputElement).disabled).toBe(false)
})

it('요청을 기다리는 동안 시작 버튼을 잠그고 같은 요청을 다시 보내지 않는다', async () => {
  let release!: () => void
  setup(async () => { await new Promise<void>((resolve) => { release = resolve }) })
  await begin()
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(startButton().disabled).toBe(true)
  fireEvent.submit(box().getByRole('textbox', { name: '전제' }).closest('form')!)
  expect(send).toHaveBeenCalledTimes(1)
  serve(); await act(async () => { release() })
})

it('흐름 양식은 열린 회차의 장면 계획을 순서대로 비트로 보이고 그 인물을 미리 고르며, 시작하면 비트와 인물을 싣는다', async () => {
  list.mockResolvedValue([
    plan('s1', '성문 대면', '카엘이 성문 앞에서 리안과 마주친다.', { characterIds: ['c1', 'c2'] }),
    plan('p0', '전체 줄거리', '플롯', { kind: 'plot', parentId: null, episodeNumber: null }),
    plan('s0', '다른 회차', '3화의 장면', { episodeNumber: 3, characterIds: ['c3'] }),
    plan('s2', '협상', '두 사람이 조건을 흥정한다.', { characterIds: ['c2', 'c4'] }),
  ])
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0)])) }, () => {})
  await openForm()
  fireEvent.click(box().getByRole('radio', { name: /흐름/ }))
  expect(box().getByText(/4화의 장면 계획 2개를 순서대로 비트로 써요/)).toBeTruthy()
  expect(within(box().getByRole('list', { name: '흐름 비트' })).getAllByRole('listitem').map((li) => li.textContent))
    .toEqual(['성문 대면: 카엘이 성문 앞에서 리안과 마주친다.', '협상: 두 사람이 조건을 흥정한다.'])
  expect(CHARACTERS.filter((c) => (box().getByRole('checkbox', { name: c.name }) as HTMLInputElement).checked).map((c) => c.id)).toEqual(['c1', 'c2', 'c4'])
  pick('도윤') // 양식에서 인물을 고칠 수 있다.
  consent()
  fireEvent.click(startButton())
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(inputs()[0]).toMatchObject({
    request: '흐름 모드 시뮬레이션: 장면 계획 2개', operation: 'character_simulation',
    simulation: { mode: 'flow', beats: ['성문 대면: 카엘이 성문 앞에서 리안과 마주친다.', '협상: 두 사람이 조건을 흥정한다.'], characterIds: ['c1', 'c2', 'c3', 'c4'] },
  })
  serve()
})

it('열린 회차의 장면 계획이 없으면 그 사실과 플롯 안내를 보이고, 비트를 직접 한 줄씩 적어 흐름 시뮬레이션을 시작할 수 있다', async () => {
  list.mockResolvedValue([plan('s0', '다른 회차', '3화의 장면', { episodeNumber: 3 })])
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0)])) }, () => {})
  await openForm()
  fireEvent.click(box().getByRole('radio', { name: /흐름/ }))
  expect(box().getByText('이 회차의 장면 계획이 없어요.')).toBeTruthy()
  expect(box().getByRole('link', { name: '플롯 화면' })).toBeTruthy()
  expect(startButton().disabled).toBe(true)
  fireEvent.change(box().getByRole('textbox', { name: '비트 (한 줄에 하나, 최대 8줄)' }), { target: { value: ' 성문 대면 \n\n협상\n' } })
  pick('카엘', '리안')
  consent()
  fireEvent.click(startButton())
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(inputs()[0]).toMatchObject({
    request: '흐름 모드 시뮬레이션: 비트 2개',
    simulation: { mode: 'flow', beats: ['성문 대면', '협상'], characterIds: ['c1', 'c2'] },
  })
  serve()
})

it('직접 적은 비트가 8줄이나 200자를 넘으면 사유를 알리고 시작을 잠근다', async () => {
  setup()
  await openForm()
  fireEvent.click(box().getByRole('radio', { name: /흐름/ }))
  pick('카엘'); consent()
  const beats = box().getByRole('textbox', { name: '비트 (한 줄에 하나, 최대 8줄)' })
  fireEvent.change(beats, { target: { value: Array.from({ length: 9 }, (_, i) => `장면${i}`).join('\n') } })
  expect(box().getByText('비트는 8개까지 쓸 수 있어요.')).toBeTruthy()
  expect(startButton().disabled).toBe(true)
  fireEvent.change(beats, { target: { value: 'ㅁ'.repeat(201) } })
  expect(box().getByText('비트는 한 줄에 200자까지 적을 수 있어요.')).toBeTruthy()
  expect(startButton().disabled).toBe(true)
})

it('장면 계획·인물을 읽는 동안 불러오는 중을 알리고, 읽지 못하면 사유와 다시 불러오기를 보인다(빈 양식으로 꾸미지 않는다)', async () => {
  list.mockRejectedValueOnce(new Error('network'))
  setup()
  fireEvent.click(screen.getByRole('button', { name: '시뮬레이션' }))
  expect(box().getByText('장면 계획과 인물을 불러오고 있어요…')).toBeTruthy()
  expect((await box().findByRole('alert')).textContent).toContain('장면 계획과 인물을 불러오지 못했어요.')
  expect(box().queryByRole('textbox', { name: '전제' })).toBeNull()
  fireEvent.click(box().getByRole('button', { name: '다시 불러오기' }))
  expect(await box().findByRole('textbox', { name: '전제' })).toBeTruthy()
})

it('세계관에 인물 카드가 없으면 알리고 시작을 잠근다', async () => {
  references.mockResolvedValue({ characters: [], places: [], episodes: [] })
  setup()
  fireEvent.click(screen.getByRole('button', { name: '시뮬레이션' }))
  expect(await box().findByText('이 작품에 연결된 세계관에 인물 카드가 없어요. 세계관에 인물을 먼저 만들어 주세요.')).toBeTruthy()
  expect(startButton().disabled).toBe(true)
})

it('발행 회차가 없어 채팅이 막혀 있으면 그 이유를 알리고 동의 없이 시작을 잠근다', async () => {
  render(<Provider store={createAppStore()}><Host basis={null} /></Provider>)
  await openForm()
  expect(box().getByText(/회차를 하나 이상 발행하면 AI와 대화할 수 있어요/)).toBeTruthy()
  expect(box().queryByRole('checkbox', { name: /OpenAI/ })).toBeNull()
  fireEvent.change(box().getByRole('textbox', { name: '전제' }), { target: { value: PREMISE } })
  pick('카엘')
  expect(startButton().disabled).toBe(true)
  expect(send).not.toHaveBeenCalled()
})

// ── 실시간 대본 ──
it('턴마다 나레이션은 지문 블록으로, 인물 줄은 이름과 말풍선으로 이어 붙고 새 줄은 aria-live로 알린다', async () => {
  let toSecond!: () => void
  setup(
    (_input, emit) => { pauseAt(emit, scene([narrate(0)])) },
    async (_input, emit) => { await new Promise<void>((resolve) => { toSecond = resolve }); pauseAt(emit, scene([narrate(0), speak(1)])) },
    (_input, emit) => { reviewAt(emit, scene([narrate(0), speak(1), narrate(2, '문이 열렸다.')], { status: 'completed' })) })
  await begin()
  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(box().getByRole('list', { name: '장면 대본' }).getAttribute('aria-live')).toBe('polite')
  expect(lines()[0].classList.contains('stage-narration')).toBe(true)
  expect(lines()[0].textContent).toContain('성문은 닫혀 있었다.')
  await act(async () => { toSecond() })
  await waitFor(() => expect(lines()).toHaveLength(3))
  expect(within(lines()[1]).getByText('카엘')).toBeTruthy()
  expect(lines()[1].querySelector('.stage-bubble')?.textContent).toContain('"열어라."')
  expect(lines()[1].classList.contains('stage-narration')).toBe(false)
  expect(lines()[2].classList.contains('stage-narration')).toBe(true)
  expect(screen.getByTestId('chat-line').textContent).toBe('시뮬레이션 완료 · 3턴')
})

it('IF 전제를 대본 위에 보이고, 흐름 모드는 비트와 그 상태를 보인다', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0)], { mode: 'if', premise: '카엘이 성문을 열었다면?' }))], missingInputs: [], awaitingScene: 'character_simulation' })
  const view = setup()
  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(box().getByText('카엘이 성문을 열었다면?')).toBeTruthy()
  view.unmount()
  reload({ status: 'waiting', missingInputs: [], awaitingScene: 'character_simulation', steps: [stepOf(scene([narrate(0)], {
    beats: [{ index: 0, text: '성문 대면', status: 'done' }, { index: 1, text: '협상', status: 'pending' }],
  }))] })
  setup()
  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(within(box().getByRole('list', { name: '흐름 비트' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['성문 대면완료', '협상대기'])
})

it('검사·근거는 줄마다 접혀 있다가 펼치면 보이고, 검사가 없는 나레이션 줄에는 접는 상자를 두지 않는다', async () => {
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0), speak(1)])) }, () => {})
  await begin()
  await waitFor(() => expect(lines()).toHaveLength(2))
  expect(lines()[0].querySelector('details')).toBeNull()
  const fold = lines()[1].querySelector('details') as HTMLDetailsElement
  expect(fold.open).toBe(false)
  expect(within(fold).getByText('검사·근거 · 통과 1 · 위반 0')).toBeTruthy()
  expect(fold.textContent).toContain('설정 그래프 · card:1')
  serve()
})

// ── 자동 재생·일시정지 ──
it('자동 재생 중에는 턴 사이 대기(awaitingScene)를 받는 즉시 resume.scene next를 보내 장면 끝(승인 대기)까지 이어 가고 거기서 멈춘다', async () => {
  setup(
    (_input, emit) => { pauseAt(emit, scene([narrate(0)])) },
    (_input, emit) => { pauseAt(emit, scene([narrate(0), speak(1)])) },
    (_input, emit) => { reviewAt(emit, scene([narrate(0), speak(1), narrate(2, '문이 열렸다.')], { status: 'completed' })) })
  await begin()
  await waitFor(() => expect(send).toHaveBeenCalledTimes(3))
  expect(resumes().slice(1)).toEqual([{ approved: true, scene: { action: 'next' } }, { approved: true, scene: { action: 'next' } }])
  await waitFor(() => expect(box().getByRole('button', { name: '원고에 반영' })).toBeTruthy())
  expect(send).toHaveBeenCalledTimes(3)
  expect(box().queryByRole('button', { name: '일시정지' })).toBeNull()
})

it('일시정지하면 진행 중인 턴은 마치되 다음 턴은 보내지 않고, 재생하면 이어서 다음 턴을 보낸다', async () => {
  let finishSecond!: () => void
  setup(
    (_input, emit) => { pauseAt(emit, scene([narrate(0)])) },
    async (_input, emit) => { await new Promise<void>((resolve) => { finishSecond = resolve }); pauseAt(emit, scene([narrate(0), speak(1)])) },
    (_input, emit) => { reviewAt(emit, scene([narrate(0), speak(1), speak(2, '리안', '"저예요."')], { status: 'completed' })) })
  await begin()
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2)) // 첫 턴을 마치고 둘째 턴을 만드는 중
  fireEvent.click(box().getByRole('button', { name: '일시정지' }))
  expect(box().getByText('이번 턴을 마치면 멈춰요.')).toBeTruthy()
  expect(box().getByRole('button', { name: '재생' })).toBeTruthy()
  await act(async () => { finishSecond() })
  await waitFor(() => expect(lines()).toHaveLength(2))
  await pause()
  expect(send).toHaveBeenCalledTimes(2)
  expect(box().getByText('일시정지됨 · 재생하면 다음 줄을 만들어요.')).toBeTruthy()
  fireEvent.click(box().getByRole('button', { name: '재생' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(3))
  expect(resumes()[2]).toEqual({ approved: true, scene: { action: 'next' } })
  await waitFor(() => expect(lines()).toHaveLength(3))
})

it('시작하고 첫 턴이 올 때까지는 양식 대신 시작하는 중임을 알리고 시작 버튼을 잠근다', async () => {
  let release!: () => void
  setup(async (_input, emit) => { await new Promise<void>((resolve) => { release = resolve }); pauseAt(emit, scene([narrate(0)])) }, () => {})
  await begin()
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(box().getByText('시뮬레이션을 시작하고 있어요…')).toBeTruthy()
  expect(startButton().disabled).toBe(true)
  await act(async () => { release() })
  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(box().queryByText('시뮬레이션을 시작하고 있어요…')).toBeNull()
  serve()
})

it('새로 고친 뒤 이어진 장면은 저절로 재생하지 않고 멈춘 채로 무대를 열어 재생을 기다린다', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0), speak(1)]))], missingInputs: [], awaitingScene: 'character_simulation' })
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0), speak(1), speak(2, '리안', '"저예요."')])) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  expect(send).not.toHaveBeenCalled()
  expect(screen.getByTestId('chat-line').textContent).toBe('시뮬레이션 진행 중 · 2턴')
  expect(box().getByText('일시정지됨 · 재생하면 다음 줄을 만들어요.')).toBeTruthy()
  consent()
  fireEvent.click(box().getByRole('button', { name: '재생' }))
  await waitFor(() => expect(lines()).toHaveLength(3))
  expect(resumes()[0]).toEqual({ approved: true, scene: { action: 'next' } })
})

// ── 끼어들기 ──
it('끼어들기는 다음 턴의 note로 한 번만 실리고, 보내는 동안 새 끼어들기는 지우지 않는다', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0)]))], missingInputs: [], awaitingScene: 'character_simulation' })
  setup(
    (_input, emit) => { pauseAt(emit, scene([narrate(0), speak(1)], { notes: [{ afterTurn: 0, text: '비가 쏟아진다' }] })) },
    (_input, emit) => { reviewAt(emit, scene([narrate(0), speak(1), speak(2, '리안', '"저예요."')], { status: 'completed', notes: [{ afterTurn: 0, text: '비가 쏟아진다' }] })) })
  await waitFor(() => expect(lines()).toHaveLength(1))
  consent()
  fireEvent.change(box().getByRole('textbox', { name: /끼어들기/ }), { target: { value: ' 비가 쏟아진다 ' } })
  fireEvent.click(box().getByRole('button', { name: '남기기' }))
  expect(box().getByText(/다음 턴에 반영할 끼어들기/).textContent).toContain('비가 쏟아진다')
  expect((box().getByRole('textbox', { name: /끼어들기/ }) as HTMLInputElement).value).toBe('')
  fireEvent.click(box().getByRole('button', { name: '재생' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(resumes()[0]).toEqual({ approved: true, scene: { action: 'next', note: '비가 쏟아진다' } })
  await waitFor(() => expect(box().queryByText(/다음 턴에 반영할 끼어들기/)).toBeNull())
  expect(resumes()[1]).toEqual({ approved: true, scene: { action: 'next' } })
  await waitFor(() => expect(lines()).toHaveLength(3))
  expect(box().getByText('작가 끼어들기').parentElement?.textContent).toContain('비가 쏟아진다')
})

it('남긴 끼어들기는 보내기 전에 취소할 수 있다', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0)]))], missingInputs: [], awaitingScene: 'character_simulation' })
  setup()
  await waitFor(() => expect(lines()).toHaveLength(1))
  fireEvent.change(box().getByRole('textbox', { name: /끼어들기/ }), { target: { value: '문이 열린다' } })
  fireEvent.click(box().getByRole('button', { name: '남기기' }))
  fireEvent.click(box().getByRole('button', { name: '끼어들기 취소' }))
  expect(box().queryByText(/다음 턴에 반영할 끼어들기/)).toBeNull()
})

// ── 장면 끝내기 ──
it('멈춰 있을 때 장면 끝내기는 바로 stop을 보내고, 장면이 승인 대기로 넘어가면 원고에 반영을 묻는다', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0), speak(1)]))], missingInputs: [], awaitingScene: 'character_simulation' })
  setup((_input, emit) => { reviewAt(emit, scene([narrate(0), speak(1)], { status: 'completed' })) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  fireEvent.click(box().getByRole('button', { name: '장면 끝내기' }))
  await waitFor(() => expect(box().getByRole('button', { name: '원고에 반영' })).toBeTruthy())
  expect(resumes()).toEqual([{ approved: true, scene: { action: 'stop' } }])
})

it('턴을 만드는 중에 장면 끝내기를 누르면 그 턴을 마친 뒤 다음 턴 대신 stop을 보낸다', async () => {
  let finishSecond!: () => void
  setup(
    (_input, emit) => { pauseAt(emit, scene([narrate(0)])) },
    async (_input, emit) => { await new Promise<void>((resolve) => { finishSecond = resolve }); pauseAt(emit, scene([narrate(0), speak(1)])) },
    (_input, emit) => { reviewAt(emit, scene([narrate(0), speak(1)], { status: 'completed' })) })
  await begin()
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  fireEvent.click(box().getByRole('button', { name: '장면 끝내기' }))
  expect((box().getByRole('button', { name: /끝내는 중/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(box().getByText('이번 턴을 마치면 장면을 끝내요.')).toBeTruthy()
  await act(async () => { finishSecond() })
  await waitFor(() => expect(send).toHaveBeenCalledTimes(3))
  expect(resumes()[2]).toEqual({ approved: true, scene: { action: 'stop' } })
  await waitFor(() => expect(box().getByRole('button', { name: '원고에 반영' })).toBeTruthy())
})

// ── 줄 수정·다시 말하기 ──
const paused = (...turns: SimulationTurn[]) => reload({ status: 'waiting', steps: [stepOf(scene(turns))], missingInputs: [], awaitingScene: 'character_simulation' })

it('줄 수정은 인라인 입력으로 고쳐 edit만 보내고(모델 호출 없음) 고친 줄에 작가 수정 표시를 단다', async () => {
  paused(narrate(0), speak(1))
  const edited = { ...speak(1, '카엘', '"열어라, 지금."'), checks: [], evidence: [], editedByAuthor: true }
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0), edited])) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  fireEvent.click(within(lines()[1]).getByRole('button', { name: '수정' }))
  const edit = within(lines()[1]).getByRole('textbox', { name: /줄 고치기/ }) as HTMLTextAreaElement
  expect(edit.value).toBe('"열어라."')
  expect(edit.maxLength).toBe(2000)
  fireEvent.change(edit, { target: { value: ' "열어라, 지금." ' } })
  fireEvent.click(within(lines()[1]).getByRole('button', { name: '수정 저장' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(resumes()[0]).toEqual({ approved: true, scene: { action: 'edit', turn: 1, text: '"열어라, 지금."' } })
  await waitFor(() => expect(within(lines()[1]).getByText('작가 수정')).toBeTruthy())
  expect(within(lines()[1]).queryByRole('textbox')).toBeNull()
  expect(lines()[1].querySelector('details')).toBeNull()
  expect(lines()[1].textContent).toContain('"열어라, 지금."')
  // 고친 뒤에는 재생을 눌러야 이어진다(저절로 다음 턴을 보내지 않는다).
  expect(send).toHaveBeenCalledTimes(1)
})

it('수정 입력이 비었거나 그대로면 저장할 수 없고, 취소하면 원래 줄로 돌아간다', async () => {
  paused(speak(0))
  setup()
  await waitFor(() => expect(lines()).toHaveLength(1))
  consent()
  fireEvent.click(within(lines()[0]).getByRole('button', { name: '수정' }))
  const save = within(lines()[0]).getByRole('button', { name: '수정 저장' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  fireEvent.change(within(lines()[0]).getByRole('textbox'), { target: { value: '   ' } })
  expect(save.disabled).toBe(true)
  fireEvent.click(within(lines()[0]).getByRole('button', { name: '수정 취소' }))
  expect(within(lines()[0]).queryByRole('textbox')).toBeNull()
  expect(lines()[0].textContent).toContain('"열어라."')
  expect(send).not.toHaveBeenCalled()
})

it('수정 요청이 실패하면 입력을 그대로 두고 사유를 알린다(고친 것처럼 보이지 않는다)', async () => {
  paused(speak(0))
  setup(() => { throw new Error('장면 대기 상태가 아니에요.') })
  await waitFor(() => expect(lines()).toHaveLength(1))
  consent()
  fireEvent.click(within(lines()[0]).getByRole('button', { name: '수정' }))
  fireEvent.change(within(lines()[0]).getByRole('textbox'), { target: { value: '"다른 말."' } })
  fireEvent.click(within(lines()[0]).getByRole('button', { name: '수정 저장' }))
  await waitFor(() => expect(box().getByRole('alert').textContent).toContain('장면 대기 상태가 아니에요.'))
  expect((within(lines()[0]).getByRole('textbox') as HTMLTextAreaElement).value).toBe('"다른 말."')
  expect(within(lines()[0]).queryByText('작가 수정')).toBeNull()
})

it('다시 말하기는 뒤에 지워질 줄이 있으면 확인을 거쳐 redo를 보낸다', async () => {
  paused(narrate(0), speak(1), speak(2, '리안', '"저예요."'))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0), speak(1, '카엘', '"문을 열어라!"')])) })
  await waitFor(() => expect(lines()).toHaveLength(3))
  consent()
  fireEvent.click(within(lines()[1]).getByRole('button', { name: '다시 말하기' }))
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('뒤의 1줄'))
  expect(send).not.toHaveBeenCalled()
  fireEvent.click(within(lines()[1]).getByRole('button', { name: '다시 말하기' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(resumes()[0]).toEqual({ approved: true, scene: { action: 'redo', turn: 1 } })
  await waitFor(() => expect(lines()).toHaveLength(2))
})

it('마지막 줄의 다시 말하기는 확인 없이 보내고 남긴 끼어들기를 함께 싣는다', async () => {
  paused(narrate(0), speak(1))
  const confirm = vi.spyOn(window, 'confirm')
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0), speak(1, '카엘', '"문을 열어라!"')])) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  fireEvent.change(box().getByRole('textbox', { name: /끼어들기/ }), { target: { value: '더 차갑게' } })
  fireEvent.click(box().getByRole('button', { name: '남기기' }))
  fireEvent.click(within(lines()[1]).getByRole('button', { name: '다시 말하기' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(confirm).not.toHaveBeenCalled()
  expect(resumes()[0]).toEqual({ approved: true, scene: { action: 'redo', turn: 1, note: '더 차갑게' } })
})

it('턴을 만드는 중에는 줄 수정·다시 말하기를 잠그고 이유를 알린다', async () => {
  paused(speak(0))
  let release!: () => void
  setup(async () => { await new Promise<void>((resolve) => { release = resolve }) })
  await waitFor(() => expect(lines()).toHaveLength(1))
  consent()
  fireEvent.click(box().getByRole('button', { name: '재생' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect((within(lines()[0]).getByRole('button', { name: '수정' }) as HTMLButtonElement).disabled).toBe(true)
  expect((within(lines()[0]).getByRole('button', { name: '다시 말하기' }) as HTMLButtonElement).disabled).toBe(true)
  expect(box().getByText('줄 수정과 다시 말하기는 일시정지한 뒤 턴이 끝나면 쓸 수 있어요.')).toBeTruthy()
  serve(); await act(async () => { release() })
})

// ── 독백·시점 ──
const monologue = (index: number, prose: string, pov: SimulationTurn['pov'], extra: Partial<SimulationTurn> = {}) =>
  turn(index, 'character', '카엘', prose, { kind: 'monologue', pov, checks: [], evidence: [], ...extra })
const povDividers = () => Array.from(box().getByRole('list', { name: '장면 대본' }).children).filter((li) => li.classList.contains('stage-pov')).map((li) => li.textContent)

it('독백 줄은 시점 인물의 이름과 속마음 표시로 나레이션과 구분해 보이고, 수정·다시 말하기도 쓸 수 있다', async () => {
  paused(narrate(0), monologue(1, '문이 열리면 끝이다.', 'limited:c1'))
  const edited = monologue(1, '문이 열려도 끝은 아니다.', 'limited:c1', { editedByAuthor: true })
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0), edited])) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  const row = lines()[1]
  expect(row.classList.contains('stage-monologue')).toBe(true)
  expect(row.classList.contains('stage-narration')).toBe(false)
  expect(within(row).getByText('카엘')).toBeTruthy()
  expect(within(row).getByText('속마음')).toBeTruthy()
  expect(row.querySelector('.stage-bubble')?.textContent).toContain('문이 열리면 끝이다.')
  expect(row.querySelector('details')).toBeNull() // 검사·근거가 없는 독백에는 접는 상자를 두지 않는다.
  expect((within(row).getByRole('button', { name: '다시 말하기' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(within(row).getByRole('button', { name: '수정' }))
  fireEvent.change(within(row).getByRole('textbox', { name: '카엘 속마음 줄 고치기' }), { target: { value: '문이 열려도 끝은 아니다.' } })
  fireEvent.click(within(row).getByRole('button', { name: '수정 저장' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(resumes()[0]).toEqual({ approved: true, scene: { action: 'edit', turn: 1, text: '문이 열려도 끝은 아니다.' } })
  await waitFor(() => expect(within(lines()[1]).getByText('작가 수정')).toBeTruthy())
})

it('나레이션 줄도 다시 말하기로 그 줄부터 다시 만들게 할 수 있다', async () => {
  paused(narrate(0), speak(1))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0, '새벽이었다.')])) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  fireEvent.click(within(lines()[0]).getByRole('button', { name: '다시 말하기' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(resumes()[0]).toEqual({ approved: true, scene: { action: 'redo', turn: 0 } })
})

it('시점이 바뀌는 곳 앞에 시점 구분선을 한 줄 보이고, 시점이 그대로인 줄 앞에는 반복하지 않으며 처음이 전지적이면 구분선이 없다', async () => {
  paused(narrate(0), monologue(1, '속으로.', 'limited:c1'), { ...speak(2), pov: 'limited:c1' }, narrate(3, '해가 떴다.'))
  setup()
  await waitFor(() => expect(lines()).toHaveLength(4))
  expect(povDividers()).toEqual(['시점: 카엘 시점(3인칭)', '시점: 전지적'])
})

it('구분선은 시점이 바뀌는 줄 바로 앞에 놓이고 1인칭·전지적 복귀도 이름 붙여 알린다', async () => {
  paused(narrate(0), monologue(1, '속으로.', 'first:c1'), speak(2, '리안', '"저예요."'), narrate(3, '해가 떴다.'))
  setup()
  await waitFor(() => expect(lines()).toHaveLength(4))
  const items = Array.from(box().getByRole('list', { name: '장면 대본' }).children) // 접힌 검사 목록 안의 항목은 빼고 대본 줄만 본다.
  const turns = items.filter((li) => li.classList.contains('stage-turn'))
  expect(items.map((li) => (li.classList.contains('stage-pov') ? li.textContent : `줄${turns.indexOf(li)}`)))
    .toEqual(['줄0', '시점: 카엘 1인칭', '줄1', '시점: 전지적', '줄2', '줄3'])
})

it('시작 양식에서 고른 인물의 이름으로, 아직 말하지 않은 인물의 첫 제한 시점 구분선을 채운다', async () => {
  setup((_input, emit) => { pauseAt(emit, scene([{ ...narrate(0), pov: 'limited:c1' }])) }, () => {})
  await begin()
  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(povDividers()).toEqual(['시점: 카엘 시점(3인칭)'])
  serve()
})

// ── 원고 반영 ──
const review = (extra: Partial<CharacterSimulation> = {}) => reload({
  status: 'waiting', steps: [stepOf(scene([narrate(0), speak(1)], { status: 'completed', ...extra }))], missingInputs: [],
  awaitingApproval: 'character_simulation', approvalEpisode: 3,
})

it('끝난 장면은 원고에 반영·반영하지 않기·장면 이어 가기를 묻고 승인 전에는 반영됐다고 알리지 않는다', async () => {
  review()
  setup((_input, emit) => { finish(emit, scene([narrate(0), speak(1)], { status: 'completed' }), { applied: { episode: 3, revision: 5 } }) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  const ask = box().getByRole('region', { name: '원고 반영' })
  expect(within(ask).getByText(/승인하면 이 장면이 3화 초안 뒤에 이어 붙어요\./)).toBeTruthy()
  expect(within(ask).getByText(/약 \d+자/)).toBeTruthy()
  expect(box().queryByText(/이어 붙였어요/)).toBeNull()
  expect(onApplied).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
  consent()
  fireEvent.click(within(ask).getByRole('button', { name: '원고에 반영' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(resumes()[0]).toEqual({ approved: true })
  await waitFor(() => expect(box().getByText('3화 초안 끝에 이어 붙였어요.')).toBeTruthy())
  expect(onApplied).toHaveBeenCalledWith(3)
  expect(box().queryByRole('region', { name: '원고 반영' })).toBeNull()
  expect(box().getByRole('button', { name: '새 시뮬레이션' })).toBeTruthy()
})

it('반영하지 않기는 승인 없이 답하고 반영하지 않았다고 알린다', async () => {
  review()
  setup((_input, emit) => { finish(emit, scene([narrate(0), speak(1)], { status: 'completed' }), { approval: 'declined' }) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  fireEvent.click(box().getByRole('button', { name: '반영하지 않기' }))
  await waitFor(() => expect(box().getByText('반영하지 않았어요. 장면은 대화에 남아 있어요.')).toBeTruthy())
  expect(resumes()[0]).toEqual({ approved: false })
  expect(onApplied).not.toHaveBeenCalled()
})

it('승인 대기에서 장면 이어 가기는 남긴 끼어들기와 함께 next를 보내 장면을 다시 진행한다', async () => {
  review()
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0), speak(1), speak(2, '리안', '"한 번 더."')])) }, () => {})
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  fireEvent.change(box().getByRole('textbox', { name: /끼어들기/ }), { target: { value: '리안이 끼어든다' } })
  fireEvent.click(box().getByRole('button', { name: '남기기' }))
  fireEvent.click(box().getByRole('button', { name: '장면 이어 가기' }))
  await waitFor(() => expect(lines()).toHaveLength(3))
  expect(resumes()[0]).toEqual({ approved: true, scene: { action: 'next', note: '리안이 끼어든다' } })
  serve()
})

it('실패한 장면은 승인 대기여도 원고 반영을 묻지 않고 이유만 보인다(완료로 꾸미지 않는다)', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0)], { status: 'failed', stopReason: '턴 한도(12)를 넘었어요.' }))], missingInputs: [], awaitingApproval: 'character_simulation' })
  setup()
  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(box().getByText('실패')).toBeTruthy()
  expect(box().queryByText('완료')).toBeNull()
  expect(box().getByText('실패 이유').parentElement?.textContent).toBe('실패 이유 턴 한도(12)를 넘었어요.')
  for (const name of ['원고에 반영', '반영하지 않기']) expect(box().queryByRole('button', { name })).toBeNull()
})

it('검사에 걸려 멈춘 장면은 이유를 보이고 줄 수정·다시 말하기·장면 끝내기를 열어 둔다(완료로 꾸미지 않는다)', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0), speak(1)], { status: 'stopped', stopReason: '말투가 섞여 멈췄어요.' }))], missingInputs: [], awaitingScene: 'character_simulation' })
  setup()
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  expect(box().getByText('멈춤')).toBeTruthy()
  expect(box().queryByText('완료')).toBeNull()
  expect(box().getByText('멈춘 이유').parentElement?.textContent).toBe('멈춘 이유 말투가 섞여 멈췄어요.')
  expect(box().getByText('멈춘 장면이에요. 줄을 고치거나 다시 말하게 한 뒤 재생해 이어 가세요.')).toBeTruthy()
  expect(box().queryByText(/일시정지됨/)).toBeNull()
  expect((within(lines()[1]).getByRole('button', { name: '다시 말하기' }) as HTMLButtonElement).disabled).toBe(false)
  expect(box().getByRole('button', { name: '장면 끝내기' })).toBeTruthy()
  for (const name of ['원고에 반영', '반영하지 않기']) expect(box().queryByRole('button', { name })).toBeNull()
})

it('작가가 끝낸 장면이 멈춤 상태로 승인을 기다리면 상태는 그대로 알리고 원고 반영은 물을 수 있다', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0), speak(1)], { status: 'stopped', stopReason: '작가가 장면을 끝냈어요.' }))], missingInputs: [], awaitingApproval: 'character_simulation', approvalEpisode: 3 })
  setup()
  await waitFor(() => expect(lines()).toHaveLength(2))
  expect(box().getByText('멈춤')).toBeTruthy()
  expect(box().getByRole('button', { name: '원고에 반영' })).toBeTruthy()
})

it('실행이 이어 갈 수 없게 멈춤으로 끝나면 줄 행동 없이 채팅으로 다시 요청하라고 안내한다', async () => {
  paused(narrate(0), speak(1))
  setup((_input, emit) => {
    const stopped = scene([narrate(0), speak(1)], { status: 'stopped', stopReason: '턴 한도를 넘었어요.' })
    store.reply = { status: 'failed', steps: [stepOf(stopped)], missingInputs: [] }
    emit({ type: 'step', step: store.reply.steps[0] })
    emit({ type: 'done', reply: store.reply })
  })
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  fireEvent.click(box().getByRole('button', { name: '재생' }))
  await waitFor(() => expect(box().getByText('흐름 수정이나 다시 시도는 채팅으로 요청해 주세요.')).toBeTruthy())
  expect(box().getByText('멈춘 이유').parentElement?.textContent).toBe('멈춘 이유 턴 한도를 넘었어요.')
  expect(box().queryByRole('button', { name: '다시 말하기' })).toBeNull()
  expect(box().queryByRole('group', { name: '장면 진행' })).toBeNull()
  expect(box().getByRole('button', { name: '새 시뮬레이션' })).toBeTruthy()
})

// ── 실패 ──
it('턴 도중 오류는 사유를 알리고 저절로 다음 턴을 보내지 않으며 재생으로 다시 시도한다', async () => {
  setup(
    (_input, emit) => { pauseAt(emit, scene([narrate(0)])) },
    (_input, emit) => { emit({ type: 'error', message: '모델 호출에 실패했어요.' }) },
    (_input, emit) => { reviewAt(emit, scene([narrate(0), speak(1)], { status: 'completed' })) })
  await begin()
  await waitFor(() => expect(box().getByRole('alert').textContent).toContain('모델 호출에 실패했어요.'))
  await pause()
  expect(send).toHaveBeenCalledTimes(2)
  expect(lines()).toHaveLength(1)
  fireEvent.click(box().getByRole('button', { name: '재생' }))
  await waitFor(() => expect(lines()).toHaveLength(2))
  expect(send).toHaveBeenCalledTimes(3)
  expect(box().queryByRole('alert')).toBeNull()
})

it('오류 상자의 다시 불러오기는 저장된 장면을 다시 읽어 오류를 지운다(기록을 못 읽어 장면이 사라진 때의 복구)', async () => {
  paused(narrate(0), speak(1))
  let failing = false
  history.mockImplementation(async () => {
    if (failing) throw new Error('대화를 불러오지 못했어요.')
    return { threadId: 'a', title: '', turns: store.reply ? [{ request: store.request, reply: store.reply }] : [] }
  })
  setup((_input, emit) => { failing = true; pauseAt(emit, scene([narrate(0), speak(1), speak(2, '리안', '"저예요."')])) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  fireEvent.click(box().getByRole('button', { name: '재생' }))
  await waitFor(() => expect(box().getByRole('alert').textContent).toContain('대화를 불러오지 못했어요.'))
  expect(box().queryByRole('list', { name: '장면 대본' })).toBeNull() // 읽지 못한 기록을 가짜로 채우지 않는다.
  failing = false
  fireEvent.click(box().getByRole('button', { name: '다시 불러오기' }))
  await waitFor(() => expect(lines()).toHaveLength(3))
  expect(box().queryByRole('alert')).toBeNull()
})

it('장면 없이 끝난 요청(AI가 되묻거나 거절)은 답을 보이고 요청 입력을 이어 둔다', async () => {
  setup((_input, emit) => {
    store.reply = { status: 'clarify', message: '어느 인물의 시점으로 쓸까요?', steps: [], missingInputs: [] }
    emit({ type: 'done', reply: store.reply })
  })
  await begin()
  await waitFor(() => expect(box().getByText('어느 인물의 시점으로 쓸까요?')).toBeTruthy())
  expect(await box().findByRole('textbox', { name: '전제' })).toBeTruthy()
  expect(box().queryByRole('list', { name: '장면 대본' })).toBeNull()
})

it('장면이 시작되고 나면 그 뒤 일반 채팅의 답이 시작 양식에 새어 나오지 않는다', async () => {
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0)])) }, (_input, emit) => { reviewAt(emit, scene([narrate(0)], { status: 'completed' })) })
  await begin()
  await waitFor(() => expect(box().getByRole('button', { name: '원고에 반영' })).toBeTruthy())
  // 작가가 채팅에서 장면과 상관없는 질문을 하고 AI가 일반 답으로 응답한 저장 상태.
  store.reply = { status: 'completed', message: '카엘은 서른 살이에요.', steps: [{ feature: 'story_context', status: 'completed', result: { text: '카엘은 서른 살이에요.' } }], missingInputs: [] }
  serve((_input, emit) => { emit({ type: 'done', reply: store.reply! }) })
  fireEvent.click(box().getByRole('button', { name: '장면 이어 가기' }))
  await waitFor(() => expect(box().getByRole('textbox', { name: '전제' })).toBeTruthy())
  expect(box().queryByText('카엘은 서른 살이에요.')).toBeNull()
})

it('대본 안의 조작 영역(줄 행동·수정 입력·검사 접기)은 aria-live를 꺼 새 줄만 읽히게 한다', async () => {
  paused(narrate(0), speak(1))
  setup()
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  expect(lines()[1].querySelector('.stage-actions')?.getAttribute('aria-live')).toBe('off')
  expect(lines()[1].querySelector('details')?.getAttribute('aria-live')).toBe('off')
  fireEvent.click(within(lines()[1]).getByRole('button', { name: '수정' }))
  expect(lines()[1].querySelector('form.stage-edit')?.getAttribute('aria-live')).toBe('off')
})

it('장면 결과 형식이 어긋나 단계가 실패하면 가짜 장면 없이 실패 사유를 알린다', async () => {
  setup((_input, emit) => {
    const step: ChatStep = { feature: 'character_simulation', status: 'failed', error: '인물 시뮬레이션 결과 형식을 확인할 수 없어요.' }
    store.reply = { status: 'failed', steps: [step], missingInputs: [] }
    emit({ type: 'step', step })
    emit({ type: 'done', reply: store.reply })
  })
  await begin()
  await waitFor(() => expect(box().getByRole('alert').textContent).toContain('인물 시뮬레이션 결과 형식을 확인할 수 없어요.'))
  expect(box().queryByRole('list', { name: '장면 대본' })).toBeNull()
})

// ── 열고 닫기 ──
it('저장된 진행 중 장면이 있으면 닫혀 있던 무대가 저절로 열리고, 닫으면 장면이 계속돼도 다시 열리지 않는다', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0)]))], missingInputs: [], awaitingScene: 'character_simulation' })
  setup((_input, emit) => { pauseAt(emit, scene([narrate(0), speak(1)])) }, (_input, emit) => { reviewAt(emit, scene([narrate(0), speak(1)], { status: 'completed' })) })
  await waitFor(() => expect(lines()).toHaveLength(1))
  consent()
  fireEvent.click(box().getByRole('button', { name: '재생' }))
  fireEvent.click(box().getByRole('button', { name: '무대 닫기' }))
  expect(screen.queryByRole('region', { name: '인물 시뮬레이션 무대' })).toBeNull()
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByTestId('chat-line').textContent).toBe('시뮬레이션 완료 · 2턴'))
  expect(screen.queryByRole('region', { name: '인물 시뮬레이션 무대' })).toBeNull()
})

it('저장된 장면이 이미 끝나 있으면 무대를 저절로 열지 않고, 시뮬레이션 버튼은 새 요청 입력으로 연다', async () => {
  reload({ status: 'completed', steps: [stepOf(scene([narrate(0)], { status: 'completed' }), { applied: { episode: 3, revision: 2 } })], missingInputs: [] })
  setup()
  await waitFor(() => expect(screen.getByTestId('chat-line').textContent).toBe('시뮬레이션 완료 · 1턴'))
  expect(screen.queryByRole('region', { name: '인물 시뮬레이션 무대' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '시뮬레이션' }))
  expect(await box().findByRole('textbox', { name: '전제' })).toBeTruthy()
})

it('진행 중인 장면에서 시뮬레이션 버튼은 요청 입력이 아니라 장면을 연다', async () => {
  reload({ status: 'waiting', steps: [stepOf(scene([narrate(0)]))], missingInputs: [], awaitingScene: 'character_simulation' })
  setup()
  await waitFor(() => expect(lines()).toHaveLength(1))
  fireEvent.click(box().getByRole('button', { name: '무대 닫기' }))
  fireEvent.click(screen.getByRole('button', { name: '시뮬레이션' }))
  expect(lines()).toHaveLength(1)
  expect(box().queryByRole('textbox', { name: '전제' })).toBeNull()
})

it('끝난 장면에서 새 시뮬레이션을 누르면 요청 입력으로 돌아간다', async () => {
  review()
  setup((_input, emit) => { finish(emit, scene([narrate(0), speak(1)], { status: 'completed' }), { approval: 'declined' }) })
  await waitFor(() => expect(lines()).toHaveLength(2))
  consent()
  fireEvent.click(box().getByRole('button', { name: '반영하지 않기' }))
  fireEvent.click(await box().findByRole('button', { name: '새 시뮬레이션' }))
  expect(await box().findByRole('textbox', { name: '전제' })).toBeTruthy()
  expect(box().queryByRole('list', { name: '장면 대본' })).toBeNull()
})

// ── 자동 스크롤 ──
it('새 줄이 붙으면 맨 아래에 있던 대본은 따라 내려가고, 위로 올려 읽는 중이면 그대로 둔다', async () => {
  let second!: () => void
  let third!: () => void
  setup(
    (_input, emit) => { pauseAt(emit, scene([narrate(0)])) },
    async (_input, emit) => { await new Promise<void>((resolve) => { second = resolve }); pauseAt(emit, scene([narrate(0), speak(1)])) },
    async (_input, emit) => { await new Promise<void>((resolve) => { third = resolve }); pauseAt(emit, scene([narrate(0), speak(1), speak(2, '리안')])) }, () => {})
  await begin()
  await waitFor(() => expect(lines()).toHaveLength(1))
  const log = box().getByRole('list', { name: '장면 대본' }).parentElement as HTMLElement
  Object.defineProperties(log, { scrollHeight: { value: 900, configurable: true }, clientHeight: { value: 300, configurable: true } })
  log.scrollTop = 600 // 맨 아래(900 - 300)
  fireEvent.scroll(log)
  await act(async () => { second() })
  await waitFor(() => expect(lines()).toHaveLength(2))
  expect(log.scrollTop).toBe(900)
  log.scrollTop = 100 // 위로 올려 읽는 중
  fireEvent.scroll(log)
  await act(async () => { third() })
  await waitFor(() => expect(lines()).toHaveLength(3))
  expect(log.scrollTop).toBe(100)
  serve()
})
