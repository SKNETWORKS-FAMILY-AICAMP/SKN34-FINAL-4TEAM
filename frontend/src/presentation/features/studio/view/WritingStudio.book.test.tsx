// @vitest-environment jsdom
// 집필실 왼쪽 메뉴의 설정집 보기(#986): 메뉴·잠금 상태·목록의 검색과 분류·가운데 상세·원고 보존.
// 상세 문서의 내용(정보 상자·관계도·문단)은 worldstudio의 CardWikiPreview 시험이 본다. 여기서는 집필실이 그것을 어떻게 잇는지만 본다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { cardTypePatch } from '../../../../domain/entities/studioCards'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting, type StudioSetting } from '../../../../domain/entities/studioWorld'
import type { ChatReply, ChatStep } from '../../../../domain/entities/writingChat'
import { WritingStudio } from './WritingStudio'

const { sessions, history, send, open, list, owned, readWorld, categories, workSettings, inherited } = vi.hoisted(() => ({
  sessions: vi.fn(), history: vi.fn(), send: vi.fn(), open: vi.fn(), list: vi.fn(), owned: vi.fn(), readWorld: vi.fn(), categories: vi.fn(), workSettings: vi.fn(), inherited: vi.fn(),
}))
const model = vi.hoisted(() => ({
  active: { number: 3, draft: { title: '셋째', body: '원고', revision: 1 }, versions: [], inherited: false, hasDraft: true, publishedVersionId: null, checkpoints: [] },
  episodes: [{ number: 3, draft: { title: '셋째' }, inherited: false, publishedVersionId: null, publicationStatus: 'draft', versions: [], checkpoints: [] }],
  draft: { title: '셋째', body: '원고', revision: 1 },
  busy: false, error: '', notice: '', ready: true, dirty: false, editingLocked: false, deleteBlocker: '', deleteBlockerOf: () => '',
  orderLookup: null, historyLoading: false, historyError: '', publicationHistory: null,
  save: vi.fn(), reload: vi.fn(), mayLeave: vi.fn(() => true), edit: vi.fn(), create: vi.fn(), select: vi.fn(() => true), cancel: vi.fn(), clearNotice: vi.fn(),
  loadPublicationHistory: vi.fn(), addImage: vi.fn(), checkOrder: vi.fn(), deleteDraft: vi.fn(), deleteEpisode: vi.fn(), changeVisibility: vi.fn(),
  restore: vi.fn(), publish: vi.fn(), revertCheckpoint: vi.fn(), aiApplied: vi.fn(), refresh: vi.fn(), loadVersion: vi.fn(), retrySave: vi.fn(), expired: false,
}))
// 입력(edit)은 진짜 ViewModel처럼 초안을 바꾸고 다시 그리게 한다: 입력한 글이 편집기에 남는지 DOM으로 본다.
vi.mock('../viewmodel/useWritingViewModel', async () => {
  const { useReducer } = await import('react')
  return { useWritingViewModel: () => {
    const [, bump] = useReducer((n: number) => n + 1, 0)
    return { ...model, edit: (patch: Partial<typeof model.draft>) => { model.draft = { ...model.draft, ...patch }; model.dirty = true; model.edit(patch); bump() } }
  } }
})
vi.mock('../../../shared/plans/useStoryPlanViewModel', () => ({ useStoryPlanViewModel: () => ({
  plans: [], references: null, selected: null, editor: null, deleting: null, embedded: true,
  busy: false, ready: true, dirty: false, error: '', notice: '', version: 0, startBlocker: '', confirmLeave: () => true,
}) }))
vi.mock('../../../shared/useMcpChangeWatch', () => ({ useMcpChangeWatch: () => ({ stale: false, reload: vi.fn() }) }))
const operator = vi.hoisted(() => ({ viewOnly: false }))
vi.mock('../viewmodel/useOperatorViewOnly', () => ({ useOperatorViewOnly: () => ({ viewOnly: operator.viewOnly, notice: null, retry: vi.fn() }) }))
vi.mock('../../../shared/useSerialLock', () => ({ useSerialLock: () => ({ locked: false, reread: vi.fn() }) }))
vi.mock('../../../shared/screenIds', () => ({ useScreenId: () => {} }))
vi.mock('../../../shared/media/MediaPanel', () => ({ ManuscriptBody: ({ body }: { body: string }) => <p>{body}</p>, StoredImage: () => null }))
// 본문 편집기(Toast UI Editor)는 textarea 대역으로 바꾼다.
vi.mock('./LazyManuscriptEditor', () => import('../../../../test/manuscriptEditorFake'))
vi.mock('../../../../app/appContainer', async () => {
  const { WritingChatUseCase } = await import('../../../../domain/usecases/WritingChatUseCase')
  const chat = new WritingChatUseCase({ sessions, history, send, open } as never)
  // UseCase는 의존 배열에 들어가므로 키마다 늘 같은 객체를 준다.
  const known: Record<string, unknown> = {
    writingChatUseCase: chat,
    storyPlanUseCase: { list, references: async () => ({ episodes: [], characters: [], places: [] }) },
    worldStudioUseCase: { list: owned, read: readWorld, supportsCardImages: false, cardImage: vi.fn() },
    cardCategoryUseCase: { list: categories },
    episodeUseCase: { inheritedWorld: inherited, workSettings },
  }
  return { appContainer: { resolve: (key: string) => (known[key] ??= {}) } }
})

/** 본문 링크 `[글자](card:<uuid>)`는 대상 id가 UUID여야 링크다. */
const HARBOR = '3f1d0c1e-5b7a-4c9e-8d2a-7e6f5a4b3c21'
const card = (id: string, title: string, type: string, text = '', extra: Partial<StudioSetting> = {}): StudioSetting => {
  const s = newSetting()
  Object.assign(s.item, cardTypePatch(s.item, type, []), { id, title, text })
  return Object.assign(s, extra)
}
/** 카엘(인물, 작가 전용) — 새벽항(장소, 2화부터) — 해월 전쟁(사건, 9화부터: 이 소설은 3화까지라 아직 없는 회차). 카엘과 새벽항은 '고향'으로 이어져 있다. */
const fixtureSettings = () => putRelation([
  card('kael', '카엘', 'character', `해월의 기사. [새벽항](card:${HARBOR})에서 태어났다. 오래된 맹세를 지킨다.`, { aliases: ['검은 기사'], characterDocs: { soul: '말수가 적고 단호하다.', goal: '왕을 지킨다.', episodes: {} } }),
  card(HARBOR, '새벽항', 'location', '바다가 보이는 항구 도시.', { revealFromEpisode: 2, tags: ['항구'] }),
  card('war', '해월 전쟁', 'event', '십 년 전의 전쟁.', { revealFromEpisode: 9 }),
], { subjectId: 'kael', targetId: HARBOR, predicate: 'custom_relation', polarity: 'asserted', text: '고향', fromEpisode: 1 })
const world = (over: Record<string, unknown> = {}) => ({ id: 'w1', name: '해월 세계관', linkedWorkId: 'work-id', relationshipStatus: 'current', settings: fixtureSettings(), ...over })
const linked = () => [{ id: 'w1', linkedWorkId: 'work-id', settings: [] }]

const originalModel = { active: model.active, episodes: model.episodes, draft: model.draft }
beforeEach(() => {
  sessions.mockResolvedValue([])
  history.mockResolvedValue({ threadId: 'a', title: '', turns: [] })
  list.mockResolvedValue([])
  inherited.mockResolvedValue(null)
  workSettings.mockResolvedValue({ current: { writingMode: 'direct' } })
  categories.mockResolvedValue([])
  owned.mockResolvedValue(linked())
  readWorld.mockImplementation(async () => world())
})
afterEach(() => {
  cleanup(); vi.resetAllMocks(); vi.unstubAllEnvs(); operator.viewOnly = false; model.dirty = false
  model.mayLeave.mockReturnValue(true); model.select.mockReturnValue(true); Object.assign(model, originalModel)
})

const renderStudio = () => render(<Provider store={createAppStore()}><MemoryRouter><WritingStudio id="work-id" /></MemoryRouter></Provider>)
const menu = () => screen.getByRole('group', { name: '집필실 메뉴' })
const tab = (name: string) => within(menu()).getByRole('button', { name })
const editor = () => screen.getByRole('textbox', { name: '회차 제목', hidden: true }).closest('.writing-editor') as HTMLElement
const body = () => screen.getByRole('textbox', { name: '원고 본문', hidden: true }) as HTMLTextAreaElement
/** 연결된 세계관을 알게 돼 버튼이 열리면 설정집을 연다. [loaded]면 목록이 읽혀 검색 칸이 보일 때까지 기다린다(읽는 중·실패를 볼 때는 끈다). */
const openBook = async (loaded = true) => {
  await waitFor(() => expect(tab('설정집').getAttribute('aria-disabled')).toBeNull())
  fireEvent.click(tab('설정집'))
  await screen.findByRole('heading', { name: '설정집', level: 2 })
  if (loaded) await screen.findByRole('searchbox', { name: '설정 검색' })
}
const rows = () => within(screen.getByRole('navigation', { name: '설정 카드 목록' })).getAllByRole('button')
const row = (title: RegExp) => within(screen.getByRole('navigation', { name: '설정 카드 목록' })).getByRole('button', { name: title })
const detail = (title: string) => screen.getByRole('region', { name: `${title} 설정 상세` })

it('왼쪽 메뉴는 회차가 기본이고, 설정집을 열면 회차 패널은 지우지 않고 숨기기만 한다', async () => {
  renderStudio()
  expect(tab('회차').getAttribute('aria-pressed')).toBe('true')
  expect(tab('설정집').getAttribute('aria-pressed')).toBe('false')
  expect(screen.queryByRole('searchbox', { name: '설정 검색' })).toBeNull()
  expect(readWorld).not.toHaveBeenCalled() // 설정집을 열기 전에는 읽지 않는다
  await openBook()
  expect(tab('설정집').getAttribute('aria-pressed')).toBe('true')
  expect(tab('회차').getAttribute('aria-pressed')).toBe('false')
  expect(screen.queryByRole('navigation', { name: '회차 목록' })).toBeNull() // 숨겨져 접근성 트리에서 빠진다
  expect(screen.getByRole('navigation', { name: '회차 목록', hidden: true }).closest('[hidden]')).not.toBeNull() // 지우지는 않는다
  fireEvent.click(tab('설정집')) // 이미 열린 설정집을 다시 눌러도 다시 읽지 않는다
  expect(readWorld).toHaveBeenCalledTimes(1)
  fireEvent.click(tab('회차'))
  expect(screen.getByRole('navigation', { name: '회차 목록' })).toBeTruthy()
  expect(screen.queryByRole('searchbox', { name: '설정 검색' })).toBeNull()
})

it('세계관이 연결되지 않은 작품은 설정집 버튼을 잠그고(aria-disabled) 작품 관리 안내를 이유로 잇는다', async () => {
  owned.mockResolvedValue([])
  renderStudio()
  const link = await screen.findByRole('link', { name: '작품 관리에서 세계관을 연결하세요' })
  expect(link.getAttribute('href')).toBe('/content?work=work-id')
  expect(tab('설정집').getAttribute('aria-disabled')).toBe('true')
  expect(document.getElementById(tab('설정집').getAttribute('aria-describedby')!)!.contains(link)).toBe(true)
  fireEvent.click(tab('설정집'))
  expect(tab('설정집').getAttribute('aria-pressed')).toBe('false')
  expect(screen.queryByRole('searchbox', { name: '설정 검색' })).toBeNull()
  expect(readWorld).not.toHaveBeenCalled()
})

it('운영자 열람 모드에서는 연결을 못 찾아도 작품 관리 연결을 권하지 않고 찾지 못했다고만 알린다', async () => {
  operator.viewOnly = true
  owned.mockResolvedValue([])
  renderStudio()
  expect(await screen.findByText('연결된 세계관을 찾지 못했어요.')).toBeTruthy()
  expect(screen.queryByRole('link', { name: '작품 관리에서 세계관을 연결하세요' })).toBeNull()
  expect(tab('설정집').getAttribute('aria-disabled')).toBe('true')
})

it('운영자 열람 모드에서도 연결된 세계관이 있으면 설정집은 읽기로 열린다', async () => {
  operator.viewOnly = true
  renderStudio()
  await openBook()
  expect(rows()).toHaveLength(3)
})

it('연결 확인 중에는 버튼을 잠그고 이유를 알린다', async () => {
  owned.mockReturnValue(new Promise(() => {}))
  renderStudio()
  expect(await screen.findByText('연결된 세계관을 확인하고 있어요…')).toBeTruthy()
  expect(tab('설정집').getAttribute('aria-disabled')).toBe('true')
})

it('연결 확인에 실패하면 단정하지 않고 다시 시도를 주며, 성공하면 버튼이 열린다', async () => {
  owned.mockRejectedValueOnce(new Error('연결 확인 실패')).mockResolvedValue(linked())
  renderStudio()
  expect(await screen.findByText('연결된 세계관을 확인하지 못했어요.')).toBeTruthy()
  expect(tab('설정집').getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(tab('설정집').getAttribute('aria-disabled')).toBeNull())
  expect(screen.queryByText('연결된 세계관을 확인하지 못했어요.')).toBeNull()
})

it('설정집 목록은 분류 칩의 개수·분류·요약과 작가 전용 칩을 보이고, 소설에 없는 회차로 정한 카드도 작가 전용이다', async () => {
  renderStudio()
  await openBook()
  const kinds = screen.getByRole('group', { name: '설정 분류' })
  expect(within(kinds).getAllByRole('button').map((b) => b.textContent)).toEqual(['전체 3', '인물 1', '장소 1', '사건 1'])
  expect(within(kinds).getByRole('button', { name: '전체 3' }).getAttribute('aria-pressed')).toBe('true')
  expect(rows().map((b) => b.getAttribute('aria-label'))).toEqual(['카엘 인물 작가 전용', '새벽항 장소', '해월 전쟁 사건 작가 전용'])
  expect(within(row(/^카엘/)).getByText('해월의 기사. 새벽항에서 태어났다. 오래된 맹세를 지킨다.')).toBeTruthy() // 링크 문법을 벗긴 한 줄 요약
  expect(within(row(/^새벽항/)).queryByText('작가 전용')).toBeNull() // 2화부터 공개(이 소설은 3화까지)
})

it('검색은 제목·별칭·본문·태그를 보고 분류 칩과 함께 걸러지며, 결과가 없으면 알린다', async () => {
  renderStudio()
  await openBook()
  const search = screen.getByRole('searchbox', { name: '설정 검색' })
  fireEvent.change(search, { target: { value: '검은 기사' } }) // 별칭
  expect(rows().map((b) => b.getAttribute('aria-label'))).toEqual(['카엘 인물 작가 전용'])
  expect(screen.getByText('설정 1개')).toBeTruthy()
  fireEvent.change(search, { target: { value: '항구' } }) // 태그와 본문
  expect(rows().map((b) => b.getAttribute('aria-label'))).toEqual(['새벽항 장소'])
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.click(within(screen.getByRole('group', { name: '설정 분류' })).getByRole('button', { name: '사건 1' }))
  expect(rows().map((b) => b.getAttribute('aria-label'))).toEqual(['해월 전쟁 사건 작가 전용'])
  fireEvent.change(search, { target: { value: '존재하지 않는 글' } })
  expect(await screen.findByText('조건에 맞는 설정이 없어요.')).toBeTruthy()
})

it('카드가 한 장도 없으면 그렇게 알리고, 읽는 중·읽기 실패는 빈 목록으로 숨기지 않는다', async () => {
  readWorld.mockImplementation(async () => world({ settings: [] }))
  const first = renderStudio()
  await openBook(false)
  expect(await screen.findByText('이 세계관에는 아직 설정 카드가 없어요.')).toBeTruthy()
  expect(screen.queryByRole('searchbox', { name: '설정 검색' })).toBeNull()
  first.unmount()
  readWorld.mockReset()
  readWorld.mockReturnValue(new Promise(() => {}))
  const second = renderStudio()
  await openBook(false)
  expect(await screen.findByText('설정집을 불러오고 있어요…')).toBeTruthy()
  expect(screen.queryByText('이 세계관에는 아직 설정 카드가 없어요.')).toBeNull()
  second.unmount()
  readWorld.mockReset()
  readWorld.mockRejectedValue(new Error('403'))
  renderStudio()
  await openBook(false)
  expect(await screen.findByText('설정집을 불러오지 못했어요.')).toBeTruthy()
  expect(screen.queryByText('이 세계관에는 아직 설정 카드가 없어요.')).toBeNull()
  readWorld.mockImplementation(async () => world())
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(rows()).toHaveLength(3))
})

it('설정집을 다시 열 때마다 다시 읽되 이미 읽은 목록은 그대로 둔다', async () => {
  renderStudio()
  await openBook()
  await waitFor(() => expect(rows()).toHaveLength(3))
  expect(readWorld).toHaveBeenCalledTimes(1)
  fireEvent.click(tab('회차'))
  readWorld.mockImplementation(async () => world({ settings: fixtureSettings().slice(0, 1) }))
  fireEvent.click(tab('설정집'))
  expect(rows()).toHaveLength(3) // 다시 읽는 동안 이전 목록이 보인다
  await waitFor(() => expect(rows()).toHaveLength(1))
  expect(readWorld).toHaveBeenCalledTimes(2)
})

it('카드를 누르면 가운데 원고 자리가 상세로 바뀌고, 원고 편집기는 지우지 않고 숨겨 입력을 지킨다', async () => {
  renderStudio()
  fireEvent.change(body(), { target: { value: '쓰다 만 문장' } })
  expect(model.edit).toHaveBeenCalledWith({ body: '쓰다 만 문장' })
  const title = screen.getByRole('textbox', { name: '회차 제목' })
  const textarea = body()
  await openBook()
  fireEvent.click(row(/^카엘/))
  const region = detail('카엘')
  expect(document.activeElement).toBe(within(region).getByRole('heading', { name: '카엘 설정 상세' })) // 초점은 상세로
  expect(editor().hasAttribute('hidden')).toBe(true)
  // 같은 DOM 노드가 그대로 있고 입력한 글도 남아 있다(다시 만들어졌다면 노드가 바뀐다).
  expect(body()).toBe(textarea)
  expect(screen.getByRole('textbox', { name: '회차 제목', hidden: true })).toBe(title)
  expect(textarea.value).toBe('쓰다 만 문장')
  fireEvent.click(within(region).getByRole('button', { name: '원고로 돌아가기' }))
  expect(screen.queryByRole('region', { name: '카엘 설정 상세' })).toBeNull()
  expect(editor().hasAttribute('hidden')).toBe(false)
  expect(screen.getByRole('textbox', { name: '원고 본문' })).toBe(textarea)
  expect(textarea.value).toBe('쓰다 만 문장')
  expect(document.activeElement).toBe(row(/^카엘/)) // 초점은 누른 목록 줄로 돌아온다
})

it('상세는 정보 상자·본문·관계 목록·세계관 편집 링크를 읽기 전용으로 보이고 인물이면 인물 문서를 덧붙인다', async () => {
  renderStudio()
  await openBook()
  fireEvent.click(row(/^카엘/))
  const region = detail('카엘')
  const doc = within(region).getByRole('group', { name: '카엘 문서' })
  expect(within(doc).getByText('검은 기사')).toBeTruthy() // 별칭
  expect(within(doc).getByRole('rowheader', { name: '공개 범위' }).nextElementSibling?.textContent).toBe('작가 전용')
  expect(within(doc).getByText(/오래된 맹세를 지킨다/)).toBeTruthy() // 본문
  const relations = within(doc).getByRole('list', { name: '고향 관계 목록' })
  expect(within(relations).getByRole('button', { name: '새벽항' })).toBeTruthy() // 상대 — 관계명
  expect(relations.textContent).toContain('고향')
  const edit = within(region).getByRole('link', { name: '세계관에서 편집' })
  expect(edit.getAttribute('href')).toBe('/worldstudio/w1?card=kael')
  expect(edit.getAttribute('target')).toBe('_blank')
  expect(edit.getAttribute('rel')).toContain('noreferrer')
  const docs = within(region).getByRole('region', { name: '인물 문서' })
  expect(within(docs).getByRole('heading', { name: '성격·말투' }).nextElementSibling?.textContent).toBe('말수가 적고 단호하다.')
  expect(within(docs).getByRole('heading', { name: '목표' }).nextElementSibling?.textContent).toBe('왕을 지킨다.')
  expect(within(region).queryByRole('textbox')).toBeNull() // 읽기 전용: 입력 칸이 없다
  fireEvent.click(within(region).getByRole('button', { name: '원고로 돌아가기' }))
  fireEvent.click(row(/^새벽항/))
  expect(within(detail('새벽항')).queryByRole('region', { name: '인물 문서' })).toBeNull() // 인물이 아니면 없다
  expect(within(detail('새벽항')).getByRole('rowheader', { name: '공개 범위' }).nextElementSibling?.textContent).toBe('2화부터 공개')
})

it('소설에 없는 회차로 정한 카드의 공개 범위는 이유와 함께 작가 전용으로 보인다', async () => {
  renderStudio()
  await openBook()
  fireEvent.click(row(/^해월 전쟁/))
  expect(within(detail('해월 전쟁')).getByRole('rowheader', { name: '공개 범위' }).nextElementSibling?.textContent).toBe('작가 전용 · 9화는 아직 없어요')
})

it('상세의 관계 상대나 본문의 설정 링크를 누르면 그 카드의 상세로 바뀐다', async () => {
  renderStudio()
  await openBook()
  fireEvent.click(row(/^카엘/))
  fireEvent.click(within(within(detail('카엘')).getByRole('list', { name: '고향 관계 목록' })).getByRole('button', { name: '새벽항' }))
  expect(detail('새벽항')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '카엘 설정 상세' })).toBeNull()
  expect(row(/^새벽항/).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(within(detail('새벽항')).getByRole('button', { name: '원고로 돌아가기' }))
  fireEvent.click(row(/^카엘/))
  fireEvent.click(within(detail('카엘').querySelector('.nw-lead') as HTMLElement).getByRole('button', { name: '새벽항' })) // 본문 속 설정 링크
  expect(detail('새벽항')).toBeTruthy()
})

it('관계 정보가 완전하지 않은 세계관은 상세에서 알린다', async () => {
  readWorld.mockImplementation(async () => world({ relationshipStatus: 'incomplete' }))
  renderStudio()
  await openBook()
  fireEvent.click(row(/^카엘/))
  expect(within(detail('카엘')).getByText('관계 정보가 완전하지 않아 관계도에 빠진 연결이 있을 수 있어요.')).toBeTruthy()
})

it('가운데에는 하나만 보인다: 상세를 보다가 시뮬레이션을 열면 상세가 닫히고, 무대 위에서 카드를 고르면 무대가 닫힌다', async () => {
  renderStudio()
  await openBook()
  fireEvent.click(row(/^카엘/))
  fireEvent.click(screen.getByRole('button', { name: '시뮬레이션' }))
  expect(await screen.findByRole('region', { name: '인물 시뮬레이션 무대' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: '카엘 설정 상세' })).toBeNull()
  expect(editor().hasAttribute('hidden')).toBe(true)
  fireEvent.click(row(/^새벽항/))
  expect(detail('새벽항')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '인물 시뮬레이션 무대' })).toBeNull()
  expect(screen.getByRole('button', { name: '시뮬레이션' }).getAttribute('aria-pressed')).toBe('false')
  await act(async () => {})
})

it('카드가 50장을 넘으면 쪽으로 나눈다', async () => {
  readWorld.mockImplementation(async () => world({ settings: Array.from({ length: 51 }, (_, i) => card(`c${i}`, `카드${String(i).padStart(2, '0')}`, 'location')) }))
  renderStudio()
  await openBook()
  await waitFor(() => expect(rows()).toHaveLength(50))
  fireEvent.click(within(screen.getByRole('navigation', { name: '설정 카드 페이지 이동' })).getByRole('button', { name: '다음' }))
  expect(rows().map((b) => b.getAttribute('aria-label'))).toEqual(['카드50 장소 작가 전용'])
})

it('카드 분류를 읽지 못하면 기본 이름으로 보이면서 실패와 다시 시도를 알린다', async () => {
  categories.mockRejectedValue(new Error('분류 읽기 실패'))
  renderStudio()
  await openBook()
  expect(await screen.findByText('카드 분류를 불러오지 못했어요.')).toBeTruthy()
  expect(rows()).toHaveLength(3) // 목록은 그대로 보인다
  categories.mockResolvedValue([])
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(screen.queryByText('카드 분류를 불러오지 못했어요.')).toBeNull())
})

it('데모(--mode mockup)의 세계관 저장소에는 소설 연결이 없어, 설정집을 잠그고 데모에서는 지원하지 않는다고 알린다', async () => {
  vi.stubEnv('MODE', 'mockup')
  owned.mockResolvedValue([])
  renderStudio()
  expect(await screen.findByText('설정집 보기는 데모에서는 지원하지 않아요.')).toBeTruthy()
  expect(tab('설정집').getAttribute('aria-disabled')).toBe('true')
  expect(screen.queryByRole('link', { name: '작품 관리에서 세계관을 연결하세요' })).toBeNull()
})

it('원고로 돌아가기는 상세에서 링크로 다른 쪽의 카드를 연 경우에도 그 카드의 목록 줄로 초점을 돌려준다', async () => {
  const END = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'
  const cards = Array.from({ length: 51 }, (_, i) => card(i === 50 ? END : `c${i}`, `카드${String(i).padStart(2, '0')}`, 'location', i === 0 ? `[끝](card:${END})` : ''))
  readWorld.mockImplementation(async () => world({ settings: cards }))
  renderStudio()
  await openBook()
  await waitFor(() => expect(rows()).toHaveLength(50))
  fireEvent.click(row(/^카드00/))
  fireEvent.click(within(detail('카드00')).getByRole('button', { name: '끝' })) // 본문 링크: 둘째 쪽의 카드 상세
  expect(detail('카드50')).toBeTruthy()
  fireEvent.click(within(detail('카드50')).getByRole('button', { name: '원고로 돌아가기' }))
  expect(rows().map((b) => b.getAttribute('aria-label'))).toEqual(['카드50 장소 작가 전용']) // 그 줄이 있는 쪽으로 넘어간다
  expect(document.activeElement).toBe(row(/^카드50/))
})

// ── 집필 AI 제안 화면(#909)과 같은 가운데 자리를 쓴다: 무대 > 제안 화면 > 설정 상세 > 편집기 ──
const draftStep: ChatStep = { feature: 'writing_editing', task: 'draft', status: 'completed', result: { text: '새로 쓴 장면' } }
const proposalReply = (): ChatReply => ({ status: 'waiting', steps: [draftStep], missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 3, rewritesLeft: 2 })
const withProposal = () => ({ threadId: 'a', title: '', turns: [{ request: '써 줘', reply: proposalReply() }] })
const proposalStage = () => screen.findByRole('region', { name: '집필 AI 제안' })
const chatPanel = () => screen.getByRole('complementary', { name: 'AI 채팅' })
const storedProposal = () => {
  workSettings.mockResolvedValue({ current: { writingMode: 'assisted' } }) // 채팅이 열린 채로 시작한다
  sessions.mockResolvedValue([{ threadId: 'a', title: '대화', updatedAt: '' }])
}

it('설정 상세를 보는 중 제안이 도착하면 제안 화면이 먼저 보이고(상세는 지우지 않고 가려진다), 제안 화면을 닫으면 상세가 돌아온다', async () => {
  storedProposal()
  let failing = true // 처음에는 대화 이력을 읽지 못해 제안이 없다 → 다시 불러오기로 제안이 도착한다
  history.mockImplementation(async () => { if (failing) throw new Error('대화를 불러오지 못했어요.'); return withProposal() })
  renderStudio()
  await openBook()
  fireEvent.click(row(/^카엘/))
  expect(detail('카엘')).toBeTruthy()
  failing = false
  fireEvent.click(within(await screen.findByRole('complementary', { name: 'AI 채팅' })).getByRole('button', { name: '다시 불러오기' }))
  const stage = await proposalStage()
  expect(screen.queryByRole('region', { name: '카엘 설정 상세' })).toBeNull() // 가운데에는 하나만 보인다
  expect(editor().hasAttribute('hidden')).toBe(true)
  expect(row(/^카엘/).getAttribute('aria-pressed')).toBe('true') // 고른 카드는 그대로다
  fireEvent.click(within(stage).getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('region', { name: '집필 AI 제안' })).toBeNull()
  expect(detail('카엘')).toBeTruthy()
  expect(editor().hasAttribute('hidden')).toBe(true)
})

it('제안 화면이 열려 있을 때 카드를 고르면 제안 화면을 닫고 상세를 보이며, 채팅의 링크로 제안 화면을 다시 열면 상세가 닫힌다(편집기는 늘 숨기기만 한다)', async () => {
  storedProposal()
  history.mockResolvedValue(withProposal())
  renderStudio()
  await proposalStage() // 제안이 있으면 저절로 열린다
  const textarea = body()
  await openBook()
  fireEvent.click(row(/^카엘/))
  expect(detail('카엘')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '집필 AI 제안' })).toBeNull()
  expect(editor().hasAttribute('hidden')).toBe(true)
  fireEvent.click(within(chatPanel()).getByRole('button', { name: '원고 영역에서 보기' }))
  const stage = await proposalStage()
  expect(screen.queryByRole('region', { name: '카엘 설정 상세' })).toBeNull()
  expect(row(/^카엘/).getAttribute('aria-pressed')).toBe('false') // 직접 연 제안 화면이 이겨 고른 카드는 닫혔다
  fireEvent.click(within(stage).getByRole('button', { name: '닫기' }))
  expect(editor().hasAttribute('hidden')).toBe(false) // 닫힌 카드가 되살아나지 않고 원고로 돌아온다
  expect(body()).toBe(textarea) // 편집기는 한 번도 다시 만들어지지 않았다
})
