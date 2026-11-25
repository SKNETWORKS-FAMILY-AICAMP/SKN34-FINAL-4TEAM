// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { WritingMode } from '../../../../domain/entities/operatingSettings'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type { WritingChatUseCase } from '../../../../domain/usecases/WritingChatUseCase'
import { WritingStudio } from './WritingStudio'

const model = vi.hoisted(() => ({
  active: { number: 3, draft: { title: '셋째', body: '원고', revision: 1 }, versions: [], inherited: false, hasDraft: true },
  episodes: [], draft: { title: '셋째', body: '원고', revision: 1 },
  busy: false, error: '', notice: '', ready: true, dirty: false, editingLocked: false,
  save: vi.fn(), reload: vi.fn(), mayLeave: vi.fn(() => true), clearNotice: vi.fn(),
}))
vi.mock('../viewmodel/useWritingViewModel', () => ({ useWritingViewModel: () => model }))
vi.mock('../../../shared/plans/useStoryPlanViewModel', () => ({ useStoryPlanViewModel: () => ({
  plans: [], references: null, selected: null, editor: null, deleting: null, embedded: true,
  busy: false, ready: true, dirty: false, error: '', notice: '', version: 0, startBlocker: '', confirmLeave: () => true,
}) }))
vi.mock('../../../shared/screenIds', () => ({ useScreenId: () => {} }))
vi.mock('../../../shared/media/MediaPanel', () => ({ ManuscriptBody: ({ body }: { body: string }) => <p>{body}</p> }))
// 본문 편집기(Toast UI Editor)는 textarea 대역으로 바꾼다. 실제 편집기 동작은 ManuscriptEditor.test.tsx가 검증한다.
vi.mock('./LazyManuscriptEditor', () => import('../../../../test/manuscriptEditorFake'))
vi.mock('./ManuscriptExportPanel', () => ({
  ManuscriptExportPanel: (props: { workId: string; episode: number; inherited: boolean; disabled?: boolean }) => <p data-testid="export-panel">{JSON.stringify(props)}</p>,
}))
vi.mock('./EpisodeImagePanel', () => ({
  EpisodeImagePanel: (props: { workId: string; episode: number; draft: unknown; unsaved: boolean; onDraftSaved: () => void }) => (
    <div data-testid="image-panel" data-props={JSON.stringify({ workId: props.workId, episode: props.episode, draft: props.draft, unsaved: props.unsaved })}>
      <button type="button" onClick={props.onDraftSaved}>저장됨 알림</button>
    </div>
  ),
}))

const original = { ...model, active: model.active }
beforeEach(() => {
  vi.spyOn(appContainer.resolve<EpisodeUseCase>('episodeUseCase'), 'workSettings').mockResolvedValue({
    current: { revision: 0, writingMode: null, changedAt: null }, history: [],
    worldUpdateMode: 'manual', proofreadingMode: 'review', autoserialState: 'off',
  })
  vi.spyOn(appContainer.resolve<WritingChatUseCase>('writingChatUseCase'), 'sessions').mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); Object.assign(model, original) })
const exportProps = () => JSON.parse(screen.getByTestId('export-panel').textContent!)
const imageProps = () => JSON.parse(screen.getByTestId('image-panel').dataset.props!)
const renderStudio = () => render(<Provider store={createAppStore()}><MemoryRouter><WritingStudio id="work-id" /></MemoryRouter></Provider>)
// 내보내기·회차 이미지 패널은 편집기 하단의 '회차 설정' 시트 안에 있다.
const renderSettings = () => { const view = renderStudio(); fireEvent.click(screen.getByRole('button', { name: '회차 설정' })); return view }

it('서버 내보내기 패널이 브라우저 TXT 내보내기 버튼을 대신하고 현재 회차를 넘긴다', () => {
  renderSettings()
  expect(exportProps()).toEqual({ workId: 'work-id', episode: 3, inherited: false, disabled: false })
  expect(screen.queryByRole('button', { name: /TXT 내보내기/ })).toBeNull()
})

it('저장 중이거나 저장하지 않은 입력이 있으면 내보내기 패널을 잠가 오래된 서버 원고를 내보내지 않는다', () => {
  for (const patch of [{ busy: true }, { dirty: true }]) {
    Object.assign(model, original, patch)
    renderSettings()
    expect(exportProps().disabled).toBe(true)
    cleanup()
  }
})

it('원작 기준 회차 여부를 내보내기 패널에 알린다', () => {
  model.active = { ...model.active, inherited: true }
  renderSettings()
  expect(exportProps().inherited).toBe(true)
})

it('회차 이미지 패널이 현재 회차와 편집 중인 초안을 받고, 초안 저장 알림은 집필실 다시 불러오기로 이어진다', () => {
  renderSettings()
  expect(imageProps()).toEqual({ workId: 'work-id', episode: 3, draft: model.draft, unsaved: false })
  expect(model.reload).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '저장됨 알림' }))
  expect(model.reload).toHaveBeenCalledTimes(1)
})

it('저장 중이거나 저장하지 않은 입력이 있으면 회차 이미지 패널에 unsaved로 알린다', () => {
  for (const patch of [{ busy: true }, { dirty: true }]) {
    Object.assign(model, original, patch)
    renderSettings()
    expect(imageProps().unsaved).toBe(true)
    cleanup()
  }
})

it('원작 기준 회차에는 회차 이미지 패널을 열지 않는다', () => {
  model.active = { ...model.active, inherited: true }
  renderSettings()
  expect(screen.queryByTestId('image-panel')).toBeNull()
})

const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

it('왼쪽 회차 목록·버전 그래프, 가운데 원고, 오른쪽 AI 채팅의 3단 순서로 놓는다', async () => {
  renderStudio()
  const list = screen.getByRole('navigation', { name: '회차 목록' })
  const graph = screen.getByRole('region', { name: '버전 그래프' })
  const editor = screen.getByRole('textbox', { name: '회차 제목' })
  const chat = await screen.findByRole('complementary', { name: 'AI 채팅' })
  expect(follows(list, graph) && follows(graph, editor) && follows(editor, chat)).toBe(true)
  expect(list.closest('.writing-rail')).toBe(graph.closest('.writing-rail'))
  expect(list.closest('.writing-rail')).not.toBeNull()
  expect(chat.contains(editor)).toBe(false)
})

it('AI 채팅은 보낼 수 없는 동안(데모·회차 없음) 입력·전송·첨부·추천 칩을 사유와 함께 잠가 가짜 제안이나 전송 흔적을 만들지 않는다', async () => {
  renderStudio()
  const chat = await screen.findByRole('complementary', { name: 'AI 채팅' })
  const box = within(chat).getByRole('textbox', { name: '메시지' })
  expect(box).toHaveProperty('disabled', true)
  expect(box.getAttribute('placeholder')).toBe('AI에게 무엇이든 물어보세요')
  for (const name of ['전송', '음성 입력 (준비 중)']) expect(within(chat).getByRole('button', { name })).toHaveProperty('disabled', true)
  expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/데모에서는|만들면/)
  // 첨부 항목은 모두 잠겨 있고(첨부는 켜져 있으니 '준비 중' 안내는 없다) 메뉴 설명은 잠긴 사유다.
  fireEvent.click(within(chat).getByRole('button', { name: '첨부' }))
  for (const name of ['이미지 첨부', '텍스트 파일 첨부']) expect(within(chat).getByRole('menuitem', { name })).toHaveProperty('disabled', true)
  expect(within(chat).queryByText('이미지·텍스트 파일 첨부는 준비 중이에요.')).toBeNull()
  // 빈 상태: 제목·한 줄 설명·추천 칩(칩도 잠겨 있어 입력창을 채우지 않는다)
  const log = within(chat).getByRole('log')
  expect(within(log).getByRole('heading', { name: '무엇을 함께 써볼까요?' })).toBeTruthy()
  expect(within(log).getByText('AI의 제안은 승인하기 전까지 원고에 반영되지 않아요.')).toBeTruthy()
  for (const name of ['다음 장면 아이디어', '이 회차 요약', '문장 다듬기']) expect(within(log).getByRole('button', { name })).toHaveProperty('disabled', true)
  expect(log.querySelectorAll('.chat-msg')).toHaveLength(0)
  expect(model.save).not.toHaveBeenCalled()
})

it('AI 채팅 머리줄에 파일을 놓아도 브라우저가 그 파일을 열어 집필실을 떠나지 않는다(#700)', async () => {
  renderStudio()
  const head = (await screen.findByRole('complementary', { name: 'AI 채팅' })).querySelector('.studio-chat-head')!
  const dataTransfer = { files: [new File(['x'], '지도.png', { type: 'image/png' })], types: ['Files'] }
  expect(fireEvent.dragOver(head, { dataTransfer })).toBe(false)
  expect(fireEvent.drop(head, { dataTransfer })).toBe(false)
})

it('좁은 화면에서 쓸 수 있게 AI 채팅을 접었다 다시 열 수 있고 접어도 집필 영역은 그대로다', async () => {
  renderStudio()
  const chat = await screen.findByRole('complementary', { name: 'AI 채팅' })
  // 처음 렌더링에서는 초점을 옮기지 않는다.
  expect(document.activeElement).toBe(document.body)
  fireEvent.click(within(chat).getByRole('button', { name: '접기' }))
  expect(screen.queryByRole('complementary', { name: 'AI 채팅' })).toBeNull()
  expect(screen.getByLabelText('원고 본문')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'AI 채팅 열기' }))
  expect(screen.getByRole('complementary', { name: 'AI 채팅' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'AI 채팅 열기' })).toBeNull()
})

it('접거나 다시 열면 사라진 버튼 대신 새로 보이는 버튼으로 키보드 초점을 옮긴다', async () => {
  renderStudio()
  const fold = within(await screen.findByRole('complementary', { name: 'AI 채팅' })).getByRole('button', { name: '접기' })
  fold.focus()
  fireEvent.click(fold)
  const open = screen.getByRole('button', { name: 'AI 채팅 열기' })
  expect(document.activeElement).toBe(open)
  fireEvent.click(open)
  expect(document.activeElement).toBe(within(screen.getByRole('complementary', { name: 'AI 채팅' })).getByRole('button', { name: '접기' }))
})

it('AI 채팅은 머리글에 브랜드 마크와 AI 채팅 제목을 두고 메시지 영역 다음 맨 아래에 입력 카드를 붙인다', async () => {
  renderStudio()
  const chat = await screen.findByRole('complementary', { name: 'AI 채팅' })
  const head = within(chat).getByRole('heading', { level: 2, name: 'AI 채팅' })
  expect(head.querySelector('.chat-brand svg')).not.toBeNull()
  expect(head.querySelector('.chat-brand')?.getAttribute('aria-hidden')).toBe('true')
  const log = within(chat).getByRole('log')
  const composer = chat.querySelector('form.chat-composer')!
  expect(follows(head, log) && follows(log, composer)).toBe(true)
  // 입력 카드가 채팅 패널의 마지막 요소라 세로 flex에서 바닥에 붙는다.
  expect(chat.querySelector('.chat-panel')!.lastElementChild).toBe(composer)
})

// 집필 방식(운영 설정)에 AI 자율 집필(autonomous)이 들어와도 집필실은 깨지지 않는다: 직접 집필처럼 AI 채팅을 접은 채로 시작하고 열 수 있다. 처음부터 채팅을 여는 것은 AI 협업 집필뿐이다.
it.each<[WritingMode, boolean]>([['assisted', true], ['direct', false], ['autonomous', false]])('집필 방식이 %s이면 AI 채팅을 처음부터 열까: %s', async (mode, opened) => {
  const read = vi.spyOn(appContainer.resolve<EpisodeUseCase>('episodeUseCase'), 'workSettings').mockResolvedValue({
    current: { revision: 1, writingMode: mode, changedAt: '2026-11-22T03:00:00Z' }, history: [],
    worldUpdateMode: 'manual', proofreadingMode: 'review', autoserialState: 'off',
  })
  renderStudio()
  await waitFor(() => expect(read).toHaveBeenCalled())
  if (opened) expect(await screen.findByRole('complementary', { name: 'AI 채팅' })).toBeTruthy()
  else {
    await act(async () => {})
    expect(screen.queryByRole('complementary', { name: 'AI 채팅' })).toBeNull()
    expect(screen.getByRole('button', { name: 'AI 채팅 열기' })).toBeTruthy()
  }
  expect(screen.queryByText('집필 방식을 불러오지 못했어요.')).toBeNull()
})

it('창이 1200px 이하면 준비 중인 AI 채팅을 접은 채로 시작하고, 처음부터 초점을 옮기지 않는다', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 1200px)', addEventListener() {}, removeEventListener() {} }))
  try {
    renderStudio()
    expect(screen.queryByRole('complementary', { name: 'AI 채팅' })).toBeNull()
    expect(screen.getByRole('button', { name: 'AI 채팅 열기' })).toBeTruthy()
    expect(document.activeElement).toBe(document.body)
    expect(screen.getByLabelText('원고 본문')).toBeTruthy()
  } finally { vi.unstubAllGlobals() }
})
