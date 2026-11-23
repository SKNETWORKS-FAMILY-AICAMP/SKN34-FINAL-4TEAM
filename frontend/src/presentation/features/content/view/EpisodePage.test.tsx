// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { act, cleanup, render as renderIn, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, RouterProvider, createMemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import '../../../../test/testLocks'
import { EpisodePage } from './EpisodePage'
import { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { HttpEpisodeRepository } from '../../../../data/content/HttpEpisodeRepository'
import { login } from '../../../../data/api/auth'
import { appContainer } from '../../../../app/appContainer'
import { InMemoryGenreRepository, InMemoryOperationsGenreRepository } from '../../../../data/mock/InMemoryGenreRepositories'
import { createAppStore } from '../../../../app/store'
import { settings as serialSettings } from '../../../../test/serialFixtures'

/** 상단바·푸터는 공용 Gnb·Footer라 이 화면 테스트에서는 호출만 기록하는 대역으로 바꾼다(실제 Gnb는 Redux 스토어가 필요하다). */
const shell = vi.hoisted(() => ({ gnb: vi.fn(), footer: vi.fn() }))
vi.mock('../../../shared/shell/Gnb', () => ({
  Gnb: (props: { on?: string }) => { shell.gnb(props.on); return null },
  Footer: () => { shell.footer(); return null },
}))

/** EpisodePage는 주소의 ?work= 로 화면이 정해지므로 라우터 안에서 그린다. 세계관 탭의 세계관 연결 카드가 공용 조회 훅(useAsyncData)으로 store를 읽어 Provider로 감싼다. */
const render = (ui: ReactElement, entry = '/content') => renderIn(<Provider store={createAppStore()}><MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter></Provider>)
/** 이동을 확인하려고 현재 주소를 화면에 적어 둔다. */
const Where = () => {
  const { pathname, search, state } = useLocation()
  return <><p>위치 {pathname}{search}</p>{state?.deletedWorkTitle && <p>삭제 완료 작품 {state.deletedWorkTitle}</p>}</>
}

beforeEach(async () => {
  // 장르 선택지는 서버의 공개 장르 목록이라 운영과 같은 메모리 목록으로 대신한다(afterEach의 restoreAllMocks가 되돌린다).
  const genres = new InMemoryGenreRepository(new InMemoryOperationsGenreRepository())
  vi.spyOn(appContainer.resolve('genreUseCase'), 'list').mockImplementation(() => genres.list())
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'content-csrf' })
    : Response.json({ accessToken: 'content-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })))
  await login('writer@example.invalid', 'test-password')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); shell.gnb.mockClear(); shell.footer.mockClear() })

/** 작품 등록 필수값(장르 1개·권리 확인)을 채운다. 장르 선택지는 서버 목록이라 그려질 때까지 기다린다. */
const fillRegistration = async () => {
  await within(screen.getByLabelText('장르')).findByRole('option', { name: '판타지' })
  fireEvent.change(screen.getByLabelText('장르'), { target: { value: '판타지' } })
  fireEvent.click(screen.getByLabelText('이 작품을 등록할 권리가 있음을 확인합니다.'))
}

/**
 * 같은 경로가 여러 번 읽혀도 호출마다 새 Response를 돌려주는 Content API 대역. 정의하지 않은 요청은 실패한다.
 * 작품 관리가 열 때마다 읽는 소유자 회차 목록(GET /works/{id}/episodes)만은 기본으로 빈 목록이고, 운영 설정 탭이 읽는 운영 설정(GET /works/{id}/operating-settings)은 기본으로 '집필 방식 미선택'이다(정의하면 그것을 쓴다). 이 기본이 없으면 읽기 실패가 조용히 화면에 그려진다.
 */
const contentApi = (routes: Record<string, () => Response | Promise<Response>>) => vi.fn<typeof fetch>(async (input, init) => {
  const route = `${init?.method ?? 'GET'} ${String(input)}`
  const make = routes[route] ?? (/^GET \/api\/v1\/works\/[^/]+\/episodes$/.test(route) ? () => Response.json([]) : /^GET \/api\/v1\/works\/[^/]+\/operating-settings$/.test(route) ? () => Response.json(unsetSettings) : undefined)
  if (!make) throw new Error(`대역에 없는 요청: ${route}`)
  return make()
})
const unsetSettings = { current: { revision: 0, writingMode: null, changedAt: null }, history: [], worldUpdateMode: 'manual', proofreadingMode: 'review', autoserialState: 'off' }
const openContent = (fetcher: typeof fetch, entry = '/content') =>
  render(<><EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(fetcher))} /><Where /></>, entry)
/** 분기 정책·포크 정보·작품 삭제는 '운영 설정' 탭에 있다. 탭을 열고 운영 설정 읽기가 끝난 뒤(집필 방식 저장 버튼이 그려진 뒤) 돌아온다. */
const openSettings = async () => {
  fireEvent.click(screen.getByRole('button', { name: '운영 설정' }))
  await screen.findByRole('button', { name: '집필 방식 저장' })
}
/** 열린 작품은 주소의 ?work= 로 정해진다. 기본 탭은 개요라 히어로 제목이 나올 때까지 기다린다(?tab=으로 다른 탭을 곧바로 열면 히어로가 없어 작품 메뉴로 갈음한다). */
const openWork = async (fetcher: typeof fetch, title = '옛 제목', entry = '/content?work=w') => {
  openContent(fetcher, entry)
  if (entry.includes('tab=')) await screen.findByRole('navigation', { name: '작품 메뉴' })
  else await screen.findByRole('heading', { level: 1, name: title })
}
/** 회차 목록·작성 중인 초안은 공개 회차 탭에, 히어로(작품 정보·표지)는 개요 탭에 있다. */
const toReadTab = () => fireEvent.click(screen.getByRole('button', { name: /^공개 회차/ }))
const toOverviewTab = () => fireEvent.click(screen.getByRole('button', { name: '개요' }))
const openRead = async (fetcher: typeof fetch, title?: string, entry?: string) => { await openWork(fetcher, title, entry); toReadTab() }
/** 표지 조회(GET .../cover)는 '표지 없음'(404)으로 답하고, 표지 업로드(PUT)는 onUpload가 답한다. 그 밖의 요청은 beforeEach 대역과 같다. */
const stubCover = (onUpload?: (path: string, init: RequestInit) => Response) => vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
  if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'content-csrf' })
  if (path.endsWith('/cover') || path.endsWith('/cover/content')) return init?.method === 'PUT' && onUpload ? onUpload(path, init) : new Response(null, { status: 404 })
  return Response.json({ accessToken: 'content-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })
}))

const owned = { id: 'w', title: '옛 제목', summary: '옛 소개', visibility: 'private', allowFork: false, allowForkPublication: false, revision: 0, source: null, episodes: [], draft: { title: '회차', body: '초안', revision: 0 }, creationType: 'ORIGINAL', genres: ['판타지', 'SF'], hashtags: ['회귀', '성장'] }
const episode = (number: number) => ({ number, version: 1, title: `${number}화 제목`, body: `${number}화 본문`, inherited: false })
/** 소유자 회차 조회(GET /works/{id}/episodes)의 한 줄. 기본은 발행 전 초안이다. */
const writingRow = (number: number, extra: object = {}) => ({
  number, draft: { title: `${number}화 초안`, body: '', revision: 0 }, publicationStatus: 'draft', hasDraft: true,
  versions: [], publishedVersionId: null, inherited: false, updatedAt: null, checkpointStatus: 'none', checkpoints: [], ...extra,
})
const draftMetric = () => screen.queryByText('작성 중인 초안', { selector: 'dt' })?.nextElementSibling?.textContent ?? null
const myFork = { ...owned, title: '내 포크', summary: '소개', visibility: 'public', revision: 4, draft: { ...owned.draft, revision: 4 }, source: { workId: 'o', title: '원작', episode: 2, version: 7, direction: '다른 결말' } }
const STOP_CONFIRM = '포크 작품의 공개를 중단할까요? 발행된 회차와 원고는 보존돼요. 대기 중인 예약 발행은 취소되고, 원작이 공개를 허용하지 않으면 다시 공개할 수 없어요.'
const AREAS = ['작품 정보 편집', '표지 편집', '분기 정책 편집']
/** jsdom에는 URL.createObjectURL이 없어 표지 미리보기 테스트가 쓰는 대역이다. 해제한 주소를 모아 돌려준다. */
const stubPreviewUrl = () => {
  const revoked: string[] = []
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:preview'
    static revokeObjectURL = (url: string) => { revoked.push(url) }
  })
  return revoked
}
/** 표지 업로드(PUT .../cover)에 대한 서버 응답. url은 요청 경로의 콘텐츠 경로여야 한다. */
const coverReply = (path: string) => Response.json({ id: '33333333-3333-4333-8333-333333333333', filename: 'cover.png', mediaType: 'image/png', kind: 'IMAGE', byteSize: 3, createdAt: '2026-11-03T00:00:00Z', url: `${path}/content` })

// ── 작품 만들기 (/content) ─────────────────────────────────────────────

it('개요 탭 히어로에는 통계 줄이 없고 공개 회차·작성 중인 초안은 지표 카드에만 보인다', async () => {
  stubCover()
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([{ ...owned, visibility: 'public' }]),
    'GET /api/v1/works/w/episodes': () => Response.json([writingRow(1)]),
  }))
  await waitFor(() => expect(draftMetric()).toBe('1개'))
  expect(document.querySelector('.ep-hero .stats')).toBeNull()
})

it('counts the editable drafts of a public work in the overview metric card and leaves opening them to the studio', async () => {
  const rows = ['첫 장면', '둘째 장면'].map((title, i) => ({
    number: i + 1, draft: { title, body: '', revision: 0 }, publicationStatus: 'draft',
    hasDraft: true, versions: [], publishedVersionId: null, inherited: false,
    updatedAt: null, checkpointStatus: 'none', checkpoints: [],
  }))
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([{ ...owned, visibility: 'public' }]),
    'GET /api/v1/works/w/episodes': () => Response.json(rows),
  }))
  expect(await screen.findByText('공개 회차 없음')).toBeTruthy()
  await waitFor(() => expect(draftMetric()).toBe('2개'))
  // 초안은 집필실 왼쪽 회차 목록에서 연다: 공개 회차 탭에는 초안 묶음도 초안 링크도 없고, 집필실로 가는 길은 집필실 열기뿐이다.
  toReadTab()
  expect(screen.queryByRole('heading', { name: '작성 중인 초안' })).toBeNull()
  for (const ep of rows) expect(screen.queryByRole('link', { name: `${ep.number}화 · ${ep.draft.title}` })).toBeNull()
  expect(screen.getByRole('link', { name: '집필실 열기' }).getAttribute('href')).toBe('/studio/w')
})

it('does not count a suspended episode as a draft in progress', async () => {
  stubCover()
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([{ ...owned, visibility: 'public' }]),
    'GET /api/v1/works/w/episodes': () => Response.json([writingRow(1), writingRow(2, { publicationStatus: 'suspended' })]),
  }))
  await waitFor(() => expect(draftMetric()).toBe('1개'))
})

it('keeps a place for the draft count while drafts load and fills it in when they arrive', async () => {
  stubCover()
  let finish!: (res: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([{ ...owned, visibility: 'public' }]),
    'GET /api/v1/works/w/episodes': () => pending,
  }))
  // 읽는 동안에도 자리를 잡아 두어, 읽고 나서 끼어들며 아래 화면을 밀지 않는다.
  expect(draftMetric()).toContain('…')
  finish(Response.json([writingRow(1), writingRow(2)]))
  await waitFor(() => expect(draftMetric()).toBe('2개'))
  expect(draftMetric()).not.toContain('…')
})

it('tells the drafts could not be read in an alert box and does not pretend to count them', async () => {
  stubCover()
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([owned]),
    'GET /api/v1/works/w/episodes': () => Response.json({ detail: '서버 오류' }, { status: 500 }),
  }))
  toReadTab() // 오류 상자는 공개 회차 탭의 초안 목록 자리에 있다.
  const alert = await screen.findByText('초안 목록을 불러오지 못했어요.')
  expect(alert.getAttribute('role')).toBe('alert')
  expect(alert.classList.contains('ep-alert')).toBe(true)
  // 못 읽은 것을 읽는 중처럼 '…'로 두지도, 0개로 채우지도 않는다.
  toOverviewTab()
  expect(draftMetric()).toBeNull()
})

it('creates a private work through the API and opens its writing studio', async () => {
  const calls = vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'w1', title: '별의 기록', summary: '', visibility: 'private', allowFork: false, revision: 0, source: null, episodes: [], draft: { title: '새 회차', body: '', revision: 0 } })))
  render(<><EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))} /><Where /></>)
  await screen.findByText('새 작품 만들기')
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: '별의 기록' } })
  fireEvent.click(screen.getByLabelText('외부 2차 창작', { exact: false }))
  await fillRegistration()
  fireEvent.change(screen.getByLabelText('두 번째 장르'), { target: { value: 'SF' } })
  fireEvent.change(screen.getByLabelText('해시태그'), { target: { value: '#회귀, 성장' } })
  fireEvent.click(screen.getByRole('button', { name: '작품 만들기' }))
  await screen.findByText('위치 /studio/w1')
  expect(calls.mock.calls[1][0]).toBe('/api/v1/works')
  expect(JSON.parse(calls.mock.calls[1][1].body)).toEqual({ title: '별의 기록', summary: '', creationType: 'EXTERNAL_DERIVATIVE', genres: ['판타지', 'SF'], hashtags: ['회귀', '성장'], rightsConfirmed: true })
})

it('does not reuse the previous cover when creating another work', async () => {
  const first = { id: '11111111-1111-4111-8111-111111111111', title: '첫 작품', summary: '', visibility: 'private', allowFork: false, revision: 0, source: null, episodes: [], draft: { title: '새 회차', body: '', revision: 0 } }
  const second = { ...first, id: '22222222-2222-4222-8222-222222222222', title: '두 번째 작품' }
  const calls = vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json([first])).mockResolvedValueOnce(Response.json(second))
  const uploads = vi.fn(async (path: string, init: RequestInit) => {
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
    return Response.json({ id: '33333333-3333-4333-8333-333333333333', filename: 'first.png', mediaType: 'image/png', kind: 'IMAGE', byteSize: 3, createdAt: '2026-11-03T00:00:00Z', url: `${path}/content` })
  })
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'content-csrf' }) : init?.method === 'PUT' ? uploads(path, init) : new Response(null, { status: 404 })))
  stubPreviewUrl()
  const router = createMemoryRouter([{ path: '/content', element: <EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))} /> }, { path: '/studio/:id', element: <Where/> }], { initialEntries: ['/content'] })
  renderIn(<Provider store={createAppStore()}><RouterProvider router={router} useTransitions={false} /></Provider>)
  await screen.findByText('새 작품 만들기')
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: first.title } })
  fireEvent.change(screen.getByLabelText('표지 이미지 선택'), { target: { files: [new File(['png'], 'first.png', { type: 'image/png' })] } })
  await fillRegistration()
  fireEvent.click(screen.getByRole('button', { name: '작품 만들기' }))
  await waitFor(() => expect(router.state.location.pathname).toBe(`/studio/${first.id}`))
  expect(uploads).toHaveBeenCalledTimes(1)
  expect(uploads.mock.calls[0][0]).toBe(`/api/v1/works/${first.id}/cover`)
  expect(router.state.location.search).toBe('')
  // 서재의 '＋ 새 소설 쓰기'로 /content에 다시 들어온 것과 같다.
  await act(async () => { await router.navigate('/content') })
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: second.title } })
  expect(screen.getByText('PNG·JPEG · 10 MiB 이하. 작품 생성 후 실제 작품 ID로 표지를 저장해요.')).toBeTruthy()
  expect((screen.getByLabelText('이 작품을 등록할 권리가 있음을 확인합니다.') as HTMLInputElement).checked).toBe(false)
  await fillRegistration()
  fireEvent.click(screen.getByRole('button', { name: '작품 만들기' }))
  await waitFor(() => expect(router.state.location.pathname).toBe(`/studio/${second.id}`))
  expect(uploads).toHaveBeenCalledTimes(1)
})

it('shows the default cover in the cover slot of the creation screen', async () => {
  stubCover()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([]) }))
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  expect(document.querySelector('.ep-cover img[src="/default-work-cover.svg"]')).toBeTruthy()
})

it('puts the same disabled AI 생성 button with a visible 준비 중 note beside the cover input of the creation screen', async () => {
  stubCover()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([]) }))
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  const ai = screen.getByRole('button', { name: 'AI로 생성' }) as HTMLButtonElement
  expect(ai.disabled).toBe(true)
  expect(ai.classList.contains('sm')).toBe(true)
  expect(document.getElementById(ai.getAttribute('aria-describedby') ?? '')?.textContent).toBe('준비 중')
  // 작품 관리의 표지 편집과 같이 '표지 이미지 선택' 보조 버튼과 한 줄(.ep-cover-pick)에 놓인다.
  const picker = screen.getByLabelText('표지 이미지 선택')
  expect(picker.closest('label')?.classList.contains('btn')).toBe(true)
  expect(ai.closest('.ep-cover-pick')).toBe(picker.closest('.ep-cover-pick'))
  // 눌러도 폼이 전송되거나 파일 선택이 바뀌지 않는다.
  fireEvent.click(ai)
  expect(screen.getByText('PNG·JPEG · 10 MiB 이하. 작품 생성 후 실제 작품 ID로 표지를 저장해요.')).toBeTruthy()
})

it('previews the chosen cover image in the cover slot of the creation screen', async () => {
  stubCover()
  stubPreviewUrl()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([]) }))
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  fireEvent.change(screen.getByLabelText('표지 이미지 선택'), { target: { files: [new File(['png'], 'cover.png', { type: 'image/png' })] } })
  expect(document.querySelector('.ep-cover img')?.getAttribute('src')).toBe('blob:preview')
  expect(screen.getByText('선택한 파일: cover.png')).toBeTruthy()
})

it('hides the 내 댓글·제보 link on the creation screen', async () => {
  stubCover()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([]) }))
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  expect(screen.queryByRole('link', { name: '내 댓글·제보' })).toBeNull()
})

it('keeps 작품 만들기 disabled when my works could not be loaded', async () => {
  const calls = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '서버 인증이 필요합니다.' }), { status: 401 }))
  render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))} />)
  await screen.findByText('서버 인증이 필요합니다. 로그인한 뒤 다시 시도해 주세요.')
  expect((screen.getByRole('button', { name: '작품 만들기' }) as HTMLButtonElement).disabled).toBe(true)
})

it('clears the second genre when the first genre becomes the same one, so the hidden value does not come back later', async () => {
  stubCover()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([]) }))
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  const first = screen.getByLabelText('장르') as HTMLSelectElement
  const second = screen.getByLabelText('두 번째 장르') as HTMLSelectElement
  await within(second).findByRole('option', { name: '무협' })
  fireEvent.change(first, { target: { value: '판타지' } })
  fireEvent.change(second, { target: { value: 'SF' } })
  fireEvent.change(first, { target: { value: 'SF' } })
  expect(second.value).toBe('')
  // 첫 장르를 다시 바꿔도 가려졌던 'SF'가 둘째 장르로 되살아나지 않는다.
  fireEvent.change(first, { target: { value: '무협' } })
  expect(second.value).toBe('')
})

it('shows the creation screen without ?work= even when works already exist', async () => {
  stubCover()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  expect(await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '작품 정보 편집' })).toBeNull()
})

// ── 화면 뼈대: 사이드바 없음, 뒤로가기, 주소로 정해지는 화면 ─────────────────

it('shows the server authentication error instead of claiming the server is offline', async () => {
  const calls = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '서버 인증이 필요합니다.' }), { status: 401 }))
  render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))} />)
  expect(await screen.findByText('서버 인증이 필요합니다. 로그인한 뒤 다시 시도해 주세요.')).toBeTruthy()
  expect(calls).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('Core 서버에 연결하지 못했어요. 서버를 실행한 뒤 새로고침해 주세요.')).toBeNull()
})

it('exposes one focusable main landmark with one h1 and names the browser tab', async () => {
  render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(vi.fn().mockResolvedValue(new Response('[]'))))} />)
  const h1 = await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  const main = screen.getByRole('main')
  expect(main.id).toBe('main')
  expect(main.getAttribute('tabindex')).toBe('-1')
  expect(main.contains(h1)).toBe(true)
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(document.title).toBe('새 작품 만들기 · STORYFORK')
})

it('keeps the shared top bar and footer on the creation screen, which has no sidebar', async () => {
  stubCover()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  expect(shell.gnb).toHaveBeenCalledWith('lib')
  expect(shell.footer).toHaveBeenCalled()
  expect(document.querySelector('.ep-menu')).toBeNull()
})

it('has no shared top bar or footer on the work management screen — not while the work is read and not when it is not found either, so nothing jumps when the sidebar appears', async () => {
  stubCover()
  let finish!: (response: Response) => void
  openContent(contentApi({ 'GET /api/v1/works': () => new Promise<Response>((resolve) => { finish = resolve }) }), '/content?work=w')
  await waitFor(() => expect(screen.getByText('작품을 불러오고 있어요…')).toBeTruthy())
  // 사이드바가 아직 없어 상단 줄의 링크가 서재로 돌려보낸다.
  expect(screen.getByRole('link', { name: '내가 쓰는 소설' }).closest('.ep-top')).toBeTruthy()
  await act(async () => { finish(Response.json([owned])) })
  await screen.findByRole('heading', { level: 1, name: '옛 제목' })
  expect(document.querySelector('.ep-top')).toBeNull()
  // 작품 설정 화면인데 '집필 작업실'이라 적혀 있던 전용 헤더(로고·부제·스튜디오 이름·칩)는 없다.
  for (const text of ['에피소드 스튜디오', '집필 작업실', '이야기가 갈라지는 순간']) expect(screen.queryByText(text)).toBeNull()
  expect(document.querySelector('.ep-header')).toBeNull()
  expect(shell.gnb).not.toHaveBeenCalled()
  expect(shell.footer).not.toHaveBeenCalled()
  cleanup()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }), '/content?work=someone-elses')
  expect(await screen.findByRole('heading', { level: 1, name: '작품을 찾을 수 없어요' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '내가 쓰는 소설' }).closest('.ep-top')).toBeTruthy()
  expect(shell.gnb).not.toHaveBeenCalled()
  expect(shell.footer).not.toHaveBeenCalled()
})

it('has no sidebar: no work list, new-work button, public browsing, studio shortcut or side note', async () => {
  stubCover()
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([owned]) })
  openContent(fetcher)
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  const absent = () => {
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('navigation', { name: '내 작품' })).toBeNull()
    expect(screen.queryByRole('button', { name: '＋ 새 작품' })).toBeNull()
    expect(screen.queryByRole('button', { name: '공개 작품 찾아보기' })).toBeNull()
    expect(screen.queryByRole('link', { name: '회차별 집필실 열기' })).toBeNull()
    expect(screen.queryByText(/작가의 선택으로 완성되는 이야기/)).toBeNull()
  }
  absent()
  cleanup()
  await openWork(fetcher)
  absent()
})

it('has one text back link to the library at the top of the main area of the creation screen, not a pill button', async () => {
  stubCover()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  const back = screen.getAllByRole('link', { name: '내가 쓰는 소설' })
  expect(back).toHaveLength(1)
  expect(back[0].getAttribute('href')).toBe('/lib?tab=write')
  expect(back[0].classList.contains('ep-back')).toBe(true)
  expect(back[0].classList.contains('back')).toBe(false)
  expect(screen.getByRole('main').firstElementChild?.firstElementChild).toBe(back[0]) // 상단 줄(.ep-top)의 첫 요소
})

it('puts the back link to the library in the sidebar just below the logo and draws no top row while the sidebar is open', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  const back = screen.getAllByRole('link', { name: '내가 쓰는 소설' })
  expect(back).toHaveLength(1)
  expect(back[0].getAttribute('href')).toBe('/lib?tab=write')
  expect(back[0].classList.contains('ep-back')).toBe(true)
  expect(back[0].classList.contains('back')).toBe(false)
  expect(back[0].closest('.ep-menu-body')).toBeTruthy()
  expect(screen.getByRole('main').contains(back[0])).toBe(true)
  expect(document.querySelector('.ep-top')).toBeNull() // 두 곳에 동시에 두지 않는다
})

it('puts the work menu, then the account row in the sidebar — no tool group; 내 댓글·제보 is a menu tab (button) and the studio is reached from the episode list only', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  const side = within(document.querySelector<HTMLElement>('.ep-menu')!)
  const order = [
    side.getByRole('navigation', { name: '작품 메뉴' }),
    side.getByRole('link', { name: '알림함' }),
    side.getByRole('button', { name: '내 계정 메뉴' }),
  ]
  order.slice(1).forEach((el, i) => expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, el.textContent || el.getAttribute('aria-label') || '').toBeTruthy())
  // 사이드바 본문의 마지막은 메뉴다: 도구 묶음(회차 작성하기·내 댓글·제보 링크)은 없고, 알림·테마·계정은 본문 밖의 맨 아래 줄이다.
  expect(document.querySelector('.ep-menu-tools')).toBeNull()
  expect(order[0].closest('.ep-menu-body')?.lastElementChild).toBe(order[0])
  expect(order[1].closest('.ep-menu-account')?.contains(order[2])).toBe(true)
  expect(order[1].closest('.ep-menu-body')).toBeNull()
  expect(screen.queryByRole('link', { name: '회차 작성하기' })).toBeNull()
  expect(screen.queryByRole('link', { name: '내 댓글·제보' })).toBeNull() // 사이드바 링크가 아니라 작품 메뉴의 탭(버튼)이다
  expect(within(order[0]).getByRole('button', { name: '내 댓글·제보' })).toBeTruthy()
})

it('folds the sidebar: the back link moves to the top row so it is never in two places (no action buttons there), and unfolding brings it back', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  const frame = document.querySelector<HTMLElement>('.ep-manage')!
  expect(frame.hasAttribute('data-menu')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '작품 메뉴 접기' }))
  expect(frame.getAttribute('data-menu')).toBe('collapsed')
  const toggle = screen.getByRole('button', { name: '작품 메뉴 펼치기' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  const top = within(document.querySelector<HTMLElement>('.ep-top')!)
  expect(top.getByRole('link', { name: '내가 쓰는 소설' }).getAttribute('href')).toBe('/lib?tab=write')
  // 상단 줄에는 돌아가기 링크뿐이다: 회차 작성하기·내 댓글·제보 같은 행동 버튼은 사이드바에도 상단 줄에도 없다.
  expect(document.querySelector('.ep-top')?.children).toHaveLength(1)
  expect(document.querySelector('.ep-top-actions')).toBeNull()
  expect(screen.queryByRole('link', { name: '회차 작성하기' })).toBeNull()
  expect(screen.queryByRole('link', { name: '내 댓글·제보' })).toBeNull()
  expect(screen.getAllByRole('link', { name: '내가 쓰는 소설' })).toHaveLength(1)
  // 900px 이하에서는 접힌 본문도 CSS로 보이므로 hidden에 기대지 않고 DOM에서도 한 곳뿐이다.
  expect(document.querySelector('.ep-menu-back')).toBeNull()
  fireEvent.click(toggle)
  expect(document.querySelector('.ep-top')).toBeNull()
  expect(frame.hasAttribute('data-menu')).toBe(false)
  expect(screen.getAllByRole('link', { name: '내가 쓰는 소설' })).toHaveLength(1)
  expect(screen.getByRole('link', { name: '내가 쓰는 소설' }).closest('.ep-menu-body')).toBeTruthy()
})

it('draws the top alert and the status line at the top of the content column so they never push the sidebar down', async () => {
  stubCover()
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([owned]),
    'PUT /api/v1/works/w': () => Response.json({ detail: '원고가 변경됐어요. 최신 데이터를 불러와 주세요.' }, { status: 409 }),
  }))
  const frame = document.querySelector<HTMLElement>('.ep-manage')!
  const content = frame.querySelector<HTMLElement>('.ep-content')!
  expect(frame.previousElementSibling).toBeNull() // 사이드바 틀 위에는 아무것도 끼지 않는다
  expect(content.querySelector(':scope > .ep-notice[role=status]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: '새 제목' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  const alert = (await screen.findByText(/원고가 변경됐어요\./)).closest('[role=alert]')
  expect(alert?.parentElement).toBe(content)
  expect(frame.previousElementSibling).toBeNull()
})

it('opens the work named by ?work= from the start and shows its management hero with the saved fork policy', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, allowFork: true }]) }))
  expect(screen.getByRole('button', { name: '작품 정보 편집' })).toBeTruthy()
  await openSettings()
  expect(within(screen.getByRole('region', { name: '분기 정책' })).getByText('분기 만들기').nextElementSibling?.textContent).toBe('허용')
  expect(screen.queryByText('새 작품 만들기')).toBeNull()
  await waitFor(() => expect(document.title).toBe('작품 관리 · 옛 제목 · STORYFORK'))
})

it('says the work cannot be found and links back to the library when ?work= is not one of my works', async () => {
  stubCover()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }), '/content?work=someone-elses')
  expect(await screen.findByRole('heading', { level: 1, name: '작품을 찾을 수 없어요' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '내가 쓰는 소설로 돌아가기' }).getAttribute('href')).toBe('/lib?tab=write')
  expect(screen.queryByLabelText('작품 제목')).toBeNull()
  expect(screen.queryByRole('button', { name: '작품 만들기' })).toBeNull()
})

it('keeps the creation form out of sight while the work list is being read for ?work=', async () => {
  stubCover()
  let finish!: (response: Response) => void
  openContent(contentApi({ 'GET /api/v1/works': () => new Promise<Response>((resolve) => { finish = resolve }) }), '/content?work=w')
  await waitFor(() => expect(screen.getByText('작품을 불러오고 있어요…')).toBeTruthy())
  expect(screen.queryByRole('button', { name: '작품 만들기' })).toBeNull()
  expect(screen.queryByRole('heading', { level: 1, name: '작품을 찾을 수 없어요' })).toBeNull()
  await act(async () => { finish(Response.json([owned])) })
  expect(await screen.findByRole('heading', { level: 1, name: '옛 제목' })).toBeTruthy()
})

// ── 작품 관리 polish(A·B 리뷰): 고른 탭이 첫 화면에서 시작한다 ──────────────────

it('shrinks the hero to a thumbnail strip at rest so the chosen tab starts on the first screen, and opens it up only while the info or cover is edited', async () => {
  stubCover()
  const id = '11111111-1111-4111-8111-111111111111'
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, id }]) }), '옛 제목', `/content?work=${id}`)
  const hero = () => document.querySelector('.ep-hero')!
  expect(hero().classList.contains('ep-hero-compact')).toBe(true)
  expect(screen.getByText('옛 소개')).toBeTruthy() // 소개는 숨기지 않는다(두 줄 말줄임은 CSS)
  for (const name of ['작품 정보 편집', '표지 편집']) {
    fireEvent.click(screen.getByRole('button', { name }))
    expect(hero().classList.contains('ep-hero-compact'), name).toBe(false) // 폼은 옛 큰 히어로의 넓은 칸에서 열린다
    await waitFor(() => expect((document.querySelector('.ep-hero fieldset') as HTMLFieldSetElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(hero().classList.contains('ep-hero-compact'), name).toBe(true)
  }
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: '분기 정책 편집' }))
  expect(document.querySelector('.ep-hero')).toBeNull() // 히어로는 개요 탭에만 있다: 분기 정책 편집은 운영 설정 탭 안에서 열린다
})

it('keeps the fork policy and the work deletion out of the shared top: the content column holds only the status line and the tab (the hero belongs to the overview tab), and both live in the operating settings tab — policy below the settings, deletion as the last block', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  const column = document.querySelector('.ep-content')!
  const structure = () => Array.from(column.children, (el) => el.className.split(' ')[0])
  expect(structure()).toEqual(['ep-notice', 'ep-tab'])
  for (const name of ['분기 정책', '작품 삭제']) expect(screen.queryByRole('region', { name })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '이야기 분기' })) // 다른 탭에도 없다
  for (const name of ['분기 정책', '작품 삭제']) expect(screen.queryByRole('region', { name })).toBeNull()
  await openSettings()
  const order = [
    screen.getByRole('heading', { level: 2, name: '운영 설정' }),
    screen.getByRole('button', { name: '집필 방식 저장' }),
    screen.getByRole('region', { name: '분기 정책' }),
    screen.getByRole('region', { name: '작품 삭제' }),
  ]
  order.slice(1).forEach((el, i) => expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, el.textContent || '').toBeTruthy())
  expect(document.querySelector('.ep-settings-cards')?.lastElementChild).toBe(order[3]) // 삭제는 설정 카드 틀 맨 끝의 위험 구역이다(분기 정책·설정 카드와 같은 틀)
  expect(document.querySelector('.ep-tab')?.lastElementChild).toBe(document.querySelector('.ep-settings-cards'))
  expect(structure()).toEqual(['ep-notice', 'whero', 'ep-tab']) // 개요 밖 탭은 상태 줄과 탭 사이에 짧은 작품 요약(.ep-brief)만 더한다
  // 두 구획의 제목은 운영 설정 탭 제목(h2) 아래 묶음 제목(h3)이다. 삭제 버튼의 이름·확인 흐름은 그대로다.
  expect(within(order[2]).getByRole('heading', { level: 3, name: '분기 정책' })).toBeTruthy()
  expect(within(order[3]).getByRole('heading', { level: 3, name: '작품 삭제' })).toBeTruthy()
  expect(within(order[3]).getByRole('button', { name: '작품 삭제' }).classList.contains('ep-danger')).toBe(true)
})

it('puts the fork info card, which carries its own delete, in the operating settings tab and offers no separate deletion block for a fork', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([myFork]) }), '내 포크')
  expect(Array.from(document.querySelector('.ep-content')!.children, (el) => el.className.split(' ')[0])).toEqual(['ep-notice', 'ep-tab'])
  await openSettings()
  expect(screen.getByRole('region', { name: '포크 정보' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: '작품 삭제' })).toBeNull()
  expect(screen.getByRole('button', { name: '포크 삭제' })).toBeTruthy()
})

it('locks the other tabs while the fork policy is edited so the open form is never dropped, and unlocks them after cancel', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  await openSettings()
  const tab = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
  expect(tab('공개 회차 · 0').disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '분기 정책 편집' }))
  expect(tab('공개 회차 · 0').disabled).toBe(true)
  expect(tab('이야기 분기').disabled).toBe(true)
  expect(tab('운영 설정').disabled).toBe(false) // 지금 탭은 두어 키보드 초점이 사라지지 않게 한다
  fireEvent.click(within(screen.getByRole('form', { name: '분기 정책 편집' })).getByRole('button', { name: '취소' }))
  expect(tab('공개 회차 · 0').disabled).toBe(false)
  expect(screen.queryByRole('form', { name: '분기 정책 편집' })).toBeNull()
})

it('has one main landmark whose only navigation is the labelled work menu, and a skip link that moves focus to the content column', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getAllByRole('navigation').map((nav) => nav.getAttribute('aria-label'))).toEqual(['작품 메뉴'])
  const skip = screen.getByRole('link', { name: '본문으로 바로가기' })
  expect(document.querySelector('.ep-menu')?.firstElementChild).toBe(skip) // 사이드바의 첫 요소(공용 상단바가 없어 상단바의 링크를 대신한다)
  const column = document.getElementById('ep-content')!
  expect(column.classList.contains('ep-content')).toBe(true)
  expect(column.getAttribute('tabindex')).toBe('-1')
  fireEvent.click(skip)
  expect(document.activeElement).toBe(column)
})

it('keeps the status line as an empty live region while there is nothing to announce, so it takes no space at the top of the content column', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  const notice = document.querySelector('.ep-content>.ep-notice')!
  expect(notice.getAttribute('role')).toBe('status')
  expect(notice.matches(':empty')).toBe(true) // CSS가 비어 있을 때만 높이·간격을 0으로 만든다
})

it('says why the writing mode save is locked right beside the button until a mode is chosen', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  await openSettings()
  const save = screen.getByRole('button', { name: '집필 방식 저장' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  const why = screen.getByText('집필 방식을 먼저 선택해 주세요.')
  expect(save.getAttribute('aria-describedby')).toBe(why.id)
  expect(why.parentElement).toBe(save.parentElement) // 버튼 옆(같은 줄)에 있다
  fireEvent.change(screen.getByRole('combobox', { name: '집필 방식' }), { target: { value: 'assisted' } })
  expect(save.disabled).toBe(false)
  expect(screen.queryByText('집필 방식을 먼저 선택해 주세요.')).toBeNull()
  expect(save.hasAttribute('aria-describedby')).toBe(false)
})

it('keeps the operating settings tab in the mockup build so the fork policy and the deletion stay reachable, without the server-backed settings form', async () => {
  vi.stubEnv('MODE', 'mockup')
  stubCover()
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([owned]) })
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '운영 설정' }))
  await act(async () => {}) // 운영 설정 읽기가 있었다면 여기서 끝난다
  expect(screen.getByRole('heading', { level: 2, name: '운영 설정' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '분기 정책' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '작품 삭제' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '집필 방식 저장' })).toBeNull()
  expect(fetcher.mock.calls.some(([path]) => String(path).includes('operating-settings'))).toBe(false) // 운영 설정 API는 서버 없는 시연에 없다
})

// ── 작품 관리: 히어로와 영역별 편집 ───────────────────────────────────

it('shows the work like a detail page with a hero and exactly one edit button per editable area', async () => {
  stubCover()
  // 표지 조회는 서버 작품(UUID)에만 요청하므로 이 작품만 UUID를 쓴다.
  const uuid = '00000000-0000-4000-8000-000000000001'
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, id: uuid }]) }), '옛 제목', `/content?work=${uuid}`)
  expect(screen.getByText('판타지 · SF')).toBeTruthy()
  expect(screen.getByText('원작')).toBeTruthy()
  expect(screen.getByText('비공개 작품')).toBeTruthy()
  expect(screen.getByText('옛 소개')).toBeTruthy()
  expect(screen.getByText('#회귀')).toBeTruthy()
  const oneEach = (names: string[]) => {
    for (const name of names) {
      // 영역마다 하나뿐이고, 보이는 글자가 곧 이름이라 어느 영역의 버튼인지 구별된다.
      expect(screen.getAllByRole('button', { name })).toHaveLength(1)
      expect(screen.getByRole('button', { name }).textContent).toBe(name)
      // 편집 폼은 편집을 누르기 전에는 없다.
      expect(screen.queryByRole('form', { name })).toBeNull()
    }
  }
  oneEach(AREAS.slice(0, 2)) // 히어로의 두 영역. 분기 정책은 운영 설정 탭에 있어 처음 화면에는 없다.
  expect(screen.queryByRole('button', { name: AREAS[2] })).toBeNull()
  expect(await screen.findByAltText('기본 작품 표지')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '포크 정보' })).toBeNull()
  await openSettings()
  oneEach(AREAS.slice(2)) // 운영 설정 탭에는 분기 정책의 편집 버튼만 하나 있다.
  for (const name of AREAS.slice(0, 2)) expect(screen.queryByRole('button', { name }), name).toBeNull() // 히어로의 두 영역은 개요 탭에 있다.
})

it('shows a brief work header (cover thumbnail, title, chips) above every tab except 개요, without the edit buttons', async () => {
  stubCover()
  // 표지 조회는 서버 작품(UUID)에만 요청하므로 UUID를 쓴다.
  const uuid = '00000000-0000-4000-8000-000000000001'
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, id: uuid }]) }), '옛 제목', `/content?work=${uuid}`)
  expect(document.querySelector('.ep-brief')).toBeNull() // 개요 탭은 편집할 수 있는 전체 히어로다
  toReadTab()
  const brief = within(document.querySelector<HTMLElement>('.ep-brief')!)
  expect(brief.getByRole('heading', { level: 1, name: '옛 제목' })).toBeTruthy()
  expect(brief.getByText('판타지 · SF')).toBeTruthy()
  expect(await brief.findByAltText('기본 작품 표지')).toBeTruthy()
  for (const name of ['작품 정보 편집', '표지 편집']) expect(screen.queryByRole('button', { name }), name).toBeNull()
  await openSettings()
  expect(document.querySelector('.ep-brief')).toBeTruthy()
})

it('edits the title and summary in place, saves them through the work API and returns to the read view', async () => {
  stubCover()
  const saved = { ...owned, title: '새 제목', summary: '새 소개', revision: 1, draft: { ...owned.draft, revision: 1 } }
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([owned]), 'PUT /api/v1/works/w': () => Response.json(saved) })
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  const form = screen.getByRole('form', { name: '작품 정보 편집' })
  fireEvent.change(within(form).getByLabelText('작품 제목'), { target: { value: '새 제목' } })
  fireEvent.change(within(form).getByLabelText('이야기 소개', { exact: false }), { target: { value: '새 소개' } })
  fireEvent.click(within(form).getByRole('button', { name: '저장' }))
  await screen.findByText('작품 정보를 저장했어요.')
  await waitFor(() => expect(screen.queryByRole('form', { name: '작품 정보 편집' })).toBeNull())
  expect(screen.getByRole('heading', { level: 1, name: '새 제목' })).toBeTruthy()
  expect(screen.getByText('새 소개')).toBeTruthy()
  const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')
  expect(put?.[0]).toBe('/api/v1/works/w')
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({ title: '새 제목', summary: '새 소개', revision: 0 })
})

it('edits genres and hashtags with the work info: filled from the server, the type stays read-only, and only what changed is sent', async () => {
  stubCover()
  const saved = { ...owned, genres: ['무협'], hashtags: ['복수', '성장'], revision: 1, draft: { ...owned.draft, revision: 1 } }
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([owned]), 'PUT /api/v1/works/w': () => Response.json(saved) })
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  const form = screen.getByRole('form', { name: '작품 정보 편집' })
  expect((within(form).getByLabelText('장르') as HTMLSelectElement).value).toBe('판타지')
  expect((within(form).getByLabelText('두 번째 장르') as HTMLSelectElement).value).toBe('SF')
  expect((within(form).getByLabelText('해시태그') as HTMLInputElement).value).toBe('#회귀, #성장')
  // 작품 유형은 등록 때 정해져 읽기 전용이라 입력이 없고, 아무것도 바꾸지 않으면 저장할 수 없다.
  expect(within(form).queryByRole('radio')).toBeNull()
  expect((within(form).getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(true)
  await within(within(form).getByLabelText('장르')).findByRole('option', { name: '무협' })
  fireEvent.change(within(form).getByLabelText('장르'), { target: { value: '무협' } })
  fireEvent.change(within(form).getByLabelText('두 번째 장르'), { target: { value: '' } })
  fireEvent.change(within(form).getByLabelText('해시태그'), { target: { value: '#복수, 성장' } })
  fireEvent.click(within(form).getByRole('button', { name: '저장' }))
  await screen.findByText('작품 정보를 저장했어요.')
  await waitFor(() => expect(screen.queryByRole('form', { name: '작품 정보 편집' })).toBeNull())
  // 읽기 표시도 서버가 돌려준 값으로 바뀐다.
  expect(screen.getByText('무협')).toBeTruthy()
  expect(screen.getByText('#복수')).toBeTruthy()
  expect(screen.queryByText('#회귀')).toBeNull()
  const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')
  expect(put?.[0]).toBe('/api/v1/works/w')
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({ title: '옛 제목', summary: '옛 소개', revision: 0, genres: ['무협'], hashtags: ['복수', '성장'] })
})

it('refuses to clear every genre of a work and keeps the form open with the reason instead of calling the server', async () => {
  stubCover()
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([owned]) })
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  const form = screen.getByRole('form', { name: '작품 정보 편집' })
  fireEvent.change(within(form).getByLabelText('장르'), { target: { value: '' } })
  fireEvent.change(within(form).getByLabelText('두 번째 장르'), { target: { value: '' } })
  fireEvent.click(within(form).getByRole('button', { name: '저장' }))
  await screen.findByText('장르는 1~2개를 선택해 주세요.')
  expect(screen.getByRole('form', { name: '작품 정보 편집' })).toBeTruthy()
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
})

it('lets a work without genres or hashtags save a new title without forcing them, while registration still requires a genre', async () => {
  stubCover()
  const legacy = { ...owned, genres: [], hashtags: [] }
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([legacy]), 'PUT /api/v1/works/w': () => Response.json({ ...legacy, title: '새 제목', revision: 1 }) })
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  const form = screen.getByRole('form', { name: '작품 정보 편집' })
  expect((within(form).getByLabelText('장르') as HTMLSelectElement).required).toBe(false)
  fireEvent.change(within(form).getByLabelText('작품 제목'), { target: { value: '새 제목' } })
  fireEvent.click(within(form).getByRole('button', { name: '저장' }))
  await screen.findByText('작품 정보를 저장했어요.')
  const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')
  // 바꾸지 않은 장르·해시태그는 보내지 않아 서버 값이 그대로 남는다.
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({ title: '새 제목', summary: '옛 소개', revision: 0 })
  cleanup()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([]) }))
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  expect((screen.getByLabelText('장르') as HTMLSelectElement).required).toBe(true)
})

it('keeps the typed input and shows the server reason when saving the work info fails', async () => {
  stubCover()
  const fetcher = contentApi({
    'GET /api/v1/works': () => Response.json([owned]),
    'PUT /api/v1/works/w': () => Response.json({ detail: '원고가 변경됐어요. 최신 데이터를 불러와 주세요.' }, { status: 409 }),
  })
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  const form = screen.getByRole('form', { name: '작품 정보 편집' })
  fireEvent.change(within(form).getByLabelText('작품 제목'), { target: { value: '새 제목' } })
  fireEvent.click(within(form).getByRole('button', { name: '저장' }))
  await screen.findByText('원고가 변경됐어요. 최신 데이터를 불러와 주세요.')
  expect(screen.getByRole('form', { name: '작품 정보 편집' })).toBeTruthy()
  expect((within(form).getByLabelText('작품 제목') as HTMLInputElement).value).toBe('새 제목')
  expect(screen.queryByText('작품 정보를 저장했어요.')).toBeNull()
})

it('resets an open edit form to the latest server values after a conflict reload so it cannot overwrite another session', async () => {
  stubCover()
  const newer = { ...owned, summary: '다른 세션의 소개', revision: 1, draft: { ...owned.draft, revision: 1 } }
  const lists = [[owned], [newer]]
  const fetcher = contentApi({
    'GET /api/v1/works': () => Response.json(lists.shift()),
    'PUT /api/v1/works/w': () => Response.json({ detail: '원고가 변경됐어요. 최신 데이터를 불러와 주세요.' }, { status: 409 }),
  })
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: '내 새 제목' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await screen.findByText('원고가 변경됐어요. 최신 데이터를 불러와 주세요.')
  fireEvent.click(screen.getByRole('button', { name: '최신 데이터 불러오기' }))
  // 옛 소개를 든 채 새 revision으로 저장하면 다른 세션의 소개를 덮어쓰므로, 폼은 서버의 최신 값으로 다시 시작한다.
  await waitFor(() => expect((screen.getByLabelText('이야기 소개', { exact: false }) as HTMLTextAreaElement).value).toBe('다른 세션의 소개'))
  expect((screen.getByLabelText('작품 제목') as HTMLInputElement).value).toBe('옛 제목')
})

it('restores the saved values on cancel and allows only one area to be edited at a time', async () => {
  stubCover()
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([owned]) })
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  expect((screen.getByRole('button', { name: '표지 편집' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: '버릴 제목' } })
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('form', { name: '작품 정보 편집' })).toBeNull()
  expect(screen.getByRole('heading', { level: 1, name: '옛 제목' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  expect((screen.getByLabelText('작품 제목') as HTMLInputElement).value).toBe('옛 제목')
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
})

it('edits the fork policy in place and saves it through the policy API', async () => {
  stubCover()
  const saved = { ...owned, allowFork: true, revision: 1, draft: { ...owned.draft, revision: 1 } }
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([owned]), 'PUT /api/v1/works/w/policy': () => Response.json(saved) })
  await openWork(fetcher)
  await openSettings()
  const card = screen.getByRole('region', { name: '분기 정책' })
  expect(within(card).getByText('분기 만들기').nextElementSibling?.textContent).toBe('허용 안 함')
  fireEvent.click(within(card).getByRole('button', { name: '분기 정책 편집' }))
  const form = within(card).getByRole('form', { name: '분기 정책 편집' })
  expect(within(form).getByLabelText('분기 작품 최초 공개 허용')).toBeTruthy()
  fireEvent.click(within(form).getByLabelText('분기 만들기 허용'))
  fireEvent.click(within(form).getByRole('button', { name: '저장' }))
  await screen.findByText('분기 생성·공개 허용 설정을 저장했어요.')
  await waitFor(() => expect(within(card).queryByRole('form', { name: '분기 정책 편집' })).toBeNull())
  expect(within(card).getByText('분기 만들기').nextElementSibling?.textContent).toBe('허용')
  const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')
  expect(put?.[0]).toBe('/api/v1/works/w/policy')
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({ revision: 0, allowFork: true, allowForkPublication: false })
})

it('uploads the chosen cover only when the cover edit is saved', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const uploads = vi.fn((path: string, _init: RequestInit) => coverReply(path))
  stubCover(uploads)
  stubPreviewUrl()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, id }]) }), '옛 제목', `/content?work=${id}`)
  fireEvent.click(screen.getByRole('button', { name: '표지 편집' }))
  const form = screen.getByRole('form', { name: '표지 편집' })
  const picker = within(form).getByLabelText('이미지 선택')
  await waitFor(() => expect((picker.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false))
  expect((within(form).getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(picker, { target: { files: [new File(['png'], 'cover.png', { type: 'image/png' })] } })
  expect(uploads).not.toHaveBeenCalled()
  fireEvent.click(within(form).getByRole('button', { name: '저장' }))
  await screen.findByText('파일을 서버에 저장했어요.')
  expect(uploads).toHaveBeenCalledTimes(1)
  expect(uploads.mock.calls[0][0]).toBe(`/api/v1/works/${id}/cover`)
  await waitFor(() => expect(screen.queryByRole('form', { name: '표지 편집' })).toBeNull())
})

it('drops the chosen cover file when the cover edit is cancelled so it cannot be uploaded later', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const uploads = vi.fn((path: string, _init: RequestInit) => coverReply(path))
  stubCover(uploads)
  const revoked = stubPreviewUrl()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, id }]) }), '옛 제목', `/content?work=${id}`)
  const openForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: '표지 편집' }))
    const form = screen.getByRole('form', { name: '표지 편집' })
    await waitFor(() => expect((within(form).getByLabelText('이미지 선택').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false))
    return form
  }
  let form = await openForm()
  fireEvent.change(within(form).getByLabelText('이미지 선택'), { target: { files: [new File(['png'], 'cover.png', { type: 'image/png' })] } })
  expect(within(form).getByText('선택한 파일: cover.png')).toBeTruthy()
  // 고른 이미지는 저장 전에 미리보기로 보인다.
  expect(form.querySelector('.ep-file-chosen img')?.getAttribute('src')).toBe('blob:preview')
  fireEvent.click(within(form).getByRole('button', { name: '취소' }))
  // 편집을 닫으면 미리보기 주소를 해제한다.
  expect(revoked).toContain('blob:preview')
  form = await openForm()
  // 새로 연 편집에는 이전에 고른 파일이 없고, 비어 있는 입력으로 저장을 눌러 취소했던 파일이 올라가는 일도 없다.
  expect(within(form).queryByText(/선택한 파일/)).toBeNull()
  expect((within(form).getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(true)
  expect(uploads).not.toHaveBeenCalled()
})

it('shows a styled 이미지 선택 button instead of the browser file input and has no attachment refresh button', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  stubCover()
  stubPreviewUrl()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, id }]) }), '옛 제목', `/content?work=${id}`)
  fireEvent.click(screen.getByRole('button', { name: '표지 편집' }))
  const form = screen.getByRole('form', { name: '표지 편집' })
  const picker = within(form).getByLabelText('이미지 선택') as HTMLInputElement
  await waitFor(() => expect((picker.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false))
  // 라벨이 버튼 모양을 맡고, 실제 파일 입력은 그 안에서 시각적으로만 숨는다(라벨과 연결돼 키보드로도 연다).
  expect(picker.type).toBe('file')
  expect(picker.closest('label')?.classList.contains('btn')).toBe(true)
  expect(screen.queryByRole('button', { name: '첨부 새로고침' })).toBeNull()
  expect(form.querySelector('.ep-file-chosen')).toBeNull()
  fireEvent.change(picker, { target: { files: [new File(['png'], 'cover.png', { type: 'image/png' })] } })
  expect(form.querySelector('.ep-file-chosen')?.textContent).toBe('선택한 파일: cover.png')
  // 저장·취소는 폼 맨 아래 한 줄이다.
  expect(Array.from(form.querySelectorAll('.ep-edit-actions button'), (b) => b.textContent)).toEqual(['저장', '취소'])
})

it('puts a disabled AI 생성 button with a visible 준비 중 note beside 이미지 선택 in the cover edit', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  stubCover()
  stubPreviewUrl()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, id }]) }), '옛 제목', `/content?work=${id}`)
  // 편집을 열기 전에는 없다.
  expect(screen.queryByRole('button', { name: 'AI로 생성' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '표지 편집' }))
  const form = screen.getByRole('form', { name: '표지 편집' })
  const ai = within(form).getByRole('button', { name: 'AI로 생성' }) as HTMLButtonElement
  // 아직 연결 전이라 비활성이고, '준비 중'은 툴팁이 아니라 보이는 글자이며 버튼 설명으로 이어진다.
  expect(ai.disabled).toBe(true)
  expect(ai.title).toBe('')
  expect(document.getElementById(ai.getAttribute('aria-describedby') ?? '')?.textContent).toBe('준비 중')
  // '이미지 선택'과 같은 보조 버튼 크기이고 한 줄(.ep-cover-pick)에 놓인다.
  const picker = within(form).getByLabelText('이미지 선택')
  expect(ai.classList.contains('sm')).toBe(true)
  expect(picker.closest('label')?.classList.contains('sm')).toBe(true)
  expect(ai.closest('.ep-cover-pick')).toBe(picker.closest('.ep-cover-pick'))
  // 눌러도 아무 일도 없다: 저장은 여전히 파일을 골라야 켜진다.
  fireEvent.click(ai)
  expect((within(form).getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(true)
})

it('shows independent fork publication consent in the policy editor and keeps the history tab', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, title: '권한 분리' }]) }), '권한 분리')
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: '분기 정책 편집' }))
  expect(screen.getByLabelText('분기 만들기 허용')).toBeTruthy()
  expect(screen.getByLabelText('분기 작품 최초 공개 허용')).toBeTruthy()
  expect(screen.getByRole('button', { name: '저장·AI·발행 이력' })).toBeTruthy()
})

// ── 원고 작성은 집필실로: 이 화면에는 없고 링크만 있다 ───────────────────

it('lists the management tabs including the overview and operating settings, and opens the overview first', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  const nav = screen.getByRole('navigation', { name: '작품 메뉴' })
  expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['개요', '공개 회차 · 0', '세계관·설정집', '이야기 분기', 'AI 집필', '받은 피드백', '내 댓글·제보', '운영 설정', '저장·AI·발행 이력'])
  expect(within(nav).getByRole('button', { name: '개요' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('heading', { level: 1, name: '옛 제목' })).toBeTruthy() // 히어로(표지·제목·소개)는 개요 탭의 내용이다.
  expect(screen.queryByText('아직 공개한 회차가 없어요. 첫 회차를 작성해 보세요.')).toBeNull()
  toReadTab()
  expect(within(nav).getByRole('button', { name: '공개 회차 · 0' }).getAttribute('aria-current')).toBe('page')
  expect(document.querySelector('.ep-hero')).toBeNull() // 공개 회차 탭은 편집 히어로 없이 위의 짧은 작품 요약과 회차 목록만 보인다.
  expect(within(document.querySelector<HTMLElement>('.ep-brief')!).getByRole('heading', { level: 1, name: '옛 제목' })).toBeTruthy()
  // 공개한 회차가 없어도 안내 문구는 남는다. 집필실로 가는 버튼은 공개 회차 탭 머리의 '집필실 열기' 하나뿐이다(회차가 0개여도 집필실의 새 회차 버튼으로 1화를 만든다, 본문의 '새 회차 집필하기'는 없앴다).
  expect(screen.getByText('아직 공개한 회차가 없어요. 첫 회차를 작성해 보세요.')).toBeTruthy()
  expect(screen.getByRole('link', { name: '집필실 열기' }).getAttribute('href')).toBe('/studio/w')
  expect(screen.queryByRole('link', { name: '회차 작성하기' })).toBeNull()
  expect(screen.queryByRole('link', { name: '새 회차 집필하기' })).toBeNull()
  expect(screen.queryByRole('button', { name: '원고 작성' })).toBeNull()
  expect(screen.queryByRole('button', { name: '원고 저장' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: '원고 본문' })).toBeNull()
  expect(screen.queryByRole('button', { name: /회차 공개하기/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /AI 이어쓰기/ })).toBeNull()
})

it('links to the studio instead of offering manuscript editing or AI continuation, even when there is no writing episode', async () => {
  stubCover()
  const w = { ...owned, title: '회차 삭제됨', draft: { title: '새 회차', body: '', revision: 4 } }
  await openRead(contentApi({ 'GET /api/v1/works': () => Response.json([w]) }), '회차 삭제됨')
  expect(screen.getByRole('link', { name: '집필실 열기' }).getAttribute('href')).toBe('/studio/w')
  expect(screen.queryByRole('link', { name: '회차 작성하기' })).toBeNull()
  expect(screen.queryByRole('button', { name: '원고 저장' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: '원고 본문' })).toBeNull()
})

it('lists public episodes as rows without their bodies and links to the studio from the list head and each row — no sidebar button and no second new-episode button below the list', async () => {
  stubCover()
  await openRead(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, episodes: [episode(1), episode(2)] }]) }))
  expect(screen.getByRole('link', { name: '집필실 열기' }).getAttribute('href')).toBe('/studio/w')
  expect(screen.queryByRole('link', { name: '회차 작성하기' })).toBeNull()
  expect(screen.getByRole('link', { name: '1화 1화 제목 수정하기' }).getAttribute('href')).toBe('/studio/w?ep=1')
  expect(screen.getByRole('link', { name: '2화 2화 제목 수정하기' }).getAttribute('href')).toBe('/studio/w?ep=2')
  expect(screen.queryByRole('link', { name: '새 회차 집필하기' })).toBeNull()
  // 소설 상세처럼 번호·제목·메타 한 줄만 보이고 본문은 펼치지 않는다.
  expect(screen.queryByText('1화 본문')).toBeNull()
  expect(within(screen.getByRole('link', { name: '1화 1화 제목 수정하기' }).closest('li')!).getByText('1화 제목')).toBeTruthy()
})

it('shows how many public forks branched off each episode and nothing for episodes without any', async () => {
  stubCover()
  const forkCounts = vi.spyOn(appContainer.resolve('readingUseCase'), 'forkCountsByEpisode').mockResolvedValue({ 2: 3 })
  await openRead(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, episodes: [episode(1), episode(2)] }]) }))
  const rowOf = (n: number) => screen.getByRole('link', { name: `${n}화 ${n}화 제목 수정하기` }).closest('li')!
  // 소설 상세와 같은 branch 아이콘과 '이 회차에서 갈라진 포크 N편'(화면 낭독용 글자)이다.
  await waitFor(() => expect(rowOf(2).textContent).toContain('이 회차에서 갈라진 포크 3편'))
  expect(rowOf(2).querySelector('svg')).toBeTruthy()
  expect(rowOf(1).textContent).not.toContain('갈라진 포크')
  expect(rowOf(1).querySelector('svg')).toBeNull()
  expect(forkCounts).toHaveBeenCalledWith('w')
})

it('hides the fork counts instead of showing 0 when they cannot be read, and the rows stay usable', async () => {
  stubCover()
  vi.spyOn(appContainer.resolve('readingUseCase'), 'forkCountsByEpisode').mockRejectedValue(new Error('목록을 읽지 못했어요.'))
  await openRead(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, episodes: [episode(1)] }]) }))
  await act(async () => {})
  const row = screen.getByRole('link', { name: '1화 1화 제목 수정하기' }).closest('li')!
  expect(row.textContent).not.toMatch(/갈라진 포크|0편/)
  expect(row.querySelector('svg')).toBeNull()
})

it('tells a private work is not public yet and marks inherited episodes as read-only 원작 회차 without an edit link', async () => {
  stubCover()
  const inheritedEpisode = (number: number) => ({ ...episode(number), inherited: true })
  await openRead(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...myFork, visibility: 'private', episodes: [inheritedEpisode(1), inheritedEpisode(2), episode(3)] }]) }), '내 포크')
  expect(screen.getByText('아직 독자에게 공개하지 않은 작품이에요.')).toBeTruthy()
  // 회차가 보이는데 '분기 기준 원고는 읽기 전용'이라고 하던 모순 문구 대신, 상속 회차 범위를 따로 한 줄로 알린다.
  expect(screen.getByText('1~2화는 원작에서 이어받은 회차라 수정할 수 없어요.')).toBeTruthy()
  expect(screen.queryByText(/분기 기준 원고는 읽기 전용/)).toBeNull()
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.ep-list > li'))
  expect(rows).toHaveLength(3)
  for (const row of rows.slice(0, 2)) expect(within(row).getByText('원작 회차')).toBeTruthy()
  expect(within(rows[2]).queryByText('원작 회차')).toBeNull()
  for (const number of [1, 2]) expect(screen.queryByRole('link', { name: `${number}화 ${number}화 제목 수정하기` })).toBeNull()
  expect(screen.getByRole('link', { name: '3화 3화 제목 수정하기' }).getAttribute('href')).toBe('/studio/w?ep=3')
})

it('keeps the public lead for a public work and says nothing about inherited episodes when there are none', async () => {
  stubCover()
  await openRead(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, visibility: 'public', episodes: [episode(1)] }]) }))
  expect(screen.getByText('아래 목록은 독자가 볼 수 있는 발행본이에요.')).toBeTruthy()
  expect(screen.queryByText('아직 독자에게 공개하지 않은 작품이에요.')).toBeNull()
  expect(screen.queryByText(/이어받은 회차/)).toBeNull()
  expect(screen.queryByText('원작 회차')).toBeNull()
})

const settingsBook = { id: 'w', name: '설정집', revision: 0, mode: 'following', basis: { episode: 2, version: 7, settings: [] }, draft: null, drafts: [], settings: [], history: [], changes: [], sourceToken: 't' }
const WORLD_ID = '0b0f6f0e-3a51-4d6b-9a39-1f4f2b6d0a01'
/** 세계관 연결 카드가 읽는 내 세계관 목록(WorldStudio)을 대역으로 바꾼다. */
const myWorlds = (worlds: { id: string; name: string; linkedWorkId?: string | null }[]) =>
  vi.spyOn(appContainer.resolve('worldStudioUseCase'), 'list').mockResolvedValue(worlds.map((w) => ({ description: '', version: 1, settings: [], analysis: null, ...w })))

it('shows the world link panel above the settings book summary in the world tab', async () => {
  stubCover()
  myWorlds([{ id: WORLD_ID, name: '별빛 세계' }])
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, worldStudioId: WORLD_ID }]), 'GET /api/v1/works/w/world': () => Response.json(settingsBook) }))
  fireEvent.click(screen.getByRole('button', { name: '세계관·설정집' }))
  const card = await screen.findByRole('region', { name: '세계관 설정집' })
  expect(within(card).getByText('최초 분기 기준: 2화 · 원고 버전 7 · 설정 0개')).toBeTruthy()
  const link = screen.getByRole('region', { name: '세계관 연결' })
  expect(link.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect((await within(link).findByRole('link', { name: '별빛 세계' })).getAttribute('href')).toBe(`/worldstudio/${WORLD_ID}`)
  // 설정 항목 편집은 이 탭에 없고, '연결 예정' 자리표시도 실제 연결 카드로 바뀌었다.
  expect(screen.queryByLabelText('설정 이름')).toBeNull()
  expect(screen.queryByRole('button', { name: '새 설정 항목' })).toBeNull()
  expect(screen.queryByText('연결 예정')).toBeNull()
})

it('opens the world tab first when the address has tab=world', async () => {
  stubCover()
  myWorlds([{ id: WORLD_ID, name: '별빛 세계' }])
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, worldStudioId: WORLD_ID }]), 'GET /api/v1/works/w/world': () => Response.json(settingsBook) }), '옛 제목', '/content?work=w&tab=world')
  expect(within(screen.getByRole('navigation', { name: '작품 메뉴' })).getByRole('button', { name: '세계관·설정집' }).getAttribute('aria-current')).toBe('page')
  expect(await screen.findByRole('region', { name: '세계관 설정집' })).toBeTruthy()
})

it('links and unlinks my world from the world tab and shows the server reason when the world is already linked', async () => {
  stubCover()
  myWorlds([{ id: WORLD_ID, name: '별빛 세계' }])
  const answers = [
    () => Response.json({ workId: 'w', worldId: WORLD_ID }),
    () => Response.json({ workId: 'w', worldId: null }),
    () => Response.json({ detail: '이미 다른 소설에 연결된 세계관이에요.', code: 'WORLD_ALREADY_LINKED' }, { status: 409 }),
  ]
  const fetcher = contentApi({
    'GET /api/v1/works': () => Response.json([owned]), 'GET /api/v1/works/w/world': () => Response.json(settingsBook),
    'PUT /api/v1/works/w/world-studio': () => answers.shift()!(),
  })
  const sent = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)))
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '세계관·설정집' }))
  const panel = () => within(screen.getByRole('region', { name: '세계관 연결' }))
  const world = async () => await panel().findByRole('radio', { name: '별빛 세계' }) as HTMLInputElement
  const connect = () => panel().getByRole('button', { name: '세계관 연결' })
  // 세계관을 검색해 목록에서 먼저 골라야 연결할 수 있다(아무것도 고르지 않은 시작과 잠긴 버튼은 LinkedWorldPanel.test가 맡는다).
  fireEvent.change(await panel().findByRole('searchbox', { name: '세계관 검색' }), { target: { value: '별빛' } })
  fireEvent.click(await world())
  fireEvent.click(connect())
  await panel().findByRole('link', { name: '별빛 세계' })
  // 결과는 연결한 카드 안에서 알린다(화면 맨 위 알림 줄은 스크롤해 내려온 이 자리에서 보이지 않는다).
  expect(panel().getByRole('status').textContent).toBe('세계관을 연결했어요.')
  expect(document.querySelector('.ep-notice')?.textContent).toBe('')
  // 해제는 확인을 받고 보낸다.
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(panel().getByRole('button', { name: '연결 해제' }))
  await panel().findByRole('button', { name: '세계관 연결' })
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(panel().getByRole('status').textContent).toBe('세계관 연결을 해제했어요.')
  // 해제한 뒤 다시 나타난 양식은 직전에 연결했던 세계관을 고른 채가 아니라 아무것도 고르지 않고 시작한다.
  expect((await world()).checked).toBe(false)
  // 그 사이 다른 소설에 연결된 세계관이면 서버 사유를 그대로 알리고 연결하지 않는다.
  fireEvent.click(await world())
  fireEvent.click(connect())
  expect((await screen.findByText(/이미 다른 소설에 연결된 세계관이에요\./)).closest('[role=alert]')).not.toBeNull()
  expect(panel().getByRole('alert').textContent).toContain('이미 다른 소설에 연결된 세계관이에요.')
  expect(document.querySelector('.ep-content > .ep-alert')).toBeNull()
  expect(panel().queryByRole('link', { name: '별빛 세계' })).toBeNull()
  expect(sent()).toEqual([{ worldId: WORLD_ID }, { worldId: null }, { worldId: WORLD_ID }])
})

it('titles every tab body (one h2, first in the tab) with exactly the words of its menu tab, and sets the groups inside it as h3', async () => {
  stubCover()
  myWorlds([])
  vi.spyOn(appContainer.resolve('feedbackReportUseCase'), 'listInbox').mockResolvedValue([])
  vi.spyOn(appContainer.resolve('editSuggestionUseCase'), 'inbox').mockResolvedValue([])
  // AI 집필 탭은 컨테이너의 서버 UseCase로 읽는다(응답 모양은 data 단위 테스트가 본다).
  vi.spyOn(appContainer.resolve('serialUseCase'), 'settings').mockResolvedValue({ enabled: false, days: [], time: '21:00', direction: '' })
  vi.spyOn(appContainer.resolve('serialUseCase'), 'boards').mockResolvedValue([])
  // 내 댓글·제보 탭은 계정 메뉴의 같은 화면과 같은 UseCase로 읽는다(서버 제보·수정 제안은 비어 있고 데모 피드백은 메모리 목록이다).
  vi.spyOn(appContainer.resolve('feedbackReportUseCase'), 'listMine').mockResolvedValue([])
  vi.spyOn(appContainer.resolve('editSuggestionUseCase'), 'mine').mockResolvedValue([])
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([owned]),
    'GET /api/v1/works/w/world': () => Response.json(settingsBook),
    'GET /api/v1/works/w/history': () => Response.json({ versions: [], proposals: [], publicationHistory: [] }),
    'GET /api/v1/works/w/episodes': () => Response.json([writingRow(1)]),
  }))
  const ready: Record<string, () => Promise<unknown>> = {
    '개요': () => screen.findByRole('heading', { level: 1, name: '옛 제목' }), // 히어로의 제목(h1)은 개요 탭 제목(h2) 아래에 있다
    '공개 회차 · 0': () => screen.findByText(/아직 공개한 회차가 없어요/), // 공개 회차가 없는 안내(초안 묶음은 없다)
    '세계관·설정집': () => screen.findByRole('region', { name: '세계관 설정집' }),
    '이야기 분기': async () => screen.getByRole('heading', { level: 3, name: '그 순간, 다른 선택을 했다면' }),
    'AI 집필': () => screen.findByRole('button', { name: '설정 저장' }),
    '받은 피드백': () => screen.findByRole('heading', { level: 3, name: '독자 제보 0' }),
    '내 댓글·제보': () => screen.findByRole('heading', { level: 3, name: '내 제보 0' }), // 구획 제목은 탭 제목(h2) 아래 h3다(쪽 제목 h1은 없다)
    '운영 설정': () => screen.findByRole('button', { name: '집필 방식 저장' }),
    '저장·AI·발행 이력': () => screen.findByText('발행 이력이 없어요.'),
  }
  const nav = within(screen.getByRole('navigation', { name: '작품 메뉴' }))
  expect(nav.getAllByRole('button').map((b) => b.textContent)).toEqual(Object.keys(ready))
  for (const button of nav.getAllByRole('button')) {
    fireEvent.click(button)
    await ready[button.textContent!]()
    const tab = document.querySelector<HTMLElement>('.ep-tab')!
    expect(tab.firstElementChild?.tagName, button.textContent!).toBe('H2')
    expect(tab.firstElementChild?.textContent, button.textContent!).toBe(button.textContent) // 메뉴 이름과 똑같다
    expect(within(tab).getAllByRole('heading', { level: 2 }), button.textContent!).toHaveLength(1) // 탭 제목은 하나뿐, 안의 묶음 제목은 h3다
  }
})

it('offers one 집필실 열기 link at the head of the episode list and none in the sidebar or the folded top row (all editing happens in the studio)', async () => {
  stubCover()
  await openRead(contentApi({
    'GET /api/v1/works': () => Response.json([{ ...owned, episodes: [episode(1)] }]),
    'GET /api/v1/works/w/episodes': () => Response.json([writingRow(2)]),
  }))
  await waitFor(() => expect(document.querySelector('.ep-brief .stats')?.textContent).toContain('작성 중인 초안 1개')) // 소유자 회차 조회가 읽힌 뒤에도
  const entry = () => [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === '/studio/w')
  expect(entry().map((a) => a.textContent)).toEqual(['집필실 열기'])
  expect(entry()[0].closest('.ep-menu')).toBeNull() // 사이드바 도구 묶음은 없어졌고 본문 머리에 집필실로 가는 창구 하나뿐이다
  expect(screen.queryByRole('link', { name: '새 회차 집필하기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '작품 메뉴 접기' }))
  expect(entry().map((a) => a.textContent)).toEqual(['집필실 열기']) // 사이드바를 접어도 같다(상단 줄에는 돌아가기 링크뿐이다)
  expect(document.querySelector('.ep-top a[href="/studio/w"]')).toBeNull()
})

// ── AI 자율 집필 중 원고 잠금(계약 'AI 자율 집필 = 집필 방식'): 소유자 설정이 켜져 있으면 작가는 1화만 쓴다. 읽지 못하면 잠그지 않는다(서버가 판정) ──
const LOCK_NOTICE = 'AI 자율 집필 중에는 1화만 직접 쓸 수 있어요. 운영 설정 > 집필 방식을 바꾸면 모든 회차를 쓸 수 있어요.'
const serialRead = (answer: () => Promise<ReturnType<typeof serialSettings>>) => vi.spyOn(appContainer.resolve('serialUseCase'), 'settings').mockImplementation(answer)

it('tells the AI 자율 집필 reason once at the head of the episode list while it is on — the sidebar and the folded top row carry no studio link or reason', async () => {
  stubCover()
  serialRead(() => Promise.resolve(serialSettings({ enabled: true })))
  await openRead(contentApi({ 'GET /api/v1/works': () => Response.json([owned]), 'GET /api/v1/works/w/episodes': () => Response.json([writingRow(1)]) }))
  await screen.findByText(LOCK_NOTICE)
  const open = screen.getByRole('link', { name: '집필실 열기' })
  expect(open.getAttribute('href')).toBe('/studio/w')
  expect(open.closest('.ep-menu')).toBeNull()
  expect(screen.queryByRole('link', { name: '회차 작성하기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '작품 메뉴 접기' }))
  const top = within(document.querySelector<HTMLElement>('.ep-top')!)
  expect(top.queryByRole('link', { name: '집필실 열기' })).toBeNull()
  expect(top.queryByText(LOCK_NOTICE)).toBeNull()
  expect(screen.getAllByText(LOCK_NOTICE)).toHaveLength(1) // 이유는 목록 머리에 한 번뿐이다(사이드바·상단 줄에 되풀이하지 않는다)
})

it.each([
  ['AI 자율 집필이 꺼져 있으면', () => Promise.resolve(serialSettings({ enabled: false }))],
  ['켜짐 여부를 읽지 못하면 (서버의 409가 판정한다)', () => Promise.reject(new Error('설정 서버 오류'))],
])('%s 회차가 있어도 집필실 열기는 집필실 링크로 남고 잠금 이유는 없다', async (_name, answer) => {
  stubCover()
  const read = serialRead(answer)
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]), 'GET /api/v1/works/w/episodes': () => Response.json([writingRow(1)]) }))
  await waitFor(() => expect(read).toHaveBeenCalled())
  await waitFor(() => expect(draftMetric()).toBe('1개')) // 회차 수까지 읽은 뒤에도
  await act(async () => {})
  toReadTab()
  expect(screen.getByRole('link', { name: '집필실 열기' }).getAttribute('href')).toBe('/studio/w')
  expect(screen.queryByRole('link', { name: '회차 작성하기' })).toBeNull()
  expect(screen.queryByText(LOCK_NOTICE)).toBeNull()
})

// ── Fork 세계관 독립(#583): 자기 세계관이 없는 Fork의 세계관 탭 ──
const ORIGIN_WORLD = '5c0b3f0e-3a51-4d6b-9a39-1f4f2b6d0a02'
const inheritedAnswer = {
  workId: 'w', worldId: ORIGIN_WORLD, upto: 2, relationshipStatus: 'current',
  cards: [{ id: 'c1', title: '카엘', body: '본문', cardType: 'character', areaCode: 'basic', classification: '', aliases: [], tags: [], semanticMetadata: { revealFromEpisode: 1 }, visibility: 'public', lifecycle: 'active' }],
  relationships: [{ id: 'r1', sourceCardId: 'c1', targetCardId: 'c1', category: 'structural', label: '', direction: 'directed', polarity: 'asserted', body: '', semanticMetadata: {}, lifecycle: 'active' }],
}
const DETACH_CONFIRM = '독립하면 원작 세계관의 이후 변경은 따라오지 않아요. 원작 세계관의 카드와 관계를 내 세계관으로 복사해 이 소설에 연결할까요? 원작 세계관과 다른 포크는 바뀌지 않아요.'
const openInheritedCard = async (detach: () => Response) => {
  stubCover()
  myWorlds([])
  const fetcher = contentApi({
    'GET /api/v1/works': () => Response.json([myFork]), 'GET /api/v1/works/w/world': () => Response.json(settingsBook),
    'GET /api/v1/works/w/inherited-world': () => Response.json(inheritedAnswer),
    'POST /api/v1/works/w/inherited-world/detach': detach,
  })
  await openWork(fetcher, '내 포크')
  fireEvent.click(screen.getByRole('button', { name: '세계관·설정집' }))
  const card = within(await screen.findByRole('region', { name: '이어받는 원작 세계관' }))
  await card.findByText('원작 「원작」 세계관을 2화 기준으로 이어받는 중')
  expect(card.getAllByRole('definition').map((definition) => definition.textContent)).toEqual(['카엘', '1개'])
  return { fetcher, card }
}

it('독립을 확인한 뒤 요청하고, 성공하면 새 세계관 관리 화면으로 간다', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const { fetcher, card } = await openInheritedCard(() => Response.json({ workId: 'w', worldId: WORLD_ID }, { status: 201 }))
  fireEvent.click(card.getByRole('button', { name: '내 세계관으로 만들어 수정하기' }))
  expect(await screen.findByText('위치 /worldstudio/' + WORLD_ID)).toBeTruthy()
  expect(confirm).toHaveBeenCalledWith(DETACH_CONFIRM)
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([path]) => path)).toEqual(['/api/v1/works/w/inherited-world/detach'])
})

it('독립이 거절되면 서버 문구를 이어받는 세계관 카드 안에 보이고 화면 맨 위 알림에는 두지 않으며 이동하지 않는다', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const { card } = await openInheritedCard(() => Response.json({ detail: '이어받는 원작 세계관이 없어요.', code: 'FORK_WORLD_NOT_INHERITED' }, { status: 409 }))
  fireEvent.click(card.getByRole('button', { name: '내 세계관으로 만들어 수정하기' }))
  expect((await card.findByRole('alert')).textContent).toBe('이어받는 원작 세계관이 없어요.')
  expect(document.querySelector('.ep-content > .ep-alert')).toBeNull()
  expect(screen.queryByText(/^위치 \/worldstudio/)).toBeNull()
  // 실패 뒤에는 다시 누를 수 있다.
  expect((card.getByRole('button', { name: '내 세계관으로 만들어 수정하기' }) as HTMLButtonElement).disabled).toBe(false)
})

it('lists saved versions, AI requests and publications read-only while restore and publish-target actions stay in the studio', async () => {
  stubCover()
  // revision(편집 번호)과 저장 순번이 다르게 두어, 화면이 순번('저장 버전 1')을 쓰는지 가른다.
  const version = { id: 'v1', episode: 1, title: '첫 화', body: '저장된 원고', revision: 7, savedAt: '2026-11-02T00:00:00Z' }
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([owned]),
    'GET /api/v1/works/w/episodes': () => Response.json([writingRow(1, { versions: [version] })]),
    'GET /api/v1/works/w/history': () => Response.json({ versions: [version], proposals: [], publicationHistory: [] }),
  }))
  fireEvent.click(screen.getByRole('button', { name: '저장·AI·발행 이력' }))
  expect(await screen.findByRole('heading', { name: '1화 · 저장 버전 1 · 첫 화' })).toBeTruthy()
  for (const name of ['이 원고를 새 버전으로 복원', '이 버전을 공개 대상으로 선택', '이 제안 다시 열기']) expect(screen.queryByRole('button', { name })).toBeNull()
})

it('deletes the original after confirmation and returns to the library only after the response', async () => {
  stubCover()
  let complete!: (response: Response) => void
  const response = new Promise<Response>((resolve) => { complete = resolve })
  const remove = vi.fn(() => response)
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([owned]), 'DELETE /api/v1/works/w': remove })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await openWork(fetcher)
  await openSettings()
  // 작품 삭제는 분기 정책 카드가 아니라 자기 카드에 있다.
  expect(within(screen.getByRole('region', { name: '분기 정책' })).queryByRole('button', { name: /삭제/ })).toBeNull()
  const button = within(screen.getByRole('region', { name: '작품 삭제' })).getByRole<HTMLButtonElement>('button', { name: '작품 삭제' })
  expect(button.classList.contains('ep-danger')).toBe(true)
  fireEvent.click(button)
  expect(confirm).toHaveBeenCalledWith('「옛 제목」 작품을 삭제할까요? 서재와 공개 화면에서 숨겨지고 되돌릴 수 없어요. 이 작품에서 만들어진 포크는 유지돼요.')
  expect(remove).not.toHaveBeenCalled()
  expect(screen.queryByText(/^삭제 완료 작품/)).toBeNull()
  expect(screen.getByText('위치 /content?work=w')).toBeTruthy()

  confirm.mockReturnValue(true)
  fireEvent.click(button)
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
  expect(button.disabled).toBe(true)
  expect(screen.getByText('위치 /content?work=w')).toBeTruthy()
  complete(new Response(null, { status: 204 }))
  expect(await screen.findByText('위치 /lib?tab=write')).toBeTruthy()
  expect(screen.getByText('삭제 완료 작품 옛 제목')).toBeTruthy()
})

it('keeps the original management page open and displays the server reason after deletion fails', async () => {
  stubCover()
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([owned]),
    'DELETE /api/v1/works/w': () => Response.json({ detail: '작품을 찾을 수 없어요.' }, { status: 404 }),
  }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await openSettings()
  const button = screen.getByRole<HTMLButtonElement>('button', { name: '작품 삭제' })
  fireEvent.click(button)
  expect(await screen.findByText('작품을 찾을 수 없어요.', { selector: '[role="alert"]' })).toBeTruthy()
  expect(screen.queryByText(/^삭제 완료 작품/)).toBeNull()
  expect(screen.getByText('위치 /content?work=w')).toBeTruthy()
  expect(button.disabled).toBe(false)
})

// ── 분기 작품: 포크 정보와 만들기 ────────────────────────────────────

it('labels a fork as 분기 작품 and shows its pinned basis and direction instead of the original-work chip', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([myFork]) }), '내 포크')
  expect(screen.getByText('분기 작품')).toBeTruthy()
  expect(screen.getByRole('button', { name: '작품 정보 편집' })).toBeTruthy() // 포크도 작품 정보를 편집한다(개요 탭)
  // 원작 칩은 없다(포크 정보 카드의 '원작' 항목 이름과는 다르다).
  expect(screen.queryByText('원작', { selector: '.chip' })).toBeNull()
  expect(screen.queryByRole('region', { name: '포크 정보' })).toBeNull() // 포크 정보는 운영 설정 탭에 있다
  await openSettings()
  const card = screen.getByRole('region', { name: '포크 정보' })
  expect(within(card).getByText('원작').nextElementSibling?.textContent).toBe('「원작」 2화 · 버전 7에서 분기')
  expect(within(card).getByText('분기 방향').nextElementSibling?.textContent).toBe('다른 결말')
  expect(screen.queryByRole('region', { name: '분기 정책' })).toBeNull()
  expect(screen.queryByRole('button', { name: '분기 정책 편집' })).toBeNull()
  expect(screen.queryByRole('button', { name: '작품 정보 편집' })).toBeNull() // 작품 정보 편집은 개요 탭에 있다
})

it('lines up the fork actions in one row: original, stop publication, and an outlined delete at the end', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([myFork]) }), '내 포크')
  await openSettings()
  const row = screen.getByRole('region', { name: '포크 정보' }).querySelector('.ep-card-actions')
  expect(Array.from(row?.children ?? [], (el) => el.textContent)).toEqual(['원작으로 가기', '포크 공개 중단', '포크 삭제'])
  // 삭제는 가장 눈에 띄는 꽉 찬 빨간 버튼(.danger)이 아니라 위험 외곽선 버튼이다.
  const remove = screen.getByRole('button', { name: '포크 삭제' })
  expect(remove.classList.contains('ep-danger')).toBe(true)
  expect(remove.classList.contains('danger')).toBe(false)
})

it('locks the other tabs and the overview shortcut links while the work info is edited, so the fork actions cannot be reached and the re-read cannot reset the unsaved input, and unlocks them after cancel', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([myFork]) }), '내 포크')
  const tab = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
  expect(tab('운영 설정').disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  // 작품 정보 폼이 개요 탭 안에 있어 탭을 떠나면 입력이 사라진다: 지금 탭만 남기고 잠근다(포크 공개 중단·삭제는 운영 설정 탭에 있어 편집 중에는 닿지 않는다).
  expect(tab('운영 설정').disabled).toBe(true)
  expect(tab('공개 회차 · 0').disabled).toBe(true)
  expect(tab('개요').disabled).toBe(false)
  // 개요 바로가기의 이동 링크도 잠긴 버튼이 된다(집필실·소설 상세로 떠나도 저장하지 않은 입력이 사라진다. 잠긴 모양은 WorkDashboard.test가 본다).
  const shortcuts = () => within(screen.getByRole('region', { name: '바로가기' }))
  expect(shortcuts().queryAllByRole('link')).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(tab('운영 설정').disabled).toBe(false)
  expect(shortcuts().getAllByRole('link')).toHaveLength(2)
  await openSettings()
  expect((within(screen.getByRole('region', { name: '포크 정보' })).getByRole('button', { name: '포크 공개 중단' }) as HTMLButtonElement).disabled).toBe(false)
})

it('stops the publication of a fork after asking, keeps the fork and reads it again', async () => {
  stubCover()
  const lists = [[myFork], [{ ...myFork, visibility: 'private', revision: 5, draft: { ...myFork.draft, revision: 5 } }]]
  const fetcher = contentApi({
    'GET /api/v1/works': () => Response.json(lists.shift()),
    'DELETE /api/v1/works/w/fork-publication': () => new Response(null, { status: 204 }),
  })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await openWork(fetcher, '내 포크')
  await openSettings()
  const card = screen.getByRole('region', { name: '포크 정보' })
  fireEvent.click(within(card).getByRole('button', { name: '포크 공개 중단' }))
  expect(confirm).toHaveBeenCalledWith(STOP_CONFIRM)
  await screen.findByText('포크 공개를 중단했어요.')
  await waitFor(() => expect(within(screen.getByRole('region', { name: '포크 정보' })).queryByRole('button', { name: '포크 공개 중단' })).toBeNull())
  toOverviewTab() // 히어로는 개요 탭에 있다.
  expect(screen.getByRole('heading', { level: 1, name: '내 포크' })).toBeTruthy()
  expect(screen.getByText('비공개 작품')).toBeTruthy()
  expect(fetcher.mock.calls.some(([input, init]) => String(input) === '/api/v1/works/w/fork-publication' && init?.method === 'DELETE')).toBe(true)
  expect(fetcher.mock.calls.filter(([path, init]) => path === '/api/v1/works' && (init?.method ?? 'GET') === 'GET')).toHaveLength(2)
})

it('links back to a live original and only explains a deleted one, and offers no stop button for a private fork', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...myFork, visibility: 'private' }]) }), '내 포크')
  await openSettings()
  expect(screen.getByRole('link', { name: '원작으로 가기' }).getAttribute('href')).toBe('/work/o')
  expect(screen.queryByRole('button', { name: '포크 공개 중단' })).toBeNull()
  expect(screen.getByRole('button', { name: '포크 삭제' })).toBeTruthy()
  cleanup()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...myFork, source: { ...myFork.source, deleted: true } }]) }), '내 포크')
  await openSettings()
  expect(screen.getByText('「원작」 2화 · 버전 7에서 분기')).toBeTruthy()
  expect(screen.getByText('삭제된 원작이라 이동할 수 없어요.')).toBeTruthy()
  expect(screen.queryByRole('link', { name: '원작으로 가기' })).toBeNull()
})

it('saves a fork title and summary through the work info edit with the fork revision', async () => {
  stubCover()
  const fetcher = contentApi({
    'GET /api/v1/works': () => Response.json([myFork]),
    'PUT /api/v1/works/w': () => Response.json({ ...myFork, title: '새 제목', revision: 5, draft: { ...myFork.draft, revision: 5 } }),
  })
  await openWork(fetcher, '내 포크')
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: '  새 제목  ' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await screen.findByText('작품 정보를 저장했어요.')
  const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({ title: '새 제목', summary: '소개', revision: 4 })
  expect(await screen.findByRole('heading', { level: 1, name: '새 제목' })).toBeTruthy()
})

it('asks about the irreversible consequences before deleting a fork and then returns to the library', async () => {
  stubCover()
  const fetcher = contentApi({
    'GET /api/v1/works': () => Response.json([myFork]),
    'DELETE /api/v1/works/w': () => new Response(null, { status: 204 }),
  })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await openWork(fetcher, '내 포크')
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: '포크 삭제' }))
  expect(confirm).toHaveBeenCalledWith('「내 포크」 포크를 삭제할까요? 서재와 공개 화면에서 숨겨지고 되돌릴 수 없어요. 같은 원작에서 포크를 다시 만들 수 없어요.')
  expect(await screen.findByText('위치 /lib?tab=write')).toBeTruthy()
  expect(screen.getByText('삭제 완료 작품 내 포크')).toBeTruthy()
  expect(fetcher.mock.calls.some(([input, init]) => String(input) === '/api/v1/works/w' && init?.method === 'DELETE')).toBe(true)
})

it('does not delete or leave when the fork deletion is not confirmed', async () => {
  stubCover()
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([myFork]) })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  await openWork(fetcher, '내 포크')
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: '포크 삭제' }))
  expect(screen.getByRole('heading', { level: 2, name: '운영 설정' })).toBeTruthy()
  expect(screen.getByText('위치 /content?work=w')).toBeTruthy()
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
})

it('opens the management page of a newly created fork', async () => {
  stubCover()
  const original = { ...owned, visibility: 'public', allowFork: true, episodes: [episode(1)] }
  const created = { ...owned, id: 'f1', title: '새 포크', source: { workId: 'w', title: '옛 제목', episode: 1, version: 1, direction: '다른 선택' } }
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([original]), 'POST /api/v1/works/w/forks': () => Response.json(created) })
  await openWork(fetcher)
  fireEvent.click(screen.getByRole('button', { name: '이야기 분기' }))
  fireEvent.change(screen.getByLabelText('분기 작품 제목'), { target: { value: '새 포크' } })
  fireEvent.change(screen.getByLabelText('무엇이 달라지나요? (선택)'), { target: { value: '다른 선택' } })
  fireEvent.click(screen.getByRole('button', { name: '이 회차에서 분기 만들기' }))
  expect(await screen.findByRole('heading', { level: 1, name: '새 포크' })).toBeTruthy()
  expect(screen.getByText('위치 /content?work=f1')).toBeTruthy()
  expect(screen.getByText('분기 작품')).toBeTruthy()
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ episode: 1, title: '새 포크', direction: '다른 선택' })
})

// ── 결과 안내는 동작한 자리에서 ─────────────────────────────────────

it('shows why creating a work failed inside the form next to 작품 만들기, not at the top of the page', async () => {
  stubCover()
  openContent(contentApi({ 'GET /api/v1/works': () => Response.json([]), 'POST /api/v1/works': () => Response.json({ detail: '같은 제목의 작품이 이미 있어요.' }, { status: 409 }) }))
  await screen.findByRole('heading', { level: 1, name: '새 작품 만들기' })
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: '중복 제목' } })
  await fillRegistration()
  fireEvent.click(screen.getByRole('button', { name: '작품 만들기' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('같은 제목의 작품이 이미 있어요.')
  expect(screen.getByRole('button', { name: '작품 만들기' }).closest('form')!.contains(alert)).toBe(true)
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  // 입력은 그대로 남아 고쳐서 다시 보낼 수 있다.
  expect((screen.getByLabelText('작품 제목') as HTMLInputElement).value).toBe('중복 제목')
})

it('shows why creating a fork failed inside the fork form next to its button, not at the top of the page', async () => {
  stubCover()
  const original = { ...owned, visibility: 'public', allowFork: true, episodes: [episode(1)] }
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([original]), 'POST /api/v1/works/w/forks': () => Response.json({ detail: '이미 이 원작에서 만든 분기가 있어요.' }, { status: 409 }) }))
  fireEvent.click(screen.getByRole('button', { name: '이야기 분기' }))
  fireEvent.change(screen.getByLabelText('분기 작품 제목'), { target: { value: '새 포크' } })
  fireEvent.click(screen.getByRole('button', { name: '이 회차에서 분기 만들기' }))
  // 표지 칸은 이 대역 작품 id에 늘 자기 오류를 보이므로, 분기 사유는 폼 안에서 찾는다.
  const form = screen.getByRole('button', { name: '이 회차에서 분기 만들기' }).closest('form')!
  const alert = await within(form).findByRole('alert')
  expect(alert.textContent).toContain('이미 이 원작에서 만든 분기가 있어요.')
  expect(screen.getAllByText(/이미 이 원작에서 만든 분기가 있어요\./)).toHaveLength(1)
  expect(document.querySelector('.ep-content > .ep-alert')).toBeNull()
  expect((screen.getByLabelText('분기 작품 제목') as HTMLInputElement).value).toBe('새 포크')
})

it('brings the top alert into view when a request without its own place fails, so the reason is not left above the screen', async () => {
  stubCover()
  const scrolled: { el: Element; arg: unknown }[] = []
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) { scrolled.push({ el: this, arg }) }
  try {
    await openWork(contentApi({
      'GET /api/v1/works': () => Response.json([owned]),
      'PUT /api/v1/works/w': () => Response.json({ detail: '원고가 변경됐어요. 최신 데이터를 불러와 주세요.' }, { status: 409 }),
    }))
    expect(scrolled).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
    fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: '새 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    const alert = (await screen.findByText(/원고가 변경됐어요\./)).closest('[role=alert]')
    expect(alert?.parentElement?.classList.contains('ep-content')).toBe(true)
    await waitFor(() => expect(scrolled).toHaveLength(1))
    expect(scrolled[0].el).toBe(alert)
    expect(scrolled[0].arg).toEqual({ block: 'nearest' })
  } finally { Reflect.deleteProperty(Element.prototype, 'scrollIntoView') }
})

it('keeps saved manuscript bodies out of the history tab until each version is opened', async () => {
  stubCover()
  const version = { id: 'v1', episode: 1, title: '첫 화', body: '저장된 원고', revision: 7, savedAt: '2026-11-02T00:00:00Z' }
  const second = { ...version, id: 'v2', revision: 8, body: '둘째 저장본' }
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([owned]),
    'GET /api/v1/works/w/episodes': () => Response.json([writingRow(1, { versions: [version, second] })]),
    'GET /api/v1/works/w/history': () => Response.json({ versions: [version, second], proposals: [], publicationHistory: [] }),
  }))
  fireEvent.click(screen.getByRole('button', { name: '저장·AI·발행 이력' }))
  const title = await screen.findByRole('heading', { name: '1화 · 저장 버전 1 · 첫 화' })
  // 저장본이 많아도 본문(과 그 안의 이미지)은 펼친 것만 그린다.
  expect(screen.queryByText('저장된 원고')).toBeNull()
  expect(screen.queryByText('둘째 저장본')).toBeNull()
  const toggle = within(title.closest('article')!).getByRole('button', { name: '원고 보기' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(document.getElementById(toggle.getAttribute('aria-describedby') ?? '')).toBe(title)
  fireEvent.click(toggle)
  expect(screen.getByText('저장된 원고')).toBeTruthy()
  expect(screen.queryByText('둘째 저장본')).toBeNull()
  expect(within(title.closest('article')!).getByRole('button', { name: '원고 접기' }).getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(within(title.closest('article')!).getByRole('button', { name: '원고 접기' }))
  expect(screen.queryByText('저장된 원고')).toBeNull()
})

// ── 개요 대시보드(R6): 히어로 아래의 작품 지표·최근 발행 이력·바로가기 ──
const dashMetric = (name: string) => screen.getByText(name, { selector: '.ep-dash dt' }).nextElementSibling?.textContent

it('개요 탭 히어로 아래에 대시보드가 있고, 공개 작품의 독자 지표는 공개 상세의 값이며 최근 발행 이력과 바로가기가 같은 작품 데이터로 보인다', async () => {
  stubCover()
  const readerStats = vi.spyOn(appContainer.resolve('readingUseCase'), 'readerStats').mockResolvedValue({ likes: 3, views: 12 })
  vi.spyOn(appContainer.resolve('feedbackReportUseCase'), 'listInbox').mockResolvedValue([])
  vi.spyOn(appContainer.resolve('editSuggestionUseCase'), 'inbox').mockResolvedValue([])
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([{ ...owned, visibility: 'public', episodes: [episode(1)] }]),
    'GET /api/v1/works/w/history': () => Response.json({ versions: [], proposals: [], publicationHistory: [{ episode: 1, versionId: 'v1', publishedAt: '2026-11-03T00:00:00Z', action: 'publish' }] }),
  }))
  const dash = document.querySelector<HTMLElement>('.ep-dash')!
  expect(document.querySelector('.ep-hero')!.compareDocumentPosition(dash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await waitFor(() => expect(dashMetric('누적 조회(회원)')).toBe('12회'))
  expect(readerStats).toHaveBeenCalledWith('w', expect.any(AbortSignal))
  expect(dashMetric('좋아요')).toBe('3')
  expect(dashMetric('공개 회차')).toBe('1화')
  expect(dashMetric('총 글자 수 · 공백 포함')).toBe('5자') // 내가 쓴 공개 회차의 글자만('1화 본문')
  await waitFor(() => expect(dashMetric('받은 피드백')).toBe('0건'))
  const recent = within(await screen.findByRole('region', { name: '최근 발행 이력' }))
  expect((await recent.findByRole('listitem')).textContent).toContain('1화 · 발행 ·')
  expect(screen.getByRole('link', { name: '소설 상세 보기' }).getAttribute('href')).toBe('/work/w')
  expect(screen.getByRole('link', { name: '집필실 열기' }).getAttribute('href')).toBe('/studio/w') // 사이드바 메뉴에 없는 목적지로 가는 바로가기(탭 전환 버튼이 없음은 WorkDashboard.test가 본다)
})

it('대시보드의 한 구획이 실패해도 그 구획 안에서만 알리고(화면 알림 role=alert는 가로채지 않는다) 다른 지표는 그대로 보인다', async () => {
  stubCover()
  vi.spyOn(appContainer.resolve('readingUseCase'), 'readerStats').mockRejectedValue(new Error('offline'))
  vi.spyOn(appContainer.resolve('feedbackReportUseCase'), 'listInbox').mockResolvedValue([])
  vi.spyOn(appContainer.resolve('editSuggestionUseCase'), 'inbox').mockResolvedValue([])
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([{ ...owned, visibility: 'public', episodes: [episode(1)] }]),
    'GET /api/v1/works/w/history': () => Response.json({ detail: '서버 오류' }, { status: 500 }),
  }))
  await waitFor(() => expect(dashMetric('누적 조회(회원)')).toBe('불러오지 못했어요'))
  expect(dashMetric('좋아요')).toBe('불러오지 못했어요')
  expect(dashMetric('공개 회차')).toBe('1화')
  expect(within(await screen.findByRole('region', { name: '최근 발행 이력' })).getByText(/발행 이력을 불러오지 못했어요/)).toBeTruthy()
  expect(within(document.querySelector<HTMLElement>('.ep-dash')!).queryByRole('alert')).toBeNull() // 표지 알림 같은 다른 구획의 알림과 섞이지 않는다: 이 대시보드 안에는 role=alert가 없다
})
