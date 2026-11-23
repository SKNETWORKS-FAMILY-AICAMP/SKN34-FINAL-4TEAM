// @vitest-environment jsdom
import { clickLink, clickNode, fakeGraph, hoverLink, rightClickNode } from '../../../../test/forceGraphFake'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { cardLinkMarkdown } from '../../../../domain/entities/cardLinks'
import { createAppStore } from '../../../../app/store'
import { InMemoryGenreRepository, InMemoryOperationsGenreRepository } from '../../../../data/mock/InMemoryGenreRepositories'
import type { Work } from '../../../../domain/entities/content'
import type { Work as ReadingWork } from '../../../../domain/entities/work'
import type { PublicWorld, PublicWorldSummary } from '../../../../domain/entities/publicWorld'
import { putRelation, relationLabel } from '../../../../domain/entities/studioRelations'
import type { ReviewBasis, ReviewFinding, WorldReview } from '../../../../domain/entities/worldReview'
import { type CharacterDocs, newSetting, type StudioSetting, type StudioWorld, type WorldPublication, type WorldPublicationInput, type WorldRevision, type WorldRevisionSummary } from '../../../../domain/entities/studioWorld'
import type { WorldStudioRepository } from '../../../../domain/repositories/WorldStudioRepository'
import { WorldReviewUseCase } from '../../../../domain/usecases/WorldReviewUseCase'
import { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { LazyMarkdownEditor as fakeEditor } from '../../../../test/markdownEditorFake'
import * as cardImports from '../../../shared/importCards'
import type { useWorldRevisions } from '../viewmodel/useWorldRevisions'
import { WorldStudioPage } from './WorldStudioPage'

let useCase: WorldStudioUseCase
/**
 * 설정집 AI 검토 UseCase. 기본(`beforeEach`)은 서버가 저장한 마지막 검토가 아직 없는 세계관(`latest`가 null)이라 화면이 서버를 부르지 않고, 검토를 요청하는 테스트는 `reviewing`이 갈아 끼운다.
 * `null`은 서버 기능이 없는 데모다. 세계관을 열 때 마지막 검토를 읽으므로(#555) 운영 컨테이너의 것을 그대로 두면 테스트마다 서버 호출을 시도한다.
 */
let reviewCase: WorldReviewUseCase | null | undefined
/** `mount`가 연 세계관의 저장본 설정. 서버가 검토 응답의 기준(basis)을 저장한 초안에서 만드는 것처럼 `reviewOf`가 같은 초안으로 기준을 만든다. */
let savedRows: StudioSetting[] = []
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
// 관계도 캔버스(react-force-graph)는 그리지 않고 넘기는 값·메서드만 붙잡는 대역이다(공용: src/test/forceGraphFake).
vi.mock('react-force-graph-2d', () => import('../../../../test/forceGraphFake'))
// 관계도의 기본 보기(인물이 둘 이상이면 인물만·정보 관계 끔)는 관계 편집 동작과 무관한 시험에서는 모든 유형을 보는 필터로 대신한다. 기본 보기·기억을 시험할 때는 prefs.filter를 undefined로 두어 실제 저장소를 읽는다.
const prefs = vi.hoisted(() => ({ filter: { hiddenTypes: [] as string[], hiddenKinds: [] as string[] } as undefined | { hiddenTypes: string[]; hiddenKinds: string[] } }))
vi.mock('../viewmodel/relationPrefs', async (original) => { const real = await original<typeof import('../viewmodel/relationPrefs')>(); return { ...real, loadFilter: (id: string) => (prefs.filter === undefined ? real.loadFilter(id) : prefs.filter) } })
beforeEach(() => { localStorage.clear(); prefs.filter = { hiddenTypes: [], hiddenKinds: [] } })
// AI·외부 도구(MCP) 변경 감시(#553)는 훅 자체의 테스트(useMcpChangeWatch.test)가 확인하고, 여기서는 이 화면이 넘기는 값·배너 연결·다시 읽은 뒤의 편집기만 본다.
const mcp = vi.hoisted(() => ({ stale: false, reload: vi.fn(), watch: vi.fn() }))
vi.mock('../../../shared/useMcpChangeWatch', () => ({ useMcpChangeWatch: (...args: unknown[]) => { mcp.watch(...args); return { stale: mcp.stale, reload: mcp.reload } } }))
afterEach(() => { mcp.stale = false; mcp.watch.mockClear(); mcp.reload.mockClear() })
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
  fakeGraph.reset()
  // 장르 선택지·헤더 칩은 서버의 공개 장르 목록이라 운영과 같은 메모리 목록으로 대신한다(afterEach의 restoreAllMocks가 되돌린다).
  const genres = new InMemoryGenreRepository(new InMemoryOperationsGenreRepository())
  vi.spyOn(appContainer.resolve('genreUseCase'), 'list').mockImplementation(() => genres.list())
  // '소설 연결' 탭의 Fork 목록은 운영과 같은 작품 목록 조회라 서버를 부르지 않게 비워 둔다(탭을 보는 테스트가 따로 정한다).
  vi.spyOn(appContainer.resolve('readingUseCase'), 'forksOf').mockResolvedValue([])
  revisions = noRevisions()
  reviewCase = new WorldReviewUseCase({ review: vi.fn(async () => { throw new Error('이 테스트는 설정집 검토를 요청하지 않아요.') }), latest: vi.fn(async () => null) })
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
  savedRows = settings
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
  // 이름으로 찾는 row·checkbox role 쿼리는 51행 표에서 행마다 접근 가능한 이름을 계산해 느렸다(로컬에서 이 테스트 시간의 4할). CI 부하에서 5초 제한을 넘긴 적이 있어 행은 제목 글자로, 선택 칸은 레이블로 찾는다.
  const rowOf = (title: string) => table().getByText(title).closest('tr')!
  expect(table().getAllByRole('row')).toHaveLength(51)
  fireEvent.click(table().getByLabelText('보이는 설정 모두 선택'))
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  expect(screen.getByText('현재 페이지 0개 선택 · 다른 페이지·필터 50개 선택')).toBeTruthy()
  fireEvent.click(table().getByLabelText('설정 50 선택'))
  expect(screen.getByText('현재 페이지 1개 선택 · 다른 페이지·필터 50개 선택')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '선택 공개' }))
  expect(rowOf('설정 50').textContent).toContain('공개')
  fireEvent.click(screen.getByRole('button', { name: '이전' }))
  expect(rowOf('설정 0').textContent).toContain('작가 전용')
  expect(table().getByLabelText<HTMLInputElement>('설정 0 선택').checked).toBe(true)
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: '설정 100' } })
  fireEvent.click(table().getByRole('button', { name: '설정 100 인물' }))
  fireEvent.click(screen.getByRole('button', { name: '수정하기' })) // 제목은 미리보기를 열고, 수정하기가 편집 화면을 연다
  expect(screen.getByRole('region', { name: '선택한 설정 편집' })).toBeTruthy()
})
/** 새 세계관 만들기 직후의 마법사(작성 모드): 주소에 `?new=1`이 붙고 저장 버전은 0이다. */
const wizard = (fixture: Fixture = {}) => show(undefined, '/worldstudio/qa?new=1', { version: 0, ...fixture })
/** 설정집 게시판의 행(제목 버튼, 이름 + 분류)을 눌러 그 줄 아래 미리보기를 열고 `수정하기`로 그 카드의 편집 화면을 연다. 고르기 전에는 패널이 없다. */
const openCard = (name: string) => {
  const title = screen.getByRole('button', { name })
  if (title.getAttribute('aria-expanded') !== 'true') fireEvent.click(title) // 이미 미리보기가 열려 있으면(편집 화면에 다녀온 뒤) 다시 누르지 않는다: 접힌다
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }))
}
/** 설정 편집 화면(집필실 같은 3단: 레일 / 편집기 / AI 채팅)이 설정집 화면을 대신한다. 설정집으로 돌아가는 버튼은 상단 바의 '← 설정집'이다. */
const editor = () => within(screen.getByRole('region', { name: '선택한 설정 편집' }))
/** 왼쪽 활동 막대의 탭(개요·문서·관계·버전·공개 순서)을 고른다. 이미 고른 탭이면 그대로 둔다. 편집 화면의 처음 탭은 문서다. 탭은 가운데 본문 전체를 바꾼다. */
const openPane = (name: string) => { const tab = screen.getByRole('tab', { name: new RegExp('^' + name) }); if (tab.getAttribute('aria-selected') !== 'true') fireEvent.click(tab) }
/** 설정 카드 목록은 활동 막대 맨 위 토글이 펴고 접는 왼쪽 패널이다(데스크톱은 처음부터 펼쳐져 있다). */
const rail = () => { const toggle = screen.getByRole('button', { name: '설정 카드 목록' }); if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle); return within(screen.getByRole('navigation', { name: '설정 카드 목록' })) }
const graph = () => { openPane('버전'); return within(screen.getByRole('region', { name: '버전 그래프' })) }
const overview = () => { openPane('개요'); return within(screen.getByRole('tabpanel')) }
const relations = () => { openPane('관계'); return within(screen.getByRole('region', { name: '연관 설정' })) }
const orderPanel = () => { openPane('공개 순서'); return within(screen.getByRole('region', { name: '공개 순서 확인' })) }
const backToBoard = () => fireEvent.click(screen.getByRole('button', { name: '설정집' }))
/** '+ 새 설정' 메뉴에서 유형을 골라 그 유형의 새 카드의 편집 화면을 연다. */
const addSetting = (type: string) => {
  if (screen.queryByRole('tablist', { name: '카드 화면' })) rail() // 편집 화면에서는 '+ 새 설정'이 설정 카드 목록 패널에 있다
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

it('보기 전환 메뉴는 현재 보기를 aria-current로 알리고 보기를 바꾸면 따라간다', async () => {
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

it('서재의 내가 만드는 세계관 탭으로 돌아가는 링크는 사이드바 맨 위(로고 줄 바로 아래)에 있고, 사이드바를 펼친 동안은 상단 줄(.ep-top)을 그리지 않는다', async () => {
  await showWorld()
  const back = screen.getByRole('link', { name: '내가 만드는 세계관' })
  expect(back.getAttribute('href')).toBe('/lib?tab=worlds')
  expect(back.closest('.ep-menu')).toBeTruthy()
  expect(screen.getByRole('main').contains(back)).toBe(true)
  expect(document.querySelector('.ep-top')).toBeNull() // 두 곳에 동시에 두지 않는다
})

it('관리 헤더는 저장한 세계관의 소개와 설정 수·저장 버전·서버 연결 예정 칩, 저장 상태를 보이고 저장 전 입력은 상태만 바꾼다', async () => {
  await showWorld()
  const header = within(screen.getByRole('heading', { name: '검증 세계', level: 1 }).closest('section')!)
  expect(header.getByText('설정 1개')).toBeTruthy()
  expect(header.getByText('저장 버전 1')).toBeTruthy()
  expect(header.getByText('비공개', { selector: '.chip' })).toBeTruthy() // 서버 연결 예정 칩은 실제 공개 범위 칩이 됐다
  expect(header.getByText('설명')).toBeTruthy()
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 관리 모드의 저장 상태는 헤더 칩이 아니라 사이드바의 저장 영역이 보인다
  expect(header.queryByText('저장됨')).toBeNull()
  openCard('가람 인물') // 관리 모드에는 기본 정보 입력이 없으니 저장 전 입력은 카드 수정으로 만든다
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '고친 이름' } })
  backToBoard()
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  expect(header.getByText('설명')).toBeTruthy()
})

it('관리 보기 전환 메뉴가 왼쪽 사이드바에 있고(개요·설정집·관계도·시간선·소설 연결) 보기를 옮기면 그 화면으로 바뀐다', async () => {
  await showWorld()
  expect(manageTabs().getAllByRole('button').map((b) => b.textContent)).toEqual(['개요', '설정집', '관계도', '시간선', '소설 연결'])
  // 사이드바(.ep-menu)가 내용 열(.ep-content)보다 먼저다(DOM 순서 = 시각 순서). 메뉴 아래에 도구·저장 영역이, 내용 열에 헤더와 게시판이 있다.
  const side = screen.getByRole('navigation', { name: '세계관 메뉴' }).closest('.ep-menu') as HTMLElement
  expect(side.nextElementSibling?.classList.contains('ep-content')).toBe(true)
  expect(within(side).getByRole('group', { name: '저장 상태' })).toBeTruthy()
  expect(within(side.nextElementSibling as HTMLElement).getByRole('heading', { name: '검증 세계', level: 1 })).toBeTruthy()
  for (const gone of ['세계관 탐색', 'AI 후보 검토', '확정 버전']) expect(manageTabs().queryByRole('button', { name: gone }), gone).toBeNull() // 탐색은 헤더의 공개 화면 보기, 후보 검토는 시트, 확정 버전은 편집 화면의 버전 그래프로 옮겼다
  expect(screen.getByRole('button', { name: 'AI 검토' })).toBeTruthy() // 의견·후보가 없으면 이름에 수를 붙이지 않는다
  expect(manageTabs().getByRole('button', { name: '설정집' }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(screen.getByRole('region', { name: '관계 편집' })).toBeTruthy()
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull()
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
})

it('테마 전환은 사이드바 맨 아래 줄의 버튼 한 개가 맡는다: 떠 있는 버튼은 GlobalChrome이 이 화면에서 그리지 않고 공용 상단바(Gnb)도 없다', async () => {
  await showWorld()
  const theme = screen.getByRole('button', { name: '다크 모드로' }) // 한 개
  expect(theme.closest('.ep-menu-account')).toBeTruthy()
  expect(theme.closest('.ep-menu')).toBeTruthy()
  expect(theme.closest('.gnb')).toBeNull()
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

it('작성 마법사도 헤더의 행동 줄(소설 버튼·관리 화면으로 옆)에 테마 버튼을 따로 두지 않고 상단바(Gnb)의 버튼 한 개가 맡는다', async () => {
  await wizard()
  expect(within(screen.getByRole('main')).queryByRole('button', { name: /모드로/ })).toBeNull()
  expect(screen.getByRole('button', { name: '다크 모드로' }).closest('.gnb')).toBeTruthy() // 한 개
})

it('새 세계관 만들기(/worldstudio)에는 테마 버튼을 따로 두지 않는다: 그 화면은 상단바(Gnb)의 테마 버튼이 맡는다', async () => {
  await show(undefined, '/worldstudio')
  expect(within(screen.getByRole('main')).queryByRole('button', { name: /모드로/ })).toBeNull()
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

it('설정 카드 단계는 공개 설정집과 같은 분류 메뉴·검색·정렬·게시판 표로 카드를 보이고 행을 누르면 미리보기가 열리고 수정하기가 목록 대신 그 카드의 편집 화면을 연다', async () => {
  await show([person('나래'), person('가람', '북부 기록관'), place('항구')])
  const menu = within(screen.getByRole('navigation', { name: '설정 분류' }))
  expect(menu.getAllByRole('button').map((b) => b.textContent)).toEqual(['전체 3', '인물 2', '장소 1', '조직 비어 있음', '규칙 비어 있음', '사건 비어 있음', '기타 비어 있음', '보완 필요 2']) // 보완 필요 분류는 마지막에 선다
  const table = within(screen.getByRole('table', { name: '설정 카드 목록' }))
  expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['보이는 설정 모두 선택', '번호', '분류', '제목', '상태', '요약', '공개', '연결']) // 맨 앞은 공개 범위를 바꿀 카드를 고르는 선택 칸이다
  const rows = () => dataRows(table).slice(1).map((row) => [...row.querySelectorAll('td')].slice(1).map((td) => (td.classList.contains('col-title') ? td.querySelector('button')?.textContent : td.textContent))) // 선택 칸은 빼고, 제목 칸은 제목 버튼만 본다
  expect(rows()).toEqual([['1', '인물', '나래', '정리 필요', '', '작가 전용', '0'], ['2', '인물', '가람', '정리 필요', '북부 기록관', '작가 전용', '0'], ['3', '장소', '항구', '—없음', '', '작가 전용', '0']]) // 상태 칸: 두 인물은 SOUL·GOAL이 비어 정리 필요, 항구는 —
  // 좁은 본문에서는 분류·요약 칸이 숨으므로 같은 내용을 제목 아래 한 줄에도 둔다(넓은 본문에서는 CSS가 이 줄을 숨긴다)
  expect(dataRows(table).slice(1).map((row) => row.querySelector('.col-title .world-row-sub')?.textContent)).toEqual(['인물', '인물북부 기록관', '장소'])
  expect(screen.queryByRole('region', { name: '선택한 설정 편집' })).toBeNull() // 행을 고르기 전에는 편집 화면이 없고 목록만 있다
  expect(screen.queryByRole('combobox', { name: '추가할 설정 유형' })).toBeNull() // 유형은 새 설정의 편집 화면에서 고른다

  fireEvent.change(screen.getByRole('combobox', { name: '정렬' }), { target: { value: 'name' } })
  expect(rows().map((r) => r.slice(0, 3))).toEqual([['1', '인물', '가람'], ['2', '인물', '나래'], ['3', '장소', '항구']])

  fireEvent.click(table.getByRole('button', { name: '항구 장소' }))
  expect(screen.queryByRole('region', { name: '선택한 설정 편집' })).toBeNull() // 제목은 편집 화면이 아니라 미리보기를 연다
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }))
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
  expect(overview().getByRole<HTMLSelectElement>('combobox', { name: '유형' }).value).toBe('character') // 같은 유형 칩이 따로 없고 선택 상자 하나로 보인다
  const links = relations()
  expect(links.queryByText('읽기 전용')).toBeNull() // 눌러서 여는 목록에 '읽기 전용' 표시가 붙으면 헷갈린다
  const link = links.getByRole('button', { name: '나래' }) // 목록 줄은 '나래 — 친구'이고 버튼은 상대 이름이다
  expect(link.closest('li')!.textContent).toContain('나래 — 친구')
  link.focus()
  fireEvent.click(link)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('나래')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '설정 이름' }))) // 눌러서 사라진 링크 대신 새 카드의 이름 입력으로
  backToBoard()
  openCard('항구 장소')
  expect(relations().getByText(/아직 연결된 설정이 없어요/)).toBeTruthy() // 관계 편집으로 가는 길은 머리 줄의 버튼과 빈 상태의 관계 추가다
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
  const open = overview().getByRole<HTMLInputElement>('switch', { name: '이 설정 공개' })
  expect([open.checked, open.disabled]).toEqual([false, false]) // 설정 카드는 기본 작가 전용이고 카드마다 공개로 바꿀 수 있다(미연결 세계관은 공개(1화부터)와 작가 전용 두 값이다, DEC-53)
  expect(overview().queryByRole('switch', { name: /스포일러 숨기기/, hidden: true })).toBeNull()
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
  expect(overview().getByRole<HTMLSelectElement>('combobox', { name: '유형' }).value).toBe('location')
  await waitFor(() => expect(document.activeElement).toBe(editor().getByRole('textbox', { name: '설정 이름' })))
  fireEvent.change(editor().getByRole('textbox', { name: '설정 이름' }), { target: { value: '항구' } })
  openPane('문서') // 유형을 확인하느라 개요 탭으로 갔으니 설명은 문서 탭에서 쓴다
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
  const people = within(screen.getByRole('region', { name: '관계 편집' }))
  expect(people.getByText(/‘항구’ 설정이 삭제됐어요/)).toBeTruthy() // 관계도에도 같은 알림과 되돌리기가 뜬다
  expect(people.getByRole('button', { name: '삭제 되돌리기' })).toBeTruthy()
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

it('집필 메모 추가는 관리 사이드바에 없다(메모 유형 카드는 + 새 설정으로 만든다): AI 검토 바로 다음이 확정 버전 남기기다', async () => {
  await showWorld()
  expect(screen.queryByRole('button', { name: '집필 메모 추가' })).toBeNull()
  const review = screen.getByRole('button', { name: /^AI 검토/ })
  expect(review.parentElement?.classList.contains('ep-menu-tools')).toBe(true)
  expect(review.nextElementSibling).toBe(screen.getByRole('button', { name: '확정 버전 남기기' }))
})

it('작성 모드 헤더의 행동 줄에도 집필 메모 추가는 없다: 설정 카드 단계에도 소설 버튼과 관리 화면으로만 있다', async () => {
  await wizard()
  fireEvent.click(screen.getByRole('button', { name: '다음 단계' })) // 설정 카드 단계
  expect(screen.queryByRole('button', { name: '집필 메모 추가' })).toBeNull()
  expect(headerOf().getAllByRole('button').map((b) => b.textContent)).toEqual(['소설 연결하기', '독자 시점으로 보기', '내보내기 ▸', '관리 화면으로']) // 소설 버튼·독자 시점 미리보기(연결 전이라 잠김)·내보내기·관리 화면으로뿐이다
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

it('설정집 화면에도 확정 버전 남기기가 사이드바의 저장 영역 위에 있어 같은 확정 버전 시트를 열고, 저장하지 않은 변경이 있으면 잠그며 이유를 알린다', async () => {
  const confirm = vi.fn(async () => undefined)
  revisions = { ...noRevisions(), confirm }
  await showWorld()
  const button = () => screen.getByRole<HTMLButtonElement>('button', { name: '확정 버전 남기기' })
  expect(screen.getByRole('group', { name: '저장 상태' }).closest('.ep-menu-tools')?.contains(button())).toBe(true) // 저장 영역과 같은 사이드바 묶음
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
  expect(screen.getByRole('heading', { name: '저장된 시간선' })).toBeTruthy()
  expect(screen.queryByText(/저장한 설정만 보여드려요/)).toBeNull() // 제목이 이미 저장분이라고 말한다
  expect(Array.from(within(screen.getByRole('region', { name: '사건 시간선' })).getAllByRole('button'), (b) => b.textContent)).toEqual(['건국1년'])
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
  expect(events()).toEqual(['건국1년'])
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveBar().getByText('저장됨')).toBeTruthy())
  expect(events()).toEqual(['건국 선포1년'])
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
  if (tab === 'people') expect(screen.getByRole('region', { name: '관계 편집' })).toBeTruthy()
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

it('소설 버튼은 한 자리다: 연결된 소설이 없으면 소설 연결 탭에 소설 연결하기뿐이고, 데모는 새 소설 폼으로 가는 소설 작성하기뿐이다', async () => {
  await show(undefined, '/worldstudio/qa?view=novel')
  expect(novelTab().getByRole('button', { name: '소설 연결하기' })).toBeTruthy()
  expect(novelTab().queryByRole('link', { name: '소설 작성하기' })).toBeNull() // 같은 자리에 두 버튼을 두지 않는다
  expect(novelTab().getByText('연결된 소설이 없어요.').querySelector('button, a')).toBeNull() // 그 위의 상태 줄은 정보만 보인다
  expect(screen.queryByRole('link', { name: '새 소설 등록으로' })).toBeNull()
  cleanup()
  vi.stubEnv('MODE', 'mockup')
  await show(undefined, '/worldstudio/qa?view=novel')
  expect(novelTab().getByRole('link', { name: '소설 작성하기' }).getAttribute('href')).toBe('/new') // 데모는 기존 새 소설 폼
  expect(novelTab().queryByRole('button', { name: '소설 연결하기' })).toBeNull()
})

it('관계 연결 단계에서 노드를 누르면 선택만 되고, 노드 메뉴의 관계 연결을 고른 뒤 다른 노드를 누르면 관계 작성 시트가 열린다', async () => {
  const [garam] = [person('가람'), person('나래')]
  await show([garam, person('나래'), person('다온')])
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(screen.getByText(/노드를 누르면 이웃을 강조해요/)).toBeTruthy() // 행동 한 문장(위치 저장 안내는 행동과 무관하다)
  clickNode('가람') // 노드 누르기는 선택과 강조 고정이다
  expect(canvasCard('가람').getAttribute('aria-current')).toBe('true')
  expect(screen.queryByText(/연결 상대를 고르세요/)).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  rightClickNode('가람')
  fireEvent.click(screen.getByRole('menuitem', { name: '관계 연결' }))
  expect(screen.getByText(/가람의 연결 상대를 고르세요/)).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: '실제 관계 1' })).toBeNull() // 주체만 고른 단계에서는 열리지 않는다
  clickNode('나래')
  expect(screen.getByRole('dialog', { name: '가람 ↔ 나래 관계' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: '실제 관계 1' })).toBeTruthy()
  expect(screen.queryByText(/연결 상대를 고르세요/)).toBeNull()
})

// ── 관계 기준 회차(DEC-51): 관계도 보기·작성 모드 관계 연결 단계에서 고른다 ───────────────────────
const episodePicker = () => within(screen.getByRole('region', { name: '관계 기준 회차' }))
// ── 관계도 캔버스 조작: 하단 관계 추가 폼·관계 목록 표는 없고 캔버스에서만 잇고 지운다 ─────────────────────────
// 캔버스는 react-force-graph 대역(src/test/forceGraphFake)이다: 노드·선은 캔버스가 넘긴 graphData에서 읽고, 누르기·오른쪽 클릭·올리기는 캔버스가 넘긴 핸들러로 흉내 낸다.
const canvasRoot = () => document.querySelector<HTMLElement>('.relationship-flow')!
/** 키보드로 관계도 조작 목록의 설정 버튼(캔버스의 노드와 같은 일을 한다: 선택은 aria-current로 알린다). */
const canvasCard = (name: string) => screen.getByRole('button', { name: new RegExp('^' + name + ' · ') })
/** 두 설정 사이의 선(없으면 undefined): 같은 쌍의 관계는 선 하나에 묶여 있다. */
const relationLine = (from: string, to: string) => fakeGraph.link(from, to)
/** 노드 오른쪽 클릭 메뉴의 '관계 연결' → 상대 노드 누르기: 관계 작성 시트가 열린다. */
const connectCards = (from: string, to: string) => {
  rightClickNode(from)
  fireEvent.click(screen.getByRole('menuitem', { name: '관계 연결' }))
  clickNode(to)
}
/** 마우스를 올린 선에서 Delete: 확인(window.confirm) 뒤 편집본에서 관계를 지운다(관계가 하나인 선). */
const deleteLine = (from: string, to: string) => { hoverLink(from, to); fireEvent.keyDown(canvasRoot(), { key: 'Delete' }) }
it('관계도 보기에서 회차를 고르면 그 회차로 다시 읽고, 회차 칸은 다시 열리지 않으며 요청이 끝나면 입력 칸으로 초점이 돌아온다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  const at = (episode?: number): StudioWorld => ({ id: 'qa', name: '검증 세계', description: '설명', version: 1, settings: episode === 1 ? [garam, narae] : friends([garam, narae], garam, narae), analysis: null, linkedWorkId: 'w1' })
  const read = vi.fn(async (_id: string, _signal?: AbortSignal, episode?: number) => structuredClone(at(episode)))
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa', { linkedWorkId: 'w1', relationEpisodes: true, read })
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(relationLine('가람', '나래')).toBeTruthy() // 최신 회차의 관계
  const apply = episodePicker().getByRole('button', { name: '이 회차 관계 보기' }), field = episodePicker().getByRole('textbox', { name: '관계 기준 화' })
  fireEvent.change(field, { target: { value: '1' } })
  fireEvent.click(apply)
  await waitFor(() => expect(relationLine('가람', '나래')).toBeUndefined()) // 1화 시점에는 그 관계가 없다
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
  deleteLine('가람', '나래') // 초안을 바꾸면 다시 읽을 때 잃으므로 잠근다
  expect(episodePicker().getByText('저장하지 않은 변경이 있어 회차를 바꿀 수 없어요. 먼저 세계관을 저장하세요.')).toBeTruthy()
})

/** 관계도 보기의 회차 칸에 회차를 넣어 그 회차 시점으로 다시 읽는다. */
const pickEpisode = async (episode: number) => {
  fireEvent.change(episodePicker().getByRole('textbox', { name: '관계 기준 화' }), { target: { value: String(episode) } })
  fireEvent.click(episodePicker().getByRole('button', { name: '이 회차 관계 보기' }))
  await waitFor(() => expect(episodePicker().getByText(`지금은 ${episode}화 시점의 관계예요.`)).toBeTruthy())
}
it('관계 기준 회차를 고른 동안에는 설정 삭제 진입점(편집 화면 삭제·레일 ⋮ 삭제)이 이유와 함께 잠기고, 최신으로 돌아오면 열린다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  const reason = '설정 삭제는 최신 회차에서 할 수 있어요.'
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people', { linkedWorkId: 'w1', relationEpisodes: true })
  await pickEpisode(1)
  expect(screen.queryByRole('button', { name: '선택한 인물 삭제' })).toBeNull() // 관계도에는 삭제 진입점이 없다(편집 화면으로 일원화)
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
  expect(episodePicker().queryByText(/이 칸은 어느 회차 시점의/)).toBeNull() // 같은 말은 관계 작성 시트와 저장 영역이 이미 한다
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  openCard('가람 인물')
  expect(editor().getByRole<HTMLButtonElement>('button', { name: '카드 삭제' }).disabled).toBe(false)
  expect(editor().queryByText(reason)).toBeNull()
})
it('지난 회차를 연 채 관계를 삭제하면 그 관계가 어느 회차에서 끝나는지 저장 영역과 작성 모드의 검토·저장 단계가 알리고, 삭제하지 않았거나 최신이면 알리지 않는다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  const note = '삭제한 관계 1개는 1화에서 끝나는 것으로 저장돼요.'
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const removeRelation = () => deleteLine('가람', '나래')
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people', { linkedWorkId: 'w1', relationEpisodes: true })
  await pickEpisode(1)
  expect(saveBar().queryByText(note)).toBeNull() // 회차를 골랐을 뿐 지우지 않았다
  removeRelation()
  expect(saveBar().getByText(note)).toBeTruthy()
  cleanup()
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people', { linkedWorkId: 'w1', relationEpisodes: true })
  removeRelation() // 최신 회차에서는 알릴 것이 없다
  expect(saveBar().queryByText(/끝나는 것으로 저장돼요/)).toBeNull()
  cleanup()
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?new=1', { version: 0, linkedWorkId: 'w1', relationEpisodes: true })
  const steps = () => within(screen.getByRole('navigation', { name: '세계관 작성 단계' }))
  fireEvent.click(steps().getByRole('button', { name: '관계 연결 (선택)' }))
  await pickEpisode(1)
  removeRelation()
  fireEvent.click(steps().getByRole('button', { name: '검토·저장' }))
  expect(within(screen.getByRole('region', { name: '세계관 검토' })).getByText(note)).toBeTruthy()
})

it('소설을 연결한 세계관은 관계 편집 시트에 기존 시작 회차가 채워져 있고, N화부터를 적어 적용하면 그 회차가 저장 요청의 관계 행에 담긴다 (DEC-54 2단계)', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  const settings = friends([garam, narae], garam, narae).map((s) => (s.item.kind === 'relation' ? { ...s, item: { ...s.item, fromEpisode: 2 } } : s))
  const { saveStudio } = await show(settings, '/worldstudio/qa?view=people', { linkedWorkId: 'w1', relationEpisodes: true })
  clickLink('가람', '나래')
  const from = () => screen.getByRole<HTMLInputElement>('textbox', { name: '실제 관계 1 시작 회차 화부터' })
  expect(from().value).toBe('2')
  fireEvent.change(from(), { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(saveStudio.mock.calls[0][0].settings.find((s) => s.item.kind === 'relation')?.item.fromEpisode).toBe(4)
  expect(saveStudio.mock.calls[0][2]).toBeUndefined() // 보는 회차(최신)가 아니라 관계마다의 N화부터가 기록 회차를 정한다
})

it('소설을 연결한 세계관에서 N화부터를 모르는 관계가 바뀌면(설정 이름을 바꿔 관계 이름이 따라 바뀜) 저장 전 확인이 그 관계를 가리켜 저장을 막고, 누르면 그 관계의 N화부터 칸으로 간다 (DEC-54 2단계)', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa', { linkedWorkId: 'w1', relationEpisodes: true })
  openCard('가람 인물')
  fireEvent.change(editor().getByRole('textbox', { name: '설정 이름' }), { target: { value: '가람이' } })
  backToBoard()
  const saveButton = () => saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' })
  const issue = saveBar().getByRole('button', { name: '‘가람이 · 친구 · 나래’: 관계가 몇 화부터인지 1 이상의 정수로 입력해 주세요.' })
  expect(saveButton().disabled).toBe(true)
  fireEvent.click(issue)
  const field = await screen.findByRole<HTMLInputElement>('textbox', { name: '실제 관계 1 시작 회차 화부터' })
  expect(field.getAttribute('aria-invalid')).toBe('true')
  await waitFor(() => expect(document.activeElement).toBe(field)) // 고칠 칸으로 초점이 간다
  fireEvent.change(field, { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
  expect(saveButton().disabled).toBe(false)
})

it('관계선을 누르면 관계 작성 패널이 열리고, 올린 선에서 Delete는 확인한 뒤에만 편집본에서 관계를 지운다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae))
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(relationLine('가람', '나래')!.relations.map((r) => r.full)).toEqual(['친구']) // 선이 나타내는 관계
  clickLink('가람', '나래')
  expect(screen.getByRole('textbox', { name: '실제 관계 1' })).toBeTruthy() // 편집은 관계 작성 패널을 연다
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  deleteLine('가람', '나래')
  expect(confirm).toHaveBeenCalledOnce()
  expect(relationLine('가람', '나래')).toBeTruthy() // 거절하면 그대로다
  confirm.mockReturnValue(true)
  deleteLine('가람', '나래')
  expect(relationLine('가람', '나래')).toBeUndefined()
  expect(screen.queryByRole('dialog')).toBeNull() // 열려 있던 패널도 닫힌다
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

it('세계관을 읽지 못하면 오류 곁의 다시 시도로 같은 세계관을 다시 읽고, 세계관 목록으로 돌아가는 길도 보인다', async () => {
  const world: StudioWorld = { id: 'qa', name: '검증 세계', description: '설명', version: 1, settings: [person('가람', '기존 내용')], analysis: null }
  const read = vi.fn<WorldStudioRepository['read']>().mockRejectedValueOnce(new Error('세계관을 읽지 못했습니다.')).mockImplementation(async () => structuredClone(world))
  mount(undefined, '/worldstudio/qa', { read })
  expect((await screen.findByRole('alert')).textContent).toBe('세계관을 읽지 못했습니다.')
  expect(screen.getByRole('link', { name: '내가 만드는 세계관으로 돌아가기' }).getAttribute('href')).toBe('/lib?tab=worlds')
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('heading', { name: '검증 세계', level: 1 })).toBeTruthy()
  expect(read).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
})

// ── 작성 모드(새로 만든 직후 ?new=1의 4단계 마법사) ↔ 관리 모드(그 밖의 모든 진입: 탭 + 저장 영역) ──────────────
const stepNames = () => Array.from(within(screen.getByRole('navigation', { name: '세계관 작성 단계' })).getAllByRole('button'), (b) => b.textContent)
const headerOf = (name = '검증 세계') => within(screen.getByRole('heading', { name, level: 1 }).closest('section')!)
const bumpVersion: WorldStudioRepository['saveStudio'] = async (next) => ({ ...next, version: next.version + 1 })

it('처음 작성하는 세계관(새로 만든 직후)은 사이드바 없이 기본 정보부터 4단계로 쓰고 공개 설정도 그 단계에 있다', async () => {
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

it('저장한 적 있는 세계관은 사이드바 메뉴와 설정집부터 시작하는 관리 화면이고 단계·기본 정보 입력은 없다', async () => {
  await showWorld()
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy() // 탭 구성은 '관리 탭 다섯 개…' 테스트가 본다
  expect(screen.queryByRole('textbox', { name: '세계관 이름' })).toBeNull()
  expect(screen.queryByRole('group', { name: '세계관 기본 정보' })).toBeNull()
  expect(headerOf().queryByRole('group', { name: '공개 설정' })).toBeNull() // 공개 설정은 헤더가 아니라 정보 편집 패널에 있다
  expect(headerOf().queryByRole('button', { name: '세계관 정보 편집' })).toBeNull() // 정보 편집은 헤더가 아니라 개요 탭에 있다
  expect(manageTabs().getByRole('button', { name: '개요' })).toBeTruthy()
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
  expect(saveBar().queryByRole('button', { name: '세계관 저장' })).toBeNull() // 저장했으니 저장할 것이 없다
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
  expect(screen.getByRole('region', { name: '관계 편집' })).toBeTruthy()
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
  expect(screen.getByRole('region', { name: '관계 편집' })).toBeTruthy()
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

it('상시 저장 영역은 바뀐 것이 없으면 저장됨뿐이고(잠긴 버튼이 같은 말을 되풀이하지 않는다), 바뀌면 저장하지 않은 변경 있음과 열린 저장 버튼이며 저장하면 저장됨으로 돌아간다', async () => {
  const { saveStudio } = await showWorld()
  const button = () => saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' })
  expect(saveBar().getByText('저장됨')).toBeTruthy()
  expect(saveBar().queryByRole('button', { name: '세계관 저장' })).toBeNull()
  dirtyCard()
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  expect(button().disabled).toBe(false)
  fireEvent.click(button())
  await waitFor(() => expect(saveBar().getByText('저장됨')).toBeTruthy())
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(saveStudio).toHaveBeenCalledWith(expect.objectContaining({ id: 'qa', settings: [expect.objectContaining({ item: expect.objectContaining({ title: '고친 이름' }) })] }), expect.any(AbortSignal), undefined)
  expect(saveBar().queryByRole('button', { name: '세계관 저장' })).toBeNull()
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
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull() // 세계관을 다시 읽으면 입력이 사라지므로 편집 중 실패에는 다시 시도를 두지 않는다
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

// ── 관리 모드 개요 탭의 정보 편집 폼(이름·설명·공개 범위·장르·표지) ───────────────────────────────────────────
/** 정보 편집 폼은 헤더가 아니라 '개요' 탭에 있다(주소 ?view=overview). 폼이 이미 열려 있으면 다시 누르지 않는다. */
const openInfoEdit = () => {
  if (!screen.queryByRole('form', { name: '세계관 정보 편집' })) fireEvent.click(manageTabs().getByRole('button', { name: '개요' }))
}
const infoForm = () => within(screen.getByRole('form', { name: '세계관 정보 편집' }))
const publishGroup = () => within(infoForm().getByRole('group', { name: '공개 설정' }))
/** 장르 선택지는 공개 장르 목록(서버)이라 패널이 열린 뒤 읽혀 그려진다. 선택지가 그려질 때까지 기다린 뒤 장르 select를 돌려준다. */
const genreSelect = async () => {
  const select = publishGroup().getByRole<HTMLSelectElement>('combobox', { name: '장르' })
  await waitFor(() => expect(select.options.length).toBeGreaterThan(1))
  return select
}
const savePanel = () => fireEvent.click(infoForm().getByRole('button', { name: '저장' }))
/** 저장하면 폼은 열린 채(탭 본문) '저장했어요.'를 알린다. */
const panelSaved = () => waitFor(() => expect(infoForm().getByText('저장했어요.')).toBeTruthy())

it('개요 탭에서 이름·설명을 고치고 저장하면 기존 초안 저장으로 보내고 헤더가 바뀐 채 폼은 열려 있다', async () => {
  const { saveStudio, setPublication, setCover, removeCover } = await showWorld()
  openInfoEdit()
  const name = infoForm().getByRole<HTMLInputElement>('textbox', { name: '세계관 이름' })
  expect(name.value).toBe('검증 세계')
  expect(document.activeElement).not.toBe(name) // 탭을 열어도 입력으로 초점을 끌어가지 않는다
  expect(infoForm().getByRole<HTMLTextAreaElement>('textbox', { name: '세계관 설명' }).value).toBe('설명')
  fireEvent.change(name, { target: { value: '새 이름' } })
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 설명' }), { target: { value: '새 소개' } })
  fireEvent.click(infoForm().getByRole('button', { name: '저장' }))
  expect(await screen.findByRole('heading', { name: '새 이름', level: 1 })).toBeTruthy()
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(saveStudio).toHaveBeenCalledWith(expect.objectContaining({ id: 'qa', name: '새 이름', description: '새 소개', version: 1 }), expect.any(AbortSignal), undefined)
  await panelSaved()
  expect([setPublication, setCover, removeCover].map((fn) => fn.mock.calls.length)).toEqual([0, 0, 0]) // 바뀐 것만 보낸다
  expect(headerOf('새 이름').getByText('새 소개')).toBeTruthy()
})

it('Esc는 개요 폼을 닫지 않고 되돌리기가 바뀐 입력을 저장한 값으로 되돌리며 저장 요청을 보내지 않는다', async () => {
  const { saveStudio } = await showWorld()
  openInfoEdit()
  const name = () => infoForm().getByRole<HTMLInputElement>('textbox', { name: '세계관 이름' })
  fireEvent.change(name(), { target: { value: '버릴 이름' } })
  fireEvent.keyDown(name(), { key: 'Escape' })
  expect(screen.getByRole('form', { name: '세계관 정보 편집' })).toBeTruthy() // 탭 본문이라 Esc로 닫히지 않는다
  expect(name().value).toBe('버릴 이름')
  fireEvent.click(infoForm().getByRole('button', { name: '되돌리기' }))
  expect(name().value).toBe('검증 세계') // 저장한 값에서 다시 시작한다
  expect(screen.getByRole('heading', { name: '검증 세계', level: 1 })).toBeTruthy()
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
  expect(infoForm().getByRole('button', { name: '되돌리기' }).closest('fieldset')!.disabled).toBe(true)
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

// ── 개요 폼의 잠금: 저장하지 않은 입력이 이름·설명 저장에 딸려 가면 안 된다 ──────────────────
const dirtyCard = () => {
  openCard('가람 인물')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '고친 이름' } })
  backToBoard() // 헤더·저장 영역은 설정집 화면에 있다
}

it('저장하지 않은 카드 수정이 있으면 개요 탭의 이름·설명 저장이 잠기고 먼저 저장하라고 안내한다', async () => {
  await showWorld()
  dirtyCard()
  openInfoEdit()
  const save = () => infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' })
  expect(infoForm().queryByText(/작성 중인 변경을 먼저 저장하세요/)).toBeNull() // 이름·설명을 건드리기 전에는 알리지 않는다
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  expect(save().disabled).toBe(true)
  const hint = infoForm().getByText(/작성 중인 변경을 먼저 저장하세요/)
  expect(save().getAttribute('aria-describedby')).toBe(hint.id)
})

it('먼저 저장하면 이름·설명 저장이 다시 열리고 방금 저장한 카드 수정을 그대로 보내 잃지 않는다', async () => {
  const { saveStudio } = await showWorld()
  dirtyCard()
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  await waitFor(() => expect(infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(false))
  expect(infoForm().queryByText(/작성 중인 변경을 먼저 저장하세요/)).toBeNull()
  savePanel()
  expect(await screen.findByRole('heading', { name: '새 이름', level: 1 })).toBeTruthy()
  expect(saveStudio).toHaveBeenCalledTimes(2)
  const [second] = saveStudio.mock.calls[1]
  expect([second.name, second.settings[0].item.title]).toEqual(['새 이름', '고친 이름']) // 첫 저장에 올라간 카드 수정이 그대로
})

it('개요 탭에서 이름을 고친 채 초안이 바뀌면(전체 공개) 저장이 잠겨 그 변경이 이름·설명 저장에 딸려 가지 않는다', async () => {
  const { saveStudio } = await show([person('가람'), person('나래')], '/worldstudio/qa', { visibility: 'public', currentRevisionId: 'rev-1' })
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  expect(infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(false)
  fireEvent.click(warningIn(infoForm()).getByRole('button', { name: '전체 공개' })) // 초안(설정 공개)이 바뀐다
  expect(infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(true)
  expect(infoForm().getByText(/작성 중인 변경을 먼저 저장하세요/)).toBeTruthy()
  fireEvent.submit(screen.getByRole('form', { name: '세계관 정보 편집' })) // Enter 제출도 막힌다
  expect(saveStudio).not.toHaveBeenCalled()
})

// ── 공개 범위·장르(편집 패널에서 저장과 함께 적용) ──────────────────────────────────────
it('관리 헤더에는 공개 설정 폼 없이 공개 범위·장르 칩만 있고, 개요 탭의 한 폼에서 이름·설명·공개 범위·장르를 저장·되돌린다', async () => {
  await show(undefined, '/worldstudio/qa', { visibility: 'public', genre: 'genre-01', currentRevisionId: 'rev-1' })
  expect(headerOf().queryByRole('group', { name: '공개 설정' })).toBeNull()
  expect(headerOf().getByText('공개', { selector: '.chip' })).toBeTruthy()
  expect(await headerOf().findByText('판타지', { selector: '.chip' })).toBeTruthy()
  openInfoEdit()
  expect(infoForm().getByRole('textbox', { name: '세계관 이름' })).toBeTruthy()
  expect(infoForm().getByRole('textbox', { name: '세계관 설명' })).toBeTruthy()
  expect(within(publishGroup().getByRole('group', { name: '공개 범위' })).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['비공개', 'false'], ['공개', 'true']])
  expect((await genreSelect()).value).toBe('genre-01')
  expect(infoForm().getByRole('button', { name: '저장' })).toBeTruthy()
  expect(infoForm().getByRole('button', { name: '되돌리기' })).toBeTruthy()
})

it('관리 헤더의 공개 설정은 서버 연결 예정 대신 실제 공개 범위 토글과 장르 선택이다', async () => {
  await showWorld()
  openInfoEdit()
  const range = within(publishGroup().getByRole('group', { name: '공개 범위' }))
  expect(range.getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['비공개', 'true'], ['공개', 'false']])
  const genre = await genreSelect()
  const all = await new InMemoryOperationsGenreRepository().list()
  expect(Array.from(genre.options, (o) => [o.value, o.textContent])).toEqual([['', '미지정'], ...all.map((g) => [g.code, g.name])]) // 운영이 관리하는 공개 장르(활성 장르, 표시 순서)
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
  expect(await screen.findByText('공개했어요. 누구나 연결된 소설이 발행한 회차까지(소설이 없으면 1화까지) 공개된 설정 카드와 그 사이의 인물 관계를 볼 수 있어요.')).toBeTruthy()
  expect(confirm).toHaveBeenCalledOnce()
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('공개하면 누구나 연결된 소설이 발행한 회차까지(소설이 없으면 1화까지) 공개된 설정 카드와 그 사이의 인물 관계를 볼 수 있고'))
  expect(setPublication).toHaveBeenCalledWith('qa', { visibility: 'public', genre: null }, expect.any(AbortSignal))
  expect(headerOf().getByText('공개', { selector: '.chip' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '공개 화면 보기' }).getAttribute('href')).toBe('/worlds/qa')
  await panelSaved() // 저장되면 저장했어요를 알린다
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

it('개요 탭은 사이드바의 현재 탭과 같은 말인 제목 없이 폼이 카드 맨 위에서 시작하고, 공개 범위 아래 안내는 한 문장이다', async () => {
  await showWorld()
  openInfoEdit()
  expect(screen.queryByRole('heading', { name: '세계관 개요' })).toBeNull()
  expect(infoForm().getByText('저장하면 적용돼요. 공개 화면에는 확정 버전의 공개 설정만, 소설이 발행한 회차까지 보여요.')).toBeTruthy()
  cleanup()
  await wizard()
  expect(screen.getByText('바로 적용돼요. 공개 화면에는 확정 버전의 공개 설정만, 소설이 발행한 회차까지 보여요.')).toBeTruthy()
})

it('공개로 설정했지만 목록에 나오지 않으면(저장 버전 없음) 저장 뒤 확정 버전을 남기라고 안내하고 설정은 반영한다', async () => {
  await show(undefined, '/worldstudio/qa', { setPublication: async (id, change) => published(id, change, false) })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  savePanel()
  expect(await screen.findByText('공개로 설정했어요.')).toBeTruthy()
  const hint = headerOf().getByText(/확정 버전이 없어 공개 목록에 아직 안 나와요/)
  expect(hint.textContent).toContain('확정 버전')
  expect(hint.textContent).toContain('나타나요')
  expect(headerOf().getByText('공개', { selector: '.chip' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: '공개 화면 보기' })).toBeNull()
})

it('이미 공개인 세계관의 장르를 바꾸면 확인 없이 현재 공개 범위와 새 장르를 보내고 칩을 바꾼다', async () => {
  const { setPublication } = await show(undefined, '/worldstudio/qa', { visibility: 'public', genre: 'genre-01', currentRevisionId: 'rev-1' })
  const confirm = vi.spyOn(window, 'confirm')
  const select = () => publishGroup().getByRole<HTMLSelectElement>('combobox', { name: '장르' })
  openInfoEdit()
  await genreSelect()
  expect(select().value).toBe('genre-01')
  expect(await headerOf().findByText('판타지', { selector: '.chip' })).toBeTruthy()
  fireEvent.change(select(), { target: { value: 'genre-14' } })
  savePanel()
  expect(await headerOf().findByText('SF', { selector: '.chip' })).toBeTruthy()
  expect(setPublication).toHaveBeenLastCalledWith('qa', { visibility: 'public', genre: 'genre-14' }, expect.any(AbortSignal))
  await panelSaved()
  openInfoEdit()
  await genreSelect()
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
  await panelSaved()
})

it('저장하지 않은 입력이 있어도 공개 설정만 바꾼 저장은 그 입력을 건드리지 않고 공개 설정만 보낸다', async () => {
  const { saveStudio, setPublication } = await show(undefined, '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  dirtyCard()
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  savePanel()
  await waitFor(() => expect(setPublication).toHaveBeenCalledOnce())
  expect(saveStudio).not.toHaveBeenCalled() // 초안 저장은 하지 않는다: 그 입력은 저장에 딸려 가지 않는다
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  openCard('고친 이름 인물')
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('고친 이름')
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
})

it('폼의 저장은 이름·설명은 초안 저장으로, 공개 범위·장르는 공개 설정으로 각각 한 번씩 보내고 둘 다 되면 저장했어요를 알린다', async () => {
  const { saveStudio, setPublication } = await show(undefined, '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.change(infoForm().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  fireEvent.change(await genreSelect(), { target: { value: 'genre-14' } })
  savePanel()
  expect(await screen.findByRole('heading', { name: '새 이름', level: 1 })).toBeTruthy()
  await waitFor(() => expect(setPublication).toHaveBeenCalledOnce())
  expect(saveStudio).toHaveBeenCalledOnce()
  expect(saveStudio).toHaveBeenCalledWith(expect.objectContaining({ id: 'qa', name: '새 이름' }), expect.any(AbortSignal), undefined)
  expect(setPublication).toHaveBeenCalledWith('qa', { visibility: 'public', genre: 'genre-14' }, expect.any(AbortSignal))
  await panelSaved()
  expect(await headerOf('새 이름').findByText('SF', { selector: '.chip' })).toBeTruthy()
})

it('이름·설명은 저장됐지만 공개 설정이 실패하면 오류를 알리고 폼과 입력을 그대로 두며, 다시 저장하면 공개 설정만 다시 보낸다', async () => {
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
  await panelSaved()
})

it('되돌리기는 고른 공개 범위·장르도 저장한 값으로 되돌리고 아무것도 보내지 않는다', async () => {
  const { saveStudio, setPublication } = await showWorld()
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  fireEvent.change(await genreSelect(), { target: { value: 'genre-14' } })
  fireEvent.click(infoForm().getByRole('button', { name: '되돌리기' }))
  expect([saveStudio, setPublication].map((fn) => fn.mock.calls.length)).toEqual([0, 0])
  expect(publishGroup().getByRole('button', { name: '비공개', pressed: true })).toBeTruthy() // 저장한 값에서 다시 시작한다
  expect((await genreSelect()).value).toBe('')
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
  expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/데모에서는|소설을 연결하면|발행하면/)
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

it('AI 채팅은 본문(main) 밖 오른쪽 열이라 헤더·사이드바·저장 영역은 본문 안에 있고 접으면 2열 배치가 풀린다', async () => {
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
  expect(coverGroup().getByText('PNG·JPEG·WebP, 5 MiB 이하.')).toBeTruthy() // 안내는 형식·크기 한 줄이다
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

it('고른 표지는 저장해야 올라가고 올라가면 헤더 표지가 새 이미지로 바뀐다(되돌리면 보내지 않는다)', async () => {
  const { setCover, readCover } = await showWorld()
  openInfoEdit()
  const file = png()
  pickCover(file)
  expect(coverGroup().getByText('선택한 파일: cover.png')).toBeTruthy()
  expect(setCover).not.toHaveBeenCalled() // 고르는 것만으로는 보내지 않는다
  fireEvent.click(infoForm().getByRole('button', { name: '되돌리기' })) // 되돌리기는 고른 파일을 버린다
  expect(setCover).not.toHaveBeenCalled()
  expect(coverGroup().queryByText(/선택한 파일/)).toBeNull()
  pickCover(file)
  savePanel()
  await waitFor(() => expect(setCover).toHaveBeenCalledWith('qa', file, expect.any(AbortSignal)))
  expect(await screen.findByText('표지를 올렸어요.')).toBeTruthy()
  await panelSaved()
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
  await panelSaved()
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
  await panelSaved()
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
  expect(where()).toBe('/worldstudio/qa?view=overview')
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
  expect(where()).toBe('/worldstudio/qa?view=overview')
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

it('이름·공개 설정·표지를 함께 바꾸면 이름·설명 → 공개 설정 → 표지 순으로 한 번씩 보내고 모두 되면 저장했어요를 알린다', async () => {
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
  await panelSaved()
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
  expect(editor().getByText(/9 \/ 3,000자$/)).toBeTruthy() // 하단은 글자 수뿐이다: 저장 상태는 상단 저장 영역 한 곳이 말한다
  expect(editor().queryByText(/저장 전 수정이 있어요|저장된 상태예요/)).toBeNull()
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
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' })) // 미리보기
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '수정하기' }))) // 화면 이동은 transition이라 멈춘 렌더가 안내(Suspense 대체 화면)로 커밋되도록 비동기로 기다린다
  expect(editor().getByText('편집기를 불러오고 있어요.')).toBeTruthy()
  expect(editor().queryByRole('textbox', { name: 'IDENTITY.md' })).toBeNull()
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('가람')
})

it('유형은 선택 상자 하나로만 보이고 같은 유형 칩이 따로 없다', async () => {
  await show()
  openCard('가람 인물')
  expect(overview().getByRole<HTMLSelectElement>('combobox', { name: '유형' }).value).toBe('character')
  expect(document.querySelector('.world-card-meta .chip')).toBeNull()
})

// ── 설정 카드 공개 설정(DEC-53: 'N화부터 공개' 또는 기본 '작가 전용', 미연결 세계관은 '공개'(1화)와 '작가 전용') ─────────────────────────────
const boardTable = () => within(screen.getByRole('table', { name: '설정 카드 목록' }))
/** 게시판 표 자신의 줄(머리 줄 포함). 열려 있는 미리보기 안의 정보 상자(nw-info) 표의 줄은 세지 않는다. */
const dataRows = (scope: { getAllByRole: (role: 'row') => HTMLElement[] }) => scope.getAllByRole('row').filter((row) => !row.closest('.world-preview'))
const visibilityOf = () => dataRows(boardTable()).slice(1).map((row) => row.querySelector('.col-vis')?.textContent)
/** 일괄 공개는 접힌 `<details>`(summary `공개 범위 한 번에 바꾸기`)다. 줄을 고르면 펼쳐진다(jsdom은 닫힌 상자 안도 숨기지 않아 닫힌 채로도 질의된다). */
const bulkDetails = () => screen.getByText('공개 범위 한 번에 바꾸기', { selector: 'summary' }).closest('details')!
const bulk = () => within(bulkDetails())
const noPublicCards = /공개로 둔 설정이 없어요/
/** 경고 줄(문구 + 전체 공개 버튼) */
const warningIn = (scope: ReturnType<typeof within>) => within(scope.getByText(noPublicCards).closest('p')!)

it('설정 카드는 기본 작가 전용이고 편집 화면의 이 설정 공개를 켜면 1화부터 공개로 초안이 바뀌어 게시판의 공개 칸과 저장 요청에 반영된다', async () => {
  const { saveStudio } = await show([person('가람', '기록관'), person('나래')])
  expect(visibilityOf()).toEqual(['작가 전용', '작가 전용'])
  openCard('가람 인물')
  fireEvent.click(overview().getByRole('switch', { name: '이 설정 공개' }))
  expect(overview().getByRole<HTMLInputElement>('switch', { name: '이 설정 공개' }).checked).toBe(true)
  expect(overview().getByText(/저장 후 ‘확정 버전 남기기’를 해야 반영돼요/)).toBeTruthy() // 초안 값이라 바로 공개되지 않는다
  backToBoard()
  expect(visibilityOf()).toEqual(['공개', '작가 전용'])
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  // 공개 설정은 하나다: 회차 값(1화)을 정하고 visibility는 그에 맞춰 공개로 저장한다.
  expect(saveStudio.mock.calls[0][0].settings.map((s) => [s.revealFromEpisode, s.visibility])).toEqual([[1, 'public'], [undefined, undefined]])
  openCard('가람 인물')
  fireEvent.click(overview().getByRole('switch', { name: '이 설정 공개' })) // 다시 끄면 작가 전용으로 돌아간다
  backToBoard()
  expect(visibilityOf()).toEqual(['작가 전용', '작가 전용'])
})

it('게시판에서 고른 설정만 선택 공개·선택 비공개로 바꾸고 전체 공개는 모든 설정 카드를 공개로 바꾼다', async () => {
  await show([person('가람'), person('나래'), place('항구')])
  const [publish, hide, all] = ['선택 공개', '선택 비공개', '전체 공개'].map((name) => bulk().getByRole<HTMLButtonElement>('button', { name }))
  expect([publish.disabled, hide.disabled, all.disabled]).toEqual([true, true, false]) // 고른 것이 없으면 선택 동작은 잠긴다
  fireEvent.click(boardTable().getByRole('checkbox', { name: '가람 선택' }))
  fireEvent.click(boardTable().getByRole('checkbox', { name: '항구 선택' }))
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 2개 선택')
  fireEvent.click(publish)
  expect(visibilityOf()).toEqual(['공개', '작가 전용', '공개'])
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 설정 2개를 공개로 뒀어요.') // 바꾸면 고른 것을 풀고 한 일을 알린다
  expect(boardTable().getAllByRole<HTMLInputElement>('checkbox').filter((box) => box.checked)).toEqual([])
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  fireEvent.click(boardTable().getByRole('checkbox', { name: '보이는 설정 모두 선택' }))
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 3개 선택')
  fireEvent.click(hide)
  expect(visibilityOf()).toEqual(['작가 전용', '작가 전용', '작가 전용'])
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 설정 3개를 비공개로 뒀어요.')
  fireEvent.click(all)
  expect(visibilityOf()).toEqual(['공개', '공개', '공개'])
  expect(bulk().getByRole('status').textContent).toBe('모든 설정을 공개로 뒀어요.')
  expect(all.disabled).toBe(true) // 이미 모두 공개다
})

it('일괄 공개는 접힌 한 줄로 시작해 줄을 고르면 펼쳐지고, 한 일을 알린 뒤에도 접히지 않으며, 안내는 한 문장이다', async () => {
  await show([person('가람'), person('나래')])
  expect(bulkDetails().open).toBe(false) // 아무것도 고르지 않았으면 표 위에는 summary 한 줄뿐이다
  expect(bulk().getByText('작가 전용 설정은 독자에게 보이지 않아요. 저장 후 확정 버전을 남겨야 반영돼요.')).toBeTruthy()
  fireEvent.click(boardTable().getByRole('checkbox', { name: '가람 선택' }))
  expect(bulkDetails().open).toBe(true)
  fireEvent.click(bulk().getByRole('button', { name: '선택 공개' }))
  expect(visibilityOf()).toEqual(['공개', '작가 전용'])
  expect(bulkDetails().open).toBe(true) // 고른 것이 풀려도 방금 한 일의 알림이 접혀 사라지지 않는다
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 설정 1개를 공개로 뒀어요.')
})

it('고른 설정은 지금 보이는 줄에서만 세어, 검색으로 가려진 설정의 공개 범위는 바꾸지 않는다', async () => {
  await show([person('가람', '북부'), person('나래', '남부')])
  fireEvent.click(boardTable().getByRole('checkbox', { name: '보이는 설정 모두 선택' }))
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: '북부' } })
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 1개 선택 · 다른 페이지·필터 1개 선택')
  fireEvent.click(bulk().getByRole('button', { name: '선택 공개' }))
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: '' } })
  expect(visibilityOf()).toEqual(['공개', '작가 전용'])
})

it('세계관을 공개로 고르면 공개로 둔 설정이 없다고 경고하고, 그 자리에서 전체 공개를 눌러도 공개 설정 저장은 잠기지 않는다', async () => {
  const { setPublication } = await show([person('가람'), person('나래')], '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  expect(screen.queryByText(noPublicCards)).toBeNull() // 비공개 세계관에는 경고가 없다
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  fireEvent.click(warningIn(infoForm()).getByRole('button', { name: '전체 공개' }))
  expect(infoForm().queryByText(noPublicCards)).toBeNull()
  // 초안이 바뀌어 저장하지 않은 변경이 생겼어도, 공개 범위만 바꾼 폼 저장은 초안 저장과 별개라 잠기지 않는다.
  expect(infoForm().getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(false)
  expect(infoForm().queryByText(/작성 중인 변경을 먼저 저장하세요/)).toBeNull()
  savePanel()
  await waitFor(() => expect(setPublication).toHaveBeenCalledWith('qa', { visibility: 'public', genre: null }, expect.any(AbortSignal)))
  await panelSaved()
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy() // 카드 공개는 초안 변경이라 세계관 저장이 남아 있다
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(visibilityOf()).toEqual(['공개', '공개'])
})

it('경고를 넘기고 공개해도 막지 않으며, 공개 세계관에 공개로 둔 설정이 없는 동안에는 헤더가 경고와 전체 공개를 보인다', async () => {
  const { setPublication } = await show([person('가람')], '/worldstudio/qa', { currentRevisionId: 'rev-1' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  openInfoEdit()
  fireEvent.click(publishGroup().getByRole('button', { name: '공개', pressed: false }))
  expect(infoForm().getByText(noPublicCards)).toBeTruthy()
  savePanel()
  await waitFor(() => expect(setPublication).toHaveBeenCalledOnce())
  await panelSaved()
  await headerOf().findByText(noPublicCards)
  fireEvent.click(warningIn(headerOf()).getByRole('button', { name: '전체 공개' }))
  expect(headerOf().queryByText(noPublicCards)).toBeNull()
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
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
const revealField = () => overview().getByRole<HTMLInputElement>('textbox', { name: /공개 회차/ })

it('연결된 소설이 있으면 소설 연결 탭이 그 제목을 알리고 소설 버튼 자리는 그 작품 관리로 가는 소설 작성하기다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록', '11111111-1111-4111-8111-111111111111'), myWork('work-2', '다른 소설')])
  await show(undefined, '/worldstudio/qa?view=novel', { linkedWorkId: 'work-1' })
  const origin = await novelTab().findByRole('link', { name: /^달빛 기록/ }) // 원작은 Fork 행과 같은 모양의 행 링크다(작품 보기 버튼이 따로 없다)
  expect([origin.getAttribute('href'), origin.textContent]).toEqual(['/work/work-1', '달빛 기록원작'])
  expect(novelTab().queryByText(/연결된 소설:/)).toBeNull() // 제목 '연결된 소설' 바로 아래에서 같은 말을 되풀이하지 않는다
  expect(novelTab().getAllByRole('link').filter((link) => link.getAttribute('href') === '/content?work=work-1').map((link) => link.textContent)).toEqual(['소설 작성하기']) // 같은 곳으로 가는 링크는 하나뿐이다
  expect(novelTab().queryByRole('button', { name: '소설 연결하기' })).toBeNull()
})

it('연결된 소설의 제목을 읽지 못해도 작품 관리로 가는 링크는 남기고 읽지 못했다고 알린다', async () => {
  vi.spyOn(episodeApi(), 'list').mockRejectedValue(new Error('서버 인증이 필요합니다.'))
  await show(undefined, '/worldstudio/qa?view=novel', { linkedWorkId: 'work-1' })
  expect(await novelTab().findByText('연결된 소설의 제목을 불러오지 못했어요.')).toBeTruthy()
  expect(novelTab().getByRole('link', { name: '소설 작성하기' }).getAttribute('href')).toBe('/content?work=work-1')
})

it('연결된 소설이 없으면 소설 연결하기가 아직 연결되지 않은 내 소설만 고르게 하고, 고르면 서버에 연결한 뒤 소설 연결 탭과 독자 공개 입력을 바꾼다', async () => {
  const list = vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록'), myWork('work-2', '이미 연결된 소설', '11111111-1111-4111-8111-111111111111')])
  const linkWorldStudio = vi.spyOn(episodeApi(), 'linkWorldStudio').mockResolvedValue({ workId: 'work-1', worldId: 'qa' })
  await show(undefined, '/worldstudio/qa?view=novel')
  expect(list).not.toHaveBeenCalled() // 내 소설 목록은 필요할 때만 읽는다
  fireEvent.click(novelTab().getByRole('button', { name: '소설 연결하기' }))
  const sheet = within(await screen.findByRole('dialog', { name: '소설 연결하기' }))
  const pick = await sheet.findByRole('button', { name: /달빛 기록/ })
  expect(sheet.getByText('세계관은 소설 하나에만 연결돼요.')).toBeTruthy() // 공개 회차 정책은 시트가 아니라 설정 카드가 알린다
  expect(sheet.queryByRole('button', { name: /이미 연결된 소설/ })).toBeNull()
  fireEvent.click(pick)
  await waitFor(() => expect(linkWorldStudio).toHaveBeenCalledWith('work-1', 'qa'))
  const write = await novelTab().findByRole('link', { name: '소설 작성하기' }) // 같은 자리의 버튼이 소설 작성하기로 바뀐다
  expect(write.getAttribute('href')).toBe('/content?work=work-1')
  await waitFor(() => expect(document.activeElement).toBe(write)) // 누른 버튼이 사라진 자리의 새 버튼으로 초점이 간다
  expect(novelTab().queryByRole('button', { name: '소설 연결하기' })).toBeNull()
  expect(screen.queryByRole('dialog', { name: '소설 연결하기' })).toBeNull()
  expect(await novelTab().findByRole('link', { name: /^달빛 기록/ })).toBeTruthy()
  expect(await novelTab().findByRole('heading', { name: 'Fork 소설 0편', level: 2 })).toBeTruthy() // 연결되면 그 소설의 Fork 목록도 읽는다
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 연결은 초안 저장과 별개다
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  openCard('가람 인물')
  expect(revealField().disabled).toBe(false)
})

it('소설 연결이 실패하면 서버가 준 이유를 시트에 보이고 연결되지 않은 채로 둔다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  vi.spyOn(episodeApi(), 'linkWorldStudio').mockRejectedValue(new Error('이미 다른 작품에 연결된 세계관이에요.'))
  await show(undefined, '/worldstudio/qa?view=novel')
  fireEvent.click(novelTab().getByRole('button', { name: '소설 연결하기' }))
  const sheet = within(await screen.findByRole('dialog', { name: '소설 연결하기' }))
  fireEvent.click(await sheet.findByRole('button', { name: /달빛 기록/ }))
  expect((await sheet.findByRole('alert')).textContent).toBe('이미 다른 작품에 연결된 세계관이에요.')
  expect(sheet.getByRole<HTMLButtonElement>('button', { name: /달빛 기록/ }).disabled).toBe(false) // 다시 고를 수 있다
  fireEvent.click(sheet.getByRole('button', { name: '닫기' }))
  expect(novelTab().getByRole('button', { name: '소설 연결하기' })).toBeTruthy()
})

it('내 소설 목록을 읽지 못하면 다시 시도할 수 있고, 연결할 소설이 없으면 그렇다고 알린다', async () => {
  const list = vi.spyOn(episodeApi(), 'list').mockRejectedValue(new Error('서버 인증이 필요합니다.'))
  await show(undefined, '/worldstudio/qa?view=novel')
  fireEvent.click(novelTab().getByRole('button', { name: '소설 연결하기' }))
  const sheet = within(await screen.findByRole('dialog', { name: '소설 연결하기' }))
  expect((await sheet.findByRole('alert')).textContent).toContain('내 소설을 불러오지 못했어요')
  expect(sheet.getByRole('link', { name: '새 소설 만들기' }).getAttribute('href')).toBe('/content') // 목록을 못 읽어도 새로 쓰러 갈 수 있다
  list.mockResolvedValue([myWork('work-2', '이미 연결된 소설', '11111111-1111-4111-8111-111111111111')])
  fireEvent.click(sheet.getByRole('button', { name: '다시 시도' }))
  expect(await sheet.findByText('연결할 수 있는 소설이 없어요.')).toBeTruthy() // 대안은 아래 새 소설 만들기 줄이 알린다
  expect(sheet.getByRole('link', { name: '새 소설 만들기' }).getAttribute('href')).toBe('/content') // 예전 미연결 '소설 작성하기'가 가던 작품 만들기
})

it('공개 회차는 소설을 연결한 세계관에서만 입력할 수 있고 비우면 작가 전용이다', async () => {
  await show([person('가람', '기록관')])
  openCard('가람 인물')
  expect(overview().queryByRole('textbox', { name: /공개 회차/ })).toBeNull() // 미연결 세계관은 회차 입력 대신 공개 스위치뿐이다
  expect(overview().getByText(/소설을 연결하면 N화부터 공개로 정할 수 있어요/)).toBeTruthy()
  cleanup()
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  const { saveStudio } = await show([person('가람', '기록관')], '/worldstudio/qa', { linkedWorkId: 'work-1' })
  openCard('가람 인물')
  expect(overview().queryByRole('switch', { name: '이 설정 공개' })).toBeNull() // 연결된 세계관은 공개 설정이 입력 하나다
  expect(revealField().disabled).toBe(false)
  expect(revealField().value).toBe('') // 비어 있으면 작가 전용(기본)이다
  expect(overview().getByText('비워 두면 작가 전용이에요.')).toBeTruthy() // 입력의 설명(aria-describedby)은 남기고 짧게
  expect(within(overview().getByRole('region', { name: '공개 범위' })).getByText('작가 전용', { selector: '.world-reach-badge' })).toBeTruthy() // 공개 안내는 제목 옆 배지 한 곳이다
  fireEvent.change(revealField(), { target: { value: '3' } })
  expect(revealField().value).toBe('3')
  expect(within(overview().getByRole('region', { name: '공개 범위' })).getByText('3화부터 공개', { selector: '.world-reach-badge' })).toBeTruthy()
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  // 회차 값을 정하면 visibility는 공개로 맞춰 저장한다.
  expect(saveStudio.mock.calls[0][0].settings[0].revealFromEpisode).toBe(3)
  expect(saveStudio.mock.calls[0][0].settings[0].visibility).toBe('public')
  fireEvent.change(revealField(), { target: { value: '' } })
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledTimes(2))
  expect(saveStudio.mock.calls[1][0].settings[0].revealFromEpisode).toBeUndefined()
  expect(saveStudio.mock.calls[1][0].settings[0].visibility).toBeUndefined()
})

it('공개 회차가 1 이상의 정수가 아니면 저장 영역이 이유를 알리고 저장을 막는다', async () => {
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

/** 공개 설정이 서로 다른 옛 카드 셋: 공개 + 회차 없음(1화부터), 비공개 + 회차 3(회차 값만), 작가 전용(값 없음, 제목 숨김). */
const legacyCards = (): StudioSetting[] => [{ ...person('옛공개'), visibility: 'public' }, { ...person('회차만'), revealFromEpisode: 3 }, person('숨김')]
const labelOfRow = (name: string) => boardTable().getByRole('row', { name: new RegExp(name) }).querySelector('.col-vis')?.textContent
const settingsSavedAt = (saveStudio: { mock: { calls: unknown[][] } }, call = 0) => (saveStudio.mock.calls[call][0] as StudioWorld).settings

it('옛 공개 카드는 읽을 때 1화부터로 보이고 건드리지 않으면 저장 요청에도 그대로 간다(미연결 세계관)', async () => {
  const { saveStudio } = await show(legacyCards())
  expect([labelOfRow('옛공개'), labelOfRow('회차만'), labelOfRow('숨김')]).toEqual(['공개', '3화부터', '작가 전용'])
  openCard('옛공개 인물')
  expect(overview().getByRole<HTMLInputElement>('switch', { name: '이 설정 공개' }).checked).toBe(true)
  backToBoard()
  openCard('회차만 인물')
  expect(overview().getByRole<HTMLInputElement>('switch', { name: '이 설정 공개' }).checked).toBe(true)
  expect(overview().getByText(/3화부터 공개로 정해져 있지만 소설이 연결되지 않아 지금은 공개되지 않아요/)).toBeTruthy() // 미연결 세계관의 기준 회차는 1이다
  backToBoard()
  openCard('숨김 인물')
  fireEvent.click(overview().getByRole('switch', { name: '이 설정 공개' })) // 건드린 카드만 값이 바뀐다
  backToBoard()
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(settingsSavedAt(saveStudio).map((s) => [s.revealFromEpisode, s.visibility])).toEqual([[undefined, 'public'], [3, undefined], [1, 'public']])
})

it('소설이 연결된 세계관은 유효 공개 회차를 입력 하나로 보이고 입력하면 회차와 visibility를 함께 저장한다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  const { saveStudio } = await show(legacyCards(), '/worldstudio/qa', { linkedWorkId: 'work-1' })
  expect([labelOfRow('옛공개'), labelOfRow('회차만'), labelOfRow('숨김')]).toEqual(['1화부터', '3화부터', '작가 전용'])
  openCard('옛공개 인물')
  expect(revealField().value).toBe('1') // 옛 공개 카드는 1화부터다
  fireEvent.change(revealField(), { target: { value: '5' } })
  backToBoard()
  expect(labelOfRow('옛공개')).toBe('5화부터')
  openCard('숨김 인물')
  expect(revealField().value).toBe('')
  backToBoard()
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  expect(settingsSavedAt(saveStudio).map((s) => [s.revealFromEpisode, s.visibility])).toEqual([[5, 'public'], [3, undefined], [undefined, undefined]])
})

it('소설이 연결된 세계관의 일괄 공개는 회차를 한 번 입력받아(기본 1화) 고른 카드 모두와 전체에 같은 N화부터 공개를 정한다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  await show([person('가람'), person('나래'), place('항구')], '/worldstudio/qa', { linkedWorkId: 'work-1' })
  const episode = () => bulk().getByRole<HTMLInputElement>('textbox', { name: /일괄 공개 회차/ })
  const labels = () => [labelOfRow('가람'), labelOfRow('나래'), labelOfRow('항구')]
  expect(episode().value).toBe('1')
  fireEvent.change(episode(), { target: { value: '3' } })
  fireEvent.click(boardTable().getByRole('checkbox', { name: '가람 선택' }))
  fireEvent.click(bulk().getByRole('button', { name: '선택 공개' }))
  expect(labels()).toEqual(['3화부터', '작가 전용', '작가 전용'])
  expect(bulk().getByRole('status').textContent).toBe('현재 페이지 설정 1개를 3화부터 공개로 뒀어요.')
  fireEvent.change(episode(), { target: { value: '2' } })
  fireEvent.click(bulk().getByRole('button', { name: '전체 공개' })) // 이미 3화부터인 카드까지 모두 같은 회차가 된다
  expect(labels()).toEqual(['2화부터', '2화부터', '2화부터'])
  expect(bulk().getByRole('status').textContent).toBe('모든 설정을 2화부터 공개로 뒀어요.')
  fireEvent.click(boardTable().getByRole('checkbox', { name: '보이는 설정 모두 선택' }))
  fireEvent.click(bulk().getByRole('button', { name: '선택 비공개' })) // 작가 전용은 회차와 무관하다
  expect(labels()).toEqual(['작가 전용', '작가 전용', '작가 전용'])
})

it('일괄 공개 회차가 비었거나 1 이상의 정수가 아니면 이유를 알리고 공개 버튼만 잠근다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  await show([person('가람'), person('나래')], '/worldstudio/qa', { linkedWorkId: 'work-1' })
  const episode = () => bulk().getByRole<HTMLInputElement>('textbox', { name: /일괄 공개 회차/ })
  const buttons = () => ['선택 공개', '선택 비공개', '전체 공개'].map((name) => bulk().getByRole<HTMLButtonElement>('button', { name }).disabled)
  fireEvent.click(boardTable().getByRole('checkbox', { name: '가람 선택' }))
  expect(buttons()).toEqual([false, false, false])
  for (const bad of ['0', '']) {
    fireEvent.change(episode(), { target: { value: bad } })
    expect(episode().getAttribute('aria-invalid')).toBe('true')
    expect(bulk().getByRole('alert').textContent).toBe('독자 공개 회차는 1 이상의 정수로 입력해 주세요.')
    expect(episode().getAttribute('aria-describedby')?.split(' ')).toContain(bulk().getByRole('alert').id)
    expect(buttons()).toEqual([true, false, true]) // 작가 전용으로 돌리는 동작은 회차가 필요 없다
  }
  fireEvent.change(episode(), { target: { value: '4' } })
  expect(bulk().queryByRole('alert')).toBeNull()
  expect(buttons()).toEqual([false, false, false])
})

it('데모(목업)에는 소설 연결이 없어 연결 줄을 그리지 않고 회차 입력 없이 공개와 작가 전용만 고르게 알린다', async () => {
  vi.stubEnv('MODE', 'mockup')
  const list = vi.spyOn(episodeApi(), 'list')
  await showWorld()
  expect(headerOf().queryByRole('button', { name: '소설 연결하기' })).toBeNull()
  expect(headerOf().queryByText(/연결된 소설/)).toBeNull()
  fireEvent.click(manageTabs().getByRole('button', { name: '소설 연결' }))
  expect(novelTab().queryByText(/^연결된 소설(:|이 없어요)/)).toBeNull() // 상태 줄 없이 소설 작성하기(→ /new)만 있다
  expect(novelTab().getByRole('link', { name: '소설 작성하기' }).getAttribute('href')).toBe('/new')
  expect(novelTab().queryByRole('heading', { name: /Fork 소설/ })).toBeNull()
  expect(list).not.toHaveBeenCalled()
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  openCard('가람 인물')
  expect(overview().queryByRole('textbox', { name: /공개 회차/ })).toBeNull()
  expect(overview().getByText('데모에서는 소설 연결을 지원하지 않아 공개(1화부터)와 작가 전용(기본)만 고를 수 있어요.')).toBeTruthy()
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
  expect(row.querySelector('.col-vis')?.textContent).toBe('작가 전용')
  openCard('설화 인물')
  expect(overview().getByText('참고: 원본 세계 세계관 · 원작자')).toBeTruthy()
  expect(overview().getByRole<HTMLInputElement>('switch', { name: '이 설정 공개' }).checked).toBe(false)
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
  expect(dataRows(boardTable())).toHaveLength(2) // 머리글과 원래 카드만 남는다
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

it('관계 작성 패널의 닫기는 적용하지 않은 입력이 있으면 확인한 뒤 닫고, 거절하면 패널과 입력을 그대로 둔다(하단 취소가 없어도 입력을 버리는 길은 이 확인뿐이다)', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show([garam, narae])
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  connectCards('가람', '나래')
  fireEvent.click(screen.getByRole('button', { name: '실제 관계 추가' }))
  fireEvent.change(screen.getByRole('textbox', { name: '실제 관계 1' }), { target: { value: '오랜 벗' } })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const close = () => fireEvent.click(within(screen.getByRole('dialog', { name: '가람 ↔ 나래 관계' })).getByRole('button', { name: '닫기' }))
  close()
  expect(confirm).toHaveBeenCalledWith('적용하지 않은 관계 입력을 버릴까요?')
  expect(screen.getByRole('textbox', { name: '실제 관계 1' })).toHaveProperty('value', '오랜 벗') // 거절하면 그대로다
  confirm.mockReturnValue(true)
  close()
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(canvasRoot())) // 사라진 닫기 대신 시트를 연 캔버스로
})

it('관계 작성 패널을 닫거나 적용해 닫으면 사라진 버튼 대신 시트를 연 캔버스로 초점이 돌아온다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show([garam, narae])
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  const write = canvasRoot
  connectCards('가람', '나래')
  const sheet = within(screen.getByRole('dialog', { name: '가람 ↔ 나래 관계' })) // 관계 작성 패널은 시트다
  expect(sheet.queryByRole('button', { name: '취소' })).toBeNull() // 닫는 길은 머리의 닫기(와 Esc·배경)뿐이다
  expect(sheet.getByText('감정은 방향마다 따로 정해요.')).toBeTruthy()
  expect(sheet.getByText('적용 후 세계관을 저장해야 저장돼요.')).toBeTruthy()
  const cancel = sheet.getByRole('button', { name: '닫기' })
  cancel.focus()
  fireEvent.click(cancel)
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(write()))
  connectCards('가람', '나래')
  fireEvent.click(screen.getByRole('button', { name: '실제 관계 추가' }))
  fireEvent.change(screen.getByRole('textbox', { name: '실제 관계 1' }), { target: { value: '오랜 벗' } })
  const apply = screen.getByRole('button', { name: '편집본에 적용' })
  apply.focus()
  fireEvent.click(apply)
  expect(relationLine('가람', '나래')!.relations.map((r) => r.full)).toContain('오랜 벗') // 적용한 관계가 선에 나타난다
  await waitFor(() => expect(document.activeElement).toBe(write()))
})

it('관계선을 지우면 사라진 선 대신 캔버스로 초점이 간다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae))
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  deleteLine('가람', '나래')
  await waitFor(() => expect(document.activeElement).toBe(canvasRoot()))
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

it('공개 회차 입력은 숫자만 받고, 어긋나면 입력 바로 아래에 이유를 글로 보이며 입력의 설명으로 잇는다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')])
  await show([person('가람', '기록관')], '/worldstudio/qa', { linkedWorkId: 'work-1' })
  openCard('가람 인물')
  expect([revealField().type, revealField().getAttribute('inputmode')]).toEqual(['text', 'numeric']) // 숫자 칸(type=number)이 아니라 휠·스핀 버튼으로 값이 바뀌지 않는다
  fireEvent.change(revealField(), { target: { value: '1.5화' } })
  expect(revealField().value).toBe('15') // 숫자만 남는다
  fireEvent.change(revealField(), { target: { value: 'abc' } })
  expect(revealField().value).toBe('')
  expect(overview().queryByRole('alert')).toBeNull()
  fireEvent.change(revealField(), { target: { value: '0' } })
  const error = overview().getByRole('alert')
  expect(error.textContent).toBe('독자 공개 회차는 1 이상의 정수로 입력해 주세요.')
  expect(revealField().getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
  fireEvent.change(revealField(), { target: { value: '2' } })
  expect(overview().queryByRole('alert')).toBeNull()
})

// ── 일괄 공개의 결과 안내·초점, 일부 선택 표시, 글자 수 낭독, 가져올 설정의 이름 ─────────────────────────────
it('일괄 변경 뒤에는 잠긴 버튼 대신 표 머리의 모두 선택으로 초점이 가고, 일부만 고르면 모두 선택이 중간 상태가 된다', async () => {
  await show([person('가람'), person('나래')])
  const head = () => boardTable().getByRole<HTMLInputElement>('checkbox', { name: '보이는 설정 모두 선택' })
  expect([head().checked, head().indeterminate]).toEqual([false, false])
  fireEvent.click(boardTable().getByRole('checkbox', { name: '가람 선택' }))
  expect([head().checked, head().indeterminate]).toEqual([false, true])
  const publish = bulk().getByRole<HTMLButtonElement>('button', { name: '선택 공개' })
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
  fireEvent.click(overview().getByRole('switch', { name: '이 설정 공개' }))
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

it('한글을 조합하는 중에 누른 Esc는 개요 폼의 입력을 지운다고 하지 않는다: 개요 폼은 Esc로 닫히거나 입력을 버리지 않는다', async () => {
  await showWorld()
  openInfoEdit()
  const name = () => infoForm().getByRole<HTMLInputElement>('textbox', { name: '세계관 이름' })
  fireEvent.change(name(), { target: { value: '쓰던 이름' } })
  fireEvent.keyDown(name(), { key: 'Escape', isComposing: true })
  fireEvent.keyDown(name(), { key: 'Escape', keyCode: 229 }) // Safari는 조합을 끝내는 키를 keyCode 229로 보낸다
  fireEvent.keyDown(name(), { key: 'Escape' })
  expect(screen.getByRole('form', { name: '세계관 정보 편집' })).toBeTruthy()
  expect(name().value).toBe('쓰던 이름') // 쓰던 입력을 지킨다
})

it('별칭 입력은 쉼표로 구분한다는 안내를 설명으로 잇는다', async () => {
  await showWorld()
  openCard('가람 인물')
  const alias = overview().getByRole('textbox', { name: '별칭' })
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
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md 정리 필요', 'GOAL.md']) // 비어 있는 필수 문서(SOUL.md)는 정리 필요로 알리고, 선택인 GOAL.md는 비어 있어도 알리지 않는다(#624)
  expect(docList().getAllByRole<HTMLButtonElement>('button').every((b) => b.tagName === 'BUTTON' && b.type === 'button')).toBe(true) // 키보드로 옮겨 다니는 버튼이다
  expect(currentDoc()).toEqual(['IDENTITY.md'])
  expect(docBody('IDENTITY.md').value).toBe('기존 내용') // 기존 인물 카드의 본문이 그대로 IDENTITY.md다
  expect(docBody('IDENTITY.md').dataset.label).toBe('IDENTITY.md')
  expect(docsPanel().getByText(/누구인가: 이름·나이·소속·외형·역할\./)).toBeTruthy()
  expect(editor().getByText('# · ## · ### 제목은 공개 페이지 목차에 나와요.')).toBeTruthy() // 공개되는 문서라 목차 안내가 그대로 있다
  openMemory() // 회차 기억은 펼쳐야 보인다
  expect(episodeDocs().getByText('아직 회차 기억이 없어요.')).toBeTruthy()
  expect(docsPanel().queryByText(/공개 세계관과 독자 설정 위키에 나가는 글은/)).toBeNull() // 공개 범위는 문장 대신 고른 문서의 안내 줄이 짧게 알린다
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
  expect(docsPanel().getByText(/어떻게 생각하고 말하는가: 성격·가치관·말투·욕망·두려움\./)).toBeTruthy()
  expect(editor().queryByText(/제목은 공개 페이지 목차에 나와요/)).toBeNull() // 공개 페이지 목차 안내는 공개되는 IDENTITY.md에만 있다
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 문서를 옮겨 보기만 해서는 초안이 바뀌지 않는다
  fireEvent.change(docBody('SOUL.md'), { target: { value: '말수가 적다' } })
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md', 'GOAL.md']) // 채운 문서는 정리 필요가 사라진다
  expect(editor().getByText(/^SOUL\.md 6 \/ 3,000자$/)).toBeTruthy()
  pickDoc('GOAL.md')
  expect(docsPanel().getByText(/인물이 원하는 것, 피하고 싶은 것, 하려는 일이 있다면 적어 주세요\. 비워도 돼요\./)).toBeTruthy() // 목표는 선택 항목이다(#624)
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
  expect(docsPanel().getByText(/12화에서 겪은 일과 알게 된 사실\./)).toBeTruthy()
  expect(episodeField().value).toBe('')
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
  fireEvent.change(docBody('memory/12회차.md'), { target: { value: '검을 물려받았다' } })
  addEpisode('3')
  expect(episodes()).toEqual(['03회차.md', '12회차.md'])
  expect(currentDoc()).toEqual(['03회차.md'])
  expect(docBody('memory/03회차.md').value).toBe('스승을 잃었다') // 있던 글을 덮어쓰지 않는다
  addEpisode('0')
  expect(episodes()).toEqual(['00회차.md', '03회차.md', '12회차.md']) // 회차 번호 순이고 두 자리로 0을 채운다
  expect(docsPanel().getByText(/이야기 시작 전부터 아는 것\(비밀·과거\)\./)).toBeTruthy() // 0회차 문서의 안내는 '0화에서 겪은 일'이 아니다
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
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md 정리 필요', 'GOAL.md', '03회차.md'])
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
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md', 'GOAL.md', '03회차.md'])
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
  expect(docNames()).toEqual(['IDENTITY.md', 'SOUL.md 3,000자 초과', 'GOAL.md'])
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

it('설정집 게시판은 IDENTITY.md·SOUL.md 중 빈 문서가 있는 인물 줄에 정리 필요를 보이고(GOAL.md는 선택), 저장은 막지 않는다', async () => {
  const filled = { soul: '성격', goal: '목표' }
  const { saveStudio } = await show([person('가람', '본문'), withDocs(person('나래', '본문'), filled), withDocs(person('다온'), filled), place('항구')])
  const flagged = () => dataRows(boardTable()).slice(1).map((row) => [row.querySelector('.col-title button')?.textContent, row.querySelector('td.col-status')!.textContent!.includes('정리 필요')])
  expect(flagged()).toEqual([['가람', true], ['나래', false], ['다온', true], ['항구', false]]) // 다온은 본문(IDENTITY.md)이 비었고, 인물이 아닌 설정은 알리지 않는다
  openCard('가람 인물')
  fireEvent.change(docBody('IDENTITY.md'), { target: { value: '고친 본문' } }) // 빈 SOUL.md는 그대로라 정리 필요도 그대로다
  backToBoard()
  expect(flagged()[0]).toEqual(['가람', true])
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(false) // 알리기만 하고 막지 않는다
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  openCard('가람 인물')
  pickDoc('SOUL.md 정리 필요')
  fireEvent.change(docBody('SOUL.md'), { target: { value: '성격' } })
  backToBoard()
  expect(flagged()[0]).toEqual(['가람', false]) // GOAL.md는 비어 있어도 정리 필요가 아니다(#624)
})

it('인물이 아닌 유형으로 바꾸면 문서 목록 대신 설명 편집기가 나오고 문서를 저장하지 않는다고 알리며, 인물로 되돌리면 문서가 그대로다', async () => {
  await show([withDocs(person('가람', '기존 내용'), { soul: '말수가 적다' }), place('항구')])
  openCard('가람 인물')
  const type = () => overview().getByRole('combobox', { name: '유형' })
  const dropped = /인물이 아닌 설정에는 SOUL\.md·GOAL\.md·회차별 기억을 저장하지 않아요/
  expect(editor().queryByText(dropped)).toBeNull()
  fireEvent.change(type(), { target: { value: 'location' } })
  openPane('문서')
  expect(editor().queryByRole('region', { name: '인물 문서' })).toBeNull()
  expect(editor().getByRole<HTMLTextAreaElement>('textbox', { name: '설명' }).value).toBe('기존 내용') // 본문(IDENTITY.md)은 설명으로 남는다
  expect(editor().getByText(dropped)).toBeTruthy()
  fireEvent.change(type(), { target: { value: 'character' } })
  openPane('문서')
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
it('문서 탭은 작가의 말(정체성·성격·말투·목표·회차 기억)이 주 라벨이고 파일 이름은 스크린리더용이며, 공개 여부는 탭이 아니라 고른 문서의 안내 줄이 알린다', async () => {
  await show([person('가람', '기존 내용')])
  openCard('가람 인물')
  const tab = (name: string) => docList().getByRole<HTMLButtonElement>('button', { name })
  const identity = tab('정체성 IDENTITY.md')
  const soul = tab('성격·말투 SOUL.md 정리 필요') // 정리 필요는 지금처럼 탭 안의 글자다
  const goal = tab('목표 · 선택 GOAL.md') // 목표는 선택이라 비어 있어도 정리 필요가 붙지 않는다(#624)
  const tabs = [identity, soul, goal]
  expect(tabs.map((b) => b.querySelector('.world-doc-name')?.textContent)).toEqual(['정체성', '성격·말투', '목표 · 선택'])
  expect(tabs.map((b) => b.querySelector('small.world-doc-file')?.textContent)).toEqual(['IDENTITY.md', 'SOUL.md', 'GOAL.md']) // 파일 이름은 스크린리더용 보조 글씨
  expect(tabs.map((b) => b.querySelector('.world-doc-scope'))).toEqual([null, null, null]) // 탭 셋에 같은 '작가만'을 되풀이하지 않는다: 범위는 아래 안내 줄이 알린다
  expect(memoryToggle().textContent).toContain('회차 기억 (0)')
  expect(memoryToggle().querySelector('.world-doc-scope')).toBeNull()
  expect(docsPanel().queryByText(/공개 세계관과 독자 설정 위키에 나가는 글은/)).toBeNull() // 문장 대신 탭이 알린다
  fireEvent.change(docBody('IDENTITY.md'), { target: { value: '가'.repeat(3001) } })
  expect(tab('정체성 IDENTITY.md 3,000자 초과')).toBeTruthy() // 3,000자 초과도 탭 안의 글자다
})

it('문서 탭 줄은 편집기 바로 위에 붙고, 그 사이에는 문서 안내 한 줄만 있다', async () => {
  await show([person('가람', '기존 내용')])
  openCard('가람 인물')
  const nav = docsPanel().getByRole('navigation', { name: '인물 문서 목록' })
  const guide = nav.nextElementSibling
  expect(guide?.textContent).toBe('IDENTITY.md · 공개 — 누구인가: 이름·나이·소속·외형·역할.') // 탭 줄 바로 다음이 문서 안내이고, 고른 문서의 공개 범위가 거기 붙는다
  expect(guide?.nextElementSibling?.classList.contains('world-card-editor')).toBe(true) // 그다음이 편집기
  openMemory() // 회차 기억을 펼쳐도 그 안은 탭 줄 안이라 편집기와의 사이는 그대로다
  expect(nav.nextElementSibling).toBe(guide)
  expect(nav.contains(episodeField())).toBe(true)
  pickDoc('SOUL.md 정리 필요')
  expect(nav.nextElementSibling?.textContent).toBe('SOUL.md · 작가만 — 어떻게 생각하고 말하는가: 성격·가치관·말투·욕망·두려움.')
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
  act(() => docButton('GOAL.md').focus()) // Tab으로 밖에 초점이 가도
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
/** 서버가 검토 응답에 싣는 기준: 수정안이 가리킨 카드마다 검토한 초안(저장본)의 그 카드 글. */
const basisOfFixes = (findings: ReviewFinding[]): ReviewBasis => Object.fromEntries(findings.flatMap(({ fix }) => {
  const row = savedRows.find((s) => s.item.id === fix?.cardId)
  return row ? [[row.item.id, { body: row.item.text, ...(row.characterDocs && { characterDocs: row.characterDocs }) }]] : []
}))
const reviewOf = (findings: ReviewFinding[], over: Partial<WorldReview> = {}): WorldReview =>
  ({ reviewedCards: 3, totalCards: 3, findings, reviewedAt: new Date(2026, 10, 19, 9, 5), basis: basisOfFixes(findings), ...over })
/**
 * 검토 요청 대역. 호출은 (세계관 id, 취소 신호)로 기록되고 결과는 만든 쪽이 정한다(약속을 주면 끝나는 때도 정한다).
 * `last`는 서버가 저장한 마지막 검토(세계관을 열 때 읽는다, #555): 기본은 없음(404 → null)이고 Error면 읽기 실패다. 읽기 대역은 `review.latest`다.
 */
const reviewing = (result: WorldReview | Error | Promise<WorldReview> = reviewOf([]), last: WorldReview | Error | null = null) => {
  const review = vi.fn(async (_world: string, _signal?: AbortSignal): Promise<WorldReview> => {
    if (result instanceof Error) throw result
    return result
  })
  const latest = vi.fn(async (_world: string, _signal?: AbortSignal): Promise<WorldReview | null> => {
    if (last instanceof Error) throw last
    return last
  })
  reviewCase = new WorldReviewUseCase({ review, latest })
  return Object.assign(review, { latest })
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
const rowOf = (title: string) => dataRows(boardTable()).find((row) => row.querySelector('.col-title button')?.textContent === title)!
const titles = () => dataRows(boardTable()).slice(1).map((row) => row.querySelector('.col-title button')?.textContent)
/** 한 줄의 상태 칸. 좁은 배치용 제목 아래 줄(.world-row-status)의 같은 칩은 CSS가 좁을 때만 보이는데 jsdom에는 CSS가 없어 둘 다 있으므로, 칩은 늘 이 칸에서 찾는다. */
const statusCell = (title: string) => within(rowOf(title).querySelector<HTMLElement>('td.col-status')!)
/** 한 줄의 상태 칸 칩 글(정리 필요·연결 필요·공개 순서 N·AI 의견 N). */
const todos = (title: string) => Array.from(rowOf(title).querySelectorAll('td.col-status .world-todo'), (badge) => badge.textContent)
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
  expect(ask.queryByRole('alert')).toBeNull() // 데모는 마지막 검토를 읽지 않아 '불러오지 못했어요'도 없다(#555)
})

it('설정집 게시판은 사건·사물 카드가 인물과 승인된 관계로 이어지지 않으면 연결 필요를 보이고, 관계를 이으면 사라진다', async () => {
  const garam = withDocs(person('가람', '본문'), { soul: '성격', goal: '목표' })
  const [war, sword, harbor] = [eventCard('전쟁'), objectCard('성검'), place('항구')]
  const settings = putRelation([garam, war, sword, harbor], { subjectId: garam.item.id, targetId: sword.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '쥐고 있다' })
  await show(settings)
  expect(titles()).toEqual(['가람', '항구', '전쟁', '성검'])
  expect(['가람', '항구', '전쟁', '성검'].map(todos)).toEqual([[], [], ['연결 필요'], []]) // 사건 전쟁만 인물과 이어지지 않았다. 장소는 대상이 아니다
})

it('빈 분류를 선택하면 목록만 바뀌고 추가를 누르면 해당 유형으로 새 편집기를 연다', async () => {
  const filled = { soul: '성격', goal: '목표' }
  await show([withDocs(person('가람', '본문'), filled), place('항구')])
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: '가람' } })
  const category = cats().getByRole('button', { name: '조직 비어 있음' })
  category.focus()
  expect(document.activeElement).toBe(category)
  fireEvent.click(category)
  expect(category.getAttribute('aria-current')).toBe('true')
  expect(cats().getByRole('button', { name: '전체 2' })).toBeTruthy()
  expect(screen.getByText('아직 조직 설정이 없어요.')).toBeTruthy()
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull()
  expect(screen.queryByRole('region', { name: '선택한 설정 편집' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '+ 조직 설정 추가' }))
  expect(overview().getByRole('combobox', { name: '유형' })).toHaveProperty('value', 'organization')
  expect(where()).toMatch(/card=/)
  fireEvent.change(editor().getByRole('textbox', { name: '설정 이름' }), { target: { value: '활빈당' } })
  backToBoard()
  expect(cats().getByRole('button', { name: '전체 3' })).toBeTruthy()
  expect(cats().getByRole('button', { name: '조직 1' }).getAttribute('aria-current')).toBe('true')
  expect(boardTable().getByRole('button', { name: '활빈당 조직' })).toBeTruthy()
})

it('카드가 하나도 없을 때도 전체의 시작 안내와 분류별 추가를 제공한다', async () => {
  await show([])
  expect(cats().getAllByRole('button', { name: /비어 있음/ })).toHaveLength(6)
  expect(boardTable().getByText('설정을 추가해 시작해 보세요.').closest('td')!.colSpan).toBe(8) // 빈 안내 줄도 표의 열 수와 같다
  fireEvent.click(cats().getByRole('button', { name: '기타 비어 있음' }))
  fireEvent.click(screen.getByRole('button', { name: '+ 기타 설정 추가' }))
  expect(overview().getByRole('combobox', { name: '유형' })).toHaveProperty('value', 'other')
})

it('AI 의견 N은 카드 줄에 붙고 누르면 그 카드의 편집 화면이 열리며, 보완 필요 분류는 상태가 있는 카드만 보인다', async () => {
  const filled = { soul: '성격', goal: '목표' }
  const [garam, harbor, tower] = [withDocs(person('가람', '본문'), filled), place('항구'), place('탑')]
  await show([garam, harbor, tower])
  expect(cats().queryByRole('button', { name: /보완 필요/ })).toBeNull() // 보완할 카드가 없으면 분류도 없다
  reviewing(reviewOf([finding([harbor.item.id]), finding([harbor.item.id, garam.item.id])]))
  await runReview()
  expect(['가람', '항구', '탑'].map(todos)).toEqual([['AI 의견 1'], ['AI 의견 2'], []])
  expect(statusCell('항구').getByRole('button', { name: '항구 AI 의견 2건 보기' }).textContent).toBe('AI 의견 2')
  fireEvent.click(cats().getByRole('button', { name: '보완 필요 2' }))
  expect(titles()).toEqual(['가람', '항구'])
  expect(cats().getByRole('button', { name: '보완 필요 2' }).getAttribute('aria-current')).toBe('true')
  expect(cats().getByRole('button', { name: /^전체/ }).getAttribute('aria-current')).toBeNull()
  fireEvent.click(cats().getByRole('button', { name: /^장소/ }))
  expect(titles()).toEqual(['항구', '탑'])
  expect(cats().getByRole('button', { name: '보완 필요 2' }).getAttribute('aria-current')).toBeNull() // 분류를 고르면 보완 필요는 풀린다
  fireEvent.click(statusCell('항구').getByRole('button', { name: '항구 AI 의견 2건 보기' }))
  expect(where()).toMatch(/card=/)
  expect(editor().getByRole('textbox', { name: '설정 이름' })).toHaveProperty('value', '항구')
  expect(findings().getAllByRole('listitem')).toHaveLength(2)
})

it('정리 필요·연결 필요·AI 의견은 한 줄에 함께 보이고 보완 필요 분류가 셋 모두를 센다', async () => {
  const [garam, war] = [person('가람', '본문'), eventCard('전쟁')] // 가람은 SOUL이 비어 정리 필요, 전쟁은 연결 필요
  await show([garam, war])
  expect(['가람', '전쟁'].map(todos)).toEqual([['정리 필요'], ['연결 필요']])
  reviewing(reviewOf([finding([war.item.id])]))
  await runReview()
  expect(['가람', '전쟁'].map(todos)).toEqual([['정리 필요'], ['연결 필요', 'AI 의견 1']])
  expect(cats().getByRole('button', { name: '보완 필요 2' })).toBeTruthy()
})

/** 상태 칸 테스트용 설정집: 가람은 정리 필요, 전쟁은 연결 필요, 궁궐은 공개 순서 1, 항구는 상태 없음 */
const statusWorld = () => {
  const [garam, war, harbor] = [person('가람', '본문'), eventCard('전쟁'), place('항구')]
  const hall = { ...place('궁궐'), revealFromEpisode: 1 }
  hall.item.text = '승상이 사는 곳.'
  const minister = { ...place('승상'), revealFromEpisode: 5 }
  return { garam, war, harbor, hall, minister, settings: [garam, war, harbor, hall, minister] }
}

it('설정집 게시판에는 상태 칸이 있어 정리 필요·연결 필요·공개 순서 N이 제목 옆이 아니라 그 칸에 모이고, 상태가 없는 줄은 —다', async () => {
  await show(statusWorld().settings)
  expect(boardTable().getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['보이는 설정 모두 선택', '번호', '분류', '제목', '상태', '요약', '공개', '연결'])
  expect(['가람', '전쟁', '궁궐', '항구', '승상'].map(todos)).toEqual([['정리 필요'], ['연결 필요'], ['공개 순서 1'], [], []])
  const empty = rowOf('항구').querySelector('td.col-status')!
  expect([empty.querySelector('[aria-hidden=true]')!.textContent, empty.querySelector('.sr-only')!.textContent]).toEqual(['—', '없음']) // 칸이 비면 줄임표 대신 —(읽는 사람에게는 없음)
  for (const title of ['가람', '전쟁', '궁궐']) {
    const besideTitle = Array.from(rowOf(title).querySelectorAll('.col-title .world-todo'))
    expect(besideTitle.every((chip) => chip.closest('.world-row-status')), title).toBe(true) // 제목 바로 옆에는 칩이 없다: 좁은 배치의 제목 아래 줄에만 있다
  }
})

it('좁은 배치용으로 같은 칩이 제목 아래 한 줄(.world-row-status)에도 있고(CSS가 좁은 컨테이너에서만 보이며 눌러도 같은 편집 화면이 열린다), 상태가 없는 줄에는 그 줄이 없다', async () => {
  const { garam, settings } = statusWorld()
  await show(settings)
  const line = rowOf('가람').querySelector<HTMLElement>('.col-title .world-row-status')!
  expect(Array.from(line.querySelectorAll('button'), (button) => [button.textContent, button.getAttribute('aria-label')])).toEqual([['정리 필요', '가람 정리 필요 보기']]) // 상태 칸과 같은 칩
  expect(rowOf('항구').querySelector('.col-title .world-row-status')).toBeNull()
  fireEvent.click(line.querySelector('button')!)
  expect(where()).toBe('/worldstudio/qa?card=' + garam.item.id)
  expect(screen.queryByRole('region', { name: '가람 미리보기' })).toBeNull() // 줄까지 올라가 미리보기를 열지도 않는다
})

/** 관계도 상자(.card-relmap)의 화면 폭을 정한다(jsdom에는 배치가 없어 clientWidth가 늘 0이다). */
const mapWidth = (px: number) => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('card-relmap') ? px : 0 })

it('좁은 상자에서도 카드별 관계도 글자는 축소되지 않는다(이름 12px·선 이름 11px): 편집 화면 관계 탭과 게시판 미리보기 모두 viewBox 가로가 상자 폭 그대로이고 둘레 이웃이 줄어든다', async () => {
  const [garam, ...others] = ['가람', ...Array.from({ length: 11 }, (_, i) => '이웃' + i)].map((name) => person(name))
  const settings = others.reduce((rows, other, i) => putRelation(rows, { subjectId: garam.item.id, targetId: other.item.id, predicate: 'custom_relation', polarity: 'asserted', title: '동료', text: '동료 ' + i, fromEpisode: 1 }), [garam, ...others])
  mapWidth(306)
  await show(settings)
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' })) // 게시판 미리보기
  const inPreview = previewOf('가람').getByRole('region', { name: '카드별 관계도' }).querySelector('svg')!
  expect(inPreview.getAttribute('viewBox')).toBe('0 0 306 300')
  expect(inPreview.querySelectorAll('.card-relmap-node')).toHaveLength(8) // 이웃 11명 중 8명만 둘레에 둔다
  fireEvent.click(previewOf('가람').getByRole('button', { name: '수정하기' }))
  const inEditor = relations().getByRole('region', { name: '카드별 관계도' }).querySelector('svg')! // 편집 화면 관계 탭
  expect(inEditor.getAttribute('viewBox')).toBe('0 0 306 300')
  expect(inEditor.querySelectorAll('.card-relmap-node')).toHaveLength(8)
})

it('상태 칩을 누르면 미리보기를 거치지 않고 그 카드의 편집 화면이 칩에 맞는 화면으로 열린다: 정리 필요·AI 의견은 문서, 연결 필요는 관계, 공개 순서 N은 공개 순서', async () => {
  const { garam, war, hall, settings } = statusWorld()
  await show(settings)
  reviewing(reviewOf([finding([garam.item.id])]))
  await runReview()
  expect(todos('가람')).toEqual(['정리 필요', 'AI 의견 1'])
  const press = (title: string, name: string) => fireEvent.click(statusCell(title).getByRole('button', { name }))
  const tab = () => screen.getByRole('tab', { selected: true }).querySelector('.world-activity-label')!.textContent // 배지 글자는 빼고 화면 이름만
  press('가람', '가람 정리 필요 보기')
  expect([where(), tab()]).toEqual(['/worldstudio/qa?card=' + garam.item.id, '문서'])
  backToBoard()
  expect(screen.queryByRole('region', { name: /미리보기/ })).toBeNull() // 칩은 줄까지 올라가 미리보기를 열지 않는다(편집 화면 뒤의 숨은 게시판이 아니라 돌아온 게시판에서 확인)
  press('가람', '가람 AI 의견 1건 보기')
  expect([where(), tab()]).toEqual(['/worldstudio/qa?card=' + garam.item.id, '문서'])
  backToBoard()
  press('전쟁', '전쟁 연결 필요 보기')
  expect([where(), tab()]).toEqual(['/worldstudio/qa?card=' + war.item.id + '&pane=relations', '관계'])
  backToBoard()
  press('궁궐', '궁궐 공개 순서 1건 보기')
  expect([where(), tab()]).toEqual(['/worldstudio/qa?card=' + hall.item.id + '&pane=order', '공개 순서'])
  backToBoard()
  expect(where()).toBe('/worldstudio/qa') // 돌아오면 주소에서 card와 pane이 모두 빠진다
  press('가람', '가람 정리 필요 보기') // 다시 문서로: 지난번 화면(공개 순서)이 남지 않는다
  expect(tab()).toBe('문서')
})

it('정렬의 보완 필요 많은 순은 정리 필요·연결 필요·공개 순서·AI 의견을 모두 센 수가 많은 카드부터 보이고 같은 수는 설정집 순서를 지키며 번호를 다시 매긴다', async () => {
  const [garam, narae, war, harbor] = [person('가람', '본문'), person('나래', '본문'), eventCard('전쟁'), place('항구')]
  await show([garam, narae, war, harbor])
  reviewing(reviewOf([finding([narae.item.id]), finding([narae.item.id])]))
  await runReview()
  expect(titles()).toEqual(['가람', '나래', '항구', '전쟁']) // 설정집 순서(분류 순 → 넣은 순서)
  const sort = screen.getByRole<HTMLSelectElement>('combobox', { name: '정렬' })
  expect(Array.from(sort.options, (o) => o.textContent)).toEqual(['설정집 순', '연결 많은 순', '가나다순', '보완 필요 많은 순'])
  fireEvent.change(sort, { target: { value: 'status' } })
  expect(titles()).toEqual(['나래', '가람', '전쟁', '항구']) // 나래 3(정리 필요 1 + AI 의견 2) > 가람 1 = 전쟁 1 > 항구 0
  expect(dataRows(boardTable()).slice(1).map((row) => row.querySelector('.col-no')!.textContent)).toEqual(['1', '2', '3', '4'])
  fireEvent.change(sort, { target: { value: 'name' } })
  expect(titles()).toEqual(['가람', '나래', '전쟁', '항구'])
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
// ── 마지막 검토 읽기(#555): 서버가 저장한 마지막 검토를 세계관을 열 때 읽어 검토 직후와 같은 상태로 채운다 ───────────────────────────
it('세계관을 열면 서버가 저장한 마지막 검토를 읽어, 요청 없이도 버튼 이름·게시판·시트 요약·편집 화면에 검토 직후와 같이 보인다', async () => {
  const filled = { soul: '성격', goal: '목표' }
  const [garam, harbor] = [withDocs(person('가람', '기존 내용'), filled), place('항구')]
  const stored = reviewOf(
    [finding([garam.item.id], { kind: 'doc_role', message: '본문이 짧아요.', fix: { cardId: garam.item.id, target: 'body', text: '새 본문' } }), finding([harbor.item.id])],
    { reviewedCards: 2, totalCards: 2, reviewedAt: new Date(2026, 10, 18, 22, 7), basis: { [garam.item.id]: { body: '기존 내용' } } },
  )
  const review = reviewing(undefined, stored)
  await show([garam, harbor])
  expect(await screen.findByRole('button', { name: 'AI 검토 · 의견 2' })).toBeTruthy()
  expect(review.latest).toHaveBeenCalledOnce()
  expect(review.latest.mock.calls[0][0]).toBe('qa')
  expect(review).not.toHaveBeenCalled() // 읽기만 하고 새로 검토하지 않는다
  expect(['가람', '항구'].map(todos)).toEqual([['AI 의견 1'], ['AI 의견 1']])
  fireEvent.click(screen.getByRole('button', { name: /^AI 검토/ }))
  const ask = askSection()
  expect(ask.getByText('AI 의견 2건 · 카드 2장 · 22:07 검토').getAttribute('role')).toBe('status') // 시각은 서버가 저장한 검토 시각이다
  expect(ask.getByRole('button', { name: '다시 검토 요청' })).toBeTruthy()
  expect(ask.queryByRole('alert')).toBeNull()
  fireEvent.click(aiSheet().getByRole('button', { name: '닫기' }))
  openCard('가람 인물')
  expect(findings().getByText('본문이 짧아요.')).toBeTruthy()
  expect(findings().getByText(/22:07 검토/)).toBeTruthy()
  fireEvent.click(findings().getByRole('button', { name: '수정안 보기' }))
  expect(findings().getByRole<HTMLButtonElement>('button', { name: '초안에 반영' }).disabled).toBe(false) // 기준과 지금 글이 같다
})

it('마지막 검토를 읽지 못하면(404 외) 시트에 지난 검토 결과를 불러오지 못했어요 알림만 보이고, 화면은 그대로 쓸 수 있으며 새 검토가 성공하면 알림이 사라진다', async () => {
  const review = reviewing(reviewOf([]), new Error('서버가 응답하지 않아요.'))
  await showWorld()
  fireEvent.click(screen.getByRole('button', { name: 'AI 검토' })) // 읽지 못했으니 의견 수는 없다
  const ask = askSection()
  expect((await ask.findByRole('alert')).textContent).toBe('지난 검토 결과를 불러오지 못했어요') // 서버가 준 문구는 쓰지 않는다
  expect(ask.queryByText(SUMMARY)).toBeNull()
  expect(boardTable()).toBeTruthy() // 게시판은 그대로 쓸 수 있다
  agree(ask)
  const send = ask.getByRole<HTMLButtonElement>('button', { name: '설정집 검토 요청' })
  expect(send.disabled).toBe(false) // 새 검토 요청도 막지 않는다
  fireEvent.click(send)
  await ask.findByText(SUMMARY)
  expect(ask.queryByRole('alert')).toBeNull()
  expect(review).toHaveBeenCalledOnce()
})

it('새로 고친 뒤에도 잠금은 응답의 기준으로 계산한다: 지금 글이 기준과 다르면 검토 뒤 바뀐 설정이라 반영할 수 없다고 알리고 반영을 잠근다', async () => {
  const garam = withDocs(person('가람', '서버에서 바뀐 본문'), { soul: '성격', goal: '목표' })
  const stored = reviewOf([finding([garam.item.id], { fix: { cardId: garam.item.id, target: 'body', text: '수정안 본문' } })], { basis: { [garam.item.id]: { body: '검토 때의 본문' } } })
  reviewing(undefined, stored)
  await show([garam])
  await screen.findByRole('button', { name: 'AI 검토 · 의견 1' })
  openCard('가람 인물')
  fireEvent.click(findings().getByRole('button', { name: '수정안 보기' }))
  const apply = findings().getByRole<HTMLButtonElement>('button', { name: '초안에 반영' })
  expect(apply.disabled).toBe(true)
  expect(apply.getAttribute('aria-describedby')).toBe(findings().getByText('검토 뒤 바뀐 설정이라 반영할 수 없어요').id)
  expect(within(findings().getByRole('region', { name: '지금 글' })).getByText('서버에서 바뀐 본문')).toBeTruthy()
})

it('지금 초안에 없는 카드의 지적은 버튼 이름의 의견 수·게시판·시트 요약에 보이지 않는다', async () => {
  const garam = withDocs(person('가람', '본문'), { soul: '성격', goal: '목표' })
  const stored = reviewOf([finding([garam.item.id]), finding([crypto.randomUUID()]), finding([crypto.randomUUID(), garam.item.id])])
  reviewing(undefined, stored)
  await show([garam])
  expect(await screen.findByRole('button', { name: 'AI 검토 · 의견 2' })).toBeTruthy() // 3건 중 지금 초안에 남은 카드를 가리킨 2건
  expect(todos('가람')).toEqual(['AI 의견 2'])
  fireEvent.click(screen.getByRole('button', { name: /^AI 검토/ }))
  expect(askSection().getByText(/^AI 의견 2건 · 카드 3장 · /)).toBeTruthy()
})

const withImage = (row: StudioSetting, imageId = CARD_IMAGE): StudioSetting => ({ ...row, imageId })
const imageGroup = () => { openPane('개요'); return within(screen.getByRole('group', { name: '대표 이미지' })) } // 대표 이미지 타일은 개요 탭에 있다
const imageInput = (label = '이미지 추가') => imageGroup().getByLabelText<HTMLInputElement>(label)
const pickImage = (file: File, label = '이미지 추가') => fireEvent.change(imageInput(label), { target: { files: [file] } })
const preview = () => { if (screen.queryByRole('tablist', { name: '카드 화면' })) openPane('개요'); return document.querySelector<HTMLImageElement>('.world-card-tile img') }
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
  // 대표 이미지 타일은 개요 탭에서 카드 기본값 칸(유형·공개 범위·분류…) 옆에 있고 가운데 머리는 이름 입력 하나다.
  const box = input.closest('.world-overview')!
  expect(Array.from(box.children, (child) => child.className.split(' ')[0])).toEqual(['world-card-image', 'world-overview-fields'])
  expect(Array.from(box.querySelector('.world-overview-fields')!.children, (child) => child.className.split(' ')[0]).slice(0, 2)).toEqual(['field', 'world-card-reach'])
  expect(overview().getByRole('combobox', { name: '유형' })).toBeTruthy()
  expect(Array.from(document.querySelector('.world-card-header')!.children, (child) => child.className.split(' ')[0])).toEqual(['et'])
  // 이미지가 없으면 타일 자체가 점선 빈 칸이고, 그 안이 파일 선택(이미지 추가)이며 안내도 타일 안에 있다.
  const tile = box.querySelector('.world-card-tile')!
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
  fireEvent.change(overview().getByRole('combobox', { name: '유형' }), { target: { value: 'character' } }) // 같은 카드의 유형 변경(장소 → 인물)
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
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 올리는 중에는 초안이 바뀌지 않았다
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
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
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
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
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
  expect(saveBar().getByText('저장하지 않은 변경 있음')).toBeTruthy()
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
  expect(saveBar().getByText('저장됨')).toBeTruthy() // 실패는 초안을 바꾸지 않는다
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

it('본문 편집기는 같은 세계관의 다른 카드를 설정 링크 대상으로 받고(편집 중인 카드는 뺀다) 고른 카드의 편집 화면을 열며, 인물의 SOUL 문서 편집기에는 설정 링크가 없다 (DEC-53)', async () => {
  const [garam, narae, harbor] = [person('가람', '본문'), person('나래', '본문'), place('항구')]
  narae.aliases = ['서약사']
  await show([garam, narae, harbor])
  fakeEditor.cardLinks.clear()
  openCard('가람 인물')
  expect(fakeEditor.cardLinks.get('IDENTITY.md')!.cards.map((c) => [c.title, c.type, c.aliases])).toEqual([['나래', '인물', ['서약사']], ['항구', '장소', undefined]])
  pickDoc('SOUL.md 정리 필요')
  expect(fakeEditor.cardLinks.get('SOUL.md')).toBeUndefined() // 설정 링크는 카드 본문(IDENTITY.md)에만 있다
  pickDoc('IDENTITY.md')
  act(() => fakeEditor.cardLinks.get('IDENTITY.md')!.open(harbor.item.id)) // 미리보기의 링크를 누른 것처럼
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('항구')
})

it('이른 카드의 글에 더 늦게 공개되는 카드의 이름이 나오면 게시판에 공개 순서 확인이 뜨고 편집 화면은 이름 아래 배지와 공개 순서 패널로 어느 글에 어떤 이름인지 알리며 저장은 막지 않는다 (DEC-53)', async () => {
  const hall = { ...place('궁궐'), revealFromEpisode: 1 }
  hall.item.text = '승상이 사는 곳.'
  const minister = { ...place('승상'), revealFromEpisode: 5 }
  const { saveStudio } = await show([hall, minister])
  expect(todos('궁궐')).toEqual(['공개 순서 1'])
  expect(todos('승상')).toEqual([])
  openCard('궁궐 장소')
  expect(screen.queryByText('공개 순서 문제 없음')).toBeNull() // 문제가 있으면 개요 화면의 문제 없음 줄이 없다
  expect(screen.queryByRole('region', { name: '공개 순서 확인' })).toBeNull() // 경고 목록은 공개 순서 화면에서만 보인다(문서 화면에는 이름 아래 작은 배지뿐)
  fireEvent.click(editor().getByRole('button', { name: '공개 순서 확인 1' }))
  expect(screen.getByRole('tab', { name: /^공개 순서/ }).getAttribute('aria-selected')).toBe('true') // 배지를 누르면 공개 순서 화면으로 바뀐다
  expect(where()).toContain('pane=order')
  const panel = () => orderPanel()
  const line = () => panel().getByRole('button', { name: '승상' }).closest('p')!.textContent
  expect(line()).toBe('승상 — 5화부터 공개 · 본문 1')
  expect([...panel().getByText('자세히').closest('details')!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['본문에 ‘승상’이(가) 나와요 · 이 글은 1화부터 독자에게 보여요'])
  openPane('문서')
  fireEvent.change(editor().getByRole('textbox', { name: '설명' }), { target: { value: '승상이 사는 곳!' } }) // 이름이 그대로 있어 경고는 남는다
  expect(line()).toBe('승상 — 5화부터 공개 · 본문 1')
  backToBoard()
  expect(saveBar().getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(false) // 알리기만 하고 저장을 막지 않는다
  saveWorld()
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  openCard('궁궐 장소')
  fireEvent.click(panel().getByRole('button', { name: '승상' })) // 이름이 나온 카드로 옮겨 간다
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('승상')
  expect(screen.queryByRole('region', { name: '공개 순서 확인' })).toBeNull() // 그 카드의 글에는 경고가 없다(공개 순서 화면은 그대로이고 문제 없음 한 줄)
  expect(screen.getByRole('tab', { name: '공개 순서' }).querySelector('.world-activity-badge')).toBeNull() // 배지도 없다
  expect(editor().queryByRole('button', { name: /^공개 순서 확인/ })).toBeNull()
  openPane('문서')
  fireEvent.change(editor().getByRole('textbox', { name: '설명' }), { target: { value: '승상은 궁궐에 산다.' } }) // 늦은 카드가 이른 카드의 이름을 말하는 것은 괜찮다
  expect(screen.queryByRole('region', { name: '공개 순서 확인' })).toBeNull()
})

it('관계 문구의 공개 순서 확인은 두 설정이 공개되는 회차와 관계를 기록한 회차(N화부터) 가운데 가장 늦은 회차부터 독자에게 보인다고 알린다 (DEC-53·54)', async () => {
  const [lian, kael] = [{ ...person('리안'), revealFromEpisode: 1 }, { ...person('카엘'), revealFromEpisode: 1 }]
  const seraphin = { ...person('세라핀'), revealFromEpisode: 3 }
  const secret = { ...person('검은 옷의 사내'), revealFromEpisode: undefined } // 작가 전용
  const relate = (subject: StudioSetting, target: StudioSetting, title: string, text: string, fromEpisode?: number) =>
    ({ subjectId: subject.item.id, targetId: target.item.id, predicate: 'custom_relation_directed', polarity: 'asserted' as const, title, text, fromEpisode })
  let settings = putRelation([lian, kael, seraphin, secret], relate(kael, lian, '보호', '세라핀의 부탁으로 지킨다', 2)) // 2화에 기록: 세라핀(3화부터 공개)보다 이르다
  settings = putRelation(settings, relate(lian, kael, '믿음', '세라핀이 보증했다', 3)) // 3화에 기록: 세라핀이 공개된 뒤라 괜찮다
  settings = putRelation(settings, relate(lian, kael, '동행', '세라핀과 길을 떠난다')) // 기록 회차를 모르면 두 설정이 공개되는 1화부터다
  settings = putRelation(settings, relate(kael, lian, '의심', '검은 옷의 사내를 닮았다', 4)) // 작가 전용 이름은 언제 기록해도 늦다
  await show(putRelation(settings, { ...relate(lian, kael, '약속', '검은 옷의 사내와 만난다', 6), recordedFrom: 2 })) // 2화에 기록된 관계를 6화로 늦춰도 2화 연결이 남아 2화부터 보인다
  openCard('리안 인물')
  const groups = orderPanel().getAllByRole('listitem').filter((li) => li.classList.contains('world-finding')) // 같은 카드 이름은 한 줄로 묶인다(경고가 많은 카드, 같으면 이름 순)
  expect(groups.map((li) => li.querySelector('p')!.textContent)).toEqual([
    '검은 옷의 사내 — 작가 전용 · 관계 글 2곳 (2·4화)',
    '세라핀 — 3화부터 공개 · 관계 글 2곳 (1·2화)',
  ])
  expect(groups.map((li) => [...li.querySelectorAll('details li')].map((d) => d.textContent))).toEqual([
    ['관계 ‘의심’의 글에 ‘검은 옷의 사내’이(가) 나와요 · 이 글은 4화부터 독자에게 보여요', '관계 ‘약속’의 글에 ‘검은 옷의 사내’이(가) 나와요 · 이 글은 2화부터 독자에게 보여요'],
    ['관계 ‘보호’의 글에 ‘세라핀’이(가) 나와요 · 이 글은 2화부터 독자에게 보여요', '관계 ‘동행’의 글에 ‘세라핀’이(가) 나와요 · 이 글은 1화부터 독자에게 보여요'],
  ])
  expect(screen.queryByText(/알 수 없어요/)).toBeNull() // 관계를 처음 기록한 회차를 모른다는 단서는 더 이상 붙지 않는다
})

// ── #553 AI·외부 도구(MCP) 변경 감시 연결 ──
it('AI·외부 도구 변경 감시에 열린 세계관 id와 저장하지 않은 변경 여부, 다시 읽기를 넘긴다', async () => {
  await show()
  expect(mcp.watch).toHaveBeenLastCalledWith({ targetType: 'world', targetId: 'qa', dirty: false, reload: expect.any(Function) })
  dirtyCard() // 설정 카드를 고쳐 초안을 바꾼다
  expect(mcp.watch).toHaveBeenLastCalledWith({ targetType: 'world', targetId: 'qa', dirty: true, reload: expect.any(Function) })
})

it.each([false, true])('다른 곳에서 바뀌었다는 배너는 설정집 화면과 설정 편집 화면(%s)에 보이고, 다시 불러오기를 누르면 감시 훅의 reload를 부른다', async (editing) => {
  mcp.stale = true
  await show()
  if (editing) openCard('가람 인물')
  const banner = screen.getByText('다른 곳에서 바뀌었어요').closest('[role="status"]') as HTMLElement
  expect(!!banner.closest('.world-card-studio')).toBe(editing)
  fireEvent.click(within(banner).getByRole('button', { name: '다시 불러오기' }))
  expect(mcp.reload).toHaveBeenCalledTimes(1)
})

it('다른 곳에서 바뀐 세계관을 다시 읽으면 열어 둔 카드 편집기가 서버의 새 글로 다시 열리고 저장하지 않은 입력은 버려진다', async () => {
  const garam = person('가람', '기존 내용')
  let served = '기존 내용'
  const read = async (): Promise<StudioWorld> => ({ id: 'qa', name: '검증 세계', description: '설명', version: 1, settings: [{ ...structuredClone(garam), item: { ...garam.item, text: served } }], analysis: null })
  await show([garam], '/worldstudio/qa', { read })
  openCard('가람 인물')
  fireEvent.change(body(), { target: { value: '저장하지 않은 입력' } })
  expect(mcp.watch).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true }))
  served = '다른 곳에서 바뀐 글'
  const { reload } = mcp.watch.mock.lastCall![0] as { reload: () => Promise<boolean> }
  await act(async () => { expect(await reload()).toBe(true) })
  expect(body().value).toBe('다른 곳에서 바뀐 글')
  expect(mcp.watch).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: false }))
})

// ── 기능별 탭(개요·소설 연결)·게시판 미리보기·사이드바 접기(audit 단계: R1~R4) ──────────────────────────
/** '소설 연결' 탭(연결된 소설과 그 Fork): 이 탭 안에서만 찾는다. */
const novelTab = () => within(screen.getByRole('region', { name: '소설 연결' }))
const readingApi = () => appContainer.resolve('readingUseCase')
const forkWork = (id: string, title: string, over: Partial<ReadingWork> = {}) => ({ id, title, author: '작가', forkAt: 2, eps: [{ t: '1화', p: ['본문'] }], ...over }) as ReadingWork
const previewOf = (title: string) => within(screen.getByRole('region', { name: title + ' 미리보기' }))

it('관리 모드 헤더에는 정보 편집 버튼·연결된 소설 줄·소설 버튼이 없고(개요·소설 연결 탭으로 옮겼다) 작성 모드(마법사) 헤더는 그대로다', async () => {
  await showWorld()
  expect(headerOf().queryByRole('button', { name: '세계관 정보 편집' })).toBeNull()
  expect(headerOf().queryByRole('button', { name: '편집' })).toBeNull()
  expect(headerOf().queryByText(/연결된 소설/)).toBeNull()
  expect(headerOf().queryByRole('button', { name: /소설 (연결|작성)하기/ })).toBeNull()
  expect(headerOf().queryByRole('link', { name: '소설 작성하기' })).toBeNull()
  cleanup()
  await wizard()
  expect(headerOf().getByText('연결된 소설이 없어요.')).toBeTruthy()
  expect(headerOf().getByRole('button', { name: '소설 연결하기' })).toBeTruthy()
  expect(headerOf().queryByRole('button', { name: '집필 메모 추가' })).toBeNull() // 작성 모드 헤더에도 없다
  expect(headerOf().getByRole('button', { name: '관리 화면으로' })).toBeTruthy()
})

it('보기 메뉴는 개요·설정집·관계도·시간선·소설 연결 다섯 개이고, 개요·소설 연결은 주소 ?view=overview|novel로 열려 그 탭의 내용만 보인다', async () => {
  await showWorld()
  expect(manageTabs().getAllByRole('button').map((b) => b.textContent)).toEqual(['개요', '설정집', '관계도', '시간선', '소설 연결'])
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull() // 기본 보기는 설정집이다
  fireEvent.click(manageTabs().getByRole('button', { name: '개요' }))
  expect(where()).toBe('/worldstudio/qa?view=overview')
  expect(manageTabs().getByRole('button', { name: '개요' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('form', { name: '세계관 정보 편집' })).toBeTruthy()
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull()
  expect(screen.queryByRole('region', { name: '소설 연결' })).toBeNull()
  fireEvent.click(manageTabs().getByRole('button', { name: '소설 연결' }))
  expect(where()).toBe('/worldstudio/qa?view=novel')
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull()
  expect(screen.getByRole('region', { name: '소설 연결' })).toBeTruthy()
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(where()).toBe('/worldstudio/qa')
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
  cleanup()
  await show(undefined, '/worldstudio/qa?view=overview') // 새로 고침하면 그 탭
  expect(screen.getByRole('form', { name: '세계관 정보 편집' })).toBeTruthy()
  cleanup()
  await show(undefined, '/worldstudio/qa?view=foo') // 모르는 값은 설정집
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
})

it('개요 탭에 다녀와도 설정집 게시판의 선택 상태는 남는다(게시판은 숨길 뿐 지우지 않는다)', async () => {
  await show([person('가람'), person('나래')])
  fireEvent.click(screen.getByLabelText('나래 선택'))
  fireEvent.click(manageTabs().getByRole('button', { name: '개요' }))
  expect(screen.queryByRole('table', { name: '설정 카드 목록' })).toBeNull()
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(screen.getByLabelText<HTMLInputElement>('나래 선택').checked).toBe(true)
})

it('개요 탭 폼은 열어도 입력으로 초점을 옮기지 않고 Esc로 닫히지 않으며, 저장하면 탭은 그대로 두고 헤더 제목을 바꾸고 저장했어요를 알린다', async () => {
  const { saveStudio } = await show(undefined, '/worldstudio/qa?view=overview')
  expect(document.activeElement).toBe(document.body) // 메뉴에서 탭을 옮기다 입력칸으로 끌려가지 않는다
  const form = within(screen.getByRole('form', { name: '세계관 정보 편집' }))
  fireEvent.keyDown(form.getByRole('textbox', { name: '세계관 이름' }), { key: 'Escape' })
  expect(screen.getByRole('form', { name: '세계관 정보 편집' })).toBeTruthy()
  expect(form.queryByRole('button', { name: '취소' })).toBeNull() // 취소 대신 되돌리기
  fireEvent.change(form.getByRole('textbox', { name: '세계관 이름' }), { target: { value: '새 이름' } })
  fireEvent.click(form.getByRole('button', { name: '저장' }))
  expect(await screen.findByRole('heading', { name: '새 이름', level: 1 })).toBeTruthy()
  expect(saveStudio).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(form.getByText('저장했어요.')).toBeTruthy())
  expect(where()).toBe('/worldstudio/qa?view=overview') // 탭은 그대로다
  expect(form.getByRole<HTMLButtonElement>('button', { name: '저장' }).disabled).toBe(true) // 바뀐 것이 없다
  fireEvent.change(form.getByRole('textbox', { name: '세계관 이름' }), { target: { value: '또 바꿈' } })
  expect(form.queryByText('저장했어요.')).toBeNull() // 다시 고치면 알림은 사라진다
})

it('개요 탭의 되돌리기는 바뀐 이름·설명·공개 범위·고른 표지를 저장값으로 되돌리고, 바뀐 것이 없으면 잠겨 있다', async () => {
  await show(undefined, '/worldstudio/qa?view=overview')
  const form = () => within(screen.getByRole('form', { name: '세계관 정보 편집' }))
  const reset = () => form().getByRole<HTMLButtonElement>('button', { name: '되돌리기' })
  expect(reset().disabled).toBe(true)
  fireEvent.change(form().getByRole('textbox', { name: '세계관 이름' }), { target: { value: '다른 이름' } })
  fireEvent.click(within(form().getByRole('group', { name: '공개 설정' })).getByRole('button', { name: '공개' }))
  fireEvent.change(form().getByLabelText('이미지 선택'), { target: { files: [new File([new Uint8Array(4)], 'cover.png', { type: 'image/png' })] } })
  expect(reset().disabled).toBe(false)
  expect(form().getByText('선택한 파일: cover.png')).toBeTruthy()
  fireEvent.click(reset())
  expect(form().getByRole<HTMLInputElement>('textbox', { name: '세계관 이름' }).value).toBe('검증 세계')
  expect(within(form().getByRole('group', { name: '공개 설정' })).getByRole('button', { name: '비공개' }).getAttribute('aria-pressed')).toBe('true')
  expect(form().queryByText(/선택한 파일/)).toBeNull()
  expect(reset().disabled).toBe(true)
})

it('개요 탭 표지 묶음 맨 앞에 현재 표지가 보이고, 세계관 삭제는 폼 맨 아래의 삭제 구획에 있다', async () => {
  await show(undefined, '/worldstudio/qa?view=overview')
  const form = screen.getByRole('form', { name: '세계관 정보 편집' })
  const cover = within(within(form).getByRole('group', { name: '표지' }))
  expect(cover.getByRole('img', { name: '기본 표지' })).toBeTruthy()
  const zone = within(form).getByRole('group', { name: '세계관 삭제' })
  expect(zone.classList.contains('ep-delete')).toBe(true)
  expect(form.querySelector('fieldset')!.lastElementChild).toBe(zone) // 저장·되돌리기 줄 아래, 폼의 맨 끝
})

it('소설 연결 탭은 연결된 소설(원작 행)·소설 작성하기와 공개 Fork 목록(작가 · N화에서 분기 · 자체 M화)을 보이고 행은 그 소설로 간다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([{ ...myWork('work-1', '달빛 기록', '11111111-1111-4111-8111-111111111111'), visibility: 'public' }])
  const forks = vi.spyOn(readingApi(), 'forksOf').mockResolvedValue([forkWork('f1', '다른 길', { author: '나래', forkAt: 3, eps: [{ t: '1화', p: ['a'] }, { t: '2화', p: ['b'] }] }), forkWork('f2', '또 다른 길')])
  await show(undefined, '/worldstudio/qa?view=novel', { linkedWorkId: 'work-1' })
  expect((await novelTab().findByRole('link', { name: /^달빛 기록/ })).getAttribute('href')).toBe('/work/work-1') // 원작 행
  expect(novelTab().getByRole('link', { name: '소설 작성하기' }).getAttribute('href')).toBe('/content?work=work-1')
  expect(novelTab().queryByRole('link', { name: '작품 보기' })).toBeNull() // 원작 행이 그 링크다
  expect(forks).toHaveBeenCalledWith('work-1')
  expect(await novelTab().findByRole('heading', { name: 'Fork 소설 2편', level: 2 })).toBeTruthy()
  const rows = novelTab().getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/work/f'))
  expect(rows.map((link) => [link.getAttribute('href'), link.textContent])).toEqual([['/work/f1', '다른 길나래 · 3화에서 분기 · 자체 2화'], ['/work/f2', '또 다른 길작가 · 2화에서 분기 · 자체 1화']])
  expect(novelTab().queryByRole('link', { name: '모두 보기' })).toBeNull() // 같은 목록이 탭에 이미 다 보인다(원작이 공개이고 Fork가 있어도)
})

it('소설 연결 탭의 Fork가 0편이면 공개 Fork만 보인다는 기준을 알리고, 읽지 못하면 다시 시도할 수 있다', async () => {
  vi.spyOn(episodeApi(), 'list').mockResolvedValue([myWork('work-1', '달빛 기록')]) // 비공개
  const forks = vi.spyOn(readingApi(), 'forksOf').mockRejectedValue(new Error('목록을 읽지 못했어요.'))
  await show(undefined, '/worldstudio/qa?view=novel', { linkedWorkId: 'work-1' })
  expect((await novelTab().findByRole('alert')).textContent).toContain('Fork 소설을 불러오지 못했어요')
  forks.mockResolvedValue([])
  fireEvent.click(novelTab().getByRole('button', { name: '다시 시도' }))
  expect(await novelTab().findByText('아직 공개된 Fork 소설이 없어요. 회차를 하나 이상 발행한 공개 Fork만 보여요.')).toBeTruthy()
  expect(novelTab().getByRole('heading', { name: 'Fork 소설 0편', level: 2 })).toBeTruthy()
  forks.mockResolvedValue([forkWork('f1', '다른 길')])
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  fireEvent.click(manageTabs().getByRole('button', { name: '소설 연결' }))
  await novelTab().findByRole('heading', { name: 'Fork 소설 1편', level: 2 })
  expect(novelTab().queryByRole('link', { name: '모두 보기' })).toBeNull()
})

it('소설 연결 탭은 연결된 소설이 없으면 소설 연결하기뿐이고 Fork 목록·작품 보기는 읽지도 그리지도 않으며, 소설 목록·Fork 조회는 이 탭을 열 때만 한다', async () => {
  const list = vi.spyOn(episodeApi(), 'list').mockResolvedValue([])
  const forks = vi.spyOn(readingApi(), 'forksOf').mockResolvedValue([])
  await showWorld()
  expect(list).not.toHaveBeenCalled() // 헤더가 연결된 소설 제목을 읽던 일을 이 탭이 맡는다
  expect(forks).not.toHaveBeenCalled()
  fireEvent.click(manageTabs().getByRole('button', { name: '소설 연결' }))
  expect(novelTab().getByText('연결된 소설이 없어요.')).toBeTruthy()
  expect(novelTab().getByRole('button', { name: '소설 연결하기' })).toBeTruthy()
  expect(novelTab().queryByRole('link', { name: '작품 보기' })).toBeNull()
  expect(novelTab().queryByRole('heading', { name: /Fork 소설/ })).toBeNull()
  expect(forks).not.toHaveBeenCalled()
})

it('사이드바 접기: 토글이 메뉴를 접고 펼치며(aria-expanded), 접힌 동안에도 저장 영역은 상단 줄에 한 곳만 보이고 초점은 토글에 남는다', async () => {
  await showWorld()
  const toggle = () => screen.getByRole('button', { name: /세계관 메뉴 (접기|펼치기)/ })
  expect(toggle().getAttribute('aria-label')).toBe('세계관 메뉴 접기')
  expect(toggle().getAttribute('title')).toBe('세계관 메뉴 접기') // 아이콘만 있는 버튼이라 마우스 사용자에게는 툴팁이 뜻을 알린다
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
  expect(screen.getAllByRole('group', { name: '저장 상태' })).toHaveLength(1)
  toggle().focus()
  fireEvent.click(toggle())
  expect(toggle().getAttribute('aria-label')).toBe('세계관 메뉴 펼치기')
  expect(toggle().getAttribute('title')).toBe('세계관 메뉴 펼치기')
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('navigation', { name: '세계관 메뉴' })).toBeNull() // 접근성 트리에서 사라진다
  expect(screen.queryByRole('button', { name: 'AI 검토' })).toBeNull()
  const bars = screen.getAllByRole('group', { name: '저장 상태' })
  expect(bars).toHaveLength(1) // 두 군데 동시에 뜨지 않는다
  expect(bars[0].closest('.ep-top')).toBeTruthy() // 뒤로 가기 링크 옆 상단 줄
  expect(within(bars[0]).getByText('저장됨')).toBeTruthy()
  expect(within(bars[0]).queryByRole('button', { name: '세계관 저장' })).toBeNull() // 저장할 것이 없으면 버튼도 없다
  expect(document.activeElement).toBe(toggle())
  fireEvent.click(toggle())
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('navigation', { name: '세계관 메뉴' })).toBeTruthy()
  expect(screen.getAllByRole('group', { name: '저장 상태' })).toHaveLength(1)
  expect(screen.getByRole('group', { name: '저장 상태' }).closest('.ep-menu')).toBeTruthy() // 펼치면 다시 사이드바 쪽
  expect(document.activeElement).toBe(toggle())
})

it('사이드바를 접어도 미저장 상태와 저장 버튼은 잃지 않는다: 상단 줄의 저장 영역으로 저장하면 서버로 간다', async () => {
  const { saveStudio } = await showWorld()
  openCard('가람 인물')
  fireEvent.change(screen.getByRole('textbox', { name: '설정 이름' }), { target: { value: '고친 이름' } })
  backToBoard()
  fireEvent.click(screen.getByRole('button', { name: '세계관 메뉴 접기' }))
  const bar = within(screen.getByRole('group', { name: '저장 상태' }))
  expect(bar.getByText('저장하지 않은 변경 있음')).toBeTruthy()
  fireEvent.click(bar.getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(within(screen.getByRole('group', { name: '저장 상태' })).getByText('저장됨')).toBeTruthy())
})

it('보기 메뉴를 누르면 누른 버튼을 가로 줄 안에 보이게 하고 바뀐 내용 카드 머리로 스크롤하되, 처음 열 때는 스크롤하지 않고 같은 탭을 다시 눌러도 카드는 스크롤하지 않는다', async () => {
  const scroll = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  try {
    await showWorld()
    expect(scroll).not.toHaveBeenCalled()
    fireEvent.click(manageTabs().getByRole('button', { name: '시간선' }))
    expect(scroll.mock.calls.map(([arg]) => arg)).toEqual([{ inline: 'nearest', block: 'nearest' }, { block: 'start' }])
    expect(scroll.mock.contexts[0]).toBe(manageTabs().getByRole('button', { name: '시간선' }))
    expect(scroll.mock.contexts[1]).toBe(document.querySelector('.tcard.ep-card'))
    scroll.mockClear()
    fireEvent.click(manageTabs().getByRole('button', { name: '시간선' }))
    expect(scroll.mock.calls.map(([arg]) => arg)).toEqual([{ inline: 'nearest', block: 'nearest' }])
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  }
})

it('시간선의 사건 설명은 본문의 카드 링크 원문 대신 링크 글자만 보인다', async () => {
  const garam = person('가람'), event = eventCard('건국')
  event.item.text = '[가람](card:' + garam.item.id + ')이 나라를 세웠다'
  await show([garam, event], '/worldstudio/qa?view=timeline')
  expect(document.querySelector('.world-timeline-description .world-prose')?.textContent).toBe('가람이 나라를 세웠다') // 설명 영역(게시판의 숨은 요약과 따로)
  expect(document.body.textContent).not.toContain('card:')
})

it('게시판 제목을 누르면 편집 화면이 아니라 그 행 바로 아래에 미리보기가 열리고, 수정하기를 눌러야 편집 화면(?card=)이 열린다', async () => {
  const garam = person('가람', '기존 내용')
  await show([garam, place('항구')])
  const title = screen.getByRole('button', { name: '가람 인물' })
  expect(title.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(title)
  expect(where()).toBe('/worldstudio/qa') // 편집 화면이 아니다
  expect(screen.queryByRole('region', { name: '선택한 설정 편집' })).toBeNull()
  expect(title.getAttribute('aria-expanded')).toBe('true')
  expect(previewOf('가람').getByText('기존 내용')).toBeTruthy() // 요약 전문
  expect(title.closest('tr')!.nextElementSibling).toBe(screen.getByRole('region', { name: '가람 미리보기' }).closest('tr')) // 고른 행 바로 아래
  expect(title.closest('tr')!.classList.contains('sel')).toBe(true)
  fireEvent.click(previewOf('가람').getByRole('button', { name: '수정하기' }))
  expect(where()).toBe('/worldstudio/qa?card=' + garam.item.id)
  expect(screen.getByRole('region', { name: '선택한 설정 편집' })).toBeTruthy()
  backToBoard()
  expect(screen.getByRole('region', { name: '가람 미리보기' })).toBeTruthy() // 편집 화면에 다녀와도 열린 채
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '가람 인물' }))) // 돌아오면 그 행의 제목에 초점
})

it('행의 빈 곳을 눌러도 미리보기가 열리지만 선택 체크박스·보완 배지 버튼은 열지 않고, 미리보기는 한 번에 하나뿐이다', async () => {
  const [garam, narae] = [person('가람', '첫째'), person('나래', '둘째')]
  await show([garam, narae])
  const rowOf = (name: string) => screen.getByRole('button', { name }).closest('tr')!
  fireEvent.click(screen.getByLabelText('가람 선택')) // 선택 칸
  expect(screen.queryByRole('region', { name: /미리보기/ })).toBeNull()
  fireEvent.click(rowOf('가람 인물').querySelector('.col-sum')!) // 행의 다른 칸
  expect(screen.getByRole('region', { name: '가람 미리보기' })).toBeTruthy()
  fireEvent.click(rowOf('나래 인물').querySelector('.col-kind')!)
  expect(screen.queryByRole('region', { name: '가람 미리보기' })).toBeNull()
  expect(screen.getByRole('region', { name: '나래 미리보기' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '나래 인물' })) // 같은 제목을 다시 누르면 접힌다
  expect(screen.queryByRole('region', { name: /미리보기/ })).toBeNull()
})

it('미리보기의 닫기와 Esc는 미리보기를 접고 제목으로 초점을 돌려준다', async () => {
  const [garam, narae] = [person('가람', '첫째'), person('나래', '둘째')]
  await show(friends([garam, narae], garam, narae))
  const title = screen.getByRole('button', { name: '가람 인물' })
  fireEvent.click(title)
  fireEvent.click(previewOf('가람').getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('region', { name: '가람 미리보기' })).toBeNull()
  expect(document.activeElement).toBe(title)
  fireEvent.click(title)
  fireEvent.keyDown(previewOf('가람').getByRole('button', { name: '수정하기' }), { key: 'Escape' }) // 미리보기 안 어디서든
  expect(screen.queryByRole('region', { name: '가람 미리보기' })).toBeNull()
  expect(document.activeElement).toBe(title)
  fireEvent.click(title)
  fireEvent.keyDown(screen.getByRole('searchbox', { name: '설정 검색' }), { key: 'Escape' }) // 미리보기 밖의 Esc는 닫지 않는다
  expect(screen.getByRole('region', { name: '가람 미리보기' })).toBeTruthy()
})

/** 미리보기 정보 상자 한 행의 값 */
const infoValue = (scope: ReturnType<typeof within>, key: string) => scope.getByRole('rowheader', { name: key }).nextElementSibling!.textContent
/** 첫머리 글·# 제목 둘·별칭·태그·17화부터 공개인 가람이 동료(설명 있음)와 사건(전쟁)으로 이어진 설정집 */
const wikiWorld = () => {
  const garam = { ...person('가람', '첫머리 글\n# 과거\n북쪽 성벽에서 자랐다.\n## 어린 시절\n눈이 많았다.'), aliases: ['서약사'], tags: ['주인공'], userCategory: '주요 인물', revealFromEpisode: 17 }
  garam.item.category = 'history'
  const [narae, war] = [person('나래', '둘째 본문'), eventCard('전쟁')]
  let settings = putRelation([garam, narae, war], { subjectId: garam.item.id, targetId: narae.item.id, predicate: 'custom_relation', polarity: 'asserted', title: '동료', text: '함께 성벽을 지켰다', fromEpisode: 3 })
  settings = putRelation(settings, { subjectId: garam.item.id, targetId: war.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', title: '참전', text: '선봉에 섰다', fromEpisode: 5 })
  return { garam, narae, war, settings }
}

it('게시판 미리보기는 공개 카드 페이지 모양이다: 정보 상자(유형·설정 영역·내 분류·별칭·공개 범위·관계·태그)·번호 목차·첫머리와 접이식 본문·카드별 관계도(간단 목록·함께한 사건)·접힌 관계 자세히 보기', async () => {
  const { settings } = wikiWorld()
  await show(settings, '/worldstudio/qa', { linkedWorkId: 'w1' })
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' }))
  const doc = previewOf('가람')
  const info = within(document.querySelector<HTMLElement>('.world-preview table.nw-info')!)
  expect(info.getByText('가람', { selector: 'caption' })).toBeTruthy()
  expect([infoValue(info, '유형'), infoValue(info, '설정 영역'), infoValue(info, '내 분류'), infoValue(info, '별칭'), infoValue(info, '공개 범위'), infoValue(info, '관계'), infoValue(info, '태그')]).toEqual(['인물', '역사', '주요 인물', '서약사', '17화부터 공개', '2개', '주인공'])
  expect(info.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['유형', '설정 영역', '내 분류', '별칭', '공개 범위', '관계', '태그']) // 공개 카드 페이지의 정보 상자와 같은 순서(유형·별칭 …)에 작가용 분류와 공개 범위가 더해진다
  const toc = doc.getByRole('navigation', { name: '목차' })
  expect(within(toc).getAllByRole('listitem').map((li) => li.querySelector('a')!.textContent)).toEqual(['1. 과거', '1.1. 어린 시절', '2. 관계', '2.1. 나래 — 동료', '2.2. 전쟁 — 참전'])
  expect(doc.getByText('첫머리 글')).toBeTruthy() // 첫 제목 앞의 글은 번호 없는 첫머리
  expect(doc.getByText('북쪽 성벽에서 자랐다.').closest('details')!.open).toBe(true) // 본문 문단은 펼쳐진 접이식
  const map = within(doc.getByRole('region', { name: '카드별 관계도' }))
  expect(map.getByText(/동료 · 3화부터/).tagName).toBe('LI') // 간단 목록: 상대 — 관계 이름 · N화부터
  expect(map.getByText('함께한 사건 1').closest('details')!.open).toBe(false) // 사건은 접힌 목록에 모인다
  const fold = document.querySelector<HTMLDetailsElement>('.world-preview details.nw-rels')!
  expect(fold.querySelector('summary')!.textContent).toBe('관계 자세히 보기 (2)')
  expect(fold.open).toBe(false)
  expect([within(fold).getByText('함께 성벽을 지켰다'), within(fold).getByText('선봉에 섰다')]).toHaveLength(2) // 관계 설명은 접힌 묶음 안 문단
  expect(document.querySelector('.world-preview-sum, .world-preview-meta, .world-preview-head')).toBeNull() // 이전의 요약·연결된 설정 목록은 없다
  expect(doc.getByRole('group', { name: '가람 문서' }).tabIndex).toBe(0) // 높이를 제한한 문서는 키보드로 스크롤할 수 있다
  expect(document.querySelector<HTMLTableCellElement>('tr.world-row-preview > td')!.colSpan).toBe(8) // 표의 열 수(8)와 같아 열 폭이 변하지 않는다
})

it('작가 전용 설정도 미리보기가 열리고(공개로 거르지 않는다) 공개 범위는 작가 전용이며, 본문이 비어 있으면 안내 한 줄이고 목차는 없다', async () => {
  const [narae, daon] = [person('나래', '둘째 본문'), person('다온')]
  await show([narae, daon])
  fireEvent.click(screen.getByRole('button', { name: '나래 인물' }))
  expect(infoValue(previewOf('나래'), '공개 범위')).toBe('작가 전용')
  expect(previewOf('나래').getByText('둘째 본문')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다온 인물' }))
  expect(previewOf('다온').getByText('본문을 아직 쓰지 않았어요.')).toBeTruthy()
  expect(previewOf('다온').queryByRole('navigation', { name: '목차' })).toBeNull()
  expect(infoValue(previewOf('다온'), '관계')).toBe('0개')
  const [harbor] = [place('항구')]
  cleanup()
  await show([harbor])
  fireEvent.click(screen.getByRole('button', { name: '항구 장소' }))
  expect([infoValue(previewOf('항구'), '유형'), infoValue(previewOf('항구'), '연결')]).toEqual(['장소', '0개']) // 인물이 아니면 관계가 아니라 연결 수다
})

it('미리보기 정보 상자의 이미지는 그 카드의 대표 이미지(읽지 않은 동안·읽지 못하면 비워 둔다)이고 같은 이미지는 한 번만 읽는다', async () => {
  const { readCardImage } = await show([withImage(person('가람', '기존 내용')), person('나래')])
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' }))
  expect(await within(document.querySelector<HTMLElement>('.world-preview .nw-info-image')!).findByRole('img', { name: '가람 이미지' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '나래 인물' }))
  expect(document.querySelector('.world-preview .nw-info-image')).toBeNull() // 이미지가 없는 카드는 이미지 행이 없다
  expect(readCardImage).toHaveBeenCalledOnce() // 줄 썸네일과 미리보기가 같은 읽기를 나눠 쓴다
})

it('미리보기의 공개 화면 보기는 공개된 설정이고 세계관이 공개 목록에 있을 때만 새 탭 링크로 있다', async () => {
  const [pub, priv] = [{ ...person('가람', '본문'), revealFromEpisode: 1 }, person('나래', '본문')]
  await show([pub, priv], '/worldstudio/qa', { visibility: 'public', currentRevisionId: 'rev-1' })
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' }))
  const link = previewOf('가람').getByRole('link', { name: '공개 화면 보기' })
  expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual(['/worlds/qa/cards/' + pub.item.id, '_blank', 'noopener noreferrer'])
  fireEvent.click(screen.getByRole('button', { name: '나래 인물' }))
  expect(previewOf('나래').queryByRole('link', { name: '공개 화면 보기' })).toBeNull() // 작가 전용 설정은 공개 화면이 없다
  cleanup()
  await show([pub]) // 공개 목록에 없는(비공개) 세계관
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' }))
  expect(previewOf('가람').queryByRole('link', { name: '공개 화면 보기' })).toBeNull()
})

it('미리보기 본문의 설정 링크와 관계도의 이웃은 그 카드의 편집 화면을 열고(수정하기와 같이 편집기는 미리보기 탭으로 시작) 모르는 카드의 링크는 글자만 남는다', async () => {
  const [harbor, gone] = [place('항구'), place('옛 성')]
  const garam = person('가람', '배는 ' + cardLinkMarkdown(harbor.item.id, '항구') + '로 가고 ' + cardLinkMarkdown(gone.item.id, '옛 성') + '은 잊었다.')
  await show([garam, harbor, person('나래')]) // 옛 성은 설정집에 없다
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' }))
  expect(Array.from(previewOf('가람').getByText(/옛 성/).closest('.card-md')!.querySelectorAll('button'), (button) => button.textContent)).toEqual(['항구']) // 설정집에 없는 카드의 링크는 글자만 남는다
  expect(previewOf('가람').queryByRole('navigation', { name: '목차' })).toBeNull() // 본문 링크로만 이어진 항구는 관계가 아니라 관계 문단·목차·접힌 묶음이 없다
  expect(document.querySelector('.world-preview details.nw-rels')).toBeNull()
  fireEvent.click(previewOf('가람').getAllByRole('button', { name: '항구' }).find((button) => button.closest('.card-md'))!)
  expect(where()).toBe('/worldstudio/qa?card=' + harbor.item.id)
  expect(editor().getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('항구')
  expect(fakeEditor.startTab.get('설정 본문')).toBe('preview')
  backToBoard()
  expect(screen.getByRole('region', { name: '가람 미리보기' })).toBeTruthy() // 편집 화면에 다녀와도 열린 채
  const neighbor = within(previewOf('가람').getByRole('region', { name: '카드별 관계도' })).getAllByRole('button', { name: '항구' })[0]
  fireEvent.click(neighbor)
  expect(where()).toBe('/worldstudio/qa?card=' + harbor.item.id)
})

it('설정 편집 화면의 카드 레일에는 기존 관계가 섞이지 않고(메모·분류 확인은 남는다) 열려 있는 관계 항목만은 남으며, 두 쪽 이동에는 각각 이름이 있다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  const note = newSetting()
  note.item.kind = 'note'
  note.item.title = '집필 메모'
  note.item.text = '메모'
  const settings = friends([garam, narae, note], garam, narae)
  await show(settings)
  openCard('가람 인물')
  const names = () => rail().getAllByRole('button', { name: /(인물|메모|관계)$/ }).map((b) => b.getAttribute('aria-label'))
  expect(names()).toEqual(['가람 인물', '나래 인물', '집필 메모 메모']) // 가람·나래 · 메모. 관계 항목은 레일에 없다
  backToBoard()
  fireEvent.click(screen.getByText(/기존 설정·관계 \d+개/)) // 관계는 게시판의 접힌 목록에서 계속 열린다
  fireEvent.click(within(screen.getByRole('navigation', { name: '기존 설정과 관계' })).getByRole('button', { name: /가람 · 친구 · 나래/ }))
  expect(names()).toContain('가람 · 친구 · 나래 관계') // 열려 있는 항목은 레일에도 남아 어디인지 알 수 있다
})

it('설정 편집 화면 레일의 두 페이지 이동은 설정 카드·기존 항목으로 이름이 구분된다', async () => {
  const cards = Array.from({ length: 51 }, (_, i) => person('카드 ' + i))
  const notes = Array.from({ length: 51 }, (_, i) => { const note = newSetting(); note.item.kind = 'note'; note.item.title = '메모 ' + i; note.item.text = 'x'; return note })
  await show([...cards, ...notes])
  openCard('카드 0 인물')
  rail() // 설정 카드 패널을 연다
  expect(screen.getByRole('navigation', { name: '설정 카드 페이지 이동' })).toBeTruthy()
  expect(screen.getByRole('navigation', { name: '기존 항목 페이지 이동' })).toBeTruthy()
  expect(screen.queryByRole('navigation', { name: '페이지 이동' })).toBeNull()
})

it.each([
  ['', '설정집'],
  ['view=people&', '관계도'],
  ['view=timeline&', '시간선'],
  ['view=overview&', '개요'],
  ['view=novel&', '소설 연결'],
])('설정 편집 화면의 돌아가기 버튼은 들어온 보기의 이름이다 (%s → %s)', async (query, name) => {
  const garam = person('가람')
  mount([garam, person('나래')], '/worldstudio/qa?' + query + 'card=' + garam.item.id)
  await screen.findByRole('region', { name: '선택한 설정 편집' }) // 편집 화면이 열려 있는 동안 설정집 화면(h1)은 숨는다
  const back = screen.getByRole('button', { name })
  fireEvent.click(back)
  expect(where()).toBe(query ? '/worldstudio/qa?' + query.slice(0, -1) : '/worldstudio/qa') // 누르면 그 보기로 돌아온다
})

it('개요 탭에서 고치던 이름과 고른 표지 파일은 다른 보기에 다녀와도 남는다(보기 이동은 입력을 잃지 않는다: 폼은 숨길 뿐 지우지 않는다)', async () => {
  await show(undefined, '/worldstudio/qa?view=overview')
  const name = () => infoForm().getByRole<HTMLInputElement>('textbox', { name: '세계관 이름' })
  fireEvent.change(name(), { target: { value: '쓰던 이름' } })
  pickCover(png())
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(screen.queryByRole('form', { name: '세계관 정보 편집' })).toBeNull() // 숨은 폼은 접근성 트리에 없다
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
  fireEvent.click(manageTabs().getByRole('button', { name: '개요' }))
  expect(name().value).toBe('쓰던 이름')
  expect(coverGroup().getByText('선택한 파일: cover.png')).toBeTruthy()
})

it('개요 폼은 한 번 열기 전에는 그리지 않고(장르 목록 같은 읽기를 미리 하지 않는다), 열고 나면 다른 보기에서도 숨겨 둔다', async () => {
  await showWorld()
  expect(document.querySelector('.world-info-edit')).toBeNull()
  fireEvent.click(manageTabs().getByRole('button', { name: '개요' }))
  expect(document.querySelector('.world-info-edit')).toBeTruthy()
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  const hidden = document.querySelector('.world-info-edit')
  expect(hidden).toBeTruthy()
  expect(hidden!.closest('[hidden]')).toBeTruthy()
})

it('미리보기를 열면 그 미리보기 구획이 화면에 들어오게 가장 가까운 만큼만 스크롤하고(첫 화면 아래에 열려도 수정하기가 보이게), 닫을 때와 편집 화면에 다녀올 때는 다시 스크롤하지 않는다 (critique)', async () => {
  const scroll = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  try {
    await show([person('가람'), person('나래')])
    expect(scroll).not.toHaveBeenCalled() // 아무것도 열지 않았다
    const title = screen.getByRole('button', { name: '가람 인물' })
    fireEvent.click(title)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.calls[0]).toEqual([{ block: 'nearest' }])
    expect(scroll.mock.contexts[0]).toBe(screen.getByRole('region', { name: '가람 미리보기' }))
    fireEvent.click(screen.getByRole('button', { name: '수정하기' })) // 편집 화면으로 갔다
    backToBoard() // 돌아오면 열려 있던 미리보기가 그대로 있다
    expect(screen.getByRole('region', { name: '가람 미리보기' })).toBeTruthy()
    expect(scroll).toHaveBeenCalledTimes(1) // 다시 열린 것이 아니라 계속 열려 있던 것이다
    fireEvent.click(title) // 접는다
    expect(scroll).toHaveBeenCalledTimes(1)
    fireEvent.click(title) // 다시 열면 다시 맞춘다
    expect(scroll).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '나래 인물' })) // 다른 줄을 열면 새 미리보기를 맞춘다
    expect(scroll).toHaveBeenCalledTimes(3)
    expect(scroll.mock.contexts[2]).toBe(screen.getByRole('region', { name: '나래 미리보기' }))
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  }
})

// ── 관리 화면 critique 승인 항목: 히어로 data-view·돌아가기 버튼·좁은 화면 채팅 열기 버튼 자리·미리보기 탭으로 열기 ─────────────────
it('헤더는 관리 모드에서는 보기마다(관계도 보기만 헤더 없음), 작성 모드에서는 wizard로 data-view를 달아(히어로를 줄이는 CSS가 쓴다) /content 히어로와 구분한다', async () => {
  await showWorld()
  const hero = () => document.querySelector('.world-manage-hero')
  expect(hero()!.getAttribute('data-view')).toBe('book') // 주소에 없으면 설정집
  for (const [label, view] of [['개요', 'overview'], ['관계도', 'people'], ['시간선', 'timeline'], ['소설 연결', 'novel'], ['설정집', 'book']] as const) {
    fireEvent.click(manageTabs().getByRole('button', { name: label }))
    if (view === 'people') expect(hero(), label).toBeNull() // 관계도 보기는 캔버스가 내용 열을 채우도록 헤더를 그리지 않는다
    else expect(hero()!.getAttribute('data-view'), label).toBe(view)
  }
  cleanup()
  await wizard()
  expect(document.querySelector('.world-manage-hero')!.getAttribute('data-view')).toBe('wizard')
})

it('관리 모드 관계도에는 설정집으로 돌아가기 버튼이 없고(왼쪽 설정집 탭이 같은 일을 한다), 작성 모드의 관계 연결 단계에는 설정 카드로 돌아가기가 남는다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people')
  expect(screen.queryByRole('button', { name: '설정집으로 돌아가기' })).toBeNull()
  expect(screen.queryByRole('button', { name: '설정 카드로 돌아가기' })).toBeNull()
  cleanup()
  await wizard()
  fireEvent.click(within(screen.getByRole('navigation', { name: '세계관 작성 단계' })).getByRole('button', { name: '관계 연결 (선택)' }))
  expect(screen.getByRole('button', { name: '설정 카드로 돌아가기' })).toBeTruthy()
})

it('좁은 화면(900px 이하)의 닫힌 AI 채팅 열기 버튼은 화면 오른쪽 아래에 떠 있지 않고 사이드바 탭 줄의 오른쪽 끝에 있으며, 넓은 화면은 그대로 본문 옆에 뜬다', async () => {
  viewport(800)
  await showWorld()
  const open = screen.getByRole('button', { name: 'AI 채팅 열기' })
  const row = document.querySelector('.world-menu-row')!
  expect(row.contains(open)).toBe(true)
  expect(open.closest('.world-chat-slot')).toBeTruthy()
  expect(row.contains(manageTabs().getByRole('button', { name: '설정집' }))).toBe(true) // 탭과 같은 줄이다
  expect(open.parentElement).not.toBe(document.querySelector('.episode-app')) // 문서 끝에 떠 있는 버튼이 아니다
  fireEvent.click(open)
  expect(chatDrawer()).toBeTruthy()
  expect(row.querySelector('.studio-chat-toggle')).toBeNull() // 서랍이 열려 있는 동안 열기 버튼은 없다
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'AI 채팅 열기' }))) // 닫으면 같은 자리 버튼으로 초점이 돌아온다
  cleanup()
  viewport(1000)
  await showWorld()
  const wide = screen.getByRole('button', { name: 'AI 채팅 열기' })
  expect(wide.parentElement).toBe(document.querySelector('.episode-app')) // 넓은 화면은 지금처럼 본문 옆에 뜬다(데스크톱 동작 그대로)
  expect(wide.closest('.world-menu-row')).toBeNull()
})

it("게시판 미리보기의 수정하기로 들어오면 처음 만들어지는 편집기를 미리보기 탭으로 열고, 같은 카드의 다른 문서·다른 카드·새 설정은 쓰기 탭으로 연다", async () => {
  await show([person('가람', '기존 내용'), person('나래', '다른 내용')])
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' }))
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }))
  expect(fakeEditor.startTab.get('IDENTITY.md')).toBe('preview') // 원문 링크([글자](card:…))가 먼저 보이지 않게 미리보기로 시작
  pickDoc('SOUL.md 정리 필요') // 비어 있는 문서는 정리 필요 표시가 붙는다
  expect(fakeEditor.startTab.has('SOUL.md')).toBe(true)
  expect(fakeEditor.startTab.get('SOUL.md')).toBeUndefined() // 문서를 옮기면 쓰는 중이니 쓰기 탭이다
  pickDoc('IDENTITY.md') // 처음 문서로 돌아와도 이미 쓰기 시작한 편집 화면이라 미리보기 탭으로 다시 열지 않는다
  expect(fakeEditor.startTab.get('IDENTITY.md')).toBeUndefined()
  fireEvent.click(rail().getByRole('button', { name: '나래 인물' }))
  expect(fakeEditor.startTab.get('IDENTITY.md')).toBeUndefined() // 레일에서 연 다른 카드
  backToBoard()
  addSetting('인물')
  expect(fakeEditor.startTab.get('IDENTITY.md')).toBeUndefined() // 새 설정
  backToBoard()
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' })) // 이미 열려 있던 미리보기를 접는다
  fireEvent.click(screen.getByRole('button', { name: '가람 인물' }))
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }))
  expect(fakeEditor.startTab.get('IDENTITY.md')).toBe('preview') // 다시 미리보기로 들어오면 다시 미리보기 탭이다
})

// ── 3단계 distill: 저장 영역 버튼·마법사 이전 단계·도구줄 설정 수·[n] 표시 ─────────────────────────────────────
it('작성 모드 1단계에는 이전 단계가 없고 2단계부터 나타난다', async () => {
  await wizard()
  expect(screen.queryByRole('button', { name: '이전 단계' })).toBeNull()
  expect(screen.getByRole('button', { name: '다음 단계' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다음 단계' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 단계' }))
  expect(screen.queryByRole('button', { name: '이전 단계' })).toBeNull() // 1단계로 돌아오면 다시 없다
})

it('게시판 도구줄의 설정 수는 검색·분류 필터가 걸린 동안에만 보인다(전체 수는 분류 메뉴의 전체가 이미 보인다)', async () => {
  await show([person('가람', '북부'), person('나래', '남부')])
  const toolbar = () => within(screen.getByRole('searchbox', { name: '설정 검색' }).closest('.worlds-board-tools') as HTMLElement)
  const search = (value: string) => fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value } })
  expect(toolbar().queryByText(/^설정 \d+개$/)).toBeNull() // 헤더 칩의 '설정 2개'와는 다른 자리다
  search('북부')
  expect(toolbar().getByText('설정 1개')).toBeTruthy()
  search('')
  expect(toolbar().queryByText(/^설정 \d+개$/)).toBeNull()
  fireEvent.click(screen.getByRole('navigation', { name: '설정 분류' }).querySelectorAll('button')[1]) // 인물
  expect(toolbar().getByText('설정 2개')).toBeTruthy()
})

it('게시판 제목 옆 [n]은 world-count 클래스를 달아 CSS가 넓은 표에서 가리고, 읽는 사람에게는 관계·연결 N개 글이 그대로 남는다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae))
  const badge = rowOf('가람').querySelector('.worlds-badge')!
  expect(badge.querySelector('.world-count')?.textContent).toBe('[1]')
  expect(badge.querySelector('.sr-only')?.textContent).toBe('관계 1개')
})

// ── 시간선(가로 시간축): afterId 화살표는 점 중심에서 점 중심으로 이어진다 ─────────────────────────────────────────────────────
it('시간선 afterId 화살표는 앞선 사건의 점 중심에서 뒤 사건의 점 중심(열 가운데 x 66·첫 행 y 64·행 간격 92)으로 이어진다', async () => {
  const first = eventCard('건국')
  const second = eventCard('전쟁', '3년')
  second.item.afterId = first.item.id
  await show([first, second], '/worldstudio/qa?view=timeline')
  const d = document.querySelector('.world-timeline-board svg path[marker-end]')?.getAttribute('d') ?? ''
  expect(d).toBe('M 66 64 Q 96 146 66 156') // 같은 열(시점 미정)의 첫 행(64)과 둘째 행(64+92)을 휘어 잇는다
})

// ── 상단바를 사이드바로 합치기(사용자 요청): 관리 모드는 공용 상단바(Gnb)를 그리지 않고 사이드바가 그 역할을 맡는다 ─────────────────────
const sidebar = () => screen.getByRole('navigation', { name: '세계관 메뉴' }).closest('.ep-menu') as HTMLElement

it('관리 모드는 공용 상단바(Gnb)를 그리지 않고, 사이드바가 로고·알림·테마·계정을 맡으며 검색 버튼은 두지 않는다(Ctrl K 전역 단축키가 남는다)', async () => {
  await showWorld()
  expect(document.querySelector('.gnb')).toBeNull()
  expect(screen.queryByRole('banner')).toBeNull()
  expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).toBeNull()
  expect(screen.queryByRole('button', { name: '소설·세계관·설정 카드·캐릭터챗 검색' })).toBeNull()
  const side = within(sidebar())
  const logo = side.getByRole('link', { name: 'STORYFORK 홈으로' }) // 상단바 로고와 같은 이름
  expect(logo.getAttribute('href')).toBe('/')
  expect(logo.textContent).toBe('SFSTORYFORK')
  expect(side.getByRole('link', { name: '알림함' }).getAttribute('href')).toBe('/notifications')
  expect(side.getByRole('button', { name: '다크 모드로' })).toBeTruthy()
  expect(side.getByRole('button', { name: '내 계정 메뉴' }).getAttribute('aria-haspopup')).toBe('menu')
  // 상단바의 '본문으로 바로가기'가 없어진 대신 사이드바 맨 앞의 같은 링크가 내용 열(#ep-content)로 건너뛴다.
  const skip = side.getByRole('link', { name: '본문으로 바로가기' })
  expect(sidebar().firstElementChild).toBe(skip)
  const column = document.getElementById('ep-content')!
  expect(column.classList.contains('ep-content')).toBe(true)
  fireEvent.click(skip)
  expect(document.activeElement).toBe(column)
})

it('사이드바는 위에서 아래로 로고·접기 토글·내가 만드는 세계관·보기 메뉴·AI 검토·확정 버전 남기기·저장 영역·알림·테마·계정 순서이고, 도구 묶음과 계정 줄은 따로다', async () => {
  await showWorld()
  const side = within(sidebar())
  const order = [
    side.getByRole('link', { name: 'STORYFORK 홈으로' }),
    side.getByRole('button', { name: '세계관 메뉴 접기' }),
    side.getByRole('link', { name: '내가 만드는 세계관' }),
    side.getByRole('navigation', { name: '세계관 메뉴' }),
    side.getByRole('button', { name: /^AI 검토/ }),
    side.getByRole('button', { name: '확정 버전 남기기' }),
    side.getByRole('group', { name: '저장 상태' }),
    side.getByRole('link', { name: '알림함' }),
    side.getByRole('button', { name: '다크 모드로' }),
    side.getByRole('button', { name: '내 계정 메뉴' }),
  ]
  order.slice(1).forEach((el, i) => expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, el.textContent || el.getAttribute('aria-label') || '').toBeTruthy())
  expect(order[4].closest('.ep-menu-tools')?.contains(order[6])).toBe(true) // AI 검토·확정 버전 남기기·저장 영역이 아래로 밀리는 한 묶음이다
  expect(order[7].closest('.ep-menu-account')?.contains(order[9])).toBe(true)
  expect(order[7].closest('.ep-menu-tools')).toBeNull() // 계정 줄은 그 묶음 밖의 맨 아래 줄이다
  expect(order[0].closest('.ep-menu-top')?.contains(order[1])).toBe(true) // 로고와 접기 토글이 맨 위 한 줄이다
})

it('작성 모드(마법사)와 새 세계관 만들기 화면은 사이드바가 없어 공용 상단바(Gnb)가 그대로이고 사이드바 계정 줄은 없다', async () => {
  await wizard()
  expect(screen.getByRole('banner')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: '주요 메뉴' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'STORYFORK 홈으로' }).closest('.gnb')).toBeTruthy()
  expect(document.querySelector('.ep-menu-account, .ep-menu-top')).toBeNull()
  cleanup()
  await show(undefined, '/worldstudio')
  expect(screen.getByRole('banner')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: '주요 메뉴' })).toBeTruthy()
  expect(document.querySelector('.ep-menu-account, .ep-menu-top')).toBeNull()
})

it('내가 만드는 세계관 링크는 사이드바를 펼친 동안은 사이드바에만, 접으면 상단 줄(.ep-top)의 저장 영역 옆에만 있다(두 곳 동시 노출 없음)', async () => {
  await showWorld()
  const back = () => screen.getAllByRole('link', { name: '내가 만드는 세계관' })
  expect(back()).toHaveLength(1)
  expect(back()[0].closest('.ep-menu')).toBeTruthy()
  expect(document.querySelector('.ep-top')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '세계관 메뉴 접기' }))
  expect(back()).toHaveLength(1)
  const top = back()[0].closest('.ep-top') as HTMLElement
  expect(top).toBeTruthy()
  expect(within(top).getByRole('group', { name: '저장 상태' })).toBeTruthy()
  expect(back()[0].closest('.ep-menu')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '세계관 메뉴 펼치기' }))
  expect(back()).toHaveLength(1)
  expect(back()[0].closest('.ep-menu')).toBeTruthy()
  expect(document.querySelector('.ep-top')).toBeNull()
})

it('관리 주소는 세계관을 읽는 동안·읽지 못했을 때도 공용 상단바 없이 상단 줄의 뒤로 가기 링크로 서재에 돌아가게 하고, 다 읽으면 그 줄이 사이드바로 옮겨 간다', async () => {
  mount(undefined, '/worldstudio/qa') // 읽는 중
  expect(document.querySelector('.gnb')).toBeNull() // 사이드바가 나타날 때 상단바가 사라지며 화면이 밀리지 않는다
  expect(screen.getByRole('link', { name: '내가 만드는 세계관' }).closest('.ep-top')).toBeTruthy()
  await screen.findByRole('heading', { name: '검증 세계', level: 1 })
  expect(screen.getByRole('link', { name: '내가 만드는 세계관' }).closest('.ep-menu')).toBeTruthy()
  expect(document.querySelector('.ep-top')).toBeNull()
  cleanup()
  mount(undefined, '/worldstudio/qa', { read: async () => { throw new Error('세계관을 읽지 못했습니다.') } })
  await screen.findByRole('alert')
  expect(document.querySelector('.gnb')).toBeNull()
  expect(screen.getByRole('link', { name: '내가 만드는 세계관' }).closest('.ep-top')).toBeTruthy()
})

it('내용 카드의 스크롤 여백은 상단바가 없어 /content 작품 관리의 80px에서 상단바 몫을 뺀 16px다', async () => {
  await showWorld()
  expect(document.querySelector<HTMLElement>('section.tcard.ep-card')!.style.scrollMarginTop).toBe('16px')
})

it('오류·상태·AI 변경 알림은 세계관이 열려 있으면 사이드바 위가 아니라 내용 열 맨 위에 그려 화면 높이를 쓰는 사이드바를 아래로 밀지 않는다', async () => {
  mcp.stale = true
  const { saveStudio } = await show(undefined, '/worldstudio/qa', { saveStudio: async () => { throw new Error('저장 충돌') } })
  const side = sidebar()
  const inContent = (el: HTMLElement) => el.closest('.ep-content') !== null && !!(side.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect(inContent(screen.getByText('다른 곳에서 바뀌었어요').closest('[role="status"]') as HTMLElement)).toBe(true)
  dirtyCard()
  fireEvent.click(saveBar().getByRole('button', { name: '세계관 저장' }))
  await waitFor(() => expect(saveStudio).toHaveBeenCalledOnce())
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('저장 충돌')
  expect(inContent(alert)).toBe(true)
  expect(document.querySelector('main > .ep-alert, main > .ep-notice')).toBeNull() // 사이드바를 감싼 틀(section.world-content) 위에는 알림이 없다
})

// ── 관리 모드 푸터 없음·관계도 보기의 React Flow 캔버스(사용자 요청) ─────────────────────────────────────────────
it('관리 모드(사이드바 화면)에는 푸터가 없고 — 읽는 동안·읽지 못했을 때도 — 작성 모드·새 세계관 만들기 화면은 푸터가 그대로다', async () => {
  mount(undefined, '/worldstudio/qa') // 읽는 중
  expect(document.querySelector('.foot')).toBeNull()
  await screen.findByRole('heading', { name: '검증 세계', level: 1 })
  expect(document.querySelector('.foot')).toBeNull()
  expect(screen.queryByRole('contentinfo')).toBeNull()
  cleanup()
  mount(undefined, '/worldstudio/qa', { read: async () => { throw new Error('세계관을 읽지 못했습니다.') } })
  await screen.findByRole('alert')
  expect(document.querySelector('.foot')).toBeNull()
  cleanup()
  await wizard()
  expect(screen.getByRole('contentinfo')).toBeTruthy()
  cleanup()
  await show(undefined, '/worldstudio')
  expect(screen.getByRole('contentinfo')).toBeTruthy()
})

it('관계도 보기에서는 세계관 머리(표지·이름·칩 줄)를 그리지 않고 이름은 화면 밖 h1로만 남기며, 다른 보기는 머리가 그대로다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people')
  expect(document.querySelector('.world-manage-hero')).toBeNull()
  const title = screen.getByRole('heading', { level: 1 })
  expect(title.textContent).toBe('검증 세계') // h1은 하나 남아 화면 구조(이름)가 그대로 읽힌다
  expect(title.classList.contains('sr-only')).toBe(true)
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(document.querySelector('.world-manage-hero')).toBeTruthy()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  fireEvent.click(manageTabs().getByRole('button', { name: '관계도' }))
  expect(document.querySelector('.world-manage-hero')).toBeNull()
})

it('관계도 보기는 그래프 캔버스가 내용 열 전체 폭의 한 열이고(주소 view가 내용 열에 붙는다) 그 아래에 관계 추가 폼·관계 목록 표는 없다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people')
  expect(document.querySelector('.ep-content')!.getAttribute('data-view')).toBe('people')
  const flow = canvasRoot()
  expect(within(flow).getByRole('img', { name: '관계도: 설정 2개 · 관계 1개' })).toBeTruthy() // 점과 이름뿐인 그래프 캔버스(스크린리더에는 요약과 키보드 목록)
  expect(relationLine('가람', '나래')).toBeTruthy()
  expect(document.querySelector('.relationship-service-form')).toBeNull() // 하단 폼·표 칸 자체가 없다
  expect(screen.queryByText('관계 추가')).toBeNull()
  expect(screen.queryByRole('region', { name: '관계 목록' })).toBeNull()
  expect(screen.queryByRole('table', { name: '저장할 관계 목록' })).toBeNull()
  expect(screen.queryByRole('combobox', { name: '관계 주체' })).toBeNull()
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(document.querySelector('.ep-content')!.getAttribute('data-view')).toBe('book')
  cleanup()
  await wizard()
  expect(document.querySelector('.ep-content')!.getAttribute('data-view')).toBeNull() // 작성 모드는 그대로
})

it('관계도 보기의 안내문은 캔버스 감싸개(.relationship-canvas) 안의 묶음(.relationship-notes)에서 캔버스에 겹치고, 도구(+ 설정 추가·톱니)는 캔버스 안 모서리라 위 줄이 없으며(알림이 있을 때만 .relationship-bar), 유형 필터·설정 찾기는 톱니의 설정 패널에 있고, 관계 기준 회차는 그 바깥이라 편집기가 다시 열려도 그대로다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae), '/worldstudio/qa?view=people')
  const flow = canvasRoot(), canvas = flow.closest('.relationship-canvas') as HTMLElement
  expect(canvas).toBeTruthy()
  const notes = canvas.querySelector('.relationship-notes') as HTMLElement
  expect(within(notes).getByText(/노드를 누르면 이웃을 강조해요/).getAttribute('role')).toBe('status') // 안내문은 캔버스 아래에 겹치는 작은 글(상태 안내)
  expect(document.querySelector('.relationship-bar')).toBeNull() // 알림이 없으면 위 줄 자체가 없다
  expect(within(flow).getByRole('button', { name: '+ 설정 추가' })).toBeTruthy() // 도구는 캔버스 안 모서리에 겹친다
  fireEvent.click(within(flow).getByRole('button', { name: '그래프 설정' }))
  const panel = within(screen.getByRole('group', { name: '그래프 설정' }))
  expect(panel.getByRole('combobox', { name: '설정 찾기' })).toBeTruthy()
  expect(panel.getByRole('checkbox', { name: '인물 2' })).toBeTruthy() // 유형 체크박스(유형 이름과 설정 수)
  expect(screen.getByRole('region', { name: '관계 기준 회차' }).closest('.relationship-canvas')).toBeNull() // 회차 칸은 다시 열리는 편집기 바깥
})

it('카드가 하나도 없으면 안내문이 첫 카드를 더하는 길(+ 설정 추가·오른쪽 클릭)을 알린다', async () => {
  await show([], '/worldstudio/qa?view=people')
  expect(screen.getByText(/첫 카드를 더해 보세요/).getAttribute('role')).toBe('status')
  expect(screen.getByRole('button', { name: '+ 설정 추가' })).toBeTruthy()
})

it('관계도 보기에서 적용하지 않은 관계 입력이 있으면 세계관 머리가 없어도 관계 입력 미적용 칩이 내용 열 맨 위에 보이고, 다른 보기에서는 머리의 칩이 맡는다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show([garam, narae], '/worldstudio/qa?view=people')
  connectCards('가람', '나래')
  fireEvent.change(screen.getByRole('textbox', { name: '실제 관계 1' }), { target: { value: '미적용 관계 원문' } })
  const chip = await screen.findByText('관계 입력 미적용')
  expect(chip.getAttribute('role')).toBe('status')
  expect(chip.closest('.world-manage-hero')).toBeNull() // 머리는 이 보기에 없다
  expect(chip.parentElement?.classList.contains('ep-content')).toBe(true) // 내용 열 바로 아래(캔버스 위)
  fireEvent.click(manageTabs().getByRole('button', { name: '설정집' }))
  expect(headerOf().getByText('관계 입력 미적용')).toBeTruthy() // 다른 보기는 머리의 칩이다(같은 칩이 두 군데 뜨지 않는다)
  expect(screen.getAllByText('관계 입력 미적용')).toHaveLength(1)
})

it('카드 편집 화면의 관계는 관계 탭에 있다: 관계 수 배지·관계 편집(모든 유형)·카드별 관계도·관계 종류별 간단 목록이고 문서 탭에는 관계 절이 없으며, 공개 순서는 문제가 없으면 개요의 공개 범위 칸 한 줄이다', async () => {
  const [garam, narae, harbor] = [person('가람'), person('나래'), place('항구')]
  await show(friends([garam, narae, harbor], garam, narae))
  openCard('가람 인물')
  expect(screen.queryByRole('region', { name: '연관 설정' })).toBeNull() // 처음 탭은 문서다: 관계는 관계 탭에서 본다
  expect(screen.getByRole('tab', { name: '관계 1개' })).toBeTruthy() // 배지 = 관계 수
  const links = relations()
  expect(screen.getByRole('heading', { name: /연관 설정·관계/ }).textContent).toContain('관계 1')
  expect(links.getByRole('list', { name: '친구 관계 목록' }).textContent).toContain('나래 — 친구') // 관계 종류별 묶음(친구 (1))
  expect(document.querySelector('svg.card-relmap-svg')?.getAttribute('aria-hidden')).toBe('true') // 가운데 전체 폭의 큰 그림
  expect(screen.queryByRole('textbox', { name: 'IDENTITY.md' })).toBeNull() // 문서 편집기는 관계 탭에서 사라진다
  expect(within(overview().getByRole('region', { name: '공개 범위' })).getByText('공개 순서 문제 없음')).toBeTruthy() // 이름 입력 위가 아니라 공개 범위 칸 안의 한 줄
  expect(screen.getAllByText('공개 순서 문제 없음')).toHaveLength(1)
  expect(screen.queryByRole('region', { name: '공개 순서 확인' })).toBeNull()
  relations()
  fireEvent.click(screen.getByRole('button', { name: '관계 편집' }))
  expect(await screen.findByRole('region', { name: '관계 편집' })).toBeTruthy() // 기존 관계 편집(관계도 화면)으로 간다
  expect(where()).toBe('/worldstudio/qa?view=people')
  cleanup()
  await show(friends([garam, narae, harbor], garam, narae))
  openCard('항구 장소') // 인물이 아닌 카드도 같은 화면이다
  openPane('관계')
  expect(screen.getByRole('button', { name: '관계 편집' })).toBeTruthy()
  expect(relations().getByRole('button', { name: '관계 추가' })).toBeTruthy() // 이웃이 없으면 빈 상태의 관계 추가
})

// ── 설정 카드 편집 화면의 왼쪽 활동 막대(VS Code식 아이콘): 탭은 가운데 본문 전체를 바꾸고 설정 카드 목록만 왼쪽에 펼쳐지는 패널이다 ──────────────
it('편집 화면 왼쪽은 활동 막대다: 맨 위 설정 카드 목록 토글과 구분선 아래 탭 다섯(개요·문서·관계·버전·공개 순서)이고 처음에는 문서 탭이다(이름 입력·설명 편집기, 주소에 pane이 없다)', async () => {
  const [garam, narae, harbor] = [person('가람'), person('나래'), place('항구')]
  await show(friends([garam, narae, harbor], garam, narae))
  openCard('가람 인물')
  const bar = within(screen.getByRole('tablist', { name: '카드 화면' }))
  expect(bar.getAllByRole('tab').map((t) => [t.getAttribute('title'), t.getAttribute('aria-selected')])).toEqual([['개요', 'false'], ['문서', 'true'], ['관계', 'false'], ['버전', 'false'], ['공개 순서', 'false']])
  const body = screen.getByRole('tabpanel')
  expect(body.getAttribute('aria-labelledby')).toBe(bar.getByRole('tab', { name: '문서' }).id)
  expect(within(body).getByRole('textbox', { name: 'IDENTITY.md' })).toBeTruthy() // 문서 탭: 문서 편집기(인물은 IDENTITY.md부터)
  expect(editor().getByRole('textbox', { name: '설정 이름' })).toBeTruthy() // 이름은 모든 탭 위에 고정이다
  for (const gone of [body.querySelector('.world-overview'), editor().queryByRole('combobox', { name: '유형' }), editor().queryByRole('group', { name: '대표 이미지' }), editor().queryByRole('region', { name: '공개 범위' }), editor().queryByRole('region', { name: '연관 설정' }), screen.queryByRole('region', { name: '버전 그래프' })]) expect(gone).toBeNull()
  expect(where()).not.toContain('pane=')
  expect(editor().queryByText('상세 설정 · 선택')).toBeNull() // 사건·기존 관계 같은 카드가 아니면 상세 설정이 없다
  expect(screen.getByRole('button', { name: '설정 카드 목록' }).getAttribute('aria-expanded')).toBe('true') // 목록은 왼쪽 패널
  expect(screen.getByRole('navigation', { name: '설정 카드 목록' })).toBeTruthy()
})

it('탭을 누르면 가운데 본문 전체가 그 화면으로 바뀌고(문서 편집기는 관계 탭에서 사라진다), 고른 화면은 주소의 pane에 기록을 쌓지 않고 남는다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae))
  openCard('가람 인물')
  const tab = (name: string | RegExp) => screen.getByRole('tab', { name })
  fireEvent.click(tab(/^관계/))
  expect(screen.queryByRole('textbox', { name: 'IDENTITY.md' })).toBeNull()
  expect(screen.getByRole('region', { name: '연관 설정' })).toBeTruthy()
  expect(tab(/^관계/).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab(/^관계/).id)
  expect(where()).toContain('pane=relations')
  fireEvent.click(tab('개요'))
  expect(screen.queryByRole('region', { name: '연관 설정' })).toBeNull()
  expect(screen.getByRole('combobox', { name: '유형' })).toBeTruthy()
  expect(where()).toContain('pane=overview')
  fireEvent.click(tab('문서'))
  expect(screen.getByRole('textbox', { name: 'IDENTITY.md' })).toBeTruthy()
  expect(where()).not.toContain('pane=') // 기본 화면은 주소에 pane이 없다
  fireEvent.click(tab('버전'))
  expect(screen.getByRole('region', { name: '버전 그래프' })).toBeTruthy()
  expect(where()).toContain('pane=versions')
  backToBoard() // 탭을 옮긴 기록이 쌓이지 않아 한 번에 설정집 화면으로 돌아온다
  expect(screen.getByRole('table', { name: '설정 카드 목록' })).toBeTruthy()
  expect(where()).toBe('/worldstudio/qa')
})

it('주소의 pane으로 처음부터 그 화면이 열리고(새로고침·공유·게시판 상태 칩), 모르는 값은 문서다. 카드를 닫으면 주소에서 pane도 지운다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  mount([garam, narae], '/worldstudio/qa?card=' + garam.item.id + '&pane=relations')
  await screen.findByRole('region', { name: '선택한 설정 편집' })
  expect(screen.getByRole('tab', { name: /^관계/ }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('region', { name: '연관 설정' })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'IDENTITY.md' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '설정집' })) // 주소로 바로 들어왔으니 주소만 바꾼다
  expect(where()).toBe('/worldstudio/qa')
  cleanup()
  mount([garam, narae], '/worldstudio/qa?card=' + garam.item.id + '&pane=nope')
  await screen.findByRole('region', { name: '선택한 설정 편집' })
  expect(screen.getByRole('tab', { name: '문서' }).getAttribute('aria-selected')).toBe('true')
})

it('설정 카드 목록 패널을 펴고 접는 것은 가운데 탭과 따로다: 접으면 막대만 남아 가운데가 넓어지고, 목록에서 다른 카드를 열어도 고른 탭이 그대로다', async () => {
  const [garam, narae] = [person('가람'), person('나래')]
  await show(friends([garam, narae], garam, narae))
  openCard('가람 인물')
  const root = () => document.querySelector('.world-card-studio')!
  const toggle = () => screen.getByRole('button', { name: '설정 카드 목록' })
  openPane('관계')
  fireEvent.click(toggle()) // 목록을 접는다
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  expect(root().getAttribute('data-list')).toBe('closed')
  expect(screen.queryByRole('navigation', { name: '설정 카드 목록' })).toBeNull()
  expect(screen.getByRole('tab', { name: /^관계/ }).getAttribute('aria-selected')).toBe('true') // 가운데 탭은 그대로
  fireEvent.click(toggle())
  expect(root().getAttribute('data-list')).toBe('open')
  fireEvent.click(rail().getByRole('button', { name: '나래 인물' })) // 다른 카드를 열어도 관계 탭이다
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '설정 이름' }).value).toBe('나래')
  expect(screen.getByRole('tab', { name: /^관계/ }).getAttribute('aria-selected')).toBe('true')
  expect(where()).toContain('pane=relations')
})

it('아이콘 위 배지: 관계는 수, 버전은 확정 버전 수(저장하지 않은 변경이 있으면 점), 공개 순서는 문제 수이며 문제가 없으면 배지가 없다', async () => {
  const hall = { ...place('궁궐'), revealFromEpisode: 1 }
  hall.item.text = '승상이 사는 곳.'
  revisions = { ...noRevisions(), rows: [revision(1, '초판'), revision(2, '개정판')], detail: revisionDetail(2, '개정판') }
  await show([hall, { ...place('승상'), revealFromEpisode: 5 }], '/worldstudio/qa', { currentRevisionId: 'r2' })
  openCard('궁궐 장소')
  const names = () => screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))
  expect(names()).toEqual(['개요', '문서', '관계', '버전 2개', '공개 순서 1건']) // 관계 0은 배지가 없다
  expect(screen.getByRole('tab', { name: '공개 순서 1건' }).querySelector('.world-activity-badge')?.textContent).toBe('1')
  fireEvent.change(editor().getByRole('textbox', { name: '설정 이름' }), { target: { value: '궁궐 터' } })
  expect(names()[3]).toBe('버전 저장 안 됨') // 저장하지 않은 변경이 있으면 수 대신 점
  expect(screen.getByRole('tab', { name: '버전 저장 안 됨' }).querySelector('.world-activity-badge')?.className).toContain('dot')
})

it('관계 탭은 관계 종류별로 묶고 알고 있음 같은 조용한 종류는 기본으로 접는다(의미 있는 종류가 위에 열려 있다)', async () => {
  const [hero, ...others] = ['주인공', '형', '누나', '지인1', '지인2', '지인3'].map((name) => person(name))
  const relate = (to: StudioSetting, title: string) => ({ subjectId: hero.item.id, targetId: to.item.id, predicate: 'custom_relation_directed', polarity: 'asserted' as const, title, text: title + ' 설명 문장이다.' })
  let settings: StudioSetting[] = [hero, ...others]
  others.forEach((other, i) => { settings = putRelation(settings, relate(other, i < 2 ? '가족' : '알고 있음')) })
  await show(settings)
  openCard('주인공 인물')
  relations()
  expect(screen.getByRole('tab', { name: '관계 5개' })).toBeTruthy()
  const groups = [...screen.getByRole('region', { name: '연관 설정' }).querySelectorAll<HTMLDetailsElement>('details.card-relmap-kind')]
  expect(groups.map((d) => [d.querySelector('summary')!.textContent, d.open])).toEqual([['가족 (2)', true], ['알고 있음 (3)', false]])
  const known = screen.getByRole('list', { name: '알고 있음 관계 목록' })
  expect(Array.from(known.children)).toHaveLength(3) // 접혀 있어도 목록은 있다(줄마다 '자세히'의 본문은 별개)
})

// ── 원고로 세계관을 만들거나 업데이트할 때 남는 '확인 필요'(서버 semanticMetadata.manuscriptBuild.needsReview → 카드의 needsReview) ──
const needsReview = (row: StudioSetting): StudioSetting => ({ ...row, needsReview: true })

it('확인 필요로 남은 카드에만 상태 칸에 확인 필요 칩이 붙고, 누르면 그 카드의 편집 화면이 문서 탭으로 열린다', async () => {
  const harbor = needsReview(place('항구'))
  await show([harbor, place('마을')])
  expect(todos('항구')).toEqual(['확인 필요'])
  expect(todos('마을')).toEqual([])
  fireEvent.click(statusCell('항구').getByRole('button', { name: '항구 확인 필요 보기' }))
  expect(where()).toBe('/worldstudio/qa?card=' + harbor.item.id)
  expect(screen.getByRole('tab', { selected: true }).querySelector('.world-activity-label')?.textContent).toBe('문서')
})

it('설정 카드 목록 패널(편집 화면)에서도 확인 필요 카드의 항목에만 칩이 붙고 읽는 이름에도 들어간다', async () => {
  await show([needsReview(place('항구')), place('마을')])
  openCard('항구 장소')
  expect(rail().getByRole('button', { name: '항구 장소 확인 필요' }).textContent).toContain('확인 필요')
  expect(rail().getByRole('button', { name: '마을 장소' }).textContent).not.toContain('확인 필요')
})

it('확인 필요 카드를 고쳐도 확인 필요 칩은 그대로 남는다', async () => {
  await show([needsReview(place('항구'))])
  openCard('항구 장소')
  fireEvent.change(editor().getByRole('textbox', { name: '설정 이름' }), { target: { value: '큰 항구' } })
  backToBoard()
  expect(todos('큰 항구')).toEqual(['확인 필요'])
})
