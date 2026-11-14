// @vitest-environment jsdom
// 집필실 ↔ 시뮬레이션 무대(#58) 연결: 버튼·편집기 대체·초점·채팅 한 줄·원고 반영 뒤 초안 다시 읽기.
// 무대 안의 동작(자동 재생·수정 등)은 shared/chat/SimulationStage.test.tsx가 검증한다.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { CharacterSimulation } from '../../../../domain/entities/characterSimulation'
import type { ChatEvent, ChatReply, ChatStep } from '../../../../domain/entities/writingChat'
import { WritingStudio } from './WritingStudio'

const { sessions, history, send, open, list, references } = vi.hoisted(() => ({ sessions: vi.fn(), history: vi.fn(), send: vi.fn(), open: vi.fn(), list: vi.fn(), references: vi.fn() }))
const model = vi.hoisted(() => ({
  active: { number: 3, draft: { title: '셋째', body: '원고', revision: 1 }, versions: [], inherited: false, hasDraft: true, publishedVersionId: 'v3', checkpoints: [] },
  episodes: [{ number: 3, draft: { title: '셋째' }, inherited: false, publishedVersionId: 'v3', publicationStatus: 'published', versions: [], checkpoints: [] }],
  draft: { title: '셋째', body: '원고', revision: 1 },
  busy: false, error: '', notice: '', ready: true, dirty: false, editingLocked: false, deleteBlocker: '', deleteBlockerOf: () => '',
  orderLookup: null, historyLoading: false, historyError: '', publicationHistory: null,
  save: vi.fn(), reload: vi.fn(), mayLeave: vi.fn(() => true), edit: vi.fn(), create: vi.fn(), select: vi.fn(() => true), cancel: vi.fn(),
  loadPublicationHistory: vi.fn(), addImage: vi.fn(), checkOrder: vi.fn(), deleteDraft: vi.fn(), deleteEpisode: vi.fn(), changeVisibility: vi.fn(),
  restore: vi.fn(), publish: vi.fn(), revertCheckpoint: vi.fn(), aiApplied: vi.fn(),
}))
vi.mock('../viewmodel/useWritingViewModel', () => ({ useWritingViewModel: () => model }))
vi.mock('../../../shared/screenIds', () => ({ useScreenId: () => {} }))
vi.mock('../../../shared/media/MediaPanel', () => ({ ManuscriptBody: ({ body }: { body: string }) => <p>{body}</p>, StoredImage: () => null }))
// 본문 편집기(Toast UI Editor)는 textarea 대역으로 바꾼다.
vi.mock('./LazyManuscriptEditor', () => import('../../../../test/manuscriptEditorFake'))
// 채팅은 실제 WritingChatUseCase 위에 가짜 Repository를, 장면 계획은 대역 UseCase를 얹는다.
vi.mock('../../../../app/appContainer', async () => {
  const { WritingChatUseCase } = await import('../../../../domain/usecases/WritingChatUseCase')
  const chat = new WritingChatUseCase({ sessions, history, send, open } as never)
  const plans = { list, references }
  return { appContainer: { resolve: (key: string) => (key === 'writingChatUseCase' ? chat : key === 'storyPlanUseCase' ? plans : {}) } }
})

const store: { reply: ChatReply | null } = { reply: null }
const turn = (index: number): CharacterSimulation['turns'][number] => ({
  index, kind: 'character', pov: 'omniscient', characterId: 'c1', characterName: '카엘', prose: '"열어라."',
  checks: [], regenerated: 0, evidence: [], editedByAuthor: false,
})
const scene = (extra: Partial<CharacterSimulation> = {}): CharacterSimulation =>
  ({ mode: 'flow', premise: null, beats: [], turns: [turn(0)], notes: [], status: 'paused', stopReason: null, ...extra })
const simStep = (simulation: CharacterSimulation, extra: Partial<ChatStep> = {}): ChatStep => ({ feature: 'character_simulation', status: 'completed', simulation, ...extra })
const stored = (reply: ChatReply) => {
  store.reply = reply
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
}
const pausedReply = (): ChatReply => ({ status: 'waiting', steps: [simStep(scene())], missingInputs: [], awaitingScene: 'character_simulation' })
const approvalReply = (): ChatReply => ({ status: 'waiting', steps: [simStep(scene({ status: 'completed' }))], missingInputs: [], awaitingApproval: 'character_simulation', approvalEpisode: 3 })

const renderStudio = () => render(<Provider store={createAppStore()}><MemoryRouter><WritingStudio id="work-id" /></MemoryRouter></Provider>)
const editor = () => screen.getByRole('textbox', { name: '회차 제목', hidden: true }).closest('.writing-editor') as HTMLElement

beforeEach(() => {
  store.reply = null
  sessions.mockResolvedValue([])
  list.mockResolvedValue([])
  references.mockResolvedValue({ characters: [{ id: 'c1', name: '카엘' }], places: [], episodes: [] })
  history.mockImplementation(async () => ({ threadId: 'a', title: '', turns: store.reply ? [{ request: '시뮬레이션', reply: store.reply }] : [] }))
})
afterEach(() => { cleanup(); vi.resetAllMocks(); model.mayLeave.mockReturnValue(true); model.select.mockReturnValue(true) })

it('시뮬레이션 버튼은 편집기 대신 무대를 열고(편집기는 숨기기만 한다) 초점을 무대로 옮기며, 다시 누르면 편집기와 버튼 초점이 돌아온다', async () => {
  renderStudio()
  const button = screen.getByRole('button', { name: '시뮬레이션' })
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(screen.queryByRole('region', { name: '인물 시뮬레이션 무대' })).toBeNull()
  fireEvent.click(button)
  const stage = await screen.findByRole('region', { name: '인물 시뮬레이션 무대' })
  expect(document.activeElement).toBe(within(stage).getByRole('heading', { name: '인물 시뮬레이션 무대' }))
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(editor().hasAttribute('hidden')).toBe(true)
  // 편집기는 사라지지 않고 숨겨져 있어 입력 상태를 지킨다.
  expect((screen.getByRole('textbox', { name: '회차 제목', hidden: true }) as HTMLInputElement).value).toBe('셋째')
  fireEvent.click(button)
  expect(screen.queryByRole('region', { name: '인물 시뮬레이션 무대' })).toBeNull()
  expect(editor().hasAttribute('hidden')).toBe(false)
  expect(document.activeElement).toBe(button)
})

it('무대의 닫기 버튼도 편집기를 되돌리고 초점을 시뮬레이션 버튼으로 돌려준다', async () => {
  renderStudio()
  fireEvent.click(screen.getByRole('button', { name: '시뮬레이션' }))
  fireEvent.click(await screen.findByRole('button', { name: '무대 닫기' }))
  expect(screen.queryByRole('region', { name: '인물 시뮬레이션 무대' })).toBeNull()
  expect(editor().hasAttribute('hidden')).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '시뮬레이션' }))
})

it('진행 중인 저장 장면이 있으면 무대가 저절로 열리되 초점을 빼앗지 않고, 채팅에는 상태 한 줄과 무대 열기만 보인다', async () => {
  stored(pausedReply())
  renderStudio()
  const stage = await screen.findByRole('region', { name: '인물 시뮬레이션 무대' })
  expect(document.activeElement).not.toBe(within(stage).getByRole('heading', { name: '인물 시뮬레이션 무대' }))
  expect(editor().hasAttribute('hidden')).toBe(true)
  const chat = screen.getByRole('complementary', { name: 'AI 채팅' })
  expect(within(chat).getByText('시뮬레이션 진행 중 · 1턴')).toBeTruthy()
  expect(within(chat).queryByText('"열어라."')).toBeNull()
  // 무대를 닫아 두어도 채팅의 무대 열기가 다시 열고 초점을 무대로 옮긴다.
  fireEvent.click(within(stage).getByRole('button', { name: '무대 닫기' }))
  expect(screen.queryByRole('region', { name: '인물 시뮬레이션 무대' })).toBeNull()
  fireEvent.click(within(chat).getByRole('button', { name: '무대 열기' }))
  const reopened = await screen.findByRole('region', { name: '인물 시뮬레이션 무대' })
  expect(document.activeElement).toBe(within(reopened).getByRole('heading', { name: '인물 시뮬레이션 무대' }))
  expect(within(reopened).getByText('"열어라."')).toBeTruthy()
})

it('채팅을 접어도 무대와 진행 중인 장면은 그대로다(채팅 상태를 집필실이 쥐고 있다)', async () => {
  stored(pausedReply())
  renderStudio()
  await screen.findByRole('region', { name: '인물 시뮬레이션 무대' })
  fireEvent.click(screen.getByRole('button', { name: '접기' }))
  expect(screen.queryByRole('complementary', { name: 'AI 채팅' })).toBeNull()
  expect(screen.getByRole('region', { name: '인물 시뮬레이션 무대' })).toBeTruthy()
  expect(within(screen.getByRole('region', { name: '인물 시뮬레이션 무대' })).getByText('"열어라."')).toBeTruthy()
})

it('원고에 반영하면 그 회차 초안을 다시 읽도록 집필실에 알린다(승인 전에는 알리지 않는다)', async () => {
  stored(approvalReply())
  send.mockImplementation(async (_work: string, _thread: string, _input: unknown, onEvent: (event: ChatEvent) => void) => {
    const applied = simStep(scene({ status: 'completed' }), { applied: { episode: 3, revision: 5 } })
    store.reply = { status: 'completed', steps: [applied], missingInputs: [] }
    onEvent({ type: 'step', step: applied })
    onEvent({ type: 'done', reply: store.reply })
  })
  renderStudio()
  const stage = await screen.findByRole('region', { name: '인물 시뮬레이션 무대' })
  expect(model.aiApplied).not.toHaveBeenCalled()
  fireEvent.click(within(stage).getByRole('checkbox', { name: /OpenAI/ }))
  fireEvent.click(within(stage).getByRole('button', { name: '원고에 반영' }))
  await waitFor(() => expect(model.aiApplied).toHaveBeenCalledWith(3))
  expect(send.mock.calls[0][2]).toMatchObject({ resume: { approved: true } })
  await waitFor(() => expect(within(stage).getByText('3화 초안 끝에 이어 붙였어요.')).toBeTruthy())
})

it('장면 계획이 없다는 안내의 플롯 화면 링크는 저장하지 않은 입력이 있으면 이동을 막는다', async () => {
  renderStudio()
  fireEvent.click(screen.getByRole('button', { name: '시뮬레이션' }))
  const stage = await screen.findByRole('region', { name: '인물 시뮬레이션 무대' })
  fireEvent.click(await within(stage).findByRole('radio', { name: /흐름/ }))
  const link = within(stage).getByRole('link', { name: '플롯 화면' })
  expect(link.getAttribute('href')).toBe('/studio/work-id?view=narrative')
  model.mayLeave.mockReturnValue(false)
  const proceeded = fireEvent.click(link)
  expect(model.mayLeave).toHaveBeenCalled()
  expect(proceeded).toBe(false) // preventDefault: 이동하지 않는다.
})

it('작품에 편집할 회차가 없으면 시뮬레이션 버튼을 잠근다', () => {
  model.active = null as never
  renderStudio()
  expect((screen.getByRole('button', { name: '시뮬레이션' }) as HTMLButtonElement).disabled).toBe(true)
  model.active = { number: 3, draft: { title: '셋째', body: '원고', revision: 1 }, versions: [], inherited: false, hasDraft: true, publishedVersionId: 'v3', checkpoints: [] }
})
