// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { Work } from '../../../../domain/entities/content'
import type { PublicWorld, PublicWorldSummary } from '../../../../domain/entities/publicWorld'
import { putRelation, relationLabel } from '../../../../domain/entities/studioRelations'
import type { ReviewFinding, WorldReview } from '../../../../domain/entities/worldReview'
import { type CharacterDocs, newSetting, type StudioSetting, type StudioWorld, type WorldPublication, type WorldPublicationInput, type WorldRevision, type WorldRevisionSummary } from '../../../../domain/entities/studioWorld'
import type { WorldStudioRepository } from '../../../../domain/repositories/WorldStudioRepository'
import { WorldReviewUseCase } from '../../../../domain/usecases/WorldReviewUseCase'
import { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { LazyMarkdownEditor as fakeEditor } from '../../../../test/markdownEditorFake'
import * as cardImports from '../../../shared/importCards'
import type { useWorldRevisions } from '../viewmodel/useWorldRevisions'
import { WorldStudioPage } from './WorldStudioPage'

let useCase: WorldStudioUseCase
/** 설정집 AI 검토 UseCase. 비워 두면 운영 컨테이너의 것(서버 호출)이고, `null`은 서버 기능이 없는 데모다. */
let reviewCase: WorldReviewUseCase | null | undefined
vi.mock('../viewmodel/useWorldStudioViewModel', async (original) => {
  const actual = await original<typeof import('../viewmodel/useWorldStudioViewModel')>()
  return { useWorldStudioViewModel: () => actual.useWorldStudioViewModel(useCase, reviewCase) }
})

/**
 * 편집 화면의 버전 그래프와 확정 버전 시트가 쓰는 훅(서버 목록·상세 조회와 확정 요청)은 이 대역이다. 로그인 세션이 없는 화면 테스트가 서버를 부르지 않고 행·상세·확정 요청만 정하게 한다.
 */
type Revisions = ReturnType<typeof useWorldRevisions>
let revisions: Revisions
vi.mock('../viewmodel/useWorldRevisions', () => ({ useWorldRevisions: () => revisions }))
// 카드 설명 편집기(Toast UI Editor)는 jsdom에서 입력을 흉내 낼 수 없어 같은 값 전달만 하는 textarea 대역을 쓴다.
vi.mock('../../../shared/LazyMarkdownEditor', () => import('../../../../test/markdownEditorFake'))
const noRevisions = (): Revisions => ({
  rows: [], detail: null, busy: false, error: '', message: '', pending: false, aiPending: false, superseded: null, supported: true,
  open: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined), confirm: vi.fn(async () => undefined), acknowledgeSuperseded: vi.fn(async () => undefined), restore: vi.fn(async () => undefined),
})
const revision = (revisionNo: number, name: string): WorldRevisionSummary => ({ worldId: 'qa', revisionId: `r${revisionNo}`, revisionNo, name, createdAt: `2026-11-0${revisionNo}T09:00:00Z` })
const revisionDetail = (revisionNo: number, name: string): WorldRevision => ({
  worldId: 'qa', revisionId: `r${revisionNo}`, revisionNo, name, description: '확정 당시 소개', parentRevisionId: null, restoredFromRevisionId: null, relationshipStatus: 'not_recorded', relationships: null,
  cards: [{ versionId: 'v1', versionNo: 1, restoredFromVersionId: null, card: { id: 'c1', title: '확정 당시 가람', body: '확정 당시 내용', cardType: 'character', areaCode: 'basic', classification: '설정', aliases: [], tags: [], semanticMetadata: {}, visibility: 'private', lifecycle: 'active' } }],
})

/** jsdom에는 URL.createObjectURL이 없어 표지 이미지(인증 읽기 → 객체 주소) 테스트가 쓰는 대역이다. 만든 순서대로 blob:cover-1, 2 …를 준다. */
const objectUrls = { created: 0, createObjectURL: vi.fn(), revokeObjectURL: vi.fn() }
beforeEach(() => {
  revisions = noRevisions()
  objectUrls.created = 0
  objectUrls.createObjectURL = vi.fn(() => `blob:cover-${++objectUrls.created}`)
  objectUrls.revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = objectUrls.createObjectURL; static revokeObjectURL = objectUrls.revokeObjectURL })
})
afterEach(() => { cleanup(); document.title = 'STORYFORK'; reviewCase = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const person = (title: string, text = ''): StudioSetting => {
  const row = newSetting('people')
  row.item.title = title
  row.item.text = text
  return row
}
const place = (title: string): StudioSetting => {
  const row = newSetting('places')
  row.item.title = title
  return row
}
const friends = (settings: StudioSetting[], a: StudioSetting, b: StudioSetting) => putRelation(settings, { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })

/** 설정 카드 대표 이미지(#401) 대역이 올린 뒤 돌려주는 이미지 id. */
const CARD_IMAGE = '11111111-1111-4111-8111-111111111111'
const NEXT_IMAGE = '22222222-2222-4222-8222-222222222222'

/** 대역 저장소에 줄 수 있는 값. `version`은 저장 버전(0이면 한 번도 저장하지 않은 세계관)이다. 작성 모드(마법사)는 저장 버전이 아니라 주소의 `?new=1`로 정해진다. */
type Fixture = {
  version?: number
  visibility?: StudioWorld['visibility']
  genre?: StudioWorld['genre']
  /** 확정 버전이 있는 세계관(`null`·생략이면 없음). 공개 세계관이 공개 목록에 나오는지의 기준이다. */
  currentRevisionId?: string | null
  read?: WorldStudioRepository['read']
  setPublication?: WorldStudioRepository['setPublication']
  saveStudio?: WorldStudioRepository['saveStudio']
  /** 올린 표지가 있는 세계관 */
  hasCover?: boolean
  setCover?: NonNullable<WorldStudioRepository['setCover']>
  removeCover?: NonNullable<WorldStudioRepository['removeCover']>
  readCover?: NonNullable<WorldStudioRepository['readCover']>
  /** 표지 저장소가 없는 데모(메모리) */
  demoCover?: true
  /** 설정 카드 이미지 저장소(올리기·읽기, #401) */
  uploadCardImage?: NonNullable<WorldStudioRepository['uploadCardImage']>
  readCardImage?: NonNullable<WorldStudioRepository['readCardImage']>
  /** 카드 이미지 저장소가 없는 데모(메모리) */
  demoCardImage?: true
  /** 이 세계관에 연결된 내 소설 id(DEC-46 1:1 연결) */
  linkedWorkId?: string
  /** 관계를 회차 시점으로 읽고 쓰는 서버 저장소(DEC-51, 없으면 회차를 모르는 데모) */
  relationEpisodes?: true
  /** 세계관 삭제(소프트 삭제) 저장소 */
  deleteStudio?: NonNullable<WorldStudioRepository['deleteStudio']>
  /** 삭제 저장소가 없는 대역 */
  demoDelete?: true
}
const published = (worldId: string, change: WorldPublicationInput, listed = true): WorldPublication => ({ worldId, ...change, publishedAt: change.visibility === 'public' ? '2026-11-12T00:00:00Z' : null, listed })

/** 지금 주소(경로 + 쿼리). 탭·마법사 표시가 주소에 남는지 본다. */
const Where = () => {
  const location = useLocation()
  return <p hidden data-testid="where">{location.pathname + location.search}</p>
}
const where = () => screen.getByTestId('where').textContent
/** 브라우저 뒤로가기(history.back)를 흉내 내는 숨은 버튼. */
const Back = () => {
  const navigate = useNavigate()
  return <button type="button" hidden data-testid="history-back" onClick={() => navigate(-1)} />
}
const browserBack = () => fireEvent.click(screen.getByTestId('history-back'))

/** 화면을 연다(제목은 기다리지 않는다). 기본 세계관은 저장한 적 있는 버전 1이다. */
function mount(settings: StudioSetting[] = [person('가람', '기존 내용')], path: string | string[] = '/worldstudio/qa', fixture: Fixture = {}) {
  const entries = Array.isArray(path) ? path : [path]
  const world: StudioWorld = { id: 'qa', name: '검증 세계', description: '설명', version: fixture.version ?? 1, settings, analysis: null, visibility: fixture.visibility, genre: fixture.genre, currentRevisionId: fixture.currentRevisionId, hasCover: fixture.hasCover, linkedWorkId: fixture.linkedWorkId }
  const create = vi.fn(async (_name: string, _description: string, _signal?: AbortSignal): Promise<StudioWorld> => ({ ...structuredClone(world), id: 'created' }))
  const setPublication = vi.fn(fixture.setPublication ?? (async (id: string, change: WorldPublicationInput) => published(id, change)))
  const saveStudio = vi.fn(fixture.saveStudio ?? (async (next: StudioWorld) => next))
  const setCover = vi.fn(fixture.setCover ?? (async () => undefined))
  const removeCover = vi.fn(fixture.removeCover ?? (async () => undefined))
  const readCover = vi.fn(fixture.readCover ?? (async () => new Blob(['png'], { type: 'image/png' })))
  const uploadCardImage = vi.fn(fixture.uploadCardImage ?? (async () => CARD_IMAGE))
  const readCardImage = vi.fn(fixture.readCardImage ?? (async () => new Blob(['png'], { type: 'image/png' })))
  const deleteStudio = vi.fn(fixture.deleteStudio ?? (async () => undefined))
  useCase = new WorldStudioUseCase({
    listStudio: async () => [world],
    read: fixture.read ?? (async () => structuredClone(world)),
    create,
    saveStudio,
    setPublication,
    ...(fixture.demoCover ? {} : { setCover, removeCover, readCover }),
    ...(fixture.demoCardImage ? {} : { uploadCardImage, readCardImage }),
    ...(fixture.demoDelete ? {} : { deleteStudio }),
    ...(fixture.relationEpisodes ? { relationEpisodes: true as const } : {}),
  })
  render(
    <Provider store={createAppStore({ role: 'user' })}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes><Route path="/worldstudio/:worldId?" element={<WorldStudioPage />} /></Routes>
        <Where />
        <Back />
      </MemoryRouter>
    </Provider>,
  )
  return { create, setPublication, saveStudio, setCover, removeCover, readCover, uploadCardImage, readCardImage, deleteStudio }
}
/** `/worldstudio/qa`(저장한 세계관 관리)나 `/worldstudio`(새 세계관 만들기)를 열고 제목이 나올 때까지 기다린다. */
async function show(settings?: StudioSetting[], path: string | string[] = '/worldstudio/qa', fixture: Fixture = {}) {
  const opened = mount(settings, path, fixture)
  await screen.findByRole('heading', { name: path === '/worldstudio' ? '새 세계관 만들기' : '검증 세계', level: 1 })
  return opened
}
const showWorld = () => show()
it('대형 설정집에서 쪽마다 선택한 카드를 유지하고 마지막 카드를 연다', async () => {
  await show(Array.from({ length: 101 }, (_, i) => person(`설정 ${i}`)))
  const table = () => within(screen.getByRole('table', { name: '설정 카드 목록' }))
  expect(table().getAllByRole('row')).toHaveLength(51)
  fireEvent.click(table().getByRole('checkbox', { name: '보이는 설정 모두 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  expect(screen.getByText('현재 페이지 0개 선택 · 다른 페이지·필터 50개 선택')).toBeTruthy()
  fireEvent.click(table().getByRole('checkbox', { name: '설정 50 선택' }))
  expect(screen.getByText('현재 페이지 1개 선택 · 다른 페이지·필터 50개 선택')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '현재 페이지 선택 공개' }))
  expect(table().getByRole('row', { name: /설정 50/ }).textContent).toContain('공개')
  fireEvent.click(screen.getByRole('button', { name: '이전' }))
  expect(table().getByRole('row', { name: /설정 0/ }).textContent).toContain('비공개')
  expect(table().getByRole<HTMLInputElement>('checkbox', { name: '설정 0 선택' }).checked).toBe(true)
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: '설정 100' } })
  fireEvent.click(table().getByRole('button', { name: '설정 100 인물' }))
  expect(screen.getByRole('region', { name: '선택한 설정 편집' })).toBeTruthy()
})
/** 새 세계관 만들기 직후의 마법사(작성 모드): 주소에 `?new=1`이 붙고 저장 버전은 0이다. */
const wizard = (fixture: Fixture = {}) => show(undefined, '/worldstudio/qa?new=1', { version: 0, ...fixture })
/** 설정집 게시판의 행(제목 버튼, 이름 + 분류)을 눌러 그 카드의 편집 패널을 연다. 고르기 전에는 패널이 없다. */
const openCard = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
/** 설정 편집 화면(집필실 같은 3단: 레일 / 편집기 / AI 채팅)이 설정집 화면을 대신한다. 설정집으로 돌아가는 버튼은 상단 바의 '← 설정집'이다. */
const editor = () => within(screen.getByRole('region', { name: '선택한 설정 편집' }))
const rail = () => within(screen.getByRole('navigation', { name: '설정 카드 목록' }))
const graph = () => within(screen.getByRole('region', { name: '버전 그래프' }))
const backToBoard = () => fireEvent.click(screen.getByRole('button', { name: '설정집' }))
/** '+ 새 설정' 메뉴에서 유형을 골라 그 유형의 새 카드의 편집 화면을 연다. */
const addSetting = (type: string) => {
  fireEvent.click(screen.getByRole('button', { name: '새 설정' }))
  fireEvent.click(within(screen.getByRole('menu', { name: '새 설정' })).getByRole('menuitem', { name: type }))
}
const eventCard = (title: string, timeText = '1년'): StudioSetting => {
  const row = newSetting()
  row.item.kind = 'event'
  row.item.category = 'history'
  row.item.title = title
  row.item.text = `${title}이 일어났다`
  row.item.timeText = timeText
  return row
}
const manageTabs = () => within(screen.getByRole('navigation', { name: '세계관 메뉴' }))
const saveBar = () => within(screen.getByRole('group', { name: '저장 상태' }))

it('보기 전환 줄은 현재 보기를 aria-current로 알리고 보기를 바꾸면 따라간다', async () => {
  await showWorld()
  const current = () => manageTabs().getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.textContent)
  expect(current()).toEqual(['설정집'])
  fireEvent.click(manageTabs().getByRole('button', { name: '시간선' }))
  expect(current()).toEqual(['시간선'])
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(current()).toEqual(['관계도'])
})

it('세계관 작업실은 h1 하나와 건너뛰기 링크가 닿는 main을 가진다', async () => {
  await showWorld()
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['검증 세계'])
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getByRole('main').id).toBe('main')
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
})

it('탭 제목에 세계관을 쓴다', async () => {
  await showWorld()
  expect(document.title).toBe('세계관 · STORYFORK')
})

it('서재의 내가 만드는 세계관 탭으로 돌아가는 링크를 본문 맨 위에 둔다', async () => {
  await showWorld()
  const back = screen.getByRole('link', { name: '내가 만드는 세계관' })
  expect(back.getAttribute('href')).toBe('/lib?tab=worlds')
  expect(screen.getByRole('main').contains(back)).toBe(true)
})

it('관리 헤더는 저장한 세계관의 소개와 설정 수·저장 버전·서버 연결 예정 칩, 저장 상태를 보이고 저장 전 입력은 상태만 바꾼다', async () => {
  await showWorld()
  const header = within(screen.getByRole('heading', { name: '검증 세계', level: 1 }).closest('section')!)
  expect(header.getByText('설정 1개')).toBeTruthy()
  expect(header.getByText('저장 버전 1')).toBeTruthy()
  expect(header.getByText('비공개', { selector: '.chip' })).toBeTruthy() // 서버 연결 예정 칩은 실제 공개 범위 칩이 됐다
  expect(header.getByText('설명')).toBeTruthy()
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 관리 모드의 저장 상태는 헤더 칩이 아니라 탭 줄의 저장 영역이 보인다
  expect(header.queryByText('저장됨')).toBeNull()
  openCard('가람 인물') // 관리 모드에는 기본 정보 입력이 없으니 저장 전 입력은 카드 수정으로 만든다
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '고친 이름' } })
  backToBoard()
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  expect(header.getByText('설명')).toBeTruthy()
})

it('관리 보기 전환 줄이 한 줄로 있고(설정집·관계도·시간선) 보기를 옮기면 그 화면으로 바뀐다', async () => {
  await showWorld()
  expect(manageTabs().getAllByRole('button').map((b) => b.textContent)).toEqual(['설정집', '관계도', '시간선'])
  for (const gone of ['세계관 탐색', 'AI 후보 검토', '확정 버전']) expect(manageTabs().queryByRole('button', { name: gone }), gone).toBeNull() // 탐색은 헤더의 공개 화면 보기, 후보 검토는 시트, 확정 버전은 편집 화면의 버전 그래프로 옮겼다
  expect(screen.getByRole('button', { name: 'AI 검토' })).toBeTruthy() // 의견·후보가 없으면 이름에 수를 붙이지 않는다
  expect(manageTabs().getByRole('button', { name: '설정집' }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(screen.getByText('아직 연결한 관계가 없어요.')).toBeTruthy()
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull()
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
})

it('테마 전환은 떠 있는 버튼이 아니라 설정집 화면의 저장 영역 옆(탭 줄 오른쪽 끝)에 기존 작은 버튼 한 개로 있다', async () => {
  await showWorld()
  const theme = screen.getByRole('button', { name: '다크 모드로' }) // 한 개: 떠 있는 버튼은 GlobalChrome이 이 화면에서 그리지 않는다
  const end = saveBar().getByRole('button', { name: '세계관 저장' }).closest('.world-tabs-end')!
  expect(end.lastElementChild).toBe(theme) // 저장 영역 바로 옆, 줄의 오른쪽 끝
  expect(saveBar().queryByRole('button', { name: /모드로/ })).toBeNull() // 저장 상태 묶음 안이 아니라 그 옆
  expect(theme.className).toBe('btn sm') // 새 스타일 없이 기존 작은 버튼: 저장 버튼(btn pri sm)보다 약하다
  fireEvent.click(theme)
  expect(screen.getByRole('button', { name: '라이트 모드로' })).toBeTruthy()
})

it('설정 편집 화면은 상단 바 오른쪽의 저장 영역 옆에 테마 전환 버튼을 한 개 두고, 가려진 설정집 화면의 버튼은 중복으로 보이지 않는다', async () => {
  await showWorld()
  openCard('가람 인물')
  const theme = screen.getByRole('button', { name: '다크 모드로' }) // 가려진 설정집 화면(hidden)의 것은 접근성 트리에 없다
  const bar = theme.closest('.sbar') as HTMLElement
  expect(bar).toBeTruthy()
  expect(within(bar).getByRole('group', { name: '저장 상태' })).toBeTruthy()
  expect(theme.closest('.writing-bar-end')?.lastElementChild).toBe(theme) // 저장 영역 옆, 상단 바 오른쪽 끝
  expect(theme.className).toBe('btn sm')
})

it('작성 마법사에는 탭 줄·저장 영역이 없어 테마 전환 버튼이 헤더의 행동 줄(집필 메모 추가·관리 화면으로 옆)에 한 개 있다', async () => {
  await wizard()
  const theme = screen.getByRole('button', { name: '다크 모드로' })
  const acts = within(theme.closest('.acts') as HTMLElement)
  expect(acts.getByRole('button', { name: '집필 메모 추가' })).toBeTruthy()
  expect(acts.getByRole('button', { name: '관리 화면으로' })).toBeTruthy()
  expect(theme.className).toBe('btn sm')
})

it('새 세계관 만들기(/worldstudio)에는 테마 버튼을 따로 두지 않는다: 그 화면은 떠 있는 테마 버튼(GlobalChrome)이 그대로 맡는다', async () => {
  await show(undefined, '/worldstudio')
  expect(screen.queryByRole('button', { name: /모드로/ })).toBeNull()
})

it('4단계 내비는 지금 단계만 aria-current=step이고 단계 이름·순서는 그대로다', async () => {
  await wizard() // 4단계(기본 정보 포함)는 새로 만든 직후(?new=1) 작성 모드의 내비다
  const steps = within(screen.getByRole('navigation', { name: '세계관 작성 단계' }))
  expect(steps.getAllByRole('button').map((b) => b.textContent)).toEqual(['1기본 정보', '2설정 카드', '3관계 연결 (선택)', '4검토·저장'])
  fireEvent.click(steps.getByRole('button', { name: '설정 카드' }))
  expect(steps.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'step')).toEqual([steps.getByRole('button', { name: '설정 카드' })])
  expect(steps.getByRole('button', { name: '기본 정보' }).closest('li')!.getAttribute('data-state')).toBe('done')
  expect(steps.getByRole('button', { name: '관계 연결 (선택)' }).closest('li')!.getAttribute('data-state')).toBe('next')
})
it('작성 검토는 열 때만 렌더하고 카드와 관계를 각각 페이지로 보여 준다', async () => {
  const cards = Array.from({ length: 101 }, (_, i) => person(`설정 ${i}`))
  let settings = cards
  for (let i = 0; i < 51; i++) settings = friends(settings, cards[i], cards[i + 1])
  await show(settings, '/worldstudio/qa?new=1', { version: 0 })
  expect(document.querySelector('.world-review')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '검토·저장' }))
  const review = within(screen.getByRole('region', { name: '세계관 검토' }))
  expect(review.getByText('설정 카드 101개')).toBeTruthy()
  expect(review.getByText('관계 51개')).toBeTruthy()
  expect(review.getByRole('heading', { name: '설정 0', level: 5 })).toBeTruthy()
  expect(review.queryByRole('heading', { name: '설정 100', level: 5 })).toBeNull()
  const controls = review.getAllByRole('navigation', { name: '페이지 이동' })
  fireEvent.change(within(controls[0]).getByRole('combobox', { name: /페이지/ }), { target: { value: '2' } })
  expect(review.getByRole('heading', { name: '설정 100', level: 5 })).toBeTruthy()
  fireEvent.click(within(controls[1]).getByRole('button', { name: '다음' }))
  expect(review.getByRole('heading', { name: '설정 50 → 설정 51', level: 5 })).toBeTruthy()
})

it('설정 카드 단계는 공개 설정집과 같은 분류 메뉴·검색·정렬·게시판 표로 카드를 보이고 행을 누르면 목록 대신 그 카드의 편집 화면이 열린다', async () => {
  await show([person('나래'), person('가람', '북부 기록관'), place('항구')])
  const menu = within(screen.getByRole('navigation', { name: '설정 분류' }))
  expect(menu.getAllByRole('button').map((b) => b.textContent)).toEqual(['전체 3', '인물 2', '장소 1', '보완 필요 2']) // 두 인물은 SOUL·GOAL이 비어 정리 필요라 보완 필요 분류가 마지막에 선다
  const table = within(screen.getByRole('table', { name: '설정 카드 목록' }))
  expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['보이는 설정 모두 선택', '번호', '분류', '제목', '요약', '공개', '연결']) // 맨 앞은 공개 범위를 바꿀 카드를 고르는 선택 칸이다
  const rows = () => table.getAllByRole('row').slice(1).map((row) => [...row.querySelectorAll('td')].slice(1).map((td) => (td.classList.contains('col-title') ? td.querySelector('button')?.textContent : td.textContent))) // 선택 칸은 빼고, 제목 칸은 제목 버튼만 본다
  expect(rows()).toEqual([['1', '인물', '나래', '', '비공개', '0'], ['2', '인물', '가람', '북부 기록관', '비공개', '0'], ['3', '장소', '항구', '', '비공개', '0']])
  // 좁은 본문에서는 분류·요약 칸이 숨으므로 같은 내용을 제목 아래 한 줄에도 둔다(넓은 본문에서는 CSS가 이 줄을 숨긴다)
  expect(table.getAllByRole('row').slice(1).map((row) => row.querySelector('.col-title .world-row-sub')?.textContent)).toEqual(['인물', '인물북부 기록관', '장소'])
  expect(screen.queryByRole('region', { name: '선택한 설정 편집' })).toBeNull() // 행을 고르기 전에는 편집 화면이 없고 목록만 있다
  expect(screen.queryByRole('combobox', { name: '추가할 설정 유형' })).toBeNull() // 유형은 새 설정의 편집 화면에서 고른다

  fireEvent.change(screen.getByRole('combobox', { name: '정렬' }), { target: { value: 'name' } })
  expect(rows().map((r) => r.slice(0, 3))).toEqual([['1', '인물', '가람'], ['2', '인물', '나래'], ['3', '장소', '항구']])

  fireEvent.click(table.getByRole('button', { name: '항구 장소' }))
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('항구')
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull() // 목록은 숨고 탭 영역 전체가 편집 화면이다
  expect(screen.queryByRole('navigation', { name: '설정 분류' })).toBeNull()
  backToBoard()
  expect(screen.queryByRole('region', { name: '선택한 설정 편집' })).toBeNull()

  fireEvent.click(menu.getByRole('button', { name: '인물 2' }))
  expect(menu.getByRole('button', { name: '인물 2' }).getAttribute('aria-current')).toBe('true')
  expect(rows().map((r) => r[2])).toEqual(['가람', '나래'])

  fireEvent.click(menu.getByRole('button', { name: /^전체/ }))
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: '북부' } })
  expect(rows().map((r) => r[2])).toEqual(['가람'])
  expect(screen.getByText('설정 1개')).toBeTruthy()
})

it('편집 패널은 분류 칩과 이 카드에 이어진 설정·관계를 읽기 전용 목록으로 보이고 항목을 누르면 그 카드로 옮겨 간다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae, place('항구')], garam, narae))
  openCard('가람 인물')
  const panel = within(screen.getByRole('region', { name: '선택한 설정 편집' }))
  expect(panel.getByRole<HTMLSelectElement>('combobox', { name: '유형' }).value).toBe('character') // 같은 유형 칩이 따로 없고 선택 상자 하나로 보인다
  const links = within(panel.getByRole('region', { name: '연관 설정' }))
  const link = links.getByRole('button', { name: '나래 친구' })
  link.focus()
  fireEvent.click(link)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('나래')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '설정 이름' }))) // 눌러서 사라진 링크 대신 새 카드의 이름 입력으로
  backToBoard()
  openCard('항구 장소')
  expect(within(screen.getByRole('region', { name: '연관 설정' })).getByText(/이어진 설정이 없어요/)).toBeTruthy()
  backToBoard()
  // 제목 옆 수: 인물은 관계 수([1]), 읽는 사람에게는 '관계 1개'로 읽힌다
  expect(screen.getByRole('table', { name: '설정 카드 목록' }).textContent).toContain('관계 1개')
})

// ── 설정집 화면(게시판) ↔ 편집 화면(집필실 3단, 주소 ?card=) ─────────────────────────────────────────
it('설정집 화면이 기본이고 레일·버전 그래프·편집기가 있는 편집 화면은 카드를 열 때만 나오며 채팅은 두 화면 모두에 있다', async () => {
  await showWorld()
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
  for (const name of ['선택한 설정 편집', '버전 그래프']) expect(screen.queryByRole('region', { name }), name).toBeNull()
  expect(screen.queryByRole('navigation', { name: '설정 카드 목록' })).toBeNull()
  expect(chatPanel()).toBeTruthy()
  openCard('가람 인물')
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull() // 게시판은 편집 화면 뒤로 숨는다
  expect(screen.queryByRole('heading', { name: '검증 세계', level: 1 })).toBeNull()
  expect(screen.getByRole('heading', { name: '설정 편집', level: 1 })).toBeTruthy()
  expect(rail().getByRole('button', { name: '가람 인물' }).getAttribute('aria-pressed')).toBe('true')
  expect(graph().getByText('작업 초안')).toBeTruthy()
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('가람')
  expect(chatPanel()).toBeTruthy() // 집필실과 같은 오른쪽 AI 채팅
  const open = editor().getByRole<HTMLInputElement>('switch', { name: '이 설정 공개' })
  expect([open.checked, open.disabled]).toEqual([false, false]) // 설정 카드는 기본 비공개이고 카드마다 공개로 바꿀 수 있다(준비 중이던 스포일러 숨기기 자리표시는 독자 공개 회차가 대신한다)
  expect(editor().queryByRole('switch', { name: /스포일러 숨기기/, hidden: true })).toBeNull()
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(document.querySelectorAll('[aria-label="저장 상태"]')).toHaveLength(1) // 숨은 설정집 화면에 같은 저장 영역이 겹쳐 있지 않다
})

it('새 설정은 유형을 고르면 초안에 그 유형의 카드를 더하고 편집 화면을 열어 이름 입력에 초점을 둔다', async () => {
  await showWorld()
  fireEvent.click(screen.getByRole('button', { name: '새 설정' }))
  const menu = within(screen.getByRole('menu', { name: '새 설정' }))
  expect(menu.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['인물', '장소', '조직', '능력', '사물', '규칙', '사건', '기타'])
  fireEvent.click(menu.getByRole('menuitem', { name: '장소' }))
  expect(where()).toMatch(/^\/worldstudio\/qa\?card=[0-9a-f-]{36}$/)
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull()
  expect(editor().getByRole<HTMLSelectElement>('combobox', { name: '유형' }).value).toBe('location')
  await waitFor(() => expect(document.activeElement).toBe(editor().getByRole('textbox', { name: '설정 이름' })))
  fireEvent.change(editor().getByRole('textbox', { name: '설정 이름' }), { target: { value: '항구' } })
  fireEvent.change(editor().getByRole('textbox', { name: '설명' }), { target: { value: '배가 드나드는 곳' } })
  expect(rail().getByRole('button', { name: '항구 장소' }).getAttribute('aria-pressed')).toBe('true') // 새 카드가 레일에 오르고 강조된다
  backToBoard()
  expect(screen.getByRole('button', { name: '항구 장소' })).toBeTruthy() // 고른 유형·입력이 초안에 남아 게시판에 오른다
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
})

it('← 설정집과 브라우저 뒤로가기는 설정집 화면으로 돌아오고 편집한 초안과 그 카드 행의 초점을 지킨다', async () => {
  mount(undefined, ['/before', '/worldstudio/qa'])
  await screen.findByRole('heading', { name: '검증 세계', level: 1 })
  let name = '가람'
  for (const back of [backToBoard, browserBack]) {
    openCard(`${name} 인물`)
    expect(where()).toMatch(/^\/worldstudio\/qa\?card=/)
    name += '!'
    fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: name } })
    back()
    expect(screen.queryByRole('region', { name: '선택한 설정 편집' })).toBeNull()
    expect(where()).toBe('/worldstudio/qa') // 한 걸음 뒤로 간 것이라 설정집 주소로 돌아오고 기록이 쌓이지 않는다
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: `${name} 인물` })))
    expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy() // 초안은 그대로
  }
  browserBack()
  expect(where()).toBe('/before') // 열고 닫는 동안 설정집 주소 기록이 늘지 않았다
})

it('레일에서 다른 카드를 누르면 편집기가 그 카드로 바뀌고 기록은 그대로이며, 레일의 검색·분류 칩은 목록만 거른다', async () => {
  const [garam, narae, harbor] = [person('가람', '첫째'), person('나래', '둘째'), place('항구')]
  await show([garam, narae, harbor])
  openCard('가람 인물')
  fireEvent.click(rail().getByRole('button', { name: '나래 인물' }))
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('나래')
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'IDENTITY.md' }).value).toBe('둘째') // 인물 카드의 본문은 IDENTITY.md 문서다
  expect(rail().getByRole('button', { name: '나래 인물' }).getAttribute('aria-pressed')).toBe('true')
  expect(rail().getByRole('button', { name: '가람 인물' }).getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(within(screen.getByRole('group', { name: '설정 분류' })).getByRole('button', { name: '장소 1' }))
  expect(Array.from(rail().getAllByRole('button'), (b) => b.getAttribute('aria-label')).filter((label) => label && !label.endsWith('더보기'))).toEqual(['항구 장소'])
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('나래') // 편집 중인 카드는 거르지 않는다
  fireEvent.click(within(screen.getByRole('group', { name: '설정 분류' })).getByRole('button', { name: '전체' }))
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: '가람' } })
  expect(rail().queryByRole('button', { name: '나래 인물' })).toBeNull()
  expect(rail().getByRole('button', { name: '가람 인물' })).toBeTruthy()
  backToBoard()
  expect(where()).toBe('/worldstudio/qa') // 편집 중 카드를 옮겨도 기록은 하나뿐이라 한 번에 설정집으로 돌아온다
  expect((screen.getByRole('searchbox', { name: '설정 검색' }) as HTMLInputElement).value).toBe('가람') // 검색어는 게시판과 레일이 함께 쓴다
})

it('주소의 card가 있으면 그 카드의 편집 화면이 바로 열리고(새로고침) 닫으면 설정집 주소로 바꾸며, 초안에 없는 카드면 설정집이다', async () => {
  const garam = person('가람', '기존 내용')
  mount([garam], `/worldstudio/qa?card=${garam.item.id}`)
  expect(await screen.findByRole<HTMLInputElement>('textbox', { name: '설정 이름' })).toBeTruthy()
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('가람')
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull()
  backToBoard() // 기록 없이 바로 연 주소라 뒤로 가지 않고 주소만 바꾼다
  expect(where()).toBe('/worldstudio/qa')
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
  cleanup()
  await show([garam], '/worldstudio/qa?card=missing') // 새로고침으로 사라진 미저장 카드 같은 경우
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: '선택한 설정 편집' })).toBeNull()
})

// #470: 새로고침으로 미저장 카드가 사라져도 주소의 card는 남는다. 그대로 두면 카드를 더하고 지울 때 history back이 그 옛 기록에 착지해 설정집 화면인데 주소에는 없는 카드가 남는다.
it('주소의 card가 초안에 없는 카드(새로고침으로 사라진 미저장 카드)를 가리키면 불러온 뒤 기록을 쌓지 않고 주소에서 지운다(#470)', async () => {
  mount(undefined, ['/before', '/worldstudio/qa?new=1&card=gone'], { version: 0 })
  await screen.findByRole('heading', { name: '검증 세계', level: 1 })
  await waitFor(() => expect(where()).toBe('/worldstudio/qa?new=1')) // 마법사 표시 같은 다른 쿼리는 그대로
  browserBack()
  expect(where()).toBe('/before') // 지우면서 새 기록을 쌓지 않았다(replace)
})

it('새로고침 뒤 카드를 여러 개 더하고 편집 화면에서 지워도 주소에 없는 card가 남지 않고 단계를 옮겨도 다시 나타나지 않는다(#470)', async () => {
  mount(undefined, ['/worldstudio/qa?new=1&card=gone'], { version: 0 }) // 미저장 카드가 새로고침으로 사라진 뒤: 주소에만 남은 옛 card
  await screen.findByRole('heading', { name: '검증 세계', level: 1 })
  const steps = () => within(screen.getByRole('navigation', { name: '세계관 작성 단계' }))
  fireEvent.click(steps().getByRole('button', { name: '설정 카드' }))
  addSetting('인물')
  addSetting('장소')
  addSetting('사건')
  expect(where()).toMatch(/^\/worldstudio\/qa\?new=1&card=[0-9a-f-]{36}$/)
  fireEvent.click(editor().getByRole('button', { name: '카드 삭제' }))
  fireEvent.click(within(screen.getByRole('region', { name: '설정 삭제 확인' })).getByRole('button', { name: '설정과 연결 삭제' }))
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy() // 설정집 화면으로 돌아왔다
  expect(where()).toBe('/worldstudio/qa?new=1') // 주소도 card 없이 설정집 화면을 가리킨다
  fireEvent.click(steps().getByRole('button', { name: '검토·저장' }))
  expect(where()).toBe('/worldstudio/qa?new=1')
  fireEvent.click(steps().getByRole('button', { name: '설정 카드' }))
  expect(where()).toBe('/worldstudio/qa?new=1')
})

it('이미 없는 카드의 card가 붙은 기록으로 돌아가도(뒤로·앞으로 가기) 설정집 화면이고 주소에서 card를 지운다(#470)', async () => {
  mount(undefined, ['/worldstudio/qa?card=gone', '/worldstudio/qa'])
  await screen.findByRole('heading', { name: '검증 세계', level: 1 })
  browserBack() // 지운 카드의 편집 화면이던 기록
  await waitFor(() => expect(where()).toBe('/worldstudio/qa'))
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
})

it('유형과 관계없이 카드를 지울 수 있다: 이어진 관계 수를 확인한 뒤 설정집으로 돌아가 되돌리기를 보이고, 저장해야 서버에 반영된다', async () => {
  const [garam, harbor] = [person('가람'), place('항구')]
  const { saveStudio } = await show(friends([garam, harbor], garam, harbor))
  openCard('항구 장소')
  fireEvent.click(editor().getByRole('button', { name: '카드 삭제' }))
  const confirm = () => within(screen.getByRole('region', { name: '설정 삭제 확인' }))
  expect(confirm().getByText(/설정과 연결된 관계·감정 1개를 편집본에서 삭제해요/)).toBeTruthy()
  expect(confirm().getByText('친구')).toBeTruthy() // 함께 지워질 관계
  fireEvent.click(confirm().getByRole('button', { name: '삭제 취소' }))
  expect(screen.queryByRole('region', { name: '설정 삭제 확인' })).toBeNull()
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 취소하면 아무것도 바뀌지 않는다
  fireEvent.click(editor().getByRole('button', { name: '카드 삭제' }))
  fireEvent.click(confirm().getByRole('button', { name: '설정과 연결 삭제' }))
  // 설정집으로 돌아가고, 지운 카드와 관계가 빠지며, 되돌리기 상태 메시지가 뜬다
  const table = () => within(screen.getByRole('table', { name: '설정 카드 목록' }))
  expect(table().queryByRole('button', { name: '항구 장소' })).toBeNull()
  expect(table().getByRole('button', { name: '가람 인물' })).toBeTruthy()
  expect(table().queryByText('관계 1개')).toBeNull() // 가람에 이어진 관계도 함께 지워졌다
  expect(screen.getByText(/‘항구’ 설정이 삭제됐어요/)).toBeTruthy()
  expect(where()).toBe('/worldstudio/qa')
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '설정 검색' }))) // 행이 없어졌으니 목록의 첫 컨트롤로
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(screen.queryByRole('button', { name: /삭제 되돌리기/ })).toBeNull() // 관계도의 되돌리기는 인물 삭제만(관계 주체 선택지에 없는 유형을 고르지 않는다)
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
  expect(table().getByRole('button', { name: '항구 장소' })).toBeTruthy()
  expect(table().getByText('관계 1개')).toBeTruthy() // 관계도 돌아온다
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull()
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 삭제 전 상태로 완전히 돌아왔다
  await waitFor(() => expect(document.activeElement).toBe(table().getByRole('button', { name: '항구 장소' })))
  // 다시 지우고 저장하면 카드와 관계가 빠진 초안이 그대로 서버로 간다
  openCard('항구 장소')
  fireEvent.click(editor().getByRole('button', { name: '카드 삭제' }))
  fireEvent.click(confirm().getByRole('button', { name: '설정과 연결 삭제' }))
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveBar().getByText('저장됨')).toBeTruthy())
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(saveStudio.mock.calls[0][0].settings.map((s) => s.item.title)).toEqual(['가람'])
  expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull() // 저장하면 되돌릴 수 없다
})

it('레일의 ⋮ 메뉴 삭제는 그 카드를 열어 같은 삭제 확인을 보이고, 다른 설정이 아직 참조하는 카드는 이유를 알리며 지우지 못하게 막는다', async () => {
  const [harbor, log] = [place('항구'), person('항구 기록')]
  log.item.relatedIds = [harbor.item.id]
  await show([harbor, log])
  openCard('항구 기록 인물')
  fireEvent.click(rail().getByRole('button', { name: '항구 더보기' }))
  fireEvent.click(within(screen.getByRole('menu', { name: '항구 더보기' })).getByRole('menuitem', { name: '삭제' }))
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('항구') // 지울 카드가 편집기에 열린다
  const confirm = within(screen.getByRole('region', { name: '설정 삭제 확인' }))
  expect(confirm.getByRole('alert').textContent).toContain('다른 설정에서 참조하고 있어 삭제할 수 없어요')
  expect(confirm.getByText('항구 기록')).toBeTruthy()
  expect(confirm.getByRole<HTMLButtonElement>('button', { name: '설정과 연결 삭제' }).disabled).toBe(true)
  fireEvent.click(confirm.getByRole('button', { name: '삭제 취소' }))
  expect(screen.queryByRole('region', { name: '설정 삭제 확인' })).toBeNull()
})

it('관계도 보기의 인물 삭제도 같은 삭제 흐름이다: 관계와 함께 지우고 되돌릴 수 있다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae))
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  fireEvent.change(screen.getByRole('combobox', { name: '관계 주체' }), { target: { value: garam.item.id } })
  fireEvent.click(screen.getByRole('button', { name: '선택한 인물 삭제' }))
  expect(screen.getByRole('region', { name: '인물 삭제 확인' }).textContent).toContain('인물과 연결된 관계·감정 1개를 편집본에서 삭제해요')
  fireEvent.click(screen.getByRole('button', { name: '인물과 연결 삭제' }))
  expect(screen.queryByRole('table', { name: '저장할 관계 목록' })).toBeNull()
  expect(screen.getByText('아직 연결한 관계가 없어요.')).toBeTruthy()
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '인물 삭제 되돌리기' }))
  expect(screen.getByRole('table', { name: '저장할 관계 목록' })).toBeTruthy()
  expect(saveBar().getByText('저장됨')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '인물 삭제 되돌리기' })).toBeNull()
})

it('집필 메모 추가는 보기 전환 줄의 AI 검토 옆에 있어 어느 보기에서든 새 메모의 편집 화면을 열고 돌아오면 그 보기다', async () => {
  await showWorld()
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  const memo = screen.getByRole('button', { name: '집필 메모 추가' })
  expect(memo.previousElementSibling).toBe(screen.getByRole('button', { name: /^AI 검토/ })) // 관리 모드에서는 헤더가 아니라 보기 전환 줄이다
  expect(headerOf().queryByRole('button', { name: '집필 메모 추가' })).toBeNull()
  fireEvent.click(memo)
  expect(where()).toMatch(/^\/worldstudio\/qa\?view=people&card=[0-9a-f-]{36}$/)
  expect(editor().getByRole('textbox', { name: '설정 이름' })).toBeTruthy()
  backToBoard()
  expect(where()).toBe('/worldstudio/qa?view=people')
  expect(manageTabs().getByRole('button', { name: '관계도' }).getAttribute('aria-current')).toBe('page')
})

it('작성 모드에는 보기 전환 줄이 없어 집필 메모 추가가 헤더 행동 줄에 남는다', async () => {
  await wizard()
  fireEvent.click(headerOf().getByRole('button', { name: '집필 메모 추가' }))
  expect(where()).toMatch(/^\/worldstudio\/qa\?new=1&card=[0-9a-f-]{36}$/)
  expect(editor().getByRole('textbox', { name: '설정 이름' })).toBeTruthy()
})

it('작성 모드의 설정 카드 단계도 같은 게시판과 편집 화면이고 마법사 표시(?new=1)를 주소에 지킨다', async () => {
  await wizard()
  fireEvent.click(within(screen.getByRole('navigation', { name: '세계관 작성 단계' })).getByRole('button', { name: '설정 카드' }))
  addSetting('인물')
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull()
  expect(where()).toMatch(/^\/worldstudio\/qa\?new=1&card=[0-9a-f-]{36}$/)
  backToBoard()
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
  expect(screen.getByRole('navigation', { name: '세계관 작성 단계' })).toBeTruthy() // 마법사의 단계 내비는 그대로다
  expect(where()).toBe('/worldstudio/qa?new=1')
})

// ── 편집 화면의 버전 그래프(확정 버전은 여기서 보고 남긴다) ────────────────────────────────────────
it('버전 그래프는 작업 초안(저장하지 않은 수정 표시)과 확정 버전을 줄로 보이고 확정 버전을 누르면 읽기 전용 시트가 열린다', async () => {
  const open = vi.fn(async () => undefined)
  revisions = { ...noRevisions(), open, rows: [revision(1, '초판'), revision(2, '개정판')], detail: revisionDetail(2, '개정판') }
  await show(undefined, '/worldstudio/qa', { currentRevisionId: 'r2' })
  openCard('가람 인물')
  expect(graph().getAllByRole('listitem')).toHaveLength(3) // 작업 초안 + 확정 버전 둘(최신이 위)
  expect(graph().getAllByRole('listitem').map((li) => li.querySelector('.graph-label')?.firstChild?.textContent)).toEqual(['작업 초안', '확정 버전 2 · 개정판 · 현재 기준', '확정 버전 1 · 초판'])
  expect(graph().queryByText('저장 안 됨')).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '고친 이름' } })
  expect(graph().getByText('저장 안 됨')).toBeTruthy()
  expect(graph().getByText(/관계는 회차별로 기록해요/)).toBeTruthy()
  fireEvent.click(graph().getByRole('button', { name: /확정 버전 1 · 초판/ }))
  expect(open).toHaveBeenCalledWith('r1')
  const sheet = within(screen.getByRole('dialog', { name: '확정 버전' }))
  expect(sheet.getByRole('region', { name: '확정 버전 읽기 전용' })).toBeTruthy()
  expect(sheet.getByText('확정 당시 내용')).toBeTruthy() // 카드는 읽기 전용으로
  expect(sheet.getByText(/관계의 과거 상태는 저장하지 않아요/)).toBeTruthy()
  fireEvent.click(sheet.getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('설정집 화면에도 확정 버전 남기기가 저장 영역 옆에 있어 같은 확정 버전 시트를 열고, 저장하지 않은 변경이 있으면 잠그며 이유를 알린다', async () => {
  const confirm = vi.fn(async () => undefined)
  revisions = { ...noRevisions(), confirm }
  await showWorld()
  const button = () => screen.getByRole<HTMLButtonElement>('button', { name: '확정 버전 남기기' })
  expect(saveBar().getByRole('button', { name: '세계관 저장' }).closest('.world-tabs-end')?.contains(button())).toBe(true) // 저장 영역과 한 줄
  fireEvent.click(button())
  fireEvent.click(within(screen.getByRole('dialog', { name: '확정 버전' })).getByRole('button', { name: '저장된 초안을 확정 버전으로 남기기' }))
  expect(confirm).toHaveBeenCalledOnce() // 새 로직 없이 기존 확정 요청
  fireEvent.click(within(screen.getByRole('dialog', { name: '확정 버전' })).getByRole('button', { name: '닫기' }))
  dirtyCard()
  expect(button().disabled).toBe(true)
  expect(document.getElementById(button().getAttribute('aria-describedby') ?? '')?.textContent).toBe('저장하지 않은 변경이 있어요. 먼저 세계관을 저장하세요.')
  expect(document.getElementById(button().getAttribute('aria-describedby') ?? '')?.classList.contains('sr-only')).toBe(false) // 눈에도 보이는 이유
  cleanup()
  revisions = { ...noRevisions(), supported: false }
  await showWorld()
  expect(button().disabled).toBe(true)
  expect(document.getElementById(button().getAttribute('aria-describedby') ?? '')?.textContent).toContain('목업에서는 확정 버전을 지원하지 않아요')
})

it('확정 버전 남기기는 그래프 머리의 버튼이 같은 시트를 열어 기존 확정 요청을 보내며, 목업은 막고 이유를 알린다', async () => {
  const confirm = vi.fn(async () => undefined)
  revisions = { ...noRevisions(), confirm }
  await showWorld()
  openCard('가람 인물')
  fireEvent.click(graph().getByRole('button', { name: '확정 버전 남기기' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '확정 버전' })).getByRole('button', { name: '저장된 초안을 확정 버전으로 남기기' }))
  expect(confirm).toHaveBeenCalledOnce()
  cleanup()
  revisions = { ...noRevisions(), supported: false }
  await showWorld()
  openCard('가람 인물')
  expect(graph().getByRole<HTMLButtonElement>('button', { name: '확정 버전 남기기' }).disabled).toBe(true)
  expect(graph().getByText(/목업에서는 확정 버전을 지원하지 않아요/)).toBeTruthy()
})

// ── 보기 전환(설정집·관계도·시간선)과 지워진 탭의 옛 주소 ──────────────────────────────────────
it('시간선은 설정집 화면의 보기 전환이고(?view=timeline) 저장한 설정의 사건만 기존 시간선으로 보인다', async () => {
  await show([person('가람'), eventCard('건국')])
  fireEvent.click(manageTabs().getByRole('button', { name: '시간선' }))
  expect(where()).toBe('/worldstudio/qa?view=timeline')
  expect(manageTabs().getByRole('button', { name: '시간선' }).getAttribute('aria-current')).toBe('page')
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull()
  expect(screen.getByText(/저장한 설정만 보여드려요/)).toBeTruthy()
  expect(Array.from(within(screen.getByRole('region', { name: '사건 시간선' })).getAllByRole('button'), (b) => b.textContent)).toEqual(['1년건국'])
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(where()).toBe('/worldstudio/qa')
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
})

it('시간선은 저장한 설정 기준이라 작성 중인 수정은 저장하기 전까지 반영하지 않는다', async () => {
  await show([eventCard('건국')])
  openCard('건국 사건')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '건국 선포' } })
  backToBoard()
  fireEvent.click(manageTabs().getByRole('button', { name: '시간선' }))
  const events = () => Array.from(within(screen.getByRole('region', { name: '사건 시간선' })).getAllByRole('button'), (b) => b.textContent)
  expect(events()).toEqual(['1년건국'])
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveBar().getByText('저장됨')).toBeTruthy())
  expect(events()).toEqual(['1년건국 선포'])
})

it.each([
  ['book', '/worldstudio/qa'],
  ['people', '/worldstudio/qa?view=people'],
  ['analysis', '/worldstudio/qa'],
  ['versions', '/worldstudio/qa'],
  ['explore', '/worldstudio/qa'],
])('옛 주소 ?tab=%s는 그 탭을 대신한 화면으로 열고 기록을 쌓지 않고 주소를 바꾼다', async (tab, expected) => {
  mount(undefined, ['/before', `/worldstudio/qa?tab=${tab}`])
  await screen.findByRole('heading', { name: '검증 세계', level: 1 })
  await waitFor(() => expect(where()).toBe(expected))
  if (tab === 'people') expect(screen.getByText('아직 연결한 관계가 없어요.')).toBeTruthy()
  else expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
  if (tab === 'analysis') expect(screen.getByRole('dialog', { name: 'AI 검토' })).toBeTruthy() // AI 후보 검토는 AI 검토 시트의 한 절이 됐다
  else expect(screen.queryByRole('dialog')).toBeNull()
  browserBack()
  expect(where()).toBe('/before') // 주소를 바꿔 쓴 것이지 새 기록을 쌓은 것이 아니다
})

it('AI 검토는 설정집 화면의 버튼이 시트로 열고, 시트 아래 절의 AI 후보 검토는 분석이 없으면 분석 요청 버튼만 보이며 저장하지 않은 세계관이면 잠근다', async () => {
  await showWorld()
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  const sheet = within(screen.getByRole('dialog', { name: 'AI 검토' }))
  expect(sheet.getByRole('region', { name: 'AI 후보 검토' })).toBeTruthy()
  expect(sheet.getByRole<HTMLButtonElement>('button', { name: 'AI 분석 요청' }).disabled).toBe(false)
  expect(sheet.queryByText('먼저 세계관을 저장하세요.')).toBeNull()
  fireEvent.click(sheet.getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  cleanup()
  await show(undefined, '/worldstudio/qa', { version: 0 })
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  expect(within(screen.getByRole('dialog', { name: 'AI 검토' })).getByRole<HTMLButtonElement>('button', { name: 'AI 분석 요청' }).disabled).toBe(true)
  expect(screen.getByText('먼저 세계관을 저장하세요.')).toBeTruthy()
})

it('헤더의 소설 버튼은 한 자리다: 연결된 소설이 없으면 소설 연결하기뿐이고, 데모는 새 소설 폼으로 가는 소설 작성하기뿐이다', async () => {
  await showWorld()
  expect(headerOf().getByRole('button', { name: '소설 연결하기' })).toBeTruthy()
  expect(headerOf().queryByRole('link', { name: '소설 작성하기' })).toBeNull() // 같은 자리에 두 버튼을 두지 않는다
  expect(headerOf().getByText('연결된 소설이 없어요.').querySelector('button, a')).toBeNull() // 그 위의 상태 줄은 정보만 보인다
  expect(screen.queryByRole('link', { name: '새 소설 등록으로' })).toBeNull()
  cleanup()
  vi.stubEnv('MODE', 'mockup')
  await showWorld()
  expect(headerOf().getByRole('link', { name: '소설 작성하기' }).getAttribute('href')).toBe('/new') // 데모는 기존 새 소설 폼
  expect(headerOf().queryByRole('button', { name: '소설 연결하기' })).toBeNull()
})

it('관계 연결 단계에서 그래프 카드를 차례로 두 번 누르면 관계 추가 폼의 주체·대상이 채워지고 관계 작성이 열린다', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const [garam, narae] = [person('가람'), person('나래')]
  await show([garam, narae, person('다온')])
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  const press = (name: string) => {
    const card = screen.getByRole('group', { name })
    fireEvent.pointerDown(card, { clientX: 20, clientY: 20 })
    fireEvent.pointerUp(card, { clientX: 20, clientY: 20 })
  }
  press('가람 인물 카드')
  expect(screen.getByText(/가람의 연결 상대를 고르세요/)).toBeTruthy()
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '관계 주체' }).value).toBe(garam.item.id)
  expect(screen.queryByRole('combobox', { name: '실제 관계 1' })).toBeNull() // 첫 번째 누름만으로는 열리지 않는다
  press('나래 인물 카드')
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '관계 대상' }).value).toBe(narae.item.id)
  expect(screen.getByRole('combobox', { name: '실제 관계 1' })).toBeTruthy()
  expect(screen.queryByText(/연결 상대를 고르세요/)).toBeNull()
})

// ── 관계 기준 회차(DEC-51): 관계도 보기·작성 모드 관계 연결 단계에서 고른다 ───────────────────────
const episodePicker = () => within(screen.getByRole('region', { name: '관계 기준 회차' }))
it('관계도 보기에서 회차를 고르면 그 회차로 다시 읽고, 회차 칸은 다시 열리지 않으며 요청이 끝나면 입력 칸으로 초점이 돌아온다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  const at = (episode?: number): StudioWorld => ({ id: 'qa', name: '검증 세계', description: '설명', version: 1, settings: episode === 1 ? [garam, narae] : friends([garam, narae], garam, narae), analysis: null, linkedWorkId: 'w1' })
  const read = vi.fn(async (_id: string, _signal?: AbortSignal, episode?: number) => structuredClone(at(episode)))
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa', { linkedWorkId: 'w1', relationEpisodes: true, read })
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(screen.getByRole('button', { name: '가람 · 친구 · 나래 편집' })).toBeTruthy() // 최신 회차의 관계
  const apply = episodePicker().getByRole('button', { name: '이 회차 관계 보기' }), field = episodePicker().getByRole('textbox', { name: '관계 기준 화' })
  fireEvent.change(field, { target: { value: '1' } })
  fireEvent.click(apply)
  expect(await screen.findByText('아직 연결한 관계가 없어요.')).toBeTruthy()
  expect(read).toHaveBeenLastCalledWith('qa', expect.any(AbortSignal), 1)
  expect(episodePicker().getByText('지금은 1화 시점의 관계예요.')).toBeTruthy()
  expect(episodePicker().getByRole('button', { name: '이 회차 관계 보기' })).toBe(apply) // 관계 편집기만 다시 열리고 회차 칸은 그대로다
  await waitFor(() => expect(document.activeElement).toBe(field)) // 요청 중 잠기며 잃은 초점을 입력 칸으로 돌려준다
})
it('회차 선택은 데모(메모리)·소설 미연결·저장하지 않은 변경에서 이유와 함께 잠기고, 작성 모드의 관계 연결 단계에도 있다', async () => {
  await show(undefined, '/worldstudio/qa?view=people', { linkedWorkId: 'w1' }) // 회차를 모르는 저장소
  expect(episodePicker().getByText('데모에서는 지원하지 않아요.')).toBeTruthy()
  expect(episodePicker().getByRole<HTMLInputElement>('textbox', { name: '관계 기준 화' }).disabled).toBe(true)
  cleanup()
  await wizard({ relationEpisodes: true })
  fireEvent.click(within(screen.getByRole('navigation', { name: '세계관 작성 단계' })).getByRole('button', { name: '관계 연결 (선택)' }))
  expect(episodePicker().getByText('소설을 연결하면 회차별로 기록할 수 있어요.')).toBeTruthy()
  cleanup()
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people', { linkedWorkId: 'w1', relationEpisodes: true })
  expect(episodePicker().getByRole<HTMLInputElement>('textbox', { name: '관계 기준 화' }).disabled).toBe(false)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: '가람 · 친구 · 나래 삭제' })) // 초안을 바꾸면 다시 읽을 때 잃으므로 잠근다
  expect(episodePicker().getByText('저장하지 않은 변경이 있어 회차를 바꿀 수 없어요. 먼저 세계관을 저장하세요.')).toBeTruthy()
})

/** 관계도 보기의 회차 칸에 회차를 넣어 그 회차 시점으로 다시 읽는다. */
const pickEpisode = async (episode: number) => {
  fireEvent.change(episodePicker().getByRole('textbox', { name: '관계 기준 화' }), { target: { value: String(episode) } })
  fireEvent.click(episodePicker().getByRole('button', { name: '이 회차 관계 보기' }))
  await waitFor(() => expect(episodePicker().getByText(`지금은 ${episode}화 시점의 관계예요.`)).toBeTruthy())
}
it('관계 기준 회차를 고른 동안에는 설정 삭제 진입점(인물 삭제·편집 화면 삭제·레일 ⋮ 삭제)이 이유와 함께 잠기고, 최신으로 돌아오면 열린다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  const reason = '설정 삭제는 최신 회차에서 할 수 있어요.'
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people', { linkedWorkId: 'w1', relationEpisodes: true })
  await pickEpisode(1)
  fireEvent.change(screen.getByRole('combobox', { name: '관계 주체' }), { target: { value: garam.item.id } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '선택한 인물 삭제' }).disabled).toBe(true)
  expect(within(screen.getByRole('region', { name: '관계 편집' })).getByText(reason)).toBeTruthy()
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  openCard('가람 인물')
  expect(editor().getByRole<HTMLButtonElement>('button', { name: '카드 삭제' }).disabled).toBe(true)
  expect(editor().getByText(reason)).toBeTruthy()
  fireEvent.click(rail().getByRole('button', { name: '나래 더보기' }))
  const menu = screen.getByRole('menu', { name: '나래 더보기' })
  expect(within(menu).getByRole<HTMLButtonElement>('menuitem', { name: '삭제' }).disabled).toBe(true)
  expect(menu.getAttribute('aria-describedby')).toBe(editor().getByText(reason).id) // 잠긴 항목은 초점을 못 받으니 같은 이유를 메뉴의 설명으로 잇는다
  fireEvent.click(rail().getByRole('button', { name: '나래 더보기' })) // 메뉴를 닫는다
  backToBoard()
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  fireEvent.click(episodePicker().getByRole('button', { name: '최신으로' }))
  await waitFor(() => expect(episodePicker().getByText('지금은 최신 회차의 관계예요.')).toBeTruthy())
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  openCard('가람 인물')
  expect(editor().getByRole<HTMLButtonElement>('button', { name: '카드 삭제' }).disabled).toBe(false)
  expect(editor().queryByText(reason)).toBeNull()
})
it('지난 회차를 연 채 저장하면 어느 회차로 기록되는지 저장 영역과 작성 모드의 검토·저장 단계가 알리고, 최신이면 알리지 않는다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  const note = '관계는 1화 기준으로 저장돼요.'
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people', { linkedWorkId: 'w1', relationEpisodes: true })
  expect(saveBar().queryByText(note)).toBeNull()
  await pickEpisode(1)
  expect(saveBar().getByText(note)).toBeTruthy()
  fireEvent.click(episodePicker().getByRole('button', { name: '최신으로' }))
  await waitFor(() => expect(saveBar().queryByText(note)).toBeNull())
  cleanup()
  await wizard({ linkedWorkId: 'w1', relationEpisodes: true })
  const steps = () => within(screen.getByRole('navigation', { name: '세계관 작성 단계' }))
  fireEvent.click(steps().getByRole('button', { name: '관계 연결 (선택)' }))
  await pickEpisode(1)
  fireEvent.click(steps().getByRole('button', { name: '검토·저장' }))
  expect(within(screen.getByRole('region', { name: '세계관 검토' })).getByText(note)).toBeTruthy()
})

it('관계 목록 표는 주체·관계·대상과 편집·삭제를 보이고 삭제는 확인한 뒤에만 편집본에서 지운다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae))
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  const table = within(screen.getByRole('table', { name: '저장할 관계 목록' }))
  expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['주체', '관계', '대상', '편집·삭제'])
  expect([...table.getAllByRole('row')[1].querySelectorAll('td')].slice(0, 3).map((td) => td.textContent)).toEqual(['가람', '친구', '나래'])
  fireEvent.click(table.getByRole('button', { name: '가람 · 친구 · 나래 편집' }))
  expect(screen.getByRole('combobox', { name: '실제 관계 1' })).toBeTruthy() // 편집은 관계 작성 패널을 연다
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(table.getByRole('button', { name: '가람 · 친구 · 나래 삭제' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByRole('table', { name: '저장할 관계 목록' })).toBeTruthy()
  confirm.mockReturnValue(true)
  fireEvent.click(table.getByRole('button', { name: '가람 · 친구 · 나래 삭제' }))
  expect(screen.queryByRole('table', { name: '저장할 관계 목록' })).toBeNull()
  expect(screen.getByText('아직 연결한 관계가 없어요.')).toBeTruthy()
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
})

it('세계관 없는 주소(/worldstudio)는 새 세계관 만들기 화면이고 만들면 그 세계관의 관리 화면으로 간다', async () => {
  const { create } = await show(undefined, '/worldstudio')
  expect(screen.getByText('◌ 처음에는 나만 볼 수 있어요')).toBeTruthy()
  expect(screen.getByRole('link', { name: '내가 만드는 세계관' }).getAttribute('href')).toBe('/lib?tab=worlds')
  const list = within(screen.getByRole('navigation', { name: '내 세계관' }))
  expect(await list.findByRole('button', { name: /검증 세계/ })).toBeTruthy()
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: '세계관 만들기' }).disabled).toBe(false))
  fireEvent.change(screen.getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 세계' } })
  fireEvent.click(screen.getByRole('button', { name: '세계관 만들기' }))
  await waitFor(() => expect(create).toHaveBeenCalledWith('새 세계', '', expect.any(AbortSignal)))
  expect(await screen.findByRole('heading', { name: '검증 세계', level: 1 })).toBeTruthy() // 만든 세계관(대역 응답)의 관리 화면
  expect(screen.getByRole('navigation', { name: '세계관 작성 단계' })).toBeTruthy() // 만든 직후에만 마법사로 열린다
  expect(where()).toBe('/worldstudio/created?new=1')
  expect(document.querySelector('.ep-create')).toBeNull() // 만든 뒤에는 만들기 화면이 사라진다
})

it('새 세계관 만들기의 표지 자리도 테마 그림이 아니라 기본 표지이고 올리지 않으면 기본 표지를 쓴다고 알린다', async () => {
  await show(undefined, '/worldstudio')
  const tile = document.querySelector('.ep-create .cov')
  expect(tile?.querySelector('svg')).toBeNull()
  expect(tile?.querySelector('img')?.getAttribute('src')).toBe('/default-work-cover.svg')
  expect(screen.getByText('표지는 만든 뒤에 올릴 수 있어요. 올리지 않으면 기본 표지를 써요.')).toBeTruthy()
})

// ── 새 세계관 만들기 화면은 세계관 없는 주소(/worldstudio)에만 있다 ─────────────────────────
/** 만들기 화면의 조각: 숨겨서라도 DOM에 남아 있으면 안 된다(RTL의 역할 질의는 숨은 요소를 건너뛰므로 DOM·텍스트로 본다). */
const createScreenParts = () => [document.querySelector('.ep-create'), document.querySelector('.world-library-list'), screen.queryByText(/한 줄의 설정에서 시작해/), screen.queryByText('정하고'), screen.queryByText('세계관 만들기')]

it('세계관 관리 화면(/worldstudio/:id)에는 새 세계관 만들기 화면이 숨겨서라도 들어 있지 않다', async () => {
  await showWorld()
  expect(createScreenParts()).toEqual([null, null, null, null, null])
  expect(screen.queryByRole('button', { name: '내 세계관' })).toBeNull() // 관리 화면을 목록·만들기로 바꿔 끼우는 버튼도 없다
})

it('세계관을 읽지 못해도 관리 주소에서는 오류만 알리고 새 세계관 만들기 화면을 끼워 넣지 않는다', async () => {
  mount(undefined, '/worldstudio/qa', { read: async () => { throw new Error('세계관을 읽지 못했습니다.') } })
  expect((await screen.findByRole('alert')).textContent).toBe('세계관을 읽지 못했습니다.')
  expect(createScreenParts()).toEqual([null, null, null, null, null])
})

// ── 작성 모드(새로 만든 직후 ?new=1의 4단계 마법사) ↔ 관리 모드(그 밖의 모든 진입: 탭 + 저장 영역) ──────────────
const stepNames = () => Array.from(within(screen.getByRole('navigation', { name: '세계관 작성 단계' })).getAllByRole('button'), (b) => b.textContent)
const headerOf = (name = '검증 세계') => within(screen.getByRole('heading', { name, level: 1 }).closest('section')!)
const bumpVersion: WorldStudioRepository['saveStudio'] = async (next) => ({ ...next, version: next.version + 1 })

it('처음 작성하는 세계관(새로 만든 직후)은 탭 줄 없이 기본 정보부터 4단계로 쓰고 공개 설정도 그 단계에 있다', async () => {
  await wizard()
  expect(screen.queryByRole('navigation', { name: '세계관 메뉴' })).toBeNull()
  expect(screen.queryByRole('group', { name: '저장 상태' })).toBeNull()
  expect(stepNames()).toEqual(['1기본 정보', '2설정 카드', '3관계 연결 (선택)', '4검토·저장'])
  expect(screen.getByRole('textbox', { name: '세계관 이름' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: '세계관 설명' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '세계관 정보 편집' })).toBeNull()
  expect(within(screen.getByRole('group', { name: '세계관 기본 정보' })).getByRole('group', { name: '공개 설정' })).toBeTruthy()
  expect(headerOf().queryByRole('group', { name: '공개 설정' })).toBeNull() // 같은 컨트롤을 두 곳에 두지 않는다
})

it('저장한 적 있는 세계관은 탭 줄과 설정집부터 시작하는 관리 화면이고 단계·기본 정보 입력은 없다', async () => {
  await showWorld()
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy() // 탭 구성은 '관리 탭 다섯 개…' 테스트가 본다
  expect(screen.queryByRole('textbox', { name: '세계관 이름' })).toBeNull()
  expect(screen.queryByRole('group', { name: '세계관 기본 정보' })).toBeNull()
  expect(headerOf().queryByRole('group', { name: '공개 설정' })).toBeNull() // 공개 설정은 헤더가 아니라 정보 편집 패널에 있다
  expect(headerOf().getByRole('button', { name: '세계관 정보 편집' })).toBeTruthy()
})

it('관리 모드에는 단계(번호·이전·다음·관계 없이 검토·저장·검토 화면) UI가 없고 설정집·관계도 탭이 그 화면을 맡는다', async () => {
  await showWorld()
  expect(screen.queryByRole('navigation', { name: '세계관 작성 단계' })).toBeNull()
  expect(screen.queryByRole('navigation', { name: '단계 이동' })).toBeNull()
  for (const name of ['이전 단계', '다음 단계', '검토·저장으로', '관계 없이 검토·저장', '검토·저장', '기본 정보']) expect(screen.queryByRole('button', { name }), name).toBeNull()
  expect(screen.queryByRole('region', { name: '세계관 검토' })).toBeNull()
  expect(document.querySelector('.world-step-title, .world-step-nav, .world-step-actions')).toBeNull()
})

it('저장 버전이 0이어도 주소에 ?new=1이 없으면(서재 관리하기·직접 주소) 마법사가 아니라 관리 화면이고 헤더 저장 버튼으로 첫 저장을 한다', async () => {
  const { saveStudio } = await show(undefined, '/worldstudio/qa', { version: 0, saveStudio: bumpVersion })
  expect(screen.queryByRole('navigation', { name: '세계관 작성 단계' })).toBeNull()
  expect(manageTabs().getByRole('button', { name: '설정집' })).toBeTruthy()
  expect(saveBar().getByText('아직 저장하지 않았어요')).toBeTruthy()
  const save = saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' })
  expect(save.disabled).toBe(false) // 바꾼 것이 없어도 첫 저장은 할 수 있다
  fireEvent.click(save)
  fireEvent.click(save) // 같은 저장을 두 번 보내지 않는다
  await waitFor(() => expect(saveBar().getByText('저장됨')).toBeTruthy())
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(headerOf().getByText('저장 버전 1')).toBeTruthy()
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(true)
})

it('처음 저장하면 관리 모드로 바뀌고 초점이 헤더 제목으로 간다', async () => {
  const { saveStudio } = await wizard({ saveStudio: bumpVersion })
  fireEvent.change(screen.getByRole('textbox', { name: '세계관 설명' }), { target: { value: '처음 쓴 소개' } })
  fireEvent.click(screen.getByRole('button', { name: '검토·저장' }))
  fireEvent.click(screen.getByRole('button', { name: '세계관 저장' }))
  await screen.findByRole('navigation', { name: '세계관 메뉴' })
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(screen.queryByRole('navigation', { name: '세계관 작성 단계' })).toBeNull()
  expect(where()).toBe('/worldstudio/qa') // 마법사 표시(?new=1)가 지워진다
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '검증 세계', level: 1 })))
})

it('한 번도 저장하지 않은 새 세계관은 바꾼 것이 없어도 검토·저장에서 바로 첫 저장을 해 관리 모드로 넘어간다', async () => {
  const { saveStudio } = await wizard({ saveStudio: bumpVersion })
  fireEvent.click(screen.getByRole('button', { name: '검토·저장' }))
  const save = screen.getByRole<HTMLButtonElement>('button', { name: '세계관 저장' })
  expect(save.disabled).toBe(false)
  fireEvent.click(save)
  fireEvent.click(save) // 같은 저장을 두 번 보내지 않는다
  await screen.findByRole('navigation', { name: '세계관 메뉴' })
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(headerOf().getByText('저장 버전 1')).toBeTruthy()
})

it('마법사의 관리 화면으로 링크는 저장하지 않고 관리 모드로 나가며 입력은 그대로 남는다', async () => {
  const { saveStudio } = await wizard()
  fireEvent.change(screen.getByRole('textbox', { name: '세계관 설명' }), { target: { value: '쓰던 소개' } })
  fireEvent.click(screen.getByRole('button', { name: '관리 화면으로' }))
  expect(await screen.findByRole('navigation', { name: '세계관 메뉴' })).toBeTruthy()
  expect(screen.queryByRole('navigation', { name: '세계관 작성 단계' })).toBeNull()
  expect(screen.queryByRole('button', { name: '관리 화면으로' })).toBeNull()
  expect(where()).toBe('/worldstudio/qa')
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy() // 쓰던 입력은 남아 헤더 저장 버튼으로 저장할 수 있다
  expect(saveStudio).not.toHaveBeenCalled()
})

// ── 관리 모드: 주소(?tab=)로 유지되는 탭과 상시 저장 영역 ───────────────────────────────────
it('보기를 옮기면 주소 ?view=가 바뀌고 그 주소로 다시 열면(새로고침) 같은 보기가 복원된다', async () => {
  await showWorld()
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(where()).toBe('/worldstudio/qa?view=people')
  expect(manageTabs().getByRole('button', { name: '관계도' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByText('아직 연결한 관계가 없어요.')).toBeTruthy()
  fireEvent.click(manageTabs().getByRole('button', { name: '시간선' }))
  expect(where()).toBe('/worldstudio/qa?view=timeline')
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(where()).toBe('/worldstudio/qa') // 설정집은 기본이라 주소에 남기지 않는다
  cleanup()
  await show(undefined, '/worldstudio/qa?view=timeline')
  expect(manageTabs().getByRole('button', { name: '시간선' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByText(/아직 확정한 과거 사건이 없어요/)).toBeTruthy()
  cleanup()
  await show(undefined, '/worldstudio/qa?view=people') // 관계 편집기도 주소만으로 열린다
  expect(manageTabs().getByRole('button', { name: '관계도' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByText('아직 연결한 관계가 없어요.')).toBeTruthy()
  cleanup()
  await show(undefined, '/worldstudio/qa?view=nope') // 모르는 값은 설정집이다
  expect(manageTabs().getByRole('button', { name: '설정집' }).getAttribute('aria-current')).toBe('page')
})

it('탭을 옮겨도 저장하지 않은 입력은 그대로이고 저장 상태도 바뀌지 않는다', async () => {
  await showWorld()
  openCard('가람 인물')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '고친 이름' } })
  backToBoard()
  for (const tab of ['관계도', '시간선', '설정집']) {
    fireEvent.click(manageTabs().getByRole('button', { name: tab }))
    expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  }
  openCard('고친 이름 인물')
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('고친 이름')
})

it('상시 저장 영역은 바뀐 것이 없으면 저장됨과 잠긴 저장 버튼, 바뀌면 저장하지 않은 변경 있음과 열린 저장 버튼이고 저장하면 저장됨으로 돌아간다', async () => {
  const { saveStudio } = await showWorld()
  const button = () => saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' })
  expect(saveBar().getByText('저장됨')).toBeTruthy()
  expect(button().disabled).toBe(true)
  dirtyCard()
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  expect(button().disabled).toBe(false)
  fireEvent.click(button())
  await waitFor(() => expect(saveBar().getByText('저장됨')).toBeTruthy())
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(saveStudio).toHaveBeenCalledWith(expect.objectContaining({ id: 'qa', settings: [expect.objectContaining({ item: expect.objectContaining({ title: '고친 이름' }) })] }), expect.any(AbortSignal), undefined)
  expect(button().disabled).toBe(true)
})

it('저장 전에 확인할 문제가 있으면 저장 버튼 옆에 첫 사유와 건수를 알리고 저장을 막는다', async () => {
  await show([person('가람', '내용'), person('나래', '내용')])
  const button = () => saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' })
  const reason = () => document.getElementById(button().getAttribute('aria-describedby') ?? '')?.textContent // 저장 버튼의 설명으로 이어진 사유
  openCard('가람 인물')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '' } })
  expect(reason()).toBe('이름 없는 설정: 카드 이름을 입력해 주세요.') // 어느 설정의 문제인지 이름을 붙인다(지금은 이름이 비어 있다)
  expect(saveBar().getByText('이름 없는 설정: 카드 이름을 입력해 주세요.')).toBeTruthy()
  expect(button().disabled).toBe(true)
  backToBoard()
  openCard('나래 인물')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '' } })
  expect(reason()).toBe('이름 없는 설정: 카드 이름을 입력해 주세요. 외 1건')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '나래' } })
  backToBoard()
  openCard('이름 없는 설정 인물')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '가람' } })
  expect(saveBar().queryByText(/카드 이름을 입력해 주세요/)).toBeNull() // 문제가 모두 풀리면 사유가 사라지고 저장할 수 있다
  expect(button().disabled).toBe(false)
})

it('저장이 실패하면 오류와 입력을 그대로 두고 저장 영역이 실패를 알리며 다시 저장할 수 있다', async () => {
  const saveStudio = vi.fn<WorldStudioRepository['saveStudio']>().mockRejectedValueOnce(new Error('저장 충돌')).mockImplementation(async (next) => next)
  await show(undefined, '/worldstudio/qa', { saveStudio })
  dirtyCard()
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  expect((await screen.findByRole('alert')).textContent).toBe('저장 충돌')
  expect(saveBar().getByText('저장 실패 · 입력은 유지돼요')).toBeTruthy()
  openCard('고친 이름 인물')
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('고친 이름')
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(false)
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveBar().getByText('저장됨')).toBeTruthy())
  expect(saveStudio).toHaveBeenCalledTimes(2)
})

it('설정집은 설정이 하나도 없으면 표 안의 빈 행 하나로만 안내하고 오른쪽에 안내 패널을 끼우지 않는다', async () => {
  await show([])
  expect(document.querySelector('.world-empty')).toBeNull()
  expect(screen.queryByText('어떤 설정부터 시작할까요?')).toBeNull()
  expect(within(screen.getByRole('table', { name: '설정 카드 목록' })).getByText('설정을 추가해 시작해 보세요.')).toBeTruthy()
  addSetting('인물')
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull() // 새 설정을 더하면 게시판 대신 그 카드의 편집 화면이 열린다
  expect(screen.getByRole('textbox', { name: '설정 이름' })).toBeTruthy()
})

// ── 관리 모드 헤더의 정보 편집 패널(이름·설명·공개 범위·장르) ──────────────────────────────────────────────
const openInfoEdit = () => fireEvent.click(screen.getByRole('button', { name: '세계관 정보 편집' }))
const infoForm = () => within(screen.getByRole('form', { name: '세계관 정보 편집' }))
const publishGroup = () => within(infoForm().getByRole('group', { name: '공개 설정' }))
const savePanel = () => fireEvent.click(infoForm().getByRole('button', { name: '저장' }))
const panelClosed = () => waitFor(() => expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull())

it('편집을 누르면 헤더에서 이름·설명을 바로 고치고 저장하면 기존 초안 저장으로 보낸 뒤 편집 버튼으로 초점을 돌린다', async () => {
  const { saveStudio, setPublication, setCover, removeCover } = await showWorld()
  openInfoEdit()
  const name = infoForm().getByRole<HTMLInputElement>('textbox', { name: '세계관 이름' })
  expect(name.value).toBe('검증 세계')
  expect(document.activeElement).toBe(name)
  expect(infoForm().getByRole<HTMLTextAreaElement>('textbox', { name: '세계관 설명' }).value).toBe('설명')
  fireEvent.change(name, { target: { value: '새 이름' } })
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 설명' }), { target: { value: '새 소개' } })
  fireEvent.click(infoForm().getByRole('button', { name: '저장' }))
  expect(await screen.findByRole('heading', { name: '새 이름', level: 1 })).toBeTruthy()
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(saveStudio).toHaveBeenCalledWith(expect.objectContaining({ id: 'qa', name: '새 이름', description: '새 소개', version: 1 }), expect.any(AbortSignal), undefined)
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull()
  expect([setPublication, setCover, removeCover].map((fn) => fn.mock.calls.length)).toEqual([0, 0, 0]) // 바뀐 것만 보낸다
  expect(headerOf('새 이름').getByText('새 소개')).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '세계관 정보 편집' })))
})

it('Esc와 취소는 입력을 버리고 편집을 닫으며 저장 요청을 보내지 않는다', async () => {
  const { saveStudio } = await showWorld()
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '버릴 이름' } })
  fireEvent.keyDown(infoForm().getByRole('textbox', { name: '세계관 이름' }), { key: 'Escape' })
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull()
  expect(screen.getByRole('heading', { name: '검증 세계', level: 1 })).toBeTruthy()
  openInfoEdit()
  expect(infoForm().getByRole<HTMLInputElement>('textbox', { name: '세계관 이름' }).value).toBe('검증 세계') // 다시 열면 저장한 값에서 시작한다
  fireEvent.click(infoForm().getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull()
  expect(saveStudio).not.toHaveBeenCalled()
})

it('이름·설명 저장이 실패하면 오류 문구를 보이고 편집 창과 입력을 그대로 두며 다시 저장할 수 있다', async () => {
  const saveStudio = vi.fn<WorldStudioRepository['saveStudio']>().mockRejectedValueOnce(new Error('저장 충돌')).mockImplementation(async (next) => next)
  await show(undefined, '/worldstudio/qa', { saveStudio })
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '고친 이름' } })
  fireEvent.click(infoForm().getByRole('button', { name: '저장' }))
  expect((await screen.findByRole('alert')).textContent).toBe('저장 충돌')
  expect(infoForm().getByRole<HTMLInputElement>('textbox', { name: '세계관 이름' }).value).toBe('고친 이름')
  expect(infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(false)
  expect(saveBar().getByText('저장 실패 · 입력은 유지돼요')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '검증 세계', level: 1 })).toBeTruthy() // 저장한 이름은 그대로
  fireEvent.click(infoForm().getByRole('button', { name: '저장' }))
  expect(await screen.findByRole('heading', { name: '고친 이름', level: 1 })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(saveStudio).toHaveBeenCalledTimes(2)
})

it('이름·설명을 저장하는 동안에는 입력과 버튼을 잠가 같은 저장을 두 번 보내지 않는다', async () => {
  let finish!: (world: StudioWorld) => void
  const saveStudio = vi.fn((_next: StudioWorld) => new Promise<StudioWorld>((resolve) => { finish = resolve }))
  await show(undefined, '/worldstudio/qa', { saveStudio })
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '고친 이름' } })
  fireEvent.click(infoForm().getByRole('button', { name: '저장' }))
  await waitFor(() => expect(infoForm().getByRole('button', { name: '저장 중…' })).toBeTruthy())
  expect(infoForm().getByRole('textbox', { name: '세계관 이름' }).closest('fieldset')!.disabled).toBe(true) // 입력·버튼은 fieldset 째로 잠긴다
  expect(infoForm().getByRole('button', { name: '취소' }).closest('fieldset')!.disabled).toBe(true)
  fireEvent.submit(screen.getByRole('form', { name: '세계관 정보 편집' })) // Enter로 보내는 제출도 한 번만
  expect(saveStudio).toHaveBeenCalledOnce()
  await act(async () => finish(saveStudio.mock.calls[0][0]))
  expect(await screen.findByRole('heading', { name: '고친 이름', level: 1 })).toBeTruthy()
})

it('이름을 비우면 저장 버튼이 잠기고, 바뀐 것이 없어도 잠긴다', async () => {
  await showWorld()
  openInfoEdit()
  const save = () => infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' })
  expect(save().disabled).toBe(true)
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '   ' } })
  expect(save().disabled).toBe(true)
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '다른 이름' } })
  expect(save().disabled).toBe(false)
})

it('검토·저장 단계의 기본 정보 수정은 마법사의 기본 정보 단계로 되돌린다', async () => {
  await wizard()
  fireEvent.click(screen.getByRole('button', { name: '검토·저장' }))
  expect(screen.queryByRole('textbox', { name: '세계관 이름' })).toBeNull() // 기본 정보 단계가 아니면 숨는다
  fireEvent.click(screen.getByRole('button', { name: '기본 정보 수정' }))
  expect(screen.getByRole('textbox', { name: '세계관 이름' })).toBeTruthy()
})

// ── 편집 패널의 잠금: 저장하지 않은 입력이 이름·설명 저장에 딸려 가면 안 된다 ──────────────────
const editButton = () => screen.getByRole<HTMLButtonElement>('button', { name: '세계관 정보 편집' })
const dirtyCard = () => {
  openCard('가람 인물')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '고친 이름' } })
  backToBoard() // 헤더·저장 영역은 설정집 화면에 있다
}

it('저장하지 않은 카드 수정이 있으면 헤더 편집이 잠기고 먼저 저장하라고 안내한다', async () => {
  await showWorld()
  expect(editButton().disabled).toBe(false)
  expect(screen.queryByText(/작성 중인 변경을 먼저 저장하세요/)).toBeNull()
  dirtyCard()
  expect(editButton().disabled).toBe(true)
  const hint = screen.getByText(/작성 중인 변경을 먼저 저장하세요/)
  expect(editButton().getAttribute('aria-describedby')).toBe(hint.id)
  fireEvent.click(editButton()) // 눌러도 열리지 않는다
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull()
})

it('먼저 저장하면 편집이 다시 열리고 이름·설명 저장은 방금 저장한 카드 수정을 그대로 보내 잃지 않는다', async () => {
  const { saveStudio } = await showWorld()
  dirtyCard()
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  await waitFor(() => expect(editButton().disabled).toBe(false))
  expect(screen.queryByText(/작성 중인 변경을 먼저 저장하세요/)).toBeNull()
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  savePanel()
  expect(await screen.findByRole('heading', { name: '새 이름', level: 1 })).toBeTruthy()
  expect(saveStudio).toHaveBeenCalledTimes(2)
  const [second] = saveStudio.mock.calls[1]
  expect([second.name, second.settings[0].item.title]).toEqual(['새 이름', '고친 이름']) // 첫 저장에 올라간 카드 수정이 그대로
})

it('편집을 연 채 카드를 고치면 열린 패널의 저장도 잠겨 카드 수정이 이름·설명 저장에 딸려 가지 않는다', async () => {
  const { saveStudio } = await showWorld()
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  expect(infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(false)
  dirtyCard()
  expect(infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(true)
  expect(infoForm().getByText(/작성 중인 변경을 먼저 저장하세요/)).toBeTruthy()
  fireEvent.submit(screen.getByRole('form', { name: '세계관 정보 편집' })) // Enter 제출도 막힌다
  expect(saveStudio).not.toHaveBeenCalled()
})

// ── 공개 범위·장르(편집 패널에서 저장과 함께 적용) ──────────────────────────────────────
it('관리 헤더에는 공개 설정 폼 없이 공개 범위·장르 칩만 있고, 편집을 열면 한 패널에서 이름·설명·공개 범위·장르를 저장·취소한다', async () => {
  await show(undefined, '/worldstudio/qa', { visibility: 'public', genre: 'fantasy', currentRevisionId: 'rev-1' })
  expect(headerOf().queryByRole('group', { name: '공개 설정' })).toBeNull()
  expect(headerOf().getByText('공개', { selector: '.chip' })).toBeTruthy()
  expect(headerOf().getByText('판타지', { selector: '.chip' })).toBeTruthy()
  openInfoEdit()
  expect(infoForm().getByRole('textbox', { name: '세계관 이름' })).toBeTruthy()
  expect(infoForm().getByRole('textbox', { name: '세계관 설명' })).toBeTruthy()
  expect(within(publishGroup().getByRole('group', { name: '공개 범위' })).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['비공개', 'false'], ['공개', 'true']])
  expect(publishGroup().getByRole<HTMLSelectElement>('combobox', { name: '장르' }).value).toBe('fantasy')
  expect(infoForm().getByRole('button', { name: '저장' })).toBeTruthy()
  expect(infoForm().getByRole('button', { name: '취소' })).toBeTruthy()
})

it('관리 헤더의 공개 설정은 서버 연결 예정 대신 실제 공개 범위 토글과 장르 선택이다', async () => {
  await showWorld()
  openInfoEdit()
  const range = within(publishGroup().getByRole('group', { name: '공개 범위' }))
  expect(range.getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['비공개', 'true'], ['공개', 'false']])
  const genre = publishGroup().getByRole<HTMLSelectElement>('combobox', { name: '장르' })
  expect(Array.from(genre.options, (o) => [o.value, o.textContent])).toEqual([['', '미지정'], ['fantasy', '판타지'], ['sf', 'SF'], ['wuxia', '무협'], ['romance', '로맨스'], ['modern', '현대'], ['classic', '고전'], ['mystery', '미스터리']])
  expect(genre.value).toBe('')
  expect(screen.queryByText(/서버 연결 예정/)).toBeNull()
  expect(screen.queryByRole('link', { name: '공개 화면 보기' })).toBeNull() // 비공개에는 공개 화면이 없다
})

it('공개로 바꾸면 한 번 확인한 뒤 공개 설정을 보내고 칩·공개 화면 링크를 바꾼다', async () => {
  const { setPublication } = await show(undefined, '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  expect(confirm).not.toHaveBeenCalled() // 고르는 것만으로는 묻지도 보내지도 않는다
  expect(setPublication).not.toHaveBeenCalled()
  savePanel()
  expect(await screen.findByText('공개했어요. 누구나 공개로 둔 설정 카드와 그 사이의 인물 관계를 볼 수 있어요.')).toBeTruthy()
  expect(confirm).toHaveBeenCalledOnce()
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('공개하면 누구나 공개로 둔 설정 카드와 그 사이의 인물 관계를 볼 수 있고'))
  expect(setPublication).toHaveBeenCalledWith('qa', { visibility: 'public', genre: null }, expect.any(AbortSignal))
  expect(headerOf().getByText('공개', { selector: '.chip' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '공개 화면 보기' }).getAttribute('href')).toBe('/worlds/qa')
  await panelClosed() // 저장되면 패널이 닫힌다
})

it('공개 확인을 거절하면 아무것도 보내지 않고 비공개 그대로다', async () => {
  const { setPublication } = await showWorld()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  savePanel()
  expect(confirm).toHaveBeenCalledOnce()
  expect(setPublication).not.toHaveBeenCalled()
  expect(headerOf().getByText('비공개', { selector: '.chip' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: '공개 화면 보기' })).toBeNull()
  expect(screen.getByRole('form', { name: '세계관 정보 편집' })).toBeTruthy() // 패널은 열린 채라 다시 고를 수 있다
})

it('이미 고른 공개 범위를 다시 누르면 아무것도 보내지 않는다', async () => {
  const { setPublication } = await showWorld()
  const confirm = vi.spyOn(window, 'confirm')
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '비공개', pressed: true }))
  expect(infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(true) // 바뀐 것이 없다
  expect(setPublication).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
})

it('공개 설정 전송이 실패하면 오류 문구를 보이고 이전 값을 그대로 두며 다시 보낼 수 있다', async () => {
  const setPublication = vi.fn<WorldStudioRepository['setPublication']>().mockRejectedValueOnce(new Error('세계관을 찾을 수 없습니다.')).mockImplementation(async (id, change) => published(id, change))
  await show(undefined, '/worldstudio/qa', { setPublication, currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  savePanel()
  expect((await screen.findByRole('alert')).textContent).toBe('세계관을 찾을 수 없습니다.')
  expect(headerOf().getByText('비공개', { selector: '.chip' })).toBeTruthy() // 서버 값은 이전 그대로
  expect(screen.queryByRole('link', { name: '공개 화면 보기' })).toBeNull()
  expect(publishGroup().getByRole('button', { name: '공개', pressed: true })).toBeTruthy() // 고른 값은 패널에 남아 다시 보낼 수 있다
  expect(infoForm().getByRole('textbox', { name: '세계관 이름' }).closest('fieldset')!.disabled).toBe(false)
  savePanel()
  expect(await screen.findByRole('link', { name: '공개 화면 보기' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('공개로 설정했지만 목록에 나오지 않으면(저장 버전 없음) 저장 뒤 확정 버전을 남기라고 안내하고 설정은 반영한다', async () => {
  await show(undefined, '/worldstudio/qa', { setPublication: async (id, change) => published(id, change, false) })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  savePanel()
  expect(await screen.findByText('공개로 설정했어요.')).toBeTruthy()
  const hint = headerOf().getByText(/확정 버전이 없어 공개 목록에는 나오지 않아요/)
  expect(hint.textContent).toContain('확정 버전')
  expect(hint.textContent).toContain('나타나요')
  expect(headerOf().getByText('공개', { selector: '.chip' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: '공개 화면 보기' })).toBeNull()
})

it('이미 공개인 세계관의 장르를 바꾸면 확인 없이 현재 공개 범위와 새 장르를 보내고 칩을 바꾼다', async () => {
  const { setPublication } = await show(undefined, '/worldstudio/qa', { visibility: 'public', genre: 'fantasy', currentRevisionId: 'rev-1' })
  const confirm = vi.spyOn(window, 'confirm')
  const select = () => publishGroup().getByRole<HTMLSelectElement>('combobox', { name: '장르' })
  openInfoEdit()
  expect(select().value).toBe('fantasy')
  expect(headerOf().getByText('판타지', { selector: '.chip' })).toBeTruthy()
  fireEvent.change(select(), { target: { value: 'sf' } })
  savePanel()
  expect(await headerOf().findByText('SF', { selector: '.chip' })).toBeTruthy()
  expect(setPublication).toHaveBeenLastCalledWith('qa', { visibility: 'public', genre: 'sf' }, expect.any(AbortSignal))
  await panelClosed()
  openInfoEdit()
  fireEvent.change(select(), { target: { value: '' } })
  savePanel()
  await waitFor(() => expect(setPublication).toHaveBeenLastCalledWith('qa', { visibility: 'public', genre: null }, expect.any(AbortSignal)))
  await waitFor(() => expect(headerOf().queryByText('SF', { selector: '.chip' })).toBeNull())
  expect(confirm).not.toHaveBeenCalled()
})

it('비공개로 되돌릴 때는 확인 없이 보내고 공개 화면 링크를 거둔다', async () => {
  const { setPublication } = await show(undefined, '/worldstudio/qa', { visibility: 'public', genre: null, currentRevisionId: 'rev-1' })
  const confirm = vi.spyOn(window, 'confirm')
  expect(screen.getByRole('link', { name: '공개 화면 보기' })).toBeTruthy()
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '비공개', pressed: false }))
  savePanel()
  expect(await screen.findByText('비공개로 바꿨어요. 이제 나만 볼 수 있어요.')).toBeTruthy()
  expect(setPublication).toHaveBeenCalledWith('qa', { visibility: 'private', genre: null }, expect.any(AbortSignal))
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.queryByRole('link', { name: '공개 화면 보기' })).toBeNull()
})

it('공개 설정을 보내는 동안에는 잠가 같은 변경을 다시 보내거나 다시 묻지 않는다', async () => {
  let finish!: (result: WorldPublication) => void
  const setPublication = vi.fn((_id: string, _change: WorldPublicationInput) => new Promise<WorldPublication>((resolve) => { finish = resolve }))
  await show(undefined, '/worldstudio/qa', { setPublication, currentRevisionId: 'rev-1' })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  savePanel()
  const lock = () => infoForm().getByRole('textbox', { name: '세계관 이름' }).closest('fieldset')!
  await waitFor(() => expect(lock().disabled).toBe(true))
  expect(headerOf().getByText('비공개', { selector: '.chip' })).toBeTruthy() // 칩은 서버가 답한 뒤에 바뀐다
  fireEvent.submit(screen.getByRole('form', { name: '세계관 정보 편집' })) // Enter로 보내는 제출도 한 번만
  expect(confirm).toHaveBeenCalledOnce()
  expect(setPublication).toHaveBeenCalledOnce()
  await act(async () => finish(published('qa', { visibility: 'public', genre: null })))
  await waitFor(() => expect(headerOf().getByText('공개', { selector: '.chip' })).toBeTruthy())
  await panelClosed()
})

it('공개 설정은 저장하지 않은 입력을 건드리지 않는다', async () => {
  const { setPublication } = await show(undefined, '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  dirtyCard()
  // 저장하지 않은 입력이 있는 동안에는 편집 패널이 잠겨 공개 설정을 보내지도, 그 입력을 저장에 딸려 보내지도 않는다.
  fireEvent.click(editButton())
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull()
  expect(setPublication).not.toHaveBeenCalled()
  openCard('고친 이름 인물')
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('고친 이름')
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
})

it('패널의 저장은 이름·설명은 초안 저장으로, 공개 범위·장르는 공개 설정으로 각각 한 번씩 보내고 둘 다 되면 닫힌다', async () => {
  const { saveStudio, setPublication } = await show(undefined, '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  fireEvent.change(publishGroup().getByRole('combobox', { name: '장르' }), { target: { value: 'sf' } })
  savePanel()
  expect(await screen.findByRole('heading', { name: '새 이름', level: 1 })).toBeTruthy()
  await waitFor(() => expect(setPublication).toHaveBeenCalledOnce())
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(saveStudio).toHaveBeenCalledWith(expect.objectContaining({ id: 'qa', name: '새 이름' }), expect.any(AbortSignal), undefined)
  expect(setPublication).toHaveBeenCalledWith('qa', { visibility: 'public', genre: 'sf' }, expect.any(AbortSignal))
  await panelClosed()
  expect(headerOf('새 이름').getByText('SF', { selector: '.chip' })).toBeTruthy()
})

it('이름·설명은 저장됐지만 공개 설정이 실패하면 패널을 닫지 않고 오류를 알리며, 다시 저장하면 공개 설정만 다시 보낸다', async () => {
  const setPublication = vi.fn<WorldStudioRepository['setPublication']>().mockRejectedValueOnce(new Error('세계관을 찾을 수 없습니다.')).mockImplementation(async (id, change) => published(id, change))
  const { saveStudio } = await show(undefined, '/worldstudio/qa', { setPublication })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  savePanel()
  expect((await screen.findByRole('alert')).textContent).toBe('세계관을 찾을 수 없습니다.')
  expect(screen.getByRole('form', { name: '세계관 정보 편집' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '새 이름', level: 1 })).toBeTruthy() // 이름·설명은 이미 저장됐다
  expect(saveStudio).toHaveBeenCalledOnce()
  savePanel() // 이제 바뀐 것은 공개 설정뿐이다
  await waitFor(() => expect(setPublication).toHaveBeenCalledTimes(2))
  expect(saveStudio).toHaveBeenCalledOnce()
  await panelClosed()
})

it('취소는 고른 공개 범위·장르도 버리고 아무것도 보내지 않는다', async () => {
  const { saveStudio, setPublication } = await showWorld()
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  fireEvent.change(publishGroup().getByRole('combobox', { name: '장르' }), { target: { value: 'sf' } })
  fireEvent.click(infoForm().getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull()
  expect([saveStudio, setPublication].map((fn) => fn.mock.calls.length)).toEqual([0, 0])
  openInfoEdit() // 다시 열면 저장한 값에서 시작한다
  expect(publishGroup().getByRole('button', { name: '비공개', pressed: true })).toBeTruthy()
  expect(publishGroup().getByRole<HTMLSelectElement>('combobox', { name: '장르' }).value).toBe('')
})

it('작성 모드의 공개 설정은 기본 정보 단계에서 같은 확인·전송을 한다', async () => {
  const { setPublication } = await wizard()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const info = within(screen.getByRole('group', { name: '세계관 기본 정보' }))
  fireEvent.click(info.getByRole('button', { name: '공개', pressed: false }))
  expect(confirm).toHaveBeenCalledOnce()
  await waitFor(() => expect(setPublication).toHaveBeenCalledWith('qa', { visibility: 'public', genre: null }, expect.any(AbortSignal)))
  expect(await headerOf().findByText('공개', { selector: '.chip' })).toBeTruthy()
})

it('데모(목업)에서는 공개 화면 링크를 숨기고 공개 목록에는 나오지 않는다고 알린다', async () => {
  vi.stubEnv('MODE', 'mockup')
  await show(undefined, '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  savePanel()
  const notice = await screen.findByText(/^공개로 설정했어요 \(데모\)/)
  expect(notice.textContent).toContain('공개 목록에는 나타나지 않고')
  expect(headerOf().getByText('공개', { selector: '.chip' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: '공개 화면 보기' })).toBeNull()
  expect(screen.queryByText(/확정 버전이 없어/)).toBeNull() // 데모에는 공개 목록이 없어 확정 버전 안내도 하지 않는다
})

// ── AI 채팅 패널(집필실과 같은 공용 집필 AI 채팅, 연결 소설이 없거나 데모면 잠긴다) ─────────────────────────
const chatPanel = () => screen.getByRole('complementary', { name: 'AI 채팅' })
const noChat = () => screen.queryByRole('complementary', { name: 'AI 채팅' })

it('설정 카드 단계에도 집필실과 같은 AI 채팅 패널이 있고 보낼 수 없으면 입력·전송·추천 문구를 사유와 함께 잠그며 가짜 응답이 없다', async () => {
  await showWorld()
  const chat = within(chatPanel())
  expect(chat.getByRole('heading', { level: 2, name: 'AI 채팅' })).toBeTruthy()
  const box = chat.getByRole('textbox', { name: '메시지' })
  expect(box).toHaveProperty('disabled', true)
  expect(chat.getByRole('button', { name: '전송' })).toHaveProperty('disabled', true)
  expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/데모에서는|소설을 연결하면|발행하면|동의에 체크/)
  const log = chat.getByRole('log')
  for (const name of ['인물 카드 아이디어', '이 설정의 모순 찾기', '관계 제안']) expect(within(log).getByRole('button', { name })).toHaveProperty('disabled', true)
  expect(log.querySelectorAll('.chat-msg')).toHaveLength(0)
})

it('AI 채팅은 접었다 다시 열 수 있고 접어도 세계관 화면은 그대로이며 사라진 버튼 대신 새로 보이는 버튼으로 초점을 옮긴다', async () => {
  await showWorld()
  expect(chatPanel().contains(document.activeElement)).toBe(false) // 처음 렌더링에서는 초점을 채팅으로 옮기지 않는다(단계 제목이 맡는다)
  fireEvent.click(within(chatPanel()).getByRole('button', { name: '접기' }))
  expect(noChat()).toBeNull()
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
  const open = screen.getByRole('button', { name: 'AI 채팅 열기' })
  expect(document.activeElement).toBe(open)
  fireEvent.click(open)
  expect(screen.queryByRole('button', { name: 'AI 채팅 열기' })).toBeNull()
  expect(document.activeElement).toBe(within(chatPanel()).getByRole('button', { name: '접기' }))
})

it('접어 둔 AI 채팅은 탭을 옮겼다 돌아와도 접힌 채이고 어느 탭에서나 열기 버튼이 있다', async () => {
  await showWorld()
  fireEvent.click(within(chatPanel()).getByRole('button', { name: '접기' }))
  for (const tab of ['관계도', '시간선', '설정집']) {
    fireEvent.click(manageTabs().getByRole('button', { name: tab }))
    expect(noChat(), tab).toBeNull()
    expect(screen.getByRole('button', { name: 'AI 채팅 열기' }), tab).toBeTruthy()
  }
})

it('관리 모드는 모든 탭에서 AI 채팅을 오른쪽에 보인다', async () => {
  await showWorld()
  for (const tab of ['설정집', '관계도', '시간선']) {
    fireEvent.click(manageTabs().getByRole('button', { name: tab }))
    expect(chatPanel(), tab).toBeTruthy()
  }
})

it('처음 작성하는 세계관도 모든 단계에서 AI 채팅을 보인다', async () => {
  await wizard()
  for (const step of ['기본 정보', '설정 카드', '관계 연결 (선택)', '검토·저장']) {
    fireEvent.click(within(screen.getByRole('navigation', { name: '세계관 작성 단계' })).getByRole('button', { name: step }))
    expect(chatPanel(), step).toBeTruthy()
  }
})

it('AI 채팅은 본문(main) 밖 오른쪽 열이라 헤더·탭 줄·저장 영역은 본문 안에 있고 접으면 2열 배치가 풀린다', async () => {
  await showWorld()
  const main = screen.getByRole('main')
  const page = main.parentElement!
  expect(main.contains(chatPanel())).toBe(false) // 채팅이 본문 흐름 중간에 끼지 않는다
  expect(chatPanel().parentElement).toBe(page) // 본문과 채팅은 같은 2열 그리드의 두 열이다
  expect(page.classList.contains('with-chat')).toBe(true)
  expect(main.contains(screen.getByRole('heading', { name: '검증 세계', level: 1 }))).toBe(true)
  expect(main.contains(screen.getByRole('navigation', { name: '세계관 메뉴' }))).toBe(true)
  expect(main.contains(screen.getByRole('group', { name: '저장 상태' }))).toBe(true)
  fireEvent.click(within(chatPanel()).getByRole('button', { name: '접기' }))
  expect(page.classList.contains('with-chat')).toBe(false)
})

/** 뷰포트 폭을 흉내 낸다: `(max-width: Npx)` 질의에는 폭이 N 이하일 때만 맞는다고 답한다(그 밖의 질의는 맞지 않는다). */
const viewport = (width: number) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: width <= Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? -1), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }))
const chatDrawer = () => screen.queryByRole('dialog', { name: 'AI 채팅' })

it('좁은 화면(900px 이하)에서는 AI 채팅이 기본으로 닫혀 있고 열기 버튼으로 서랍처럼 연다', async () => {
  viewport(900)
  await showWorld()
  expect(noChat()).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'AI 채팅 열기' }))
  expect(chatDrawer()).toBeTruthy() // 화면을 덮는 서랍이라 오른쪽 열(complementary)이 아니라 대화 상자로 연다
  expect(noChat()).toBeNull()
})

it('AI 채팅 전송이 잠겨 있는 동안에는 본문을 좁히지 않게 1200px 이하에서도 닫힌 채로 시작하고, 그보다 넓으면 연 채로 시작한다', async () => {
  viewport(1200)
  await showWorld()
  expect(noChat()).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'AI 채팅 열기' }))
  expect(chatPanel()).toBeTruthy() // 900px보다 넓으면 서랍이 아니라 오른쪽 열이다
  expect(chatDrawer()).toBeNull()
  cleanup()
  viewport(1201)
  await showWorld()
  expect(chatPanel()).toBeTruthy()
})

it('좁은 화면의 채팅 서랍은 뒤 화면을 막는 대화 상자라 Esc로 닫히고, 닫으면 열기 버튼으로 초점이 돌아온다', async () => {
  viewport(600)
  await showWorld()
  fireEvent.click(screen.getByRole('button', { name: 'AI 채팅 열기' }))
  const drawer = chatDrawer()!
  expect(drawer.getAttribute('aria-modal')).toBe('true')
  expect(within(drawer).getByRole('heading', { level: 2, name: 'AI 채팅' })).toBeTruthy()
  expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: '접기' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(chatDrawer()).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'AI 채팅 열기' })))
  openCard('가람 인물') // 편집 화면의 채팅은 좁은 화면에서 편집기 아래에 놓이는 영역이라 대화 상자가 아니다
  fireEvent.click(screen.getByRole('button', { name: 'AI 채팅 열기' }))
  expect(chatPanel()).toBeTruthy()
  expect(chatDrawer()).toBeNull()
})

// ── 세계관 표지(올리기·교체·삭제는 정보 편집 패널, 읽기는 인증 요청 → 객체 주소) ───────────────────────
const png = (name = 'cover.png', type = 'image/png', size = 4) => new File([new Uint8Array(size)], name, { type })
const coverGroup = () => within(infoForm().getByRole('group', { name: '표지' }))
const pickCover = (file: File) => fireEvent.change(coverGroup().getByLabelText('이미지 선택'), { target: { files: [file] } })
const headerCover = () => headerOf().queryByRole('img', { name: '세계관 표지' })
const defaultCover = () => headerOf().queryByRole('img', { name: '기본 세계관 표지' })

it('올린 표지가 있는 세계관은 헤더 표지가 인증 읽기로 받은 이미지이고, 화면을 떠나면 객체 주소를 해제한다', async () => {
  const { readCover } = await show(undefined, '/worldstudio/qa', { hasCover: true })
  await waitFor(() => expect(headerCover()?.getAttribute('src')).toBe('blob:cover-1'))
  expect(readCover).toHaveBeenCalledOnce()
  expect(readCover).toHaveBeenCalledWith('qa', expect.any(AbortSignal))
  expect(document.querySelector('.world-manage-hero .cov svg')).toBeNull()
  cleanup()
  expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1')
})

it('올린 표지가 없으면 읽지 않고 기본 표지를 보인다', async () => {
  const { readCover } = await showWorld()
  expect(readCover).not.toHaveBeenCalled()
  expect(headerCover()).toBeNull()
  expect(defaultCover()?.getAttribute('src')).toBe('/default-work-cover.svg')
  expect(document.querySelector('.world-manage-hero .cov svg')).toBeNull() // 테마·장르 그림을 표지 대신 쓰지 않는다
})

it('표지를 읽지 못하면 기본 표지를 두고 패널에서 이유를 알린다', async () => {
  const readCover = vi.fn(async () => { throw new Error('표지를 불러오지 못했어요.') })
  await show(undefined, '/worldstudio/qa', { hasCover: true, readCover })
  await waitFor(() => expect(readCover).toHaveBeenCalled())
  expect(headerCover()).toBeNull()
  expect(defaultCover()?.getAttribute('src')).toBe('/default-work-cover.svg')
  expect(document.querySelector('.world-manage-hero .cov svg')).toBeNull()
  openInfoEdit()
  expect(await coverGroup().findByText('표지를 불러오지 못했어요.')).toBeTruthy()
})

it('표지 칸은 이미지 선택과 AI로 생성(준비 중, 잠김)을 두고 5 MiB 형식 안내를 보이며 삭제는 표지가 있을 때만 보인다', async () => {
  await showWorld()
  openInfoEdit()
  expect(coverGroup().getByText(/PNG·JPEG·WebP, 5 MiB 이하/)).toBeTruthy()
  const input = coverGroup().getByLabelText<HTMLInputElement>('이미지 선택')
  expect([input.type, input.accept, input.disabled]).toEqual(['file', 'image/png,image/jpeg,image/webp', false])
  const ai = coverGroup().getByRole<HTMLButtonElement>('button', { name: /AI로 생성/ })
  expect(ai.disabled).toBe(true)
  expect(document.getElementById(ai.getAttribute('aria-describedby') ?? '')?.textContent).toBe('준비 중')
  expect(coverGroup().queryByRole('button', { name: '표지 삭제' })).toBeNull()
  cleanup()
  await show(undefined, '/worldstudio/qa', { hasCover: true })
  openInfoEdit()
  expect(coverGroup().getByRole('button', { name: '표지 삭제' })).toBeTruthy()
})

it('고른 표지는 저장해야 올라가고 올라가면 헤더 표지가 새 이미지로 바뀐다(취소하면 보내지 않는다)', async () => {
  const { setCover, readCover } = await showWorld()
  openInfoEdit()
  const file = png()
  pickCover(file)
  expect(coverGroup().getByText('선택한 파일: cover.png')).toBeTruthy()
  expect(setCover).not.toHaveBeenCalled() // 고르는 것만으로는 보내지 않는다
  fireEvent.click(infoForm().getByRole('button', { name: '취소' })) // 취소는 고른 파일을 버린다
  expect(setCover).not.toHaveBeenCalled()
  openInfoEdit()
  expect(coverGroup().queryByText(/선택한 파일/)).toBeNull()
  pickCover(file)
  savePanel()
  await waitFor(() => expect(setCover).toHaveBeenCalledWith('qa', file, expect.any(AbortSignal)))
  expect(await screen.findByText('표지를 올렸어요.')).toBeTruthy()
  await panelClosed()
  await waitFor(() => expect(headerCover()).toBeTruthy())
  expect(readCover).toHaveBeenCalledWith('qa', expect.any(AbortSignal))
})

it('이미 표지가 있는 세계관에 새 표지를 올리면 교체하고 이전 표지의 객체 주소를 해제한다', async () => {
  const { setCover, readCover } = await show(undefined, '/worldstudio/qa', { hasCover: true })
  await waitFor(() => expect(headerCover()?.getAttribute('src')).toBe('blob:cover-1'))
  openInfoEdit()
  pickCover(png('new.png'))
  savePanel()
  await waitFor(() => expect(setCover).toHaveBeenCalledOnce())
  await waitFor(() => { // 고른 파일의 미리보기도 객체 주소를 쓰므로 번호가 아니라 '이전 표지가 아닌 새 이미지'로 본다
    expect(headerCover()?.getAttribute('src')).toBeTruthy()
    expect(headerCover()?.getAttribute('src')).not.toBe('blob:cover-1')
  })
  expect(readCover).toHaveBeenCalledTimes(2)
  expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1')
})

it('표지를 올리는 동안에는 올리고 있다고 알리고 패널을 잠가 같은 파일을 두 번 올리지 않는다', async () => {
  let finish!: () => void
  const setCover = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  await show(undefined, '/worldstudio/qa', { setCover })
  openInfoEdit()
  pickCover(png())
  savePanel()
  expect(await infoForm().findByText('표지를 올리고 있어요…')).toBeTruthy()
  expect(infoForm().getByRole('textbox', { name: '세계관 이름' }).closest('fieldset')!.disabled).toBe(true)
  fireEvent.submit(screen.getByRole('form', { name: '세계관 정보 편집' }))
  expect(setCover).toHaveBeenCalledOnce()
  await act(async () => finish())
  await panelClosed()
})

it('표지 올리기가 실패하면 오류를 알리고 패널과 고른 파일을 그대로 두며 헤더 표지는 바뀌지 않고 다시 올릴 수 있다', async () => {
  const setCover = vi.fn<NonNullable<WorldStudioRepository['setCover']>>().mockRejectedValueOnce(new Error('PNG·JPEG·WebP 이미지만 올릴 수 있어요.')).mockResolvedValue(undefined)
  await show(undefined, '/worldstudio/qa', { setCover })
  openInfoEdit()
  pickCover(png())
  savePanel()
  expect((await screen.findByRole('alert')).textContent).toBe('PNG·JPEG·WebP 이미지만 올릴 수 있어요.')
  expect(screen.getByRole('form', { name: '세계관 정보 편집' })).toBeTruthy()
  expect(coverGroup().getByText('선택한 파일: cover.png')).toBeTruthy()
  expect(headerCover()).toBeNull()
  savePanel()
  await waitFor(() => expect(setCover).toHaveBeenCalledTimes(2))
  await panelClosed()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('형식·크기가 맞지 않는 파일은 고르는 순간 이유를 알리고 올릴 수 없다', async () => {
  const { setCover } = await showWorld()
  openInfoEdit()
  const save = () => infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' })
  pickCover(png('big.png', 'image/png', 5 * 1024 * 1024 + 1))
  expect(coverGroup().getByRole('alert').textContent).toBe('표지는 5 MiB 이하여야 해요.')
  expect(coverGroup().queryByText(/선택한 파일/)).toBeNull()
  expect(save().disabled).toBe(true)
  pickCover(png('doc.gif', 'image/gif'))
  expect(coverGroup().getByRole('alert').textContent).toBe('PNG·JPEG·WebP 이미지만 표지로 쓸 수 있어요.')
  expect(save().disabled).toBe(true)
  pickCover(png('ok.webp', 'image/webp')) // 맞는 파일을 고르면 이유가 사라지고 저장할 수 있다
  expect(coverGroup().queryByRole('alert')).toBeNull()
  expect(save().disabled).toBe(false)
  expect(setCover).not.toHaveBeenCalled()
})

it('표지를 지우면 확인한 뒤 바로 지우고 기본 표지로 돌아간다(거절하면 아무것도 하지 않는다)', async () => {
  const { removeCover } = await show(undefined, '/worldstudio/qa', { hasCover: true })
  await waitFor(() => expect(headerCover()).toBeTruthy())
  openInfoEdit()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(coverGroup().getByRole('button', { name: '표지 삭제' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(removeCover).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(coverGroup().getByRole('button', { name: '표지 삭제' }))
  await waitFor(() => expect(removeCover).toHaveBeenCalledWith('qa', expect.any(AbortSignal)))
  expect(await screen.findByText('표지를 지웠어요. 기본 표지를 써요.')).toBeTruthy()
  await waitFor(() => expect(headerCover()).toBeNull())
  expect(defaultCover()?.getAttribute('src')).toBe('/default-work-cover.svg')
  expect(document.querySelector('.world-manage-hero .cov svg')).toBeNull()
  expect(coverGroup().queryByRole('button', { name: '표지 삭제' })).toBeNull()
})

// ── 세계관 삭제(정보 편집 패널) ───────────────────────────────────────────────────────────────────────────
const deleteButton = () => infoForm().getByRole<HTMLButtonElement>('button', { name: '세계관 삭제' })

it('정보 편집 패널의 세계관 삭제는 이름을 보이며 확인하고, 지우면 내 세계관 목록으로 간다(거절하면 아무것도 하지 않는다)', async () => {
  const { deleteStudio } = await showWorld()
  openInfoEdit()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(deleteButton())
  expect(confirm).toHaveBeenCalledOnce()
  expect(String(confirm.mock.calls[0][0])).toContain('검증 세계')
  expect(String(confirm.mock.calls[0][0])).toContain('목록에서 사라져요')
  expect(deleteStudio).not.toHaveBeenCalled()
  expect(where()).toBe('/worldstudio/qa')
  confirm.mockReturnValue(true)
  fireEvent.click(deleteButton())
  await waitFor(() => expect(deleteStudio).toHaveBeenCalledExactlyOnceWith('qa', expect.any(AbortSignal)))
  await waitFor(() => expect(where()).toBe('/lib?tab=worlds'))
})

it('서버가 삭제를 거절하면(연결된 소설 등) 그 이유를 그대로 알리고 이동하지 않으며 패널은 열려 있다', async () => {
  const reason = '연결된 소설이 있어 세계관을 삭제할 수 없어요. 작품 관리에서 연결을 해제한 뒤 삭제하세요.'
  const { deleteStudio } = await show(undefined, '/worldstudio/qa', { deleteStudio: async () => { throw new Error(reason) } })
  openInfoEdit()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(deleteButton())
  expect((await screen.findByText(reason)).getAttribute('role')).toBe('alert')
  expect(deleteStudio).toHaveBeenCalledOnce()
  expect(where()).toBe('/worldstudio/qa')
  expect(screen.getByRole('form', { name: '세계관 정보 편집' })).toBeTruthy()
})

it('연결된 소설이 있으면 삭제 버튼을 이유와 함께 잠그고 확인도 서버 호출도 하지 않는다', async () => {
  const { deleteStudio } = await show(undefined, '/worldstudio/qa', { linkedWorkId: 'work-1' })
  openInfoEdit()
  expect(deleteButton().disabled).toBe(true)
  const reason = infoForm().getByText(/작품 관리에서 연결을 해제한 뒤 삭제하세요/)
  expect(deleteButton().getAttribute('aria-describedby')).toBe(reason.id)
  const confirm = vi.spyOn(window, 'confirm')
  fireEvent.click(deleteButton())
  expect(confirm).not.toHaveBeenCalled()
  expect(deleteStudio).not.toHaveBeenCalled()
})

it('연결된 소설이 없으면 삭제 버튼은 열려 있고 목록에서 사라진다고 미리 알린다', async () => {
  await showWorld()
  openInfoEdit()
  expect(deleteButton().disabled).toBe(false)
  expect(infoForm().getByText(/내 세계관 목록과 공개 화면에서 사라져요/)).toBeTruthy()
})

it('삭제 저장소가 없는 데모 대역에는 삭제 버튼이 없다', async () => {
  await show(undefined, '/worldstudio/qa', { demoDelete: true })
  openInfoEdit()
  expect(infoForm().queryByRole('button', { name: '세계관 삭제' })).toBeNull()
})

it('삭제하는 동안은 패널 전체가 잠겨 다시 누를 수 없다', async () => {
  let finish: () => void = () => undefined
  const { deleteStudio } = await show(undefined, '/worldstudio/qa', { deleteStudio: () => new Promise<void>((resolve) => { finish = resolve }) })
  openInfoEdit()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(deleteButton())
  await waitFor(() => expect(deleteButton().closest('fieldset')?.disabled).toBe(true)) // 패널 fieldset이 잠기면 안의 버튼도 잠긴다
  fireEvent.click(deleteButton())
  expect(deleteStudio).toHaveBeenCalledOnce()
  finish()
  await waitFor(() => expect(where()).toBe('/lib?tab=worlds'))
})

it('이름·공개 설정·표지를 함께 바꾸면 이름·설명 → 공개 설정 → 표지 순으로 한 번씩 보내고 모두 되면 닫는다', async () => {
  const { saveStudio, setPublication, setCover } = await show(undefined, '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  pickCover(png())
  savePanel()
  await waitFor(() => expect(setCover).toHaveBeenCalledOnce())
  expect([saveStudio, setPublication, setCover].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1])
  const order = [saveStudio, setPublication, setCover].map((fn) => fn.mock.invocationCallOrder[0])
  expect(order).toEqual([...order].sort((a, b) => a - b))
  await panelClosed()
})

it('표지 저장소가 없는 데모(메모리)에서는 표지 올리기를 잠그고 지원하지 않는다고 알린다', async () => {
  await show(undefined, '/worldstudio/qa', { demoCover: true })
  openInfoEdit()
  expect(coverGroup().getByText('데모에서는 표지 업로드를 지원하지 않아요.')).toBeTruthy()
  expect(coverGroup().getByLabelText<HTMLInputElement>('이미지 선택').disabled).toBe(true)
  expect(coverGroup().queryByRole('button', { name: '표지 삭제' })).toBeNull()
})

// ── 설명(본문): Toast UI Editor(MarkdownEditor, 지연 로딩) 자리. 입력은 대역 textarea로 흉내 낸다 ──
afterEach(() => { fakeEditor.suspend = false })
/** 인물 카드의 본문 편집기. 인물 카드는 본문이 IDENTITY.md 문서이고(아래 '인물 문서'), 인물이 아닌 설정은 '설명'이다. */
const body = () => editor().getByRole<HTMLTextAreaElement>('textbox', { name: 'IDENTITY.md' })

it('설명은 이름 붙은 마크다운 편집기 자리이고 문단을 나누는 방법을 한 줄로 안내한다', async () => {
  await show([eventCard('건국')]) // 인물이 아닌 설정
  openCard('건국 사건')
  const description = editor().getByRole<HTMLTextAreaElement>('textbox', { name: '설명' })
  expect(description.dataset.label).toBe('설정 본문')
  expect(description.value).toBe('건국이 일어났다')
  expect(description.placeholder).toContain('어떤 인물인가요?')
  expect(editor().getByText('# · ## · ### 제목은 공개 페이지 목차에 나와요.')).toBeTruthy()
})

it('글을 고치면 초안이 바뀌어 저장 전 수정이 있다고 알리고 글자 수를 센다', async () => {
  await show()
  openCard('가람 인물')
  fireEvent.change(body(), { target: { value: '고친 **내용**' } })
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  expect(editor().getByText(/9 \/ 3,000자 · 저장 전 수정이 있어요/)).toBeTruthy()
})

it('다른 카드를 열면 편집기가 그 카드의 글로 다시 만들어지고 고친 글은 초안에 남아 돌아오면 그대로다', async () => {
  await show([person('가람', '첫째'), person('나래', '둘째')])
  openCard('가람 인물')
  fireEvent.change(body(), { target: { value: '첫째 고침' } })
  fireEvent.click(rail().getByRole('button', { name: '나래 인물' }))
  expect(body().value).toBe('둘째') // 이전 카드의 글이 섞이지 않는다
  fireEvent.click(rail().getByRole('button', { name: '가람 인물' }))
  expect(body().value).toBe('첫째 고침')
})

it('저장하는 동안에는 편집기를 잠가 그사이 입력이 초안과 어긋나지 않게 하고 끝나면 푼다', async () => {
  let finish!: (world: StudioWorld) => void
  const saveStudio = vi.fn((_next: StudioWorld) => new Promise<StudioWorld>((resolve) => { finish = resolve }))
  await show(undefined, '/worldstudio/qa', { saveStudio })
  openCard('가람 인물')
  fireEvent.change(body(), { target: { value: '고친 내용' } })
  const locked = () => body().closest('.world-card-editor')!.hasAttribute('inert') // 글자 입력은 fieldset 잠금이 닿지 않아 inert로 막는다
  expect(locked()).toBe(false)
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(locked()).toBe(true))
  await act(async () => finish(saveStudio.mock.calls[0][0]))
  await waitFor(() => expect(locked()).toBe(false))
  expect(body().value).toBe('고친 내용') // 편집기를 다시 만들지 않는다
})

it('3000자를 넘기면 글자 수가 경고로 바뀌고 저장을 눌러도 기존 검증이 막아 알린다', async () => {
  await show([eventCard('건국')]) // 인물이 아닌 설정(인물 카드의 본문은 IDENTITY.md 문서라 저장 영역이 문서 이름으로 먼저 막는다)
  openCard('건국 사건')
  const description = () => editor().getByRole('textbox', { name: '설명' })
  fireEvent.change(description(), { target: { value: '가'.repeat(3001) } })
  const count = editor().getByText(/3,001 \/ 3,000자/)
  expect(count.textContent).toContain('3,000자를 넘으면 저장할 수 없어요')
  expect(count.classList.contains('world-over')).toBe(true)
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  expect((await screen.findByRole('alert')).textContent).toContain('설정 이름과 설명의 길이를 확인해 주세요.')
  fireEvent.change(description(), { target: { value: '가'.repeat(3000) } })
  expect(editor().getByText(/3,000 \/ 3,000자/).classList.contains('world-over')).toBe(false)
})

it('편집기를 불러오는 동안은 같은 자리에 안내를 보이고 이름 입력은 그대로 쓸 수 있다', async () => {
  fakeEditor.suspend = true
  await show()
  await act(async () => openCard('가람 인물')) // 화면 이동은 transition이라 멈춘 렌더가 안내(Suspense 대체 화면)로 커밋되도록 비동기로 기다린다
  expect(editor().getByText('편집기를 불러오고 있어요.')).toBeTruthy()
  expect(editor().queryByRole('textbox', { name: 'IDENTITY.md' })).toBeNull()
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('가람')
})

it('유형은 선택 상자 하나로만 보이고 같은 유형 칩이 따로 없다', async () => {
  await show()
  openCard('가람 인물')
  expect(editor().getByRole<HTMLSelectElement>('combobox', { name: '유형' }).value).toBe('character')
  expect(document.querySelector('.world-card-meta .chip')).toBeNull()
})

// ── 설정 카드 단위 공개(DEC-46: 기본 비공개, 공개 세계관 화면에는 공개 카드만) ─────────────────────────────
const boardTable = () => within(screen.getByRole('table', { name: '설정 카드 목록' }))
const visibilityOf = () => boardTable().getAllByRole('row').slice(1).map((row) => row.querySelector('.col-vis')?.textContent)
const bulk = () => within(screen.getByRole('group', { name: '공개 범위 한 번에 바꾸기' }))
const noPublicCards = /공개로 둔 설정이 없어요/
/** 경고 줄(문구 + 전체 공개 버튼) */
const warningIn = (scope: ReturnType<typeof within>) => within(scope.getByText(noPublicCards).closest('p')!)

it('설정 카드는 기본 비공개이고 편집 화면의 이 설정 공개를 켜면 초안이 바뀌어 게시판의 공개 칸과 저장 요청에 반영된다', async () => {
  const { saveStudio } = await show([person('가람', '기록관'), person('나래')])
  expect(visibilityOf()).toEqual(['비공개', '비공개'])
  openCard('가람 인물')
  fireEvent.click(editor().getByRole('switch', { name: '이 설정 공개' }))
  expect(editor().getByRole<HTMLInputElement>('switch', { name: '이 설정 공개' }).checked).toBe(true)
  expect(editor().getByText(/확정 버전 남기기’를 해야 공개 세계관 화면과 독자 설정 위키에 반영돼요/)).toBeTruthy() // 초안 값이라 바로 공개되지 않는다
  backToBoard()
  expect(visibilityOf()).toEqual(['공개', '비공개'])
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings.map((s) => s.visibility)).toEqual(['public', undefined])
  openCard('가람 인물')
  fireEvent.click(editor().getByRole('switch', { name: '이 설정 공개' })) // 다시 끄면 비공개로 돌아간다
  backToBoard()
  expect(visibilityOf()).toEqual(['비공개', '비공개'])
})

it('게시판에서 고른 설정만 선택 공개·선택 비공개로 바꾸고 전체 공개는 모든 설정 카드를 공개로 바꾼다', async () => {
  await show([person('가람'), person('나래'), place('항구')])
  const [publish, hide, all] = ['현재 페이지 선택 공개', '현재 페이지 선택 비공개', '전체 공개'].map((name) => bulk().getByRole<HTMLButtonElement>('button', { name }))
  expect([publish.disabled, hide.disabled, all.disabled]).toEqual([true, true, false]) // 고른 것이 없으면 선택 동작은 잠긴다
  fireEvent.click(boardTable().getByRole('checkbox', { name: '가람 선택' }))
  fireEvent.click(boardTable().getByRole('checkbox', { name: '항구 선택' }))
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 2개 선택')
  fireEvent.click(publish)
  expect(visibilityOf()).toEqual(['공개', '비공개', '공개'])
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 설정 2개를 공개로 뒀어요.') // 바꾸면 고른 것을 풀고 한 일을 알린다
  expect(boardTable().getAllByRole<HTMLInputElement>('checkbox').filter((box) => box.checked)).toEqual([])
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  fireEvent.click(boardTable().getByRole('checkbox', { name: '보이는 설정 모두 선택' }))
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 3개 선택')
  fireEvent.click(hide)
  expect(visibilityOf()).toEqual(['비공개', '비공개', '비공개'])
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 설정 3개를 비공개로 뒀어요.')
  fireEvent.click(all)
  expect(visibilityOf()).toEqual(['공개', '공개', '공개'])
  expect(bulk().getByRole('status').textContent).toBe('모든 설정을 공개로 뒀어요.')
  expect(all.disabled).toBe(true) // 이미 모두 공개다
})

it('고른 설정은 지금 보이는 줄에서만 세어, 검색으로 가려진 설정의 공개 범위는 바꾸지 않는다', async () => {
  await show([person('가람', '북부'), person('나래', '남부')])
  fireEvent.click(boardTable().getByRole('checkbox', { name: '보이는 설정 모두 선택' }))
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: '북부' } })
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 1개 선택 · 다른 페이지·필터 1개 선택')
  fireEvent.click(bulk().getByRole('button', { name: '현재 페이지 선택 공개' }))
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: '' } })
  expect(visibilityOf()).toEqual(['공개', '비공개'])
})

it('세계관을 공개로 고르면 공개로 둔 설정이 없다고 경고하고, 그 자리에서 전체 공개를 눌러도 공개 설정 저장은 잠기지 않는다', async () => {
  const { setPublication } = await show([person('가람'), person('나래')], '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  expect(screen.queryByText(noPublicCards)).toBeNull() // 비공개 세계관에는 경고가 없다
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  fireEvent.click(warningIn(infoForm()).getByRole('button', { name: '전체 공개' }))
  expect(infoForm().queryByText(noPublicCards)).toBeNull()
  expect(visibilityOf()).toEqual(['공개', '공개'])
  // 초안이 바뀌어 저장하지 않은 변경이 생겼어도, 공개 범위만 바꾼 패널 저장은 초안 저장과 별개라 잠기지 않는다.
  expect(infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(false)
  expect(infoForm().queryByText(/작성 중인 변경을 먼저 저장하세요/)).toBeNull()
  savePanel()
  await waitFor(() => expect(setPublication).toHaveBeenCalledWith('qa', { visibility: 'public', genre: null }, expect.any(AbortSignal)))
  await panelClosed()
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy() // 카드 공개는 초안 변경이라 세계관 저장이 남아 있다
})

it('경고를 넘기고 공개해도 막지 않으며, 공개 세계관에 공개로 둔 설정이 없는 동안에는 헤더가 경고와 전체 공개를 보인다', async () => {
  const { setPublication } = await show([person('가람')], '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  expect(infoForm().getByText(noPublicCards)).toBeTruthy()
  savePanel()
  await waitFor(() => expect(setPublication).toHaveBeenCalledOnce())
  await panelClosed()
  await headerOf().findByText(noPublicCards)
  fireEvent.click(warningIn(headerOf()).getByRole('button', { name: '전체 공개' }))
  expect(headerOf().queryByText(noPublicCards)).toBeNull()
  expect(visibilityOf()).toEqual(['공개'])
})

it('이미 공개인 세계관도 공개로 둔 설정이 없으면 헤더가 경고하고, 공개할 설정이 없으면 전체 공개 버튼 없이 알리기만 한다', async () => {
  await show([person('가람')], '/worldstudio/qa', { visibility: 'public', currentRevisionId: 'rev-1' })
  expect(warningIn(headerOf()).getByRole('button', { name: '전체 공개' })).toBeTruthy()
  cleanup()
  await show([], '/worldstudio/qa', { visibility: 'public', currentRevisionId: 'rev-1' })
  expect(headerOf().getByText(noPublicCards)).toBeTruthy()
  expect(headerOf().queryByRole('button', { name: '전체 공개' })).toBeNull()
  cleanup()
  await show([{ ...person('가람'), visibility: 'public' }], '/worldstudio/qa', { visibility: 'public', currentRevisionId: 'rev-1' })
  expect(screen.queryByText(noPublicCards)).toBeNull()
})

it('작성 모드에서도 공개로 바꾸면 기본 정보 단계의 공개 설정 아래에 같은 경고와 전체 공개를 보인다', async () => {
  const { setPublication } = await wizard()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const info = within(screen.getByRole('group', { name: '세계관 기본 정보' }))
  expect(info.queryByText(noPublicCards)).toBeNull()
  fireEvent.click(info.getByRole('button', { name: '공개', pressed: false }))
  await waitFor(() => expect(setPublication).toHaveBeenCalledOnce())
  const all = await waitFor(() => { const button = warningIn(info).getByRole<HTMLButtonElement>('button', { name: '전체 공개' }); expect(button.disabled).toBe(false); return button })
  expect(headerOf().queryByText(noPublicCards)).toBeNull() // 같은 경고를 헤더에 겹쳐 두지 않는다
  fireEvent.click(all)
  expect(info.queryByText(noPublicCards)).toBeNull()
})

// ── 연결된 소설(세계관 ↔ 소설 1:1)과 독자 공개 회차 ────────────────────────────────────────────────
const episodeApi = () => appContainer.resolve('episodeUseCase')
const myWork = (id: string, title: string, worldStudioId: string | null = null): Work => ({ id, title, summary: '', visibility: 'private', allowFork: false, allowForkPublication: false, source: null, episodes: [], draft: { title: '새 회차', body: '', revision: 0 }, revision: 0, worldStudioId })
const revealField = () => editor().getByRole<HTMLInputElement>('textbox', { name: /독자 공개/ })

it('연결된 소설이 있으면 헤더가 그 제목을 알리고 소설 버튼 자리는 그 작품 관리로 가는 소설 작성하기다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록', '11111111-1111-4111-8111-111111111111'), myWork('work-2', '다른 소설')])
  await show(undefined, '/worldstudio/qa', { linkedWorkId: 'work-1' })
  expect((await headerOf().findByText('연결된 소설: 달빛 기록')).querySelector('button, a')).toBeNull() // 상태 줄은 정보만 보인다
  expect(headerOf().getAllByRole('link').filter((link) => link.getAttribute('href') === '/content?work=work-1').map((link) => link.textContent)).toEqual(['소설 작성하기']) // 같은 곳으로 가는 링크는 하나뿐이다
  expect(headerOf().queryByRole('button', { name: '소설 연결하기' })).toBeNull()
})

it('연결된 소설의 제목을 읽지 못해도 작품 관리로 가는 링크는 남기고 읽지 못했다고 알린다', async () => {
  vi.spyOn(episodeApi(), 'list').mockRejectedValue(new Error('서버 인증이 필요합니다.'))
  await show(undefined, '/worldstudio/qa', { linkedWorkId: 'work-1' })
  expect(await headerOf().findByText('연결된 소설의 제목을 불러오지 못했어요.')).toBeTruthy()
  expect(headerOf().getByRole('link', { name: '소설 작성하기' }).getAttribute('href')).toBe('/content?work=work-1')
})

it('연결된 소설이 없으면 소설 연결하기가 아직 연결되지 않은 내 소설만 고르게 하고, 고르면 서버에 연결한 뒤 헤더와 독자 공개 입력을 바꾼다', async () => {
  const list = vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록'), myWork('work-2', '이미 연결된 소설', '11111111-1111-4111-8111-111111111111')])
  const linkWorldStudio = vi.spyOn(episodeApi(), 'linkWorldStudio').mockResolvedValue({ workId: 'work-1', worldId: 'qa' })
  await showWorld()
  expect(list).not.toHaveBeenCalled() // 내 소설 목록은 필요할 때만 읽는다
  fireEvent.click(headerOf().getByRole('button', { name: '소설 연결하기' }))
  const sheet = within(await screen.findByRole('dialog', { name: '소설 연결하기' }))
  const pick = await sheet.findByRole('button', { name: /달빛 기록/ })
  expect(sheet.queryByRole('button', { name: /이미 연결된 소설/ })).toBeNull()
  fireEvent.click(pick)
  await waitFor(() => expect(linkWorldStudio).toHaveBeenCalledWith('work-1', 'qa'))
  const write = await headerOf().findByRole('link', { name: '소설 작성하기' }) // 같은 자리의 버튼이 소설 작성하기로 바뀐다
  expect(write.getAttribute('href')).toBe('/content?work=work-1')
  await waitFor(() => expect(document.activeElement).toBe(write)) // 누른 버튼이 사라진 자리의 새 버튼으로 초점이 간다
  expect(headerOf().queryByRole('button', { name: '소설 연결하기' })).toBeNull()
  expect(screen.queryByRole('dialog', { name: '소설 연결하기' })).toBeNull()
  expect(await headerOf().findByText('연결된 소설: 달빛 기록')).toBeTruthy()
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 연결은 초안 저장과 별개다
  openCard('가람 인물')
  expect(revealField().disabled).toBe(false)
})

it('소설 연결이 실패하면 서버가 준 이유를 시트에 보이고 연결되지 않은 채로 둔다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  vi.spyOn(episodeApi(), 'linkWorldStudio').mockRejectedValue(new Error('이미 다른 작품에 연결된 세계관이에요.'))
  await showWorld()
  fireEvent.click(headerOf().getByRole('button', { name: '소설 연결하기' }))
  const sheet = within(await screen.findByRole('dialog', { name: '소설 연결하기' }))
  fireEvent.click(await sheet.findByRole('button', { name: /달빛 기록/ }))
  expect((await sheet.findByRole('alert')).textContent).toBe('이미 다른 작품에 연결된 세계관이에요.')
  expect(sheet.getByRole<HTMLButtonElement>('button', { name: /달빛 기록/ }).disabled).toBe(false) // 다시 고를 수 있다
  fireEvent.click(sheet.getByRole('button', { name: '닫기' }))
  expect(headerOf().getByRole('button', { name: '소설 연결하기' })).toBeTruthy()
})

it('내 소설 목록을 읽지 못하면 다시 시도할 수 있고, 연결할 소설이 없으면 그렇다고 알린다', async () => {
  const list = vi.spyOn(episodeApi(), 'list').mockRejectedValue(new Error('서버 인증이 필요합니다.'))
  await showWorld()
  fireEvent.click(headerOf().getByRole('button', { name: '소설 연결하기' }))
  const sheet = within(await screen.findByRole('dialog', { name: '소설 연결하기' }))
  expect((await sheet.findByRole('alert')).textContent).toContain('내 소설을 불러오지 못했어요')
  expect(sheet.getByRole('link', { name: '새 소설 만들기' }).getAttribute('href')).toBe('/content') // 목록을 못 읽어도 새로 쓰러 갈 수 있다
  list.mockResolvedValue([myWork('work-2', '이미 연결된 소설', '11111111-1111-4111-8111-111111111111')])
  fireEvent.click(sheet.getByRole('button', { name: '다시 시도' }))
  expect(await sheet.findByText(/연결할 수 있는 소설이 없어요/)).toBeTruthy()
  expect(sheet.getByRole('link', { name: '새 소설 만들기' }).getAttribute('href')).toBe('/content') // 예전 미연결 '소설 작성하기'가 가던 작품 만들기
})

it('독자 공개 회차는 소설을 연결한 세계관에서만 입력할 수 있고 비우면 독자에게 숨긴다', async () => {
  await show([person('가람', '기록관')])
  openCard('가람 인물')
  expect(revealField().disabled).toBe(true)
  expect(editor().getByText('소설을 연결하면 설정할 수 있어요.')).toBeTruthy()
  cleanup()
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  const { saveStudio } = await show([person('가람', '기록관')], '/worldstudio/qa', { linkedWorkId: 'work-1' })
  openCard('가람 인물')
  expect(revealField().disabled).toBe(false)
  fireEvent.change(revealField(), { target: { value: '3' } })
  expect(revealField().value).toBe('3')
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings[0].revealFromEpisode).toBe(3)
  fireEvent.change(revealField(), { target: { value: '' } })
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledTimes(2))
  expect(saveStudio.mock.calls[1][0].settings[0].revealFromEpisode).toBeUndefined()
})

it('독자 공개 회차가 1 이상의 정수가 아니면 저장 영역이 이유를 알리고 저장을 막는다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  await show([person('가람', '기록관')], '/worldstudio/qa', { linkedWorkId: 'work-1' })
  openCard('가람 인물')
  fireEvent.change(revealField(), { target: { value: '0' } })
  expect(revealField().getAttribute('aria-invalid')).toBe('true')
  expect(saveBar().getByText('‘가람’: 독자 공개 회차는 1 이상의 정수로 입력해 주세요.')).toBeTruthy()
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(true)
  fireEvent.change(revealField(), { target: { value: '2' } })
  expect(revealField().getAttribute('aria-invalid')).toBe('false')
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(false)
})

it('데모(목업)에는 소설 연결이 없어 연결 줄을 그리지 않고 독자 공개 입력은 지원하지 않는다고 알린다', async () => {
  vi.stubEnv('MODE', 'mockup')
  const list = vi.spyOn(episodeApi(), 'list')
  await showWorld()
  expect(headerOf().queryByRole('button', { name: '소설 연결하기' })).toBeNull()
  expect(headerOf().queryByText(/연결된 소설/)).toBeNull()
  openCard('가람 인물')
  expect(revealField().disabled).toBe(true)
  expect(editor().getByText('데모에서는 소설 연결을 지원하지 않아 설정할 수 없어요.')).toBeTruthy()
  expect(list).not.toHaveBeenCalled()
})

// ── 다른 세계관에서 가져오기(공개 세계관의 공개 설정을 초안에 복사) ──────────────────────────────────
const publicApi = () => appContainer.resolve('publicWorldUseCase')
const summary = (id: string, name: string, cardCount = 3): PublicWorldSummary => ({ id, name, description: '', genre: null, authorNickname: '원작자', cardCount, relationshipCount: 1, publishedAt: '2026-11-12T00:00:00Z' })
const sourceWorld = (over: Partial<PublicWorld> = {}): PublicWorld => ({
  id: 'src', name: '원본 세계', description: '', genre: null, authorNickname: '원작자', publishedAt: '2026-11-12T00:00:00Z', revisionNo: 4,
  cards: [
    { id: 'a', title: '설화', text: '## 개요\n북쪽 기록관의 필경사', cardType: 'character', aliases: ['눈의 필경사'], tags: ['기록관'] },
    { id: 'b', title: '등불지기', text: '밤길을 지키는 사람', cardType: 'character', aliases: [], tags: [] },
    { id: 'c', title: '안개 항구', text: '새벽마다 안개가 끼는 항구', cardType: 'location', aliases: [], tags: [] },
  ],
  relationships: [{ id: 'r1', sourceCardId: 'a', targetCardId: 'b', label: '스승과 제자' }, { id: 'r2', sourceCardId: 'a', targetCardId: 'c', label: '고향' }],
  relationshipStatus: 'current', ...over,
})
/** 공개 세계관 조회 대역: 목록(대상 세계관 자신 포함)과 상세 한 건. 그 밖의 id는 찾을 수 없는 세계관이다. */
const stubPublicWorlds = (world = sourceWorld(), items = [summary('qa', '검증 세계'), summary('src', '원본 세계'), summary('empty', '빈 세계', 0)]) => ({
  list: vi.spyOn(publicApi(), 'list').mockResolvedValue({ items, page: 0, size: 24, total: items.length }),
  get: vi.spyOn(publicApi(), 'get').mockImplementation(async (id) => (id === world.id ? structuredClone(world) : undefined)),
})
const importDialog = async () => within(await screen.findByRole('dialog', { name: '다른 세계관에서 가져오기' }))
const openImport = () => { fireEvent.click(screen.getByRole('button', { name: '다른 세계관에서 가져오기' })); return importDialog() }
const noImportDialog = () => waitFor(() => expect(screen.queryByRole('dialog', { name: '다른 세계관에서 가져오기' })).toBeNull())
/** 가져오기 시트에서 원본 세계를 골라 그 세계관의 설정을 고르는 단계로 간다. */
const pickSource = async (sheet: ReturnType<typeof within>) => {
  fireEvent.click(await sheet.findByRole('button', { name: /원본 세계/ }))
  const cards = within(await sheet.findByRole('region', { name: '가져올 설정 고르기' }))
  await cards.findByRole('checkbox', { name: /설화/ })
  return cards
}

it('다른 세계관에서 가져오기는 공개 세계관을 고르고 공개 설정을 체크해 초안에 새 카드로 더하며 가져옴·출처를 보이고 비공개로 시작한다', async () => {
  const { get } = stubPublicWorlds()
  const { saveStudio } = await showWorld()
  const sheet = await openImport()
  const worlds = within(await sheet.findByRole('region', { name: '가져올 세계관 고르기' }))
  await worlds.findByRole('button', { name: /원본 세계/ })
  expect(worlds.getAllByRole('button').map((b) => b.querySelector('strong')?.textContent)).toEqual(['원본 세계', '빈 세계']) // 대상 세계관 자신(검증 세계)은 없다
  expect(worlds.getByRole<HTMLButtonElement>('button', { name: /빈 세계/ }).disabled).toBe(true) // 공개 설정이 없어 가져올 것이 없다
  const cards = await pickSource(sheet)
  expect(get).toHaveBeenCalledWith('src', expect.any(AbortSignal))
  expect(cards.getByRole<HTMLButtonElement>('button', { name: '가져오기' }).disabled).toBe(true) // 고른 설정이 없다
  fireEvent.click(cards.getByRole('checkbox', { name: /설화/ }))
  fireEvent.click(cards.getByRole('checkbox', { name: /안개 항구/ }))
  fireEvent.click(cards.getByRole('button', { name: '설정 2개 가져오기' }))
  await noImportDialog()
  expect(screen.getByText('설정 2개를 초안에 가져왔어요. 저장해야 반영돼요.')).toBeTruthy()
  const row = boardTable().getByRole('button', { name: '설화 인물' }).closest('tr')!
  expect(row.textContent).toContain('가져옴')
  expect(row.textContent).toContain('참고: 원본 세계 세계관 · 원작자')
  expect(row.querySelector('.col-vis')?.textContent).toBe('비공개')
  openCard('설화 인물')
  expect(editor().getByText('참고: 원본 세계 세계관 · 원작자')).toBeTruthy()
  expect(editor().getByRole<HTMLInputElement>('switch', { name: '이 설정 공개' }).checked).toBe(false)
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  const saved = saveStudio.mock.calls[0][0].settings
  expect(saved.map((s) => s.item.title)).toEqual(['가람', '설화', '안개 항구']) // 관계 포함을 켜지 않아 관계는 없다
  expect(saved[1].importedFrom).toEqual({ worldId: 'src', worldName: '원본 세계', authorNickname: '원작자', revisionNo: 4, cardId: 'a' })
  expect([saved[1].item.id === 'a', saved[1].aliases, saved[1].tags]).toEqual([false, ['눈의 필경사'], ['기록관']])
})

it('같이 가져온 카드 사이 관계 포함을 켜면 양 끝을 모두 가져온 관계만 함께 들어오고, 관계를 불러오지 못한 세계관에서는 켤 수 없다', async () => {
  stubPublicWorlds()
  const { saveStudio } = await showWorld()
  const cards = await pickSource(await openImport())
  fireEvent.click(cards.getByRole('checkbox', { name: /전체 선택/ }))
  fireEvent.click(cards.getByRole('checkbox', { name: /안개 항구/ })) // 항구는 빼서 '고향' 관계의 한쪽 끝이 없다
  fireEvent.click(cards.getByRole('checkbox', { name: '같이 가져온 카드 사이 관계 포함' }))
  fireEvent.click(cards.getByRole('button', { name: '설정 2개 가져오기' }))
  await noImportDialog()
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  const saved = saveStudio.mock.calls[0][0].settings
  const relations = saved.filter((s) => s.item.kind === 'relation').map((s) => s.item)
  expect(relations.map((item) => [relationLabel(item), saved.find((s) => s.item.id === item.subjectId)?.item.title, saved.find((s) => s.item.id === item.targetId)?.item.title])).toEqual([['스승과 제자', '설화', '등불지기']])
  cleanup()
  vi.restoreAllMocks()
  stubPublicWorlds(sourceWorld({ relationships: [], relationshipStatus: 'unavailable' }))
  await showWorld()
  const unavailable = await pickSource(await openImport())
  expect(unavailable.getByRole<HTMLInputElement>('checkbox', { name: '같이 가져온 카드 사이 관계 포함' }).disabled).toBe(true)
  expect(unavailable.getByText(/관계를 불러오지 못해 지금은 관계를 함께 가져올 수 없어요/)).toBeTruthy()
})

it('공개 세계관 목록을 읽지 못하면 다시 시도할 수 있고, 가져올 세계관이 없으면 그렇다고 알린다', async () => {
  const list = vi.spyOn(publicApi(), 'list').mockRejectedValue(new Error('network'))
  await showWorld()
  const sheet = await openImport()
  expect((await sheet.findByRole('alert')).textContent).toContain('공개 세계관을 불러오지 못했어요')
  list.mockResolvedValue({ items: [summary('qa', '검증 세계')], page: 0, size: 24, total: 1 })
  fireEvent.click(sheet.getByRole('button', { name: '다시 시도' }))
  expect(await sheet.findByText('가져올 수 있는 공개 세계관이 없어요.')).toBeTruthy()
})

it('고른 세계관이 그사이 비공개가 됐거나 없으면 찾을 수 없다고 알리고 세계관 목록으로 돌아갈 수 있다', async () => {
  stubPublicWorlds(sourceWorld(), [summary('gone', '사라진 세계')])
  await showWorld()
  const sheet = await openImport()
  fireEvent.click(await sheet.findByRole('button', { name: /사라진 세계/ }))
  expect((await sheet.findByRole('alert')).textContent).toContain('이 세계관을 찾을 수 없어요')
  fireEvent.click(sheet.getByRole('button', { name: '세계관 목록' }))
  expect(await sheet.findByRole('button', { name: /사라진 세계/ })).toBeTruthy()
})

it('설정 가져오기 한도 오류를 시트에 보이고 초안은 그대로 둔다', async () => {
  stubPublicWorlds()
  const append = vi.spyOn(cardImports, 'appendImported').mockImplementation(() => { throw new Error('설정 카드는 10,000개까지 저장할 수 있어요. 더 가져오려면 설정을 먼저 정리해 주세요.') })
  await showWorld()
  const cards = await pickSource(await openImport())
  fireEvent.click(cards.getByRole('checkbox', { name: /설화/ }))
  fireEvent.click(cards.getByRole('button', { name: '설정 1개 가져오기' }))
  expect((await cards.findByRole('alert')).textContent).toBe('설정 카드는 10,000개까지 저장할 수 있어요. 더 가져오려면 설정을 먼저 정리해 주세요.')
  expect(append).toHaveBeenCalledOnce()
  expect(screen.getByRole('dialog', { name: '다른 세계관에서 가져오기' })).toBeTruthy() // 닫지 않아 고른 것을 줄여 다시 할 수 있다
  expect(saveBar().getByText('저장됨')).toBeTruthy()
  expect(boardTable().getAllByRole('row')).toHaveLength(2) // 머리글과 원래 카드만 남는다
  expect(boardTable().getByRole('button', { name: '가람 인물' })).toBeTruthy()
})

// ── 새로 나타나거나 사라지는 영역의 초점(삭제 확인·관계 작성 패널) ─────────────────────────────────────
it('삭제를 누르면 삭제 확인으로 초점이 가고 취소하면 누른 삭제 버튼으로 초점이 돌아온다', async () => {
  await show([place('항구')])
  openCard('항구 장소')
  const remove = editor().getByRole('button', { name: '카드 삭제' })
  remove.focus()
  fireEvent.click(remove)
  const confirm = screen.getByRole('region', { name: '설정 삭제 확인' })
  await waitFor(() => expect(document.activeElement).toBe(confirm)) // 긴 편집 열의 아래에 열리므로 초점을 옮겨 보이는 자리로 스크롤한다
  fireEvent.click(within(confirm).getByRole('button', { name: '삭제 취소' }))
  await waitFor(() => expect(document.activeElement).toBe(remove))
})

it('레일의 ⋮ 메뉴로 연 삭제 확인을 취소하면 그 항목의 더보기 버튼으로 초점이 돌아온다', async () => {
  await show([place('항구'), person('가람')])
  openCard('가람 인물')
  const more = rail().getByRole('button', { name: '항구 더보기' })
  fireEvent.click(more)
  fireEvent.click(within(screen.getByRole('menu', { name: '항구 더보기' })).getByRole('menuitem', { name: '삭제' }))
  const confirm = screen.getByRole('region', { name: '설정 삭제 확인' })
  await waitFor(() => expect(document.activeElement).toBe(confirm))
  fireEvent.click(within(confirm).getByRole('button', { name: '삭제 취소' }))
  await waitFor(() => expect(document.activeElement).toBe(rail().getByRole('button', { name: '항구 더보기' })))
})

it('관계도의 인물 삭제도 확인으로 초점이 가고, 지우면 되돌리기 버튼으로, 되돌리면 관계 주체 선택으로 초점이 간다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae))
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  const subject = () => screen.getByRole('combobox', { name: '관계 주체' })
  fireEvent.change(subject(), { target: { value: garam.item.id } })
  const remove = screen.getByRole('button', { name: '선택한 인물 삭제' })
  remove.focus()
  fireEvent.click(remove)
  const confirm = () => screen.getByRole('region', { name: '인물 삭제 확인' })
  await waitFor(() => expect(document.activeElement).toBe(confirm()))
  fireEvent.click(within(confirm()).getByRole('button', { name: '삭제 취소' }))
  await waitFor(() => expect(document.activeElement).toBe(remove))
  fireEvent.click(remove)
  fireEvent.click(within(confirm()).getByRole('button', { name: '인물과 연결 삭제' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '인물 삭제 되돌리기' }))) // 누른 버튼이 사라진 자리에서 바로 되돌릴 수 있다
  fireEvent.click(screen.getByRole('button', { name: '인물 삭제 되돌리기' }))
  await waitFor(() => expect(document.activeElement).toBe(subject()))
})

it('관계 작성 패널을 취소하거나 적용해 닫으면 사라진 버튼 대신 관계 작성 버튼으로 초점이 돌아온다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show([garam, narae])
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  fireEvent.change(screen.getByRole('combobox', { name: '관계 주체' }), { target: { value: garam.item.id } })
  fireEvent.change(screen.getByRole('combobox', { name: '관계 대상' }), { target: { value: narae.item.id } })
  const write = () => screen.getByRole('button', { name: '관계 작성' })
  fireEvent.click(write())
  const cancel = screen.getByRole('button', { name: '취소' })
  cancel.focus()
  fireEvent.click(cancel)
  await waitFor(() => expect(document.activeElement).toBe(write()))
  fireEvent.click(write())
  fireEvent.click(screen.getByRole('button', { name: '실제 관계 추가' }))
  fireEvent.change(screen.getByRole('combobox', { name: '실제 관계 1' }), { target: { value: '오랜 벗' } })
  const apply = screen.getByRole('button', { name: '편집본에 적용' })
  apply.focus()
  fireEvent.click(apply)
  expect(within(screen.getByRole('table', { name: '저장할 관계 목록' })).getByText('오랜 벗')).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(write()))
})

it('관계 목록에서 관계를 지우면 사라진 삭제 버튼 대신 관계 목록으로 초점이 간다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae))
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const remove = screen.getByRole('button', { name: '가람 · 친구 · 나래 삭제' })
  remove.focus()
  fireEvent.click(remove)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: '관계 목록' })))
})

// ── 저장을 막는 사유(어느 설정인지·그 설정으로 가기)와 독자 공개 회차 입력의 오류 안내 ─────────────────────
it('저장을 막는 사유는 어느 설정의 문제인지 이름을 붙여 알리고, 누르면 그 설정의 편집 화면으로 간다', async () => {
  const rule = newSetting()
  rule.item.kind = 'rule'
  rule.item.title = '금기'
  await show([person('가람', '내용'), rule])
  const issue = '‘금기’: 이 설정의 설명을 입력해 주세요.'
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(true)
  openCard('가람 인물')
  expect(saveBar().getByRole('button', { name: issue })).toBeTruthy() // 다른 설정을 보고 있어도 사유가 그 설정을 가리킨다
  fireEvent.click(saveBar().getByRole('button', { name: issue }))
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('금기')
  backToBoard()
  fireEvent.click(saveBar().getByRole('button', { name: issue })) // 설정집 화면에서도 같은 사유를 눌러 바로 간다
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('금기')
  fireEvent.change(editor().getByRole('textbox', { name: '설명' }), { target: { value: '밤에는 문을 열지 않는다' } })
  expect(saveBar().queryByRole('button', { name: issue })).toBeNull()
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(false)
})

it('작성 모드의 검토 단계 오류 목록도 같은 이름 붙은 사유이고 누르면 그 설정의 편집 화면으로 간다', async () => {
  const rule = newSetting()
  rule.item.kind = 'rule'
  rule.item.title = '금기'
  await show([rule], '/worldstudio/qa?new=1', { version: 0 })
  fireEvent.click(screen.getByRole('button', { name: '검토·저장' }))
  const review = within(screen.getByRole('region', { name: '세계관 검토' }))
  fireEvent.click(within(review.getByRole('alert')).getByRole('button', { name: '‘금기’: 이 설정의 설명을 입력해 주세요.' }))
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('금기')
})

it('독자 공개 회차 입력은 숫자만 받고, 어긋나면 입력 바로 아래에 이유를 글로 보이며 입력의 설명으로 잇는다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  await show([person('가람', '기록관')], '/worldstudio/qa', { linkedWorkId: 'work-1' })
  openCard('가람 인물')
  expect([revealField().type, revealField().getAttribute('inputmode')]).toEqual(['text', 'numeric']) // 숫자 칸(type=number)이 아니라 휠·스핀 버튼으로 값이 바뀌지 않는다
  fireEvent.change(revealField(), { target: { value: '1.5화' } })
  expect(revealField().value).toBe('15') // 숫자만 남는다
  fireEvent.change(revealField(), { target: { value: 'abc' } })
  expect(revealField().value).toBe('')
  expect(editor().queryByRole('alert')).toBeNull()
  fireEvent.change(revealField(), { target: { value: '0' } })
  const error = editor().getByRole('alert')
  expect(error.textContent).toBe('독자 공개 회차는 1 이상의 정수로 입력해 주세요.')
  expect(revealField().getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
  fireEvent.change(revealField(), { target: { value: '2' } })
  expect(editor().queryByRole('alert')).toBeNull()
})

// ── 일괄 공개의 결과 안내·초점, 일부 선택 표시, 글자 수 낭독, 가져올 설정의 이름 ─────────────────────────────
it('일괄 변경 뒤에는 잠긴 버튼 대신 표 머리의 모두 선택으로 초점이 가고, 일부만 고르면 모두 선택이 중간 상태가 된다', async () => {
  await show([person('가람'), person('나래')])
  const head = () => boardTable().getByRole<HTMLInputElement>('checkbox', { name: '보이는 설정 모두 선택' })
  expect([head().checked, head().indeterminate]).toEqual([false, false])
  fireEvent.click(boardTable().getByRole('checkbox', { name: '가람 선택' }))
  expect([head().checked, head().indeterminate]).toEqual([false, true])
  const publish = bulk().getByRole<HTMLButtonElement>('button', { name: '현재 페이지 선택 공개' })
  publish.focus()
  fireEvent.click(publish)
  expect(publish.disabled).toBe(true) // 고른 것이 풀려 누른 버튼은 잠긴다
  expect(document.activeElement).toBe(head())
  expect([head().checked, head().indeterminate]).toEqual([false, false])
  fireEvent.click(head())
  expect([head().checked, head().indeterminate]).toEqual([true, false])
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 2개 선택') // 다시 고르면 결과 문구 대신 고른 수를 보인다
  const all = bulk().getByRole<HTMLButtonElement>('button', { name: '전체 공개' })
  all.focus()
  fireEvent.click(all)
  expect(all.disabled).toBe(true)
  expect(document.activeElement).toBe(head())
  expect(bulk().getByRole('status').textContent).toBe('모든 설정을 공개로 뒀어요.')
  openCard('가람 인물') // 그 뒤 초안이 달라지면(다른 수정·저장) 결과 문구는 낡은 말이라 보이지 않는다
  fireEvent.click(editor().getByRole('switch', { name: '이 설정 공개' }))
  backToBoard()
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 2개 선택')
})

it('글자 수는 입력할 때마다 읽히지 않고 3,000자를 넘는 순간에만 상태로 알린다', async () => {
  await show()
  openCard('가람 인물')
  const count = editor().getByText(/\/ 3,000자/)
  expect(count.closest('[aria-live], [role=status]')).toBeNull() // 숫자가 든 줄은 라이브 영역이 아니다
  const over = () => editor().getByRole('status')
  expect(over().textContent).toBe('')
  fireEvent.change(body(), { target: { value: '가'.repeat(3001) } })
  expect(over().textContent).toBe('IDENTITY.md가 3,000자를 넘었어요.') // 인물 카드는 고른 문서의 이름으로 알린다
  fireEvent.change(body(), { target: { value: '가'.repeat(3000) } })
  expect(over().textContent).toBe('')
})

it('가져올 설정의 체크박스는 유형과 이름으로 읽히고 본문은 설명으로 이어지며, 일부만 고르면 전체 선택이 중간 상태가 된다', async () => {
  stubPublicWorlds()
  await showWorld()
  const cards = await pickSource(await openImport())
  const box = cards.getByRole<HTMLInputElement>('checkbox', { name: '인물 설화' })
  expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe('개요 북쪽 기록관의 필경사') // 긴 본문이 이름에 섞여 읽히지 않는다
  const all = cards.getByRole<HTMLInputElement>('checkbox', { name: /전체 선택/ })
  expect([all.checked, all.indeterminate]).toEqual([false, false])
  fireEvent.click(box)
  expect([all.checked, all.indeterminate]).toEqual([false, true])
  fireEvent.click(all)
  expect([all.checked, all.indeterminate]).toEqual([true, false])
})

it('한글을 조합하는 중에 누른 Esc는 조합만 끝내고 정보 편집을 닫지 않아 쓰던 입력을 지킨다', async () => {
  await showWorld()
  openInfoEdit()
  const name = () => infoForm().getByRole<HTMLInputElement>('textbox', { name: '세계관 이름' })
  fireEvent.change(name(), { target: { value: '쓰던 이름' } })
  fireEvent.keyDown(name(), { key: 'Escape', isComposing: true })
  fireEvent.keyDown(name(), { key: 'Escape', keyCode: 229 }) // Safari는 조합을 끝내는 키를 keyCode 229로 보낸다
  expect(name().value).toBe('쓰던 이름')
  fireEvent.keyDown(name(), { key: 'Escape' })
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull()
})

it('별칭 입력은 쉼표로 구분한다는 안내를 설명으로 잇는다', async () => {
  await showWorld()
  openCard('가람 인물')
  const alias = editor().getByRole('textbox', { name: '별칭', hidden: true })
  expect(document.getElementById(alias.getAttribute('aria-describedby') ?? '')?.textContent).toContain('별칭은 쉼표로 구분하며')
})

// ── 인물 문서(IDENTITY.md · SOUL.md · GOAL.md · memory/NN회차.md): 인물 카드는 설명 자리에 문서 목록과 고른 문서의 편집기를 둔다 ──────────
const withDocs = (row: StudioSetting, characterDocs: Partial<CharacterDocs>): StudioSetting => ({ ...row, characterDocs: { soul: '', goal: '', episodes: {}, ...characterDocs } })
const docsPanel = () => within(editor().getByRole('region', { name: '인물 문서' }))
const docList = () => within(docsPanel().getByRole('navigation', { name: '인물 문서 목록' }))
/** 탭 줄 끝의 `회차 기억 (N)`: 펼치면 회차 문서 목록과 추가 폼이 보인다(aria-expanded). */
const memoryToggle = () => docList().getByRole('button', { name: /^회차 기억 \(\d+\)/ })
const openMemory = () => { if (memoryToggle().getAttribute('aria-expanded') !== 'true') fireEvent.click(memoryToggle()) }
/** 문서 버튼: 탭 셋과 펼친 회차 목록의 회차 버튼(펼침 버튼과 추가 폼의 버튼은 문서가 아니다). */
const docButtons = () => docList().getAllByRole<HTMLButtonElement>('button').filter((b) => !b.hasAttribute('aria-expanded') && !b.closest('form'))
/** 문서 버튼을 예전 이름으로 읽는다: 탭(`정체성 IDENTITY.md 공개 정리 필요`)은 파일 이름과 표시(`IDENTITY.md`·`SOUL.md 정리 필요`)로, 회차 버튼은 그 글자 그대로. */
const docName = (b: HTMLElement) => {
  const file = b.querySelector('.world-doc-file')?.textContent
  return file ? [file, b.querySelector('.world-doc-flag')?.textContent].filter(Boolean).join(' ') : b.textContent
}
const docNames = () => docButtons().map(docName)
const currentDoc = () => docButtons().filter((b) => b.getAttribute('aria-current') === 'true').map(docName)
const docButton = (name: string) => {
  const found = docButtons().find((b) => docName(b) === name)
  if (!found) throw new Error(`문서 버튼 '${name}'이 없어요: ${docNames().join(', ')}`)
  return found
}
/** 회차 기억의 문서는 펼쳐야 보이므로 먼저 펼친다. */
const pickDoc = (name: string) => {
  if (name.endsWith('회차.md')) openMemory()
  fireEvent.click(docButton(name))
}
/** 고른 문서의 편집기(대역 textarea). 이름은 문서의 파일 이름이다. */
const docBody = (name: string) => editor().getByRole<HTMLTextAreaElement>('textbox', { name })
const episodeDocs = () => within(docList().getByRole('group', { name: '회차별 기억' }))
const episodeField = () => docsPanel().getByRole<HTMLInputElement>('textbox', { name: '회차 번호' })
const addEpisode = (value: string) => {
  openMemory()
  fireEvent.change(episodeField(), { target: { value } })
  fireEvent.click(docsPanel().getByRole('button', { name: '회차 기억 추가' }))
}
const md = (name: string, text: string) => new File([text], name, { type: 'text/markdown' })
const loadFiles = (...files: File[]) => fireEvent.change(docsPanel().getByLabelText('.md 파일 불러오기'), { target: { files } })
const saveWorld = () => fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))

it('인물 카드는 설명 대신 문서 목록(IDENTITY.md·SOUL.md·GOAL.md·memory/)과 고른 문서의 편집기를 보이고 처음에는 카드 본문인 IDENTITY.md가 열려 있다', async () => {
  await show([person('가람', '기존 내용'), place('항구')])
  openCard('가람 인물')
  expect(editor().queryByRole('textbox', { name: '설명' })).toBeNull()
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md 정리 필요', 'GOAL.md 정리 필요']) // 비어 있는 문서는 정리 필요로 알린다
  expect(docList().getAllByRole<HTMLButtonElement>('button').every((b) => b.tagName === 'BUTTON' && b.type === 'button')).toBe(true) // 키보드로 옮겨 다니는 버튼이다
  expect(currentDoc()).toEqual(['IDENTITY.md'])
  expect(docBody('IDENTITY.md').value).toBe('기존 내용') // 기존 인물 카드의 본문이 그대로 IDENTITY.md다
  expect(docBody('IDENTITY.md').dataset.label).toBe('IDENTITY.md')
  expect(docsPanel().getByText('누구인가: 이름·나이·소속·외형·역할.')).toBeTruthy()
  expect(editor().getByText('# · ## · ### 제목은 공개 페이지 목차에 나와요.')).toBeTruthy() // 공개되는 문서라 목차 안내가 그대로 있다
  openMemory() // 회차 기억은 펼쳐야 보인다
  expect(episodeDocs().getByText('아직 회차 기억이 없어요.')).toBeTruthy()
  expect(docsPanel().queryByText(/공개 세계관과 독자 설정 위키에 나가는 글은/)).toBeNull() // 공개 범위는 문장 대신 탭의 `공개`·`작가만` 표시가 알린다
  expect(docsPanel().getByText('0회차는 이야기 시작 전부터 아는 것(비밀·과거)이에요.')).toBeTruthy() // 회차 기억 추가 폼 아래의 0회차 안내
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 열어 보기만 해서는 초안이 바뀌지 않는다
  backToBoard()
  openCard('항구 장소') // 인물이 아닌 설정은 지금 그대로 설명 하나다
  expect(editor().queryByRole('region', { name: '인물 문서' })).toBeNull()
  fireEvent.change(editor().getByRole('textbox', { name: '설명' }), { target: { value: '가'.repeat(3001) } })
  expect(editor().getByText(/^3,001 \/ 3,000자/)).toBeTruthy() // 문서 이름 없이 글자 수만
  expect(editor().getByRole('status').textContent).toBe('설명이 3,000자를 넘었어요.')
})

it('문서를 바꿔 가며 쓰면 문서마다 초안에 남고 안내와 글자 수가 그 문서의 것으로 바뀌며, 저장 요청에 본문과 문서가 함께 실린다', async () => {
  const { saveStudio } = await show()
  openCard('가람 인물')
  pickDoc('SOUL.md 정리 필요')
  expect(currentDoc()).toEqual(['SOUL.md 정리 필요'])
  expect(docBody('SOUL.md').value).toBe('')
  expect(docsPanel().getByText('어떻게 생각하고 말하는가: 성격·가치관·말투·욕망·두려움.')).toBeTruthy()
  expect(editor().queryByText(/제목은 공개 페이지 목차에 나와요/)).toBeNull() // 공개 페이지 목차 안내는 공개되는 IDENTITY.md에만 있다
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 문서를 옮겨 보기만 해서는 초안이 바뀌지 않는다
  fireEvent.change(docBody('SOUL.md'), { target: { value: '말수가 적다' } })
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md', 'GOAL.md 정리 필요']) // 채운 문서는 정리 필요가 사라진다
  expect(editor().getByText(/^SOUL\.md 6 \/ 3,000자 · 저장 전 수정이 있어요/)).toBeTruthy()
  pickDoc('GOAL.md 정리 필요')
  expect(docsPanel().getByText('무엇을 원하고 하려는가: 이 인물의 목표·동기·하려는 일.')).toBeTruthy()
  fireEvent.change(docBody('GOAL.md'), { target: { value: '스승의 원수를 찾는다' } })
  pickDoc('IDENTITY.md')
  expect(docBody('IDENTITY.md').value).toBe('기존 내용')
  fireEvent.change(docBody('IDENTITY.md'), { target: { value: '떠돌이 검객' } })
  pickDoc('SOUL.md')
  expect(docBody('SOUL.md').value).toBe('말수가 적다') // 다른 문서를 보고 와도 그대로다
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings[0]).toMatchObject({ item: { text: '떠돌이 검객' }, characterDocs: { soul: '말수가 적다', goal: '스승의 원수를 찾는다', episodes: {} } })
})

it('회차 기억 추가는 회차 번호를 받아 memory/ 아래에 그 문서를 만들어 고르고, 이미 있는 회차면 새로 만들지 않고 그 문서를 고른다', async () => {
  const { saveStudio } = await show([withDocs(person('가람', '기존 내용'), { episodes: { 3: '스승을 잃었다' } })])
  openCard('가람 인물')
  openMemory()
  const episodes = () => episodeDocs().getAllByRole('button').map((b) => b.textContent)
  expect(episodes()).toEqual(['03회차.md'])
  fireEvent.click(docsPanel().getByRole('button', { name: '회차 기억 추가' })) // 번호 없이는 아무것도 만들지 않는다
  expect(episodes()).toEqual(['03회차.md'])
  fireEvent.change(episodeField(), { target: { value: '1.2화' } })
  expect(episodeField().value).toBe('12') // 숫자만 받는다
  fireEvent.click(docsPanel().getByRole('button', { name: '회차 기억 추가' }))
  expect(episodes()).toEqual(['03회차.md', '12회차.md'])
  expect(currentDoc()).toEqual(['12회차.md'])
  expect(docBody('memory/12회차.md').value).toBe('')
  expect(docsPanel().getByText('12화에서 겪은 일과 알게 된 사실.')).toBeTruthy()
  expect(episodeField().value).toBe('')
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  fireEvent.change(docBody('memory/12회차.md'), { target: { value: '검을 물려받았다' } })
  addEpisode('3')
  expect(episodes()).toEqual(['03회차.md', '12회차.md'])
  expect(currentDoc()).toEqual(['03회차.md'])
  expect(docBody('memory/03회차.md').value).toBe('스승을 잃었다') // 있던 글을 덮어쓰지 않는다
  addEpisode('0')
  expect(episodes()).toEqual(['00회차.md', '03회차.md', '12회차.md']) // 회차 번호 순이고 두 자리로 0을 채운다
  expect(docsPanel().getByText('이야기 시작 전부터 아는 것(비밀·과거).')).toBeTruthy() // 0회차 문서의 안내는 '0화에서 겪은 일'이 아니다
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings[0].characterDocs).toEqual({ soul: '', goal: '', episodes: { 0: '', 3: '스승을 잃었다', 12: '검을 물려받았다' } })
})

it('회차 기억 삭제는 회차 기억을 고른 동안에만 있고, 확인을 받은 뒤 그 문서만 지우고 IDENTITY.md로 돌아와 그 문서 버튼에 초점을 둔다', async () => {
  const { saveStudio } = await show([withDocs(person('가람', '기존 내용'), { episodes: { 3: '스승을 잃었다', 4: '검을 물려받았다' } })])
  openCard('가람 인물')
  expect(docsPanel().queryByRole('button', { name: '회차 기억 삭제' })).toBeNull()
  pickDoc('04회차.md')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(docsPanel().getByRole('button', { name: '회차 기억 삭제' }))
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('memory/04회차.md'))
  expect(docNames()).toContain('04회차.md') // 취소하면 그대로다
  expect(saveBar().getByText('저장됨')).toBeTruthy()
  confirm.mockReturnValue(true)
  fireEvent.click(docsPanel().getByRole('button', { name: '회차 기억 삭제' }))
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md 정리 필요', 'GOAL.md 정리 필요', '03회차.md'])
  expect(currentDoc()).toEqual(['IDENTITY.md'])
  await waitFor(() => expect(document.activeElement).toBe(docButton('IDENTITY.md'))) // 누른 버튼이 사라진 자리 대신
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings[0].characterDocs?.episodes).toEqual({ 3: '스승을 잃었다' })
})

it('.md 파일 불러오기는 여러 파일을 받아 파일 이름으로 문서를 정해 채우고, 알아볼 수 없는 이름은 가져오지 않고 그 이름을 알린다', async () => {
  const { saveStudio } = await show([person('가람')])
  openCard('가람 인물')
  const confirm = vi.spyOn(window, 'confirm')
  const input = docsPanel().getByLabelText<HTMLInputElement>('.md 파일 불러오기')
  expect([input.type, input.multiple, input.hidden]).toEqual(['file', true, false]) // 숨기지 않아 키보드로 닿는다(모양은 CSS가 맡는다)
  loadFiles(md('soul.md', '말수가 적다'), md('notes.md', '메모'), md('03회차.md', '스승을 잃었다\r\n검을 받았다'), md('IDENTITY.md', '이름: 가람'))
  const notice = await docsPanel().findByRole('status')
  expect(notice.textContent).toContain('문서 3개를 불러왔어요: SOUL.md, memory/03회차.md, IDENTITY.md.')
  expect(notice.textContent).toContain('알아볼 수 없어 가져오지 않은 파일: notes.md.')
  expect(confirm).not.toHaveBeenCalled() // 비어 있던 문서라 덮어쓸 것이 없다
  expect(docBody('IDENTITY.md').value).toBe('이름: 가람') // 보고 있던 문서도 불러온 글로 다시 열린다
  openMemory()
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md', 'GOAL.md 정리 필요', '03회차.md'])
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings[0]).toMatchObject({ item: { text: '이름: 가람' }, characterDocs: { soul: '말수가 적다', goal: '', episodes: { 3: '스승을 잃었다\n검을 받았다' } } })
})

it('GOAL.md는 목표 문서로, 옛 MEMORY.md는 00회차로 불러오고, 00회차에 이미 글이 있으면 그 앞에 빈 줄로 이어 붙이며 덮어쓰기 확인을 묻지 않는다', async () => {
  const { saveStudio } = await show([withDocs(person('가람', '기존 내용'), { episodes: { 0: '프롤로그의 기억' } })])
  openCard('가람 인물')
  const confirm = vi.spyOn(window, 'confirm')
  loadFiles(md('GOAL.md', '스승의 원수를 찾는다'), md('MEMORY.md', '스승의 유언'))
  const notice = await docsPanel().findByRole('status')
  expect(notice.textContent).toContain('문서 2개를 불러왔어요: GOAL.md, memory/00회차.md.') // 옛 MEMORY.md가 담긴 곳을 알린다
  expect(confirm).not.toHaveBeenCalled() // 00회차의 옛 글은 사라지지 않고 이어 붙으므로 덮어쓰기가 아니다
  openMemory()
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md 정리 필요', 'GOAL.md', '00회차.md'])
  pickDoc('00회차.md')
  expect(docBody('memory/00회차.md').value).toBe('스승의 유언\n\n프롤로그의 기억')
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings[0].characterDocs).toEqual({ soul: '', goal: '스승의 원수를 찾는다', episodes: { 0: '스승의 유언\n\n프롤로그의 기억' } })
})

it('알아볼 수 없는 파일만 고르면 아무것도 바꾸지 않고, 같은 문서로 읽히는 파일이 둘이면 앞의 것만 가져오고 나머지를 알린다', async () => {
  await show([person('가람', '기존 내용')])
  openCard('가람 인물')
  loadFiles(md('메모.md', '메모'), md('SOUL.txt', '성격'))
  expect((await docsPanel().findByRole('status')).textContent).toBe('알아볼 수 없어 가져오지 않은 파일: 메모.md, SOUL.txt. 파일 이름은 IDENTITY.md·SOUL.md·GOAL.md·NN회차.md여야 해요.')
  expect(saveBar().getByText('저장됨')).toBeTruthy()
  loadFiles(md('03회차.md', '먼저 고른 글'), md('3회차.md', '나중에 고른 글'))
  await waitFor(() => expect(docsPanel().getByRole('status').textContent).toContain('문서 1개를 불러왔어요: memory/03회차.md.'))
  expect(docsPanel().getByRole('status').textContent).toContain('같은 문서의 파일이 둘 이상이라 가져오지 않은 파일: 3회차.md.')
  pickDoc('03회차.md')
  expect(docBody('memory/03회차.md').value).toBe('먼저 고른 글')
})

it('이미 내용이 있는 문서를 불러오면 바뀌는 문서를 알리고 확인을 받으며, 취소하면 아무것도 바꾸지 않는다', async () => {
  await show([withDocs(person('가람', '기존 내용'), { soul: '옛 성격' })])
  openCard('가람 인물')
  pickDoc('SOUL.md')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  loadFiles(md('SOUL.md', '새 성격'), md('GOAL.md', '새 목표'))
  expect((await docsPanel().findByRole('status')).textContent).toContain('불러오기를 취소했어요. 문서는 그대로예요.')
  expect(confirm).toHaveBeenCalledOnce()
  expect(confirm.mock.calls[0][0]).toContain('SOUL.md')
  expect(confirm.mock.calls[0][0]).not.toContain('GOAL.md') // 비어 있던 문서는 덮어쓰는 것이 아니다
  expect(docBody('SOUL.md').value).toBe('옛 성격')
  expect(saveBar().getByText('저장됨')).toBeTruthy()
  confirm.mockReturnValue(true)
  loadFiles(md('SOUL.md', '새 성격'), md('GOAL.md', '새 목표'))
  await waitFor(() => expect(docBody('SOUL.md').value).toBe('새 성격')) // 열려 있던 편집기도 불러온 글로 바뀐다
  expect(docsPanel().getByRole('status').textContent).toContain('문서 2개를 불러왔어요: SOUL.md, GOAL.md.')
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md', 'GOAL.md'])
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
})

it('파일을 읽는 사이에 고친 글은 불러오기가 끝난 뒤에도 초안에 남는다', async () => {
  const { saveStudio } = await show([person('가람', '기존 내용')])
  openCard('가람 인물')
  loadFiles(md('SOUL.md', '말수가 적다'))
  fireEvent.change(docBody('IDENTITY.md'), { target: { value: '읽는 사이에 고친 본문' } }) // 파일을 다 읽기 전의 입력
  await docsPanel().findByRole('status')
  expect(docBody('IDENTITY.md').value).toBe('읽는 사이에 고친 본문')
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings[0]).toMatchObject({ item: { text: '읽는 사이에 고친 본문' }, characterDocs: { soul: '말수가 적다' } })
})

it('3,000자를 넘는 파일도 가져오되 그 문서에 초과를 표시하고, 저장 영역이 어느 문서인지 알리며 저장을 막는다', async () => {
  await show([person('가람', '기존 내용')])
  openCard('가람 인물')
  loadFiles(md('SOUL.md', '가'.repeat(3001)))
  await docsPanel().findByRole('status')
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md 3,000자 초과', 'GOAL.md 정리 필요'])
  expect(saveBar().getByRole('button', { name: '‘가람’: SOUL.md는 3,000자 이하로 줄여 주세요.' })).toBeTruthy()
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(true)
  pickDoc('SOUL.md 3,000자 초과')
  const count = editor().getByText(/3,001 \/ 3,000자/)
  expect(count.textContent).toContain('3,000자를 넘으면 저장할 수 없어요')
  expect(count.classList.contains('world-over')).toBe(true)
  expect(editor().getByText('SOUL.md가 3,000자를 넘었어요.').getAttribute('role')).toBe('status')
  fireEvent.change(docBody('SOUL.md'), { target: { value: '말수가 적다' } })
  expect(saveBar().queryByText(/3,000자 이하로 줄여 주세요/)).toBeNull()
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(false)
  pickDoc('IDENTITY.md') // 카드 본문인 IDENTITY.md도 같은 방식으로 막는다
  fireEvent.change(docBody('IDENTITY.md'), { target: { value: '가'.repeat(3001) } })
  expect(docNames()[0]).toBe('IDENTITY.md 3,000자 초과')
  expect(saveBar().getByRole('button', { name: '‘가람’: IDENTITY.md는 3,000자 이하로 줄여 주세요.' })).toBeTruthy()
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(true)
})

it('설정집 게시판은 IDENTITY.md·SOUL.md·GOAL.md 중 빈 문서가 있는 인물 줄에 정리 필요를 보이고, 저장은 막지 않는다', async () => {
  const filled = { soul: '성격', goal: '목표' }
  const { saveStudio } = await show([person('가람', '본문'), withDocs(person('나래', '본문'), filled), withDocs(person('다온'), filled), place('항구')])
  const flagged = () => boardTable().getAllByRole('row').slice(1).map((row) => [row.querySelector('.col-title button')?.textContent, within(row).queryByText('정리 필요') !== null])
  expect(flagged()).toEqual([['가람', true], ['나래', false], ['다온', true], ['항구', false]]) // 다온은 본문(IDENTITY.md)이 비었고, 인물이 아닌 설정은 알리지 않는다
  openCard('가람 인물')
  pickDoc('SOUL.md 정리 필요')
  fireEvent.change(docBody('SOUL.md'), { target: { value: '성격' } })
  backToBoard()
  expect(flagged()[0]).toEqual(['가람', true]) // GOAL.md가 아직 비어 있다
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(false) // 알리기만 하고 막지 않는다
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  openCard('가람 인물')
  pickDoc('GOAL.md 정리 필요')
  fireEvent.change(docBody('GOAL.md'), { target: { value: '목표' } })
  backToBoard()
  expect(flagged()[0]).toEqual(['가람', false])
})

it('인물이 아닌 유형으로 바꾸면 문서 목록 대신 설명 편집기가 나오고 문서를 저장하지 않는다고 알리며, 인물로 되돌리면 문서가 그대로다', async () => {
  await show([withDocs(person('가람', '기존 내용'), { soul: '말수가 적다' }), place('항구')])
  openCard('가람 인물')
  const type = () => editor().getByRole('combobox', { name: '유형' })
  const dropped = /인물이 아닌 설정에는 SOUL\.md·GOAL\.md·회차별 기억을 저장하지 않아요/
  expect(editor().queryByText(dropped)).toBeNull()
  fireEvent.change(type(), { target: { value: 'location' } })
  expect(editor().queryByRole('region', { name: '인물 문서' })).toBeNull()
  expect(editor().getByRole<HTMLTextAreaElement>('textbox', { name: '설명' }).value).toBe('기존 내용') // 본문(IDENTITY.md)은 설명으로 남는다
  expect(editor().getByText(dropped)).toBeTruthy()
  fireEvent.change(type(), { target: { value: 'character' } })
  expect(editor().queryByText(dropped)).toBeNull()
  pickDoc('SOUL.md')
  expect(docBody('SOUL.md').value).toBe('말수가 적다')
  fireEvent.click(rail().getByRole('button', { name: '항구 장소' })) // 문서가 없는 설정에는 알림이 없다
  expect(editor().queryByText(dropped)).toBeNull()
})

it('다른 인물 카드를 열면 그 카드의 IDENTITY.md부터 다시 보이고 문서는 카드마다 따로다', async () => {
  await show([withDocs(person('가람', '가람 본문'), { soul: '가람의 성격' }), withDocs(person('나래', '나래 본문'), { soul: '나래의 성격', episodes: { 1: '나래의 기억' } })])
  openCard('나래 인물')
  pickDoc('01회차.md')
  fireEvent.click(rail().getByRole('button', { name: '가람 인물' }))
  expect(currentDoc()).toEqual(['IDENTITY.md']) // 가람에는 1회차 기억이 없다
  expect(docBody('IDENTITY.md').value).toBe('가람 본문')
  pickDoc('SOUL.md')
  expect(docBody('SOUL.md').value).toBe('가람의 성격')
  fireEvent.click(rail().getByRole('button', { name: '나래 인물' }))
  expect(currentDoc()).toEqual(['IDENTITY.md']) // 다른 카드에서 고른 문서를 따라가지 않는다
  expect(docBody('IDENTITY.md').value).toBe('나래 본문')
})

// ── 인물 문서 편집 영역 UX(critique P1): 탭 재배치·라벨·공개 표시, 회차 기억 펼침, 더보기 메뉴, 카드 삭제 라벨 ─────────────────────
it('문서 탭은 작가의 말(정체성·성격·말투·목표·회차 기억)이 주 라벨이고 파일 이름이 작은 보조 글씨이며, 공개 여부를 탭이 알린다', async () => {
  await show([person('가람', '기존 내용')])
  openCard('가람 인물')
  const tab = (name: string) => docList().getByRole<HTMLButtonElement>('button', { name })
  const identity = tab('정체성 IDENTITY.md 공개')
  const soul = tab('성격·말투 SOUL.md 작가만 정리 필요') // 정리 필요는 지금처럼 탭 안의 글자다
  const goal = tab('목표 GOAL.md 작가만 정리 필요')
  const tabs = [identity, soul, goal]
  expect(tabs.map((b) => b.querySelector('.world-doc-name')?.textContent)).toEqual(['정체성', '성격·말투', '목표'])
  expect(tabs.map((b) => b.querySelector('small.world-doc-file')?.textContent)).toEqual(['IDENTITY.md', 'SOUL.md', 'GOAL.md']) // 파일 이름은 보조 글씨
  expect(tabs.map((b) => b.querySelector('small.world-doc-scope')?.textContent)).toEqual(['공개', '작가만', '작가만']) // 공개 세계관·독자 설정 위키에 나가는 글은 IDENTITY.md뿐이다
  expect(memoryToggle().textContent).toContain('회차 기억 (0)')
  expect(memoryToggle().querySelector('.world-doc-scope')?.textContent).toBe('작가만')
  expect(docsPanel().queryByText(/공개 세계관과 독자 설정 위키에 나가는 글은/)).toBeNull() // 문장 대신 탭이 알린다
  fireEvent.change(docBody('IDENTITY.md'), { target: { value: '가'.repeat(3001) } })
  expect(tab('정체성 IDENTITY.md 공개 3,000자 초과')).toBeTruthy() // 3,000자 초과도 탭 안의 글자다
})

it('문서 탭 줄은 편집기 바로 위에 붙고, 그 사이에는 문서 안내 한 줄만 있다', async () => {
  await show([person('가람', '기존 내용')])
  openCard('가람 인물')
  const nav = docsPanel().getByRole('navigation', { name: '인물 문서 목록' })
  const guide = nav.nextElementSibling
  expect(guide?.textContent).toBe('IDENTITY.md 누구인가: 이름·나이·소속·외형·역할.') // 탭 줄 바로 다음이 문서 안내
  expect(guide?.nextElementSibling?.classList.contains('world-card-editor')).toBe(true) // 그다음이 편집기
  openMemory() // 회차 기억을 펼쳐도 그 안은 탭 줄 안이라 편집기와의 사이는 그대로다
  expect(nav.nextElementSibling).toBe(guide)
  expect(nav.contains(episodeField())).toBe(true)
})

it('회차 기억 (N)은 접혀 있다가 펼치면 회차 문서 목록과 회차 번호·추가가 보이고, 추가하면 그 회차가 선택돼 탭 줄에도 이름이 남는다', async () => {
  await show([withDocs(person('가람', '기존 내용'), { episodes: { 3: '스승을 잃었다' } })])
  openCard('가람 인물')
  expect(memoryToggle().textContent).toContain('회차 기억 (1)')
  expect(memoryToggle().getAttribute('aria-expanded')).toBe('false')
  expect(docsPanel().queryByRole('textbox', { name: '회차 번호' })).toBeNull() // 접혀 있으면 목록도 추가 폼도 없다
  expect(docsPanel().queryByRole('button', { name: '03회차.md' })).toBeNull()
  fireEvent.click(memoryToggle())
  expect(memoryToggle().getAttribute('aria-expanded')).toBe('true')
  expect(episodeDocs().getAllByRole('button').map((b) => b.textContent)).toEqual(['03회차.md'])
  expect(episodeField().labels?.[0]?.textContent).toContain('회차 번호') // 보이는 라벨이 있다
  expect(docsPanel().getByRole('button', { name: '회차 기억 추가' }).textContent).toBe('추가')
  expect(docsPanel().getByText('0회차는 이야기 시작 전부터 아는 것(비밀·과거)이에요.')).toBeTruthy()
  addEpisode('12')
  expect(currentDoc()).toEqual(['12회차.md']) // 그 회차의 탭이 선택으로 보이고
  expect(docBody('memory/12회차.md')).toBeTruthy()
  expect(memoryToggle().getAttribute('aria-expanded')).toBe('true') // 펼침은 열린 채 유지된다
  expect(memoryToggle().textContent).toContain('회차 기억 (2)')
  expect(memoryToggle().textContent).toContain('12회차.md') // 접어도 알 수 있게 탭 줄에 지금 편집 중인 회차 이름이 있다
  expect(memoryToggle().dataset.current).toBe('true')
  fireEvent.click(memoryToggle())
  expect(docsPanel().queryByRole('button', { name: '12회차.md' })).toBeNull()
  expect(memoryToggle().textContent).toContain('12회차.md')
  pickDoc('IDENTITY.md')
  expect(memoryToggle().textContent).not.toContain('12회차.md')
  expect(memoryToggle().dataset.current).toBeUndefined()
})

it('0회차 문서를 고르면 이야기 시작 전부터 아는 것이라는 안내는 문서 안내 한 줄에만 있고 추가 폼 아래에서 되풀이하지 않는다', async () => {
  await show()
  openCard('가람 인물')
  openMemory()
  expect(docsPanel().getAllByText(/이야기 시작 전부터 아는 것/)).toHaveLength(1) // 0회차를 아직 고르지 않았으면 추가 폼 아래 안내 하나
  addEpisode('0')
  expect(currentDoc()).toEqual(['00회차.md'])
  const notes = docsPanel().getAllByText(/이야기 시작 전부터 아는 것/)
  expect(notes).toHaveLength(1)
  expect(notes[0].classList.contains('world-doc-guide')).toBe(true) // 편집기 위의 문서 안내 한 줄이 남는다
  addEpisode('4')
  expect(docsPanel().getAllByText(/이야기 시작 전부터 아는 것/)).toHaveLength(1) // 다른 회차를 고르면 추가 폼 아래 안내가 돌아온다
  expect(docsPanel().getByText('0회차는 이야기 시작 전부터 아는 것(비밀·과거)이에요.')).toBeTruthy()
})

it('.md 파일 불러오기는 인물 문서 제목 줄 오른쪽 ⋯(인물 문서 더보기) 메뉴 안에 있고, 불러오면 메뉴가 닫혀 결과 문구를 가리지 않는다', async () => {
  await show([person('가람')])
  openCard('가람 인물')
  const more = docsPanel().getByLabelText('인물 문서 더보기')
  const menu = more.closest('details')!
  expect(more.tagName).toBe('SUMMARY')
  expect(more.textContent).toBe('⋯')
  expect(menu.previousElementSibling?.textContent).toBe('인물 문서') // 제목 줄의 오른쪽
  expect(menu.contains(docsPanel().getByLabelText('.md 파일 불러오기'))).toBe(true)
  expect(docsPanel().getByLabelText<HTMLInputElement>('.md 파일 불러오기').closest('.ep-file-pick')).toBeTruthy() // 키보드로 닿는 기존 파일 선택 방식 그대로
  expect(menu.open).toBe(false)
  menu.open = true
  loadFiles(md('SOUL.md', '말수가 적다'))
  expect((await docsPanel().findByRole('status')).textContent).toContain('문서 1개를 불러왔어요: SOUL.md.')
  expect(menu.open).toBe(false)
})

it('⋯(인물 문서 더보기) 메뉴는 메뉴 밖을 누르거나 밖으로 초점이 가거나 Esc를 누르면 닫혀, 열린 채 뒤의 탭을 덮지 않는다', async () => {
  await show([person('가람')])
  openCard('가람 인물')
  const more = docsPanel().getByLabelText('인물 문서 더보기')
  const menu = more.closest('details')!
  menu.open = true
  fireEvent.pointerDown(docsPanel().getByLabelText('.md 파일 불러오기'))
  expect(menu.open).toBe(true) // 메뉴 안을 누르는 것은 닫지 않는다
  fireEvent.pointerDown(docButton('SOUL.md 정리 필요')) // 탭을 바꾸러 밖을 누르면
  expect(menu.open).toBe(false)
  menu.open = true
  act(() => docButton('GOAL.md 정리 필요').focus()) // Tab으로 밖에 초점이 가도
  expect(menu.open).toBe(false)
  menu.open = true
  fireEvent.keyDown(docsPanel().getByLabelText('.md 파일 불러오기'), { key: 'Escape' }) // Esc는 닫고 초점을 ⋯로 돌려준다
  expect(menu.open).toBe(false)
  expect(document.activeElement).toBe(more)
})

it('하단 바의 삭제 버튼은 카드 삭제라고 적혀 있어, 문서 글자 수 옆에서 그 문서만 지우는 것으로 읽히지 않는다', async () => {
  await show([person('가람', '기존 내용')])
  openCard('가람 인물')
  const remove = editor().getByRole('button', { name: '카드 삭제' })
  expect(remove.closest('footer')?.textContent).toContain('IDENTITY.md') // 글자 수 줄 옆의 버튼이다
  expect(editor().queryByRole('button', { name: '삭제' })).toBeNull() // 확인창·동작은 그대로라 위의 삭제 테스트들이 '카드 삭제'로 확인한다
})

// ── 설정집 AI 검토(#394): 시트의 설정집 검토 요청 · 게시판 상태 칸 · 편집 화면의 지적과 수정안 ─────────────────────────────────────
const finding = (cardIds: string[], over: Partial<ReviewFinding> = {}): ReviewFinding => ({ cardIds, kind: 'contradiction', message: `${cardIds.length}장에 걸친 지적이에요.`, ...over })
const reviewOf = (findings: ReviewFinding[], over: Partial<WorldReview> = {}): WorldReview => ({ reviewedCards: 3, totalCards: 3, findings, ...over })
/** 검토 요청 대역. 호출은 (세계관 id, 취소 신호)로 기록되고 결과는 만든 쪽이 정한다(약속을 주면 끝나는 때도 정한다). */
const reviewing = (result: WorldReview | Error | Promise<WorldReview> = reviewOf([])) => {
  const review = vi.fn(async (_world: string, _signal?: AbortSignal): Promise<WorldReview> => {
    if (result instanceof Error) throw result
    return result
  })
  reviewCase = new WorldReviewUseCase({ review })
  return review
}
const objectCard = (title: string): StudioSetting => {
  const row = newSetting()
  row.item.kind = 'entity'
  row.item.entityType = 'object'
  row.item.title = title
  row.item.text = `${title}은 오래된 물건이다`
  return row
}
const aiSheet = () => within(screen.getByRole('dialog', { name: 'AI 검토' }))
const askSection = () => within(aiSheet().getByRole('region', { name: '설정집 검토' }))
const agree = (ask = askSection()) => fireEvent.click(ask.getByRole('checkbox', { name: /OpenAI로 보내고/ }))
const SUMMARY = /^AI 의견 \d+건 · 카드 \d+장 · \d{2}:\d{2} 검토$/
/** 시트를 열어 동의하고 설정집 검토를 요청한 뒤 결과 요약이 나오면 시트를 닫는다(게시판·편집 화면의 상태 칸을 보려는 테스트가 쓴다). */
async function runReview() {
  fireEvent.click(screen.getByRole('button', { name: /^AI 검토/ }))
  const ask = askSection()
  agree(ask)
  fireEvent.click(ask.getByRole('button', { name: '설정집 검토 요청' }))
  await ask.findByText(SUMMARY)
  fireEvent.click(aiSheet().getByRole('button', { name: '닫기' }))
}
const rowOf = (title: string) => boardTable().getAllByRole('row').find((row) => row.querySelector('.col-title button')?.textContent === title)!
const titles = () => boardTable().getAllByRole('row').slice(1).map((row) => row.querySelector('.col-title button')?.textContent)
/** 한 줄의 보완 상태 칸(정리 필요·연결 필요·AI 의견 N) */
const todos = (title: string) => Array.from(rowOf(title).querySelectorAll('.world-todo'), (badge) => badge.textContent)
const cats = () => within(screen.getByRole('navigation', { name: '설정 분류' }))
const findings = () => within(editor().getByRole('region', { name: 'AI 검토 의견' }))

it('AI 검토 시트는 맨 위에 설정집 검토 절을 두고 그 아래에 기존 AI 후보 검토 절을 둔다', async () => {
  await showWorld()
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  const ask = aiSheet().getByRole('region', { name: '설정집 검토' })
  const candidates = aiSheet().getByRole('region', { name: 'AI 후보 검토' })
  expect(ask.compareDocumentPosition(candidates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(ask).getByRole('heading', { name: '설정집 검토' })).toBeTruthy()
  expect(within(ask).getByRole<HTMLButtonElement>('button', { name: '설정집 검토 요청' }).disabled).toBe(true) // 동의 전에는 보낼 수 없다
})

it('동의에 체크하고 설정집 검토를 요청하면 진행을 알리고, 끝나면 의견·카드 수·시각 요약과 버튼 이름의 의견 수가 보인다', async () => {
  const garam = person('가람', '기존 내용')
  await show([garam])
  let finish!: (review: WorldReview) => void
  const review = reviewing(new Promise<WorldReview>((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  const ask = askSection()
  const send = ask.getByRole<HTMLButtonElement>('button', { name: '설정집 검토 요청' })
  fireEvent.click(send)
  expect(review).not.toHaveBeenCalled() // 동의 전에는 요청하지 않는다
  agree(ask)
  expect(send.disabled).toBe(false)
  fireEvent.click(send)
  expect(review).toHaveBeenCalledOnce()
  expect(review.mock.calls[0][0]).toBe('qa')
  expect((await ask.findByText(/AI가 설정집을 검토하고 있어요/)).getAttribute('role')).toBe('status')
  expect(ask.getByRole<HTMLButtonElement>('button', { name: '설정집 검토 요청' }).disabled).toBe(true) // 진행 중에는 다시 보내지 않는다
  await act(async () => finish(reviewOf([finding([garam.item.id]), finding([garam.item.id])], { reviewedCards: 1, totalCards: 1 })))
  const summary = await ask.findByText(SUMMARY)
  expect(summary.textContent).toMatch(/^AI 의견 2건 · 카드 1장 · /)
  await waitFor(() => expect(document.activeElement).toBe(summary)) // 잠겼다 풀린 버튼 대신 결과 문장으로 초점이 간다
  expect(ask.queryByText(/AI가 설정집을 검토하고 있어요/)).toBeNull()
  expect(ask.getByRole('button', { name: '다시 검토 요청' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'AI 검토 · 의견 2' })).toBeTruthy()
})

it('전체 카드보다 적게 검토했으면 그 사실을, 지적이 없으면 없다는 것을 요약 아래에 알린다', async () => {
  await showWorld()
  reviewing(reviewOf([], { reviewedCards: 300, totalCards: 412 }))
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  const ask = askSection()
  agree(ask)
  fireEvent.click(ask.getByRole('button', { name: '설정집 검토 요청' }))
  expect((await ask.findByText(SUMMARY)).textContent).toMatch(/^AI 의견 0건 · 카드 300장 · /)
  expect(ask.getByText('카드 412장 중 300장만 검토했어요. 한 번에 보낼 수 있는 분량을 넘은 카드는 검토하지 못했어요.')).toBeTruthy()
  expect(ask.getByText('지적한 문제가 없어요.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'AI 검토' })).toBeTruthy() // 의견이 0건이면 버튼 이름에 수를 붙이지 않는다
})

it('요청이 실패하면 서버 문구를 시트 안 알림으로 남기고 다시 시도로 같은 요청을 다시 보낸다(성공·빈 결과로 바꾸지 않는다)', async () => {
  await showWorld()
  const review = reviewing(new Error('AI 응답이 늦어져 검토하지 못했어요.'))
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  const ask = askSection()
  agree(ask)
  fireEvent.click(ask.getByRole('button', { name: '설정집 검토 요청' }))
  const failure = await ask.findByRole('alert')
  expect(failure.textContent).toBe('AI 응답이 늦어져 검토하지 못했어요.')
  await waitFor(() => expect(document.activeElement).toBe(failure))
  expect(ask.queryByText(SUMMARY)).toBeNull()
  expect(ask.queryByRole('button', { name: '설정집 검토 요청' })).toBeNull() // 실패 뒤에는 다시 시도가 그 자리다
  review.mockResolvedValueOnce(reviewOf([]))
  fireEvent.click(ask.getByRole('button', { name: '다시 시도' }))
  expect((await ask.findByText(SUMMARY)).textContent).toMatch(/^AI 의견 0건/)
  expect(ask.queryByRole('alert')).toBeNull()
  expect(review).toHaveBeenCalledTimes(2)
})

it('이미 결과가 있는 뒤의 다시 요청이 실패하면 이전 요약은 숨기고 실패만 알리며, 다시 시도가 성공하면 새 요약이 보인다', async () => {
  await showWorld()
  const review = reviewing(reviewOf([]))
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  const ask = askSection()
  agree(ask)
  fireEvent.click(ask.getByRole('button', { name: '설정집 검토 요청' }))
  await ask.findByText(SUMMARY)
  review.mockRejectedValueOnce(new Error('AI 응답을 확인하지 못했어요.'))
  fireEvent.click(ask.getByRole('button', { name: '다시 검토 요청' }))
  expect((await ask.findByRole('alert')).textContent).toBe('AI 응답을 확인하지 못했어요.')
  expect(ask.queryByText(SUMMARY)).toBeNull() // 이전 결과 문장과 실패 문장이 함께 남지 않는다
  fireEvent.click(ask.getByRole('button', { name: '다시 시도' }))
  expect(await ask.findByText(SUMMARY)).toBeTruthy()
  expect(ask.queryByRole('alert')).toBeNull()
})

it('저장하지 않은 변경이 있으면 이유와 함께 검토 요청을 잠그고, 저장하면 풀린다', async () => {
  const { saveStudio } = await show([person('가람', '기존 내용')])
  const review = reviewing()
  openCard('가람 인물')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '고친 이름' } })
  backToBoard()
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  let ask = askSection()
  agree(ask)
  const send = () => ask.getByRole<HTMLButtonElement>('button', { name: '설정집 검토 요청' })
  expect(send().disabled).toBe(true)
  const reason = ask.getByText(/저장하지 않은 변경이 있어요/)
  expect(send().getAttribute('aria-describedby')).toBe(reason.id) // 서버는 저장한 초안을 검토하므로 먼저 저장하게 한다
  fireEvent.click(send())
  expect(review).not.toHaveBeenCalled()
  fireEvent.click(aiSheet().getByRole('button', { name: '닫기' }))
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  await waitFor(() => expect(saveBar().getByText('저장됨')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  ask = askSection()
  expect(ask.queryByText(/저장하지 않은 변경이 있어요/)).toBeNull()
  expect(send().disabled).toBe(false) // 동의는 그대로 남아 있다
})

it('데모(서버 기능 없음)에서는 설정집 검토를 지원하지 않는다고 알리고 요청을 잠근다', async () => {
  reviewCase = null
  await showWorld()
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' }))
  const ask = askSection()
  expect(ask.getByText('데모에서는 지원하지 않아요.')).toBeTruthy()
  expect(ask.getByRole<HTMLButtonElement>('button', { name: '설정집 검토 요청' }).disabled).toBe(true)
  expect(ask.getByRole<HTMLInputElement>('checkbox', { name: /OpenAI로 보내고/ }).disabled).toBe(true)
})

it('설정집 게시판은 사건·사물 카드가 인물과 승인된 관계로 이어지지 않으면 연결 필요를 보이고, 관계를 이으면 사라진다', async () => {
  const garam = withDocs(person('가람', '본문'), { soul: '성격', goal: '목표' })
  const [war, sword, harbor] = [eventCard('전쟁'), objectCard('성검'), place('항구')]
  const settings = putRelation([garam, war, sword, harbor], { subjectId: garam.item.id, targetId: sword.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '쥐고 있다' })
  await show(settings)
  expect(titles()).toEqual(['가람', '항구', '전쟁', '성검'])
  expect(['가람', '항구', '전쟁', '성검'].map(todos)).toEqual([[], [], ['연결 필요'], []]) // 사건 전쟁만 인물과 이어지지 않았다. 장소는 대상이 아니다
})

it('설정이 있는 세계관에서 카드가 없는 분류는 분류 메뉴에 비어 있음으로 남고, 설정이 하나도 없으면 시작 안내만 있다', async () => {
  const filled = { soul: '성격', goal: '목표' }
  await show([withDocs(person('가람', '본문'), filled), place('항구')])
  expect(cats().getAllByRole('listitem').map((item) => item.textContent)).toEqual(['전체 2', '인물 1', '장소 1', '조직 비어 있음', '규칙 비어 있음', '사건 비어 있음', '기타 비어 있음'])
  expect(cats().queryByRole('button', { name: /비어 있음/ })).toBeNull() // 비어 있는 분류는 누를 대상이 아니다
  cleanup()
  await show([])
  expect(cats().getAllByRole('listitem').map((item) => item.textContent)).toEqual(['전체 0'])
  expect(boardTable().getByText('설정을 추가해 시작해 보세요.')).toBeTruthy()
})

it('AI 의견 N은 카드 줄에 붙고 누르면 그 카드의 편집 화면이 열리며, 보완 필요 분류는 상태가 있는 카드만 보인다', async () => {
  const filled = { soul: '성격', goal: '목표' }
  const [garam, harbor, tower] = [withDocs(person('가람', '본문'), filled), place('항구'), place('탑')]
  await show([garam, harbor, tower])
  expect(cats().queryByRole('button', { name: /보완 필요/ })).toBeNull() // 보완할 카드가 없으면 분류도 없다
  reviewing(reviewOf([finding([harbor.item.id]), finding([harbor.item.id, garam.item.id])]))
  await runReview()
  expect(['가람', '항구', '탑'].map(todos)).toEqual([['AI 의견 1'], ['AI 의견 2'], []])
  expect(within(rowOf('항구')).getByRole('button', { name: '항구 AI 의견 2건 보기' }).textContent).toBe('AI 의견 2')
  fireEvent.click(cats().getByRole('button', { name: '보완 필요 2' }))
  expect(titles()).toEqual(['가람', '항구'])
  expect(cats().getByRole('button', { name: '보완 필요 2' }).getAttribute('aria-current')).toBe('true')
  expect(cats().getByRole('button', { name: /^전체/ }).getAttribute('aria-current')).toBeNull()
  fireEvent.click(cats().getByRole('button', { name: /^장소/ }))
  expect(titles()).toEqual(['항구', '탑'])
  expect(cats().getByRole('button', { name: '보완 필요 2' }).getAttribute('aria-current')).toBeNull() // 분류를 고르면 보완 필요는 풀린다
  fireEvent.click(within(rowOf('항구')).getByRole('button', { name: '항구 AI 의견 2건 보기' }))
  expect(where()).toMatch(/card=/)
  expect(editor().getByRole('textbox', { name: '설정 이름' })).toHaveProperty('value', '항구')
  expect(findings().getAllByRole('listitem')).toHaveLength(2)
})

it('정리 필요·연결 필요·AI 의견은 한 줄에 함께 보이고 보완 필요 분류가 셋 모두를 센다', async () => {
  const [garam, war] = [person('가람', '본문'), eventCard('전쟁')] // 가람은 SOUL·GOAL이 비어 정리 필요, 전쟁은 연결 필요
  await show([garam, war])
  expect(['가람', '전쟁'].map(todos)).toEqual([['정리 필요'], ['연결 필요']])
  reviewing(reviewOf([finding([war.item.id])]))
  await runReview()
  expect(['가람', '전쟁'].map(todos)).toEqual([['정리 필요'], ['연결 필요', 'AI 의견 1']])
  expect(cats().getByRole('button', { name: '보완 필요 2' })).toBeTruthy()
})

it('수정안 보기는 지금 글과 바꿀 글을 나란히 보이고, 초안에 반영은 그 카드의 그 칸만 바꿔 저장하지 않은 변경이 되며 저장하면 서버로 간다', async () => {
  const garam = withDocs(person('가람', '기존 내용'), { soul: '말수가 적다', goal: '스승을 찾는다' })
  const { saveStudio } = await show([garam, place('항구')])
  reviewing(reviewOf([finding([garam.item.id], { kind: 'doc_role', message: 'SOUL.md에 목표가 섞여 있어요.', fix: { cardId: garam.item.id, target: 'soul', text: '말수가 적고 신중하다' } })]))
  await runReview()
  openCard('가람 인물')
  const panel = findings()
  expect(panel.getByText('SOUL.md에 목표가 섞여 있어요.')).toBeTruthy()
  expect(panel.getByText('인물 문서 역할')).toBeTruthy()
  expect(panel.getByText(/\d{2}:\d{2} 검토/)).toBeTruthy()
  expect(panel.queryByRole('region', { name: '바꿀 글' })).toBeNull()
  const show1 = panel.getByRole('button', { name: '수정안 보기' })
  expect(show1.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(show1)
  expect(within(panel.getByRole('region', { name: '지금 글' })).getByText('말수가 적다')).toBeTruthy()
  expect(within(panel.getByRole('region', { name: '바꿀 글' })).getByText('말수가 적고 신중하다')).toBeTruthy()
  expect(panel.getByText(/SOUL\.md/, { selector: '.world-finding-field' })).toBeTruthy()
  expect(saveBar().getByText('저장됨')).toBeTruthy()
  fireEvent.click(panel.getByRole('button', { name: '초안에 반영' }))
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  expect(panel.getByText('반영함')).toBeTruthy()
  expect(panel.queryByRole('button', { name: '초안에 반영' })).toBeNull()
  await waitFor(() => expect(document.activeElement?.textContent).toMatch(/^반영함/)) // 누른 버튼이 사라지므로 초점은 결과 문장으로 간다
  pickDoc('SOUL.md')
  expect(docBody('SOUL.md').value).toBe('말수가 적고 신중하다')
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings[0]).toMatchObject({ item: { text: '기존 내용' }, characterDocs: { soul: '말수가 적고 신중하다', goal: '스승을 찾는다' } })
  expect(saveStudio.mock.calls[0][0].settings[1].item.text).toBe('')
})

it('본문 수정안은 지금 열린 편집기에도 바로 보인다', async () => {
  const harbor = place('항구')
  await show([harbor])
  reviewing(reviewOf([finding([harbor.item.id], { kind: 'missing_info', message: '항구의 위치가 빠졌어요.', fix: { cardId: harbor.item.id, target: 'body', text: '바다에 면한 큰 항구' } })]))
  await runReview()
  openCard('항구 장소')
  const before = editor().getByRole<HTMLTextAreaElement>('textbox', { name: '설명' })
  expect(before.value).toBe('')
  fireEvent.click(findings().getByRole('button', { name: '수정안 보기' }))
  fireEvent.click(findings().getByRole('button', { name: '초안에 반영' }))
  const after = editor().getByRole<HTMLTextAreaElement>('textbox', { name: '설명' })
  expect(after.value).toBe('바다에 면한 큰 항구')
  expect(after).not.toBe(before) // 진짜 편집기(Toast)는 처음 값만 읽으므로 새로 만들어야 보인다(대역 textarea는 defaultValue를 따라가 가려진다)
})

it('반영하지 않기는 초안을 바꾸지 않고 그 지적을 반영하지 않음으로 남긴다', async () => {
  const garam = withDocs(person('가람', '기존 내용'), { soul: '성격', goal: '목표' })
  await show([garam])
  reviewing(reviewOf([finding([garam.item.id], { fix: { cardId: garam.item.id, target: 'goal', text: '새 목표' } })]))
  await runReview()
  openCard('가람 인물')
  fireEvent.click(findings().getByRole('button', { name: '수정안 보기' }))
  fireEvent.click(findings().getByRole('button', { name: '반영하지 않기' }))
  expect(findings().getByText('반영하지 않음')).toBeTruthy()
  await waitFor(() => expect(document.activeElement?.textContent).toBe('반영하지 않음')) // 누른 버튼이 사라지므로 초점은 결과 문장으로 간다
  expect(findings().queryByRole('button', { name: '초안에 반영' })).toBeNull()
  expect(saveBar().getByText('저장됨')).toBeTruthy()
  expect(findings().getByText('1장에 걸친 지적이에요.')).toBeTruthy() // 지적 문장은 다음 검토 전까지 그대로 남는다
})

it('검토 뒤에 그 칸의 글이 바뀌었으면 검토 뒤 바뀐 설정이라 반영할 수 없다고 알리고 반영을 잠근다', async () => {
  const garam = withDocs(person('가람', '기존 내용'), { soul: '성격', goal: '목표' })
  await show([garam])
  reviewing(reviewOf([finding([garam.item.id], { fix: { cardId: garam.item.id, target: 'body', text: '수정안 본문' } })]))
  await runReview()
  openCard('가람 인물')
  fireEvent.change(docBody('IDENTITY.md'), { target: { value: '내가 그 뒤에 고친 본문' } })
  fireEvent.click(findings().getByRole('button', { name: '수정안 보기' }))
  const apply = findings().getByRole<HTMLButtonElement>('button', { name: '초안에 반영' })
  expect(apply.disabled).toBe(true)
  const reason = findings().getByText('검토 뒤 바뀐 설정이라 반영할 수 없어요')
  expect(apply.getAttribute('aria-describedby')).toBe(reason.id)
  expect(within(findings().getByRole('region', { name: '지금 글' })).getByText('내가 그 뒤에 고친 본문')).toBeTruthy()
  fireEvent.click(apply)
  expect(docBody('IDENTITY.md').value).toBe('내가 그 뒤에 고친 본문') // 덮어쓰지 않는다
  expect(findings().queryByText('반영함')).toBeNull()
  expect(findings().getByRole('button', { name: '반영하지 않기' })).toBeTruthy() // 잠겨도 접을 수는 있다
})

it('여러 카드를 가리킨 지적은 각 카드에 보이고, 수정안은 그 칸이 있는 카드에서만 반영한다', async () => {
  const filled = { soul: '성격', goal: '목표' }
  const [garam, harbor] = [withDocs(person('가람', '본문'), filled), place('항구')]
  await show([garam, harbor])
  reviewing(reviewOf([finding([garam.item.id, harbor.item.id], { message: '가람의 행적과 항구의 설정이 어긋나요.', fix: { cardId: garam.item.id, target: 'goal', text: '새 목표' } })]))
  await runReview()
  openCard('항구 장소')
  expect(findings().getByText('가람의 행적과 항구의 설정이 어긋나요.')).toBeTruthy()
  expect(findings().queryByRole('button', { name: '수정안 보기' })).toBeNull()
  expect(findings().getByText(/수정안은 ‘가람’ 설정에서 반영할 수 있어요/)).toBeTruthy()
  fireEvent.click(findings().getByRole('button', { name: '가람' })) // 관련 설정으로 옮겨 간다
  expect(editor().getByRole('textbox', { name: '설정 이름' })).toHaveProperty('value', '가람')
  expect(findings().getByRole('button', { name: '수정안 보기' })).toBeTruthy()
  expect(findings().getByRole('button', { name: '항구' })).toBeTruthy()
})

it('지적이 없는 카드의 편집 화면에는 AI 검토 의견 절이 없다', async () => {
  const garam = withDocs(person('가람', '본문'), { soul: '성격', goal: '목표' })
  await show([garam, place('항구')])
  openCard('항구 장소')
  expect(screen.queryByRole('region', { name: 'AI 검토 의견' })).toBeNull() // 검토를 받기 전
  backToBoard()
  reviewing(reviewOf([finding([garam.item.id])]))
  await runReview()
  openCard('항구 장소')
  expect(screen.queryByRole('region', { name: 'AI 검토 의견' })).toBeNull() // 이 카드에는 지적이 없다
})

// ── 설정 카드 대표 이미지(#401): 편집 화면 제목 줄에서 올리고 바꾸고 빼며, 게시판·레일은 작은 썸네일(소유자 이미지는 인증 읽기 → 객체 주소) ───
const withImage = (row: StudioSetting, imageId = CARD_IMAGE): StudioSetting => ({ ...row, imageId })
const imageGroup = () => within(screen.getByRole('group', { name: '대표 이미지' }))
const imageInput = (label = '이미지 추가') => imageGroup().getByLabelText<HTMLInputElement>(label)
const pickImage = (file: File, label = '이미지 추가') => fireEvent.change(imageInput(label), { target: { files: [file] } })
const preview = () => document.querySelector<HTMLImageElement>('.world-card-tile img')
const thumbs = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLImageElement>('img.board-thumb'), (img) => img.getAttribute('src'))
const savedSettings = (saveStudio: ReturnType<typeof mount>['saveStudio']) => saveStudio.mock.calls[0][0].settings

it('이미지가 없는 카드는 제목 아래 줄에 이미지 추가만 두고 형식·크기를 안내하며, 이미지 첨부 미지원 문구는 없다', async () => {
  const { readCardImage } = await showWorld()
  openCard('가람 인물')
  const input = imageInput()
  expect([input.type, input.accept, input.disabled]).toEqual(['file', 'image/png,image/jpeg,image/webp', false])
  expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe('PNG·JPEG·WebP, 5 MiB 이하')
  expect(imageGroup().queryByRole('button', { name: '빼기' })).toBeNull()
  expect(imageGroup().queryByLabelText('바꾸기')).toBeNull()
  expect(preview()).toBeNull()
  expect(screen.queryByText('이미지 첨부는 이 화면에서 지원하지 않아요.')).toBeNull()
  expect(readCardImage).not.toHaveBeenCalled() // 이미지가 없는 카드는 읽지 않는다
  // 머리는 두 열이다: 이름 입력·유형 선택(+출처)이 한 열, 대표 이미지 타일이 오른쪽 열(CSS 격자가 .world-card-head를 두 열로 나눈다).
  const head = input.closest('.world-card-head')!
  expect(head.parentElement?.classList.contains('world-card-header')).toBe(true) // 좁은 배치가 머리 폭을 묻는 컨테이너
  expect(Array.from(head.children, (child) => child.className.split(' ')[0])).toEqual(['et', 'world-card-meta', 'world-card-image'])
  expect(head.querySelector('.world-card-meta select')).toBeTruthy()
  // 이미지가 없으면 타일 자체가 점선 빈 칸이고, 그 안이 파일 선택(이미지 추가)이며 안내도 타일 안에 있다.
  const tile = head.querySelector('.world-card-tile')!
  expect([tile.classList.contains('cov'), tile.classList.contains('empty')]).toEqual([true, true])
  expect(tile.contains(input)).toBe(true)
  expect(tile.contains(document.getElementById(input.getAttribute('aria-describedby') ?? ''))).toBe(true)
  expect(imageGroup().queryByRole('button')).toBeNull() // 바꾸기·빼기 같은 버튼 줄은 이미지가 있을 때만 있다
})

// #466: Chromium은 fieldset의 직접 자식 목록이 바뀌면(인물 ↔ 그 밖의 문서 구조·편집기 교체) 같은 fieldset 안의 컨테이너 쿼리 컨테이너(.world-card-header) 하위를 레이아웃에서 빼 머리가 0×0이 된다(카드를 하나 걸러 하나씩).
// jsdom은 레이아웃을 계산하지 못해 그 구조 계약을 본다: 편집 화면 fieldset의 직접 자식은 legend와 내용 래퍼 하나뿐이고, 카드를 옮기거나 유형을 바꿔도 같은 노드다.
it('편집 화면 fieldset의 직접 자식은 legend와 내용 래퍼 하나뿐이고 카드를 옮기거나 유형을 바꿔도 그대로다(머리 컨테이너 보호, #466)', async () => {
  await show([person('가람', '본문'), place('항구')])
  openCard('가람 인물')
  const fields = screen.getByRole('group', { name: '설정 카드 작성' })
  const children = () => Array.from(fields.children)
  const [legend, body] = children()
  expect([children().length, legend.tagName, body.tagName]).toEqual([2, 'LEGEND', 'DIV'])
  expect(body.querySelector('.world-card-header')).toBeTruthy() // 머리 컨테이너·편집기·공개 범위 모두 래퍼 안이다
  fireEvent.click(rail().getByRole('button', { name: '항구 장소' })) // 인물 → 장소: 인물 문서 탭 줄이 사라지고 편집기가 바뀐다
  expect(children()).toEqual([legend, body])
  fireEvent.change(editor().getByRole('combobox', { name: '유형' }), { target: { value: 'character' } }) // 같은 카드의 유형 변경(장소 → 인물)
  expect(children()).toEqual([legend, body])
})

it('파일을 고르면 곧바로 올리고(올리는 동안 알림·잠금) 올라가면 미리보기와 바꾸기·빼기가 나오며, 저장 전 수정이 되고 초점은 바꾸기로 간다', async () => {
  let finish!: (id: string) => void
  const uploadCardImage = vi.fn((_id: string, _file: File, _signal?: AbortSignal) => new Promise<string>((resolve) => { finish = resolve }))
  const { readCardImage, saveStudio } = await show(undefined, '/worldstudio/qa', { uploadCardImage })
  openCard('가람 인물')
  const file = png('portrait.png')
  pickImage(file)
  await waitFor(() => expect(uploadCardImage).toHaveBeenCalledWith('qa', file, expect.any(AbortSignal)))
  expect(imageGroup().getByRole('status').textContent).toBe('이미지를 올리고 있어요…')
  expect(imageInput().closest('fieldset')?.disabled).toBe(true) // 올리는 동안 같은 파일을 두 번 올리지 않는다(칸은 fieldset 잠금을 따른다)
  expect(editor().getByText('저장된 상태예요', { exact: false })).toBeTruthy() // 올리는 중에는 초안이 바뀌지 않았다
  await act(async () => finish(CARD_IMAGE))
  await waitFor(() => expect(preview()?.getAttribute('src')).toBe('blob:cover-1'))
  expect(readCardImage).toHaveBeenCalledOnce()
  expect(readCardImage).toHaveBeenCalledWith('qa', CARD_IMAGE, expect.any(AbortSignal))
  expect(preview()?.getAttribute('alt')).toBe('가람 이미지') // 편집 화면 타일 이미지는 카드 제목으로 읽힌다(썸네일과 달리 옆에 제목이 없다)
  expect(imageGroup().getByRole('img', { name: '가람 이미지' })).toBe(preview())
  // 이미지가 채워진 타일은 헤더 표지와 같은 .cov(3:4·둥근 모서리·그림자)이고 바꾸기·빼기는 그 아래에 놓인다.
  const tile = preview()!.closest('.world-card-tile')!
  expect([tile.classList.contains('cov'), tile.classList.contains('empty')]).toEqual([true, false])
  const actions = imageGroup().getByRole('button', { name: '빼기' }).closest('.world-card-image-actions')!
  expect(actions.contains(imageInput('바꾸기')) && !tile.contains(imageInput('바꾸기'))).toBe(true)
  expect(tile.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(imageGroup().queryByRole('status')).toBeNull()
  expect(imageGroup().queryByLabelText('이미지 추가')).toBeNull()
  expect(imageGroup().getByRole('button', { name: '빼기' })).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(imageInput('바꾸기'))) // 눌렀던 칸이 잠겼다 풀리므로 초점을 이어 준다
  expect(editor().getByText('저장 전 수정이 있어요', { exact: false })).toBeTruthy()
  expect(screen.getByText('이미지를 올렸어요. 세계관을 저장한 뒤 ‘확정 버전 남기기’를 해야 공개 화면에 나와요.').getAttribute('role')).toBe('status')
  expect(saveStudio).not.toHaveBeenCalled() // 올리는 것만으로 초안을 저장하지 않는다
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(savedSettings(saveStudio).map((s) => s.imageId)).toEqual([CARD_IMAGE])
})

it('이미 이미지가 있는 카드는 미리보기를 인증 읽기로 받고, 바꾸기로 새 이미지를 올리면 카드가 새 id를 가리키고 이전 이미지의 객체 주소를 해제한다', async () => {
  const uploadCardImage = vi.fn(async () => NEXT_IMAGE)
  const { readCardImage, saveStudio } = await show([withImage(person('가람', '기존 내용'))], '/worldstudio/qa', { uploadCardImage })
  openCard('가람 인물')
  await waitFor(() => expect(preview()?.getAttribute('src')).toBe('blob:cover-1'))
  expect(imageGroup().getByRole('button', { name: '빼기' })).toBeTruthy()
  expect(imageInput('바꾸기').disabled).toBe(false)
  expect(readCardImage).toHaveBeenCalledOnce() // 게시판·레일·편집 화면이 같은 이미지를 한 번만 읽는다
  expect(objectUrls.revokeObjectURL).not.toHaveBeenCalled()
  const file = png('new.png', 'image/webp')
  pickImage(file, '바꾸기')
  await waitFor(() => expect(uploadCardImage).toHaveBeenCalledWith('qa', file, expect.any(AbortSignal)))
  await waitFor(() => expect(preview()?.getAttribute('src')).toBe('blob:cover-2'))
  expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1')
  expect(readCardImage.mock.calls.map(([, image]) => image)).toEqual([CARD_IMAGE, NEXT_IMAGE])
  expect(editor().getByText('저장 전 수정이 있어요', { exact: false })).toBeTruthy()
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(savedSettings(saveStudio).map((s) => s.imageId)).toEqual([NEXT_IMAGE])
})

it('빼기는 서버를 부르지 않고 초안에서 이미지 연결만 지워 이미지 추가로 돌아가며, 이전 이미지의 객체 주소를 해제하고 저장 요청에는 이미지가 실리지 않는다', async () => {
  const { uploadCardImage, saveStudio } = await show([withImage(person('가람', '기존 내용'))])
  openCard('가람 인물')
  await waitFor(() => expect(preview()).toBeTruthy())
  fireEvent.click(imageGroup().getByRole('button', { name: '빼기' }))
  expect(preview()).toBeNull()
  expect(imageGroup().queryByRole('button', { name: '빼기' })).toBeNull()
  expect(imageInput().disabled).toBe(false)
  expect(document.activeElement).toBe(imageInput()) // 눌렀던 빼기 버튼이 사라지므로 같은 자리의 추가 칸으로 초점을 옮긴다
  expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1')
  expect(uploadCardImage).not.toHaveBeenCalled()
  expect(editor().getByText('저장 전 수정이 있어요', { exact: false })).toBeTruthy()
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(savedSettings(saveStudio).map((s) => s.imageId)).toEqual([undefined])
})

it('올리기가 실패하면 서버가 준 이유를 알리고 초안·미리보기는 그대로이며 같은 칸으로 다시 올릴 수 있다', async () => {
  const uploadCardImage = vi.fn().mockRejectedValueOnce(new Error('PNG·JPEG·WebP 이미지만 올릴 수 있어요.')).mockResolvedValueOnce(CARD_IMAGE)
  await show(undefined, '/worldstudio/qa', { uploadCardImage })
  openCard('가람 인물')
  pickImage(png('broken.png'))
  expect((await screen.findByRole('alert')).textContent).toBe('PNG·JPEG·WebP 이미지만 올릴 수 있어요.')
  expect(preview()).toBeNull()
  expect(imageInput().disabled).toBe(false)
  expect(editor().getByText('저장된 상태예요', { exact: false })).toBeTruthy() // 실패는 초안을 바꾸지 않는다
  pickImage(png('again.png'))
  await waitFor(() => expect(preview()?.getAttribute('src')).toBe('blob:cover-1'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(uploadCardImage).toHaveBeenCalledTimes(2)
})

it('형식·크기가 맞지 않는 파일은 서버로 보내기 전에 이유를 알리고 올리지 않는다', async () => {
  const { uploadCardImage } = await showWorld()
  openCard('가람 인물')
  pickImage(png('x.gif', 'image/gif'))
  expect((await screen.findByRole('alert')).textContent).toBe('PNG·JPEG·WebP 이미지만 올릴 수 있어요.')
  pickImage(png('big.png', 'image/png', 5 * 1024 * 1024 + 1))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('이미지는 5 MiB 이하여야 해요.'))
  expect(uploadCardImage).not.toHaveBeenCalled()
  expect(preview()).toBeNull()
})

it('이미지를 읽지 못하면 미리보기 자리에 이유를 알리되 바꾸기·빼기는 그대로 쓸 수 있다', async () => {
  const readCardImage = vi.fn(async () => { throw new Error('이미지를 찾을 수 없어요.') })
  await show([withImage(person('가람', '기존 내용'))], '/worldstudio/qa', { readCardImage })
  openCard('가람 인물')
  expect(await imageGroup().findByText('이미지를 찾을 수 없어요.')).toBeTruthy()
  expect(document.querySelector('.world-card-tile span.world-card-tile-wait')).toBeTruthy() // 깨진 그림 대신 타일 크기 그대로의 빈 자리
  expect(preview()).toBeNull()
  expect(imageGroup().getByRole('button', { name: '빼기' })).toBeTruthy()
  expect(imageInput('바꾸기').disabled).toBe(false)
})

it('화면을 떠나면 만든 이미지 객체 주소를 모두 해제한다', async () => {
  const { readCardImage } = await show([withImage(person('가람', '기존 내용'))])
  openCard('가람 인물')
  await waitFor(() => expect(preview()?.getAttribute('src')).toBe('blob:cover-1'))
  expect(readCardImage).toHaveBeenCalledOnce()
  cleanup()
  expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1')
})

it('게시판 줄과 편집 화면 레일은 이미지가 있는 카드만 빈 대체 글(alt="")의 작은 썸네일을 보이고 같은 이미지는 한 번만 읽는다', async () => {
  const { readCardImage } = await show([withImage(person('가람', '기존 내용')), person('나래')])
  await waitFor(() => expect(thumbs(screen.getByRole('table', { name: '설정 카드 목록' }))).toEqual(['blob:cover-1']))
  const rows = within(screen.getByRole('table', { name: '설정 카드 목록' })).getAllByRole('row').slice(1)
  expect(rows.map((row) => row.querySelectorAll('img.board-thumb').length)).toEqual([1, 0]) // 이미지 없는 카드는 비워 둔다
  expect(document.querySelector('.worlds-board-table img.board-thumb')?.getAttribute('alt')).toBe('')
  openCard('가람 인물')
  await waitFor(() => expect(thumbs(screen.getByRole('navigation', { name: '설정 카드 목록' }))).toEqual(['blob:cover-1']))
  expect(Array.from(screen.getByRole('navigation', { name: '설정 카드 목록' }).querySelectorAll('img.board-thumb'), (image) => image.getAttribute('alt'))).toEqual(['']) // 레일 썸네일도 빈 대체 글(제목이 옆에 있다)
  const railRows = Array.from(screen.getByRole('navigation', { name: '설정 카드 목록' }).querySelectorAll('.writing-episode-row'))
  expect(railRows.map((row) => row.querySelectorAll('img.board-thumb').length)).toEqual([1, 0])
  expect(readCardImage).toHaveBeenCalledOnce() // 게시판·레일·미리보기 세 곳이 한 번의 읽기를 나눠 쓴다
})

it('카드 이미지를 읽을 수 없는 데모(메모리)에서는 이미지 추가를 잠그고 지원하지 않는다고 알리며 아무것도 읽지 않는다', async () => {
  const { readCardImage, uploadCardImage } = await show(undefined, '/worldstudio/qa', { demoCardImage: true })
  openCard('가람 인물')
  expect(imageInput().disabled).toBe(true)
  const lock = imageGroup().getByText('데모에서는 이미지 업로드를 지원하지 않아요.')
  expect([lock.classList.contains('sr-only'), lock.closest('.world-card-tile')]).toEqual([false, null]) // 잠긴 이유는 좁은 타일 안이 아니라 타일 아래에 읽힌다
  expect(imageInput().closest('.world-card-tile')?.classList.contains('empty')).toBe(true) // 빈 타일은 그대로 두되 잠겨 있다
  expect(readCardImage).not.toHaveBeenCalled()
  expect(uploadCardImage).not.toHaveBeenCalled()
})

it('목업(mockup) 모드의 발표용 인물 초상은 그대로 보이고 이미지 추가는 잠겨 있다', async () => {
  vi.stubEnv('MODE', 'mockup')
  await show([person('홍길동', '의적')], '/worldstudio/qa', { demoCardImage: true })
  openCard('홍길동 인물')
  const portrait = imageGroup().getByRole('img', { name: '홍길동 인물 이미지' })
  const tile = portrait.closest('.world-card-tile')!
  expect([tile.classList.contains('cov'), tile.classList.contains('empty')]).toEqual([true, false]) // 초상도 같은 타일 자리를 채운다
  expect(imageInput().disabled).toBe(true)
  expect(tile.contains(imageInput())).toBe(false) // 잠긴 이미지 추가는 타일 아래 작은 버튼이고
  expect(imageGroup().getByText('데모에서는 이미지 업로드를 지원하지 않아요.').classList.contains('sr-only')).toBe(false) // 잠금 안내는 그대로 보인다
})

it('이미 이미지가 있는 카드의 안내는 화면에서는 숨기고 입력의 설명으로만 남기며, 이미지가 없을 때만 타일 안에 보인다', async () => {
  await show([withImage(person('가람', '기존 내용')), person('나래')])
  openCard('가람 인물')
  await waitFor(() => expect(preview()).toBeTruthy())
  const note = document.getElementById(imageInput('바꾸기').getAttribute('aria-describedby') ?? '')!
  expect([note.textContent, note.classList.contains('sr-only')]).toEqual(['PNG·JPEG·WebP, 5 MiB 이하', true])
  fireEvent.click(imageGroup().getByRole('button', { name: '빼기' }))
  const empty = document.getElementById(imageInput().getAttribute('aria-describedby') ?? '')!
  expect([empty.textContent, empty.classList.contains('sr-only'), !!empty.closest('.world-card-tile.empty')]).toEqual(['PNG·JPEG·WebP, 5 MiB 이하', false, true])
})
