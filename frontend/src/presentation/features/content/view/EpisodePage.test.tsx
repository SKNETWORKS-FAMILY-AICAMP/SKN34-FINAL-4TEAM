// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { act, cleanup, render as renderIn, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, RouterProvider, createMemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import '../../../../test/testLocks'
import { EpisodePage } from './EpisodePage'
import { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { HttpEpisodeRepository } from '../../../../data/content/HttpEpisodeRepository'
import { login } from '../../../../data/api/auth'
import { appContainer } from '../../../../app/appContainer'

/** 상단바·푸터는 공용 Gnb·Footer라 이 화면 테스트에서는 호출만 기록하는 대역으로 바꾼다(실제 Gnb는 Redux 스토어가 필요하다). */
const shell = vi.hoisted(() => ({ gnb: vi.fn(), footer: vi.fn() }))
vi.mock('../../../shared/shell/Gnb', () => ({
  Gnb: (props: { on?: string }) => { shell.gnb(props.on); return null },
  Footer: () => { shell.footer(); return null },
}))

/** EpisodePage는 주소의 ?work= 로 화면이 정해지므로 라우터 안에서 그린다. */
const render = (ui: ReactElement, entry = '/content') => renderIn(<MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>)
/** 이동을 확인하려고 현재 주소를 화면에 적어 둔다. */
const Where = () => { const here = useLocation(); return <p>위치 {here.pathname}{here.search}</p> }

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'content-csrf' })
    : Response.json({ accessToken: 'content-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })))
  await login('writer@example.invalid', 'test-password')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); shell.gnb.mockClear(); shell.footer.mockClear() })

/** 작품 등록 필수값(장르 1개·권리 확인)을 채운다. */
const fillRegistration = () => {
  fireEvent.change(screen.getByLabelText('장르'), { target: { value: '판타지' } })
  fireEvent.click(screen.getByLabelText('이 작품을 등록할 권리가 있음을 확인합니다.'))
}

/** 같은 경로가 여러 번 읽혀도 호출마다 새 Response를 돌려주는 Content API 대역. 정의하지 않은 요청은 실패한다. */
const contentApi = (routes: Record<string, () => Response | Promise<Response>>) => vi.fn<typeof fetch>(async (input, init) => {
  const route = `${init?.method ?? 'GET'} ${String(input)}`
  const make = routes[route]
  if (!make) throw new Error(`대역에 없는 요청: ${route}`)
  return make()
})
const openContent = (fetcher: typeof fetch, entry = '/content') =>
  render(<><EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(fetcher))} /><Where /></>, entry)
/** 열린 작품은 주소의 ?work= 로 정해진다. 히어로 제목이 나올 때까지 기다린다. */
const openWork = async (fetcher: typeof fetch, title = '옛 제목', entry = '/content?work=w') => {
  openContent(fetcher, entry)
  await screen.findByRole('heading', { level: 1, name: title })
}
/** 표지 조회(GET .../cover)는 '표지 없음'(404)으로 답하고, 표지 업로드(PUT)는 onUpload가 답한다. 그 밖의 요청은 beforeEach 대역과 같다. */
const stubCover = (onUpload?: (path: string, init: RequestInit) => Response) => vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
  if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'content-csrf' })
  if (path.endsWith('/cover') || path.endsWith('/cover/content')) return init?.method === 'PUT' && onUpload ? onUpload(path, init) : new Response(null, { status: 404 })
  return Response.json({ accessToken: 'content-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })
}))

const owned = { id: 'w', title: '옛 제목', summary: '옛 소개', visibility: 'private', allowFork: false, allowForkPublication: false, revision: 0, source: null, episodes: [], draft: { title: '회차', body: '초안', revision: 0 }, creationType: 'ORIGINAL', genres: ['판타지', 'SF'], hashtags: ['회귀', '성장'] }
const episode = (number: number) => ({ number, version: 1, title: `${number}화 제목`, body: `${number}화 본문`, inherited: false })
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

it('creates a private work through the API and opens its management page', async () => {
  const calls = vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'w1', title: '별의 기록', summary: '', visibility: 'private', allowFork: false, revision: 0, source: null, episodes: [], draft: { title: '새 회차', body: '', revision: 0 } })))
  render(<><EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))} /><Where /></>)
  await screen.findByText('새 작품 만들기')
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: '별의 기록' } })
  fireEvent.click(screen.getByLabelText('외부 2차 창작', { exact: false }))
  fillRegistration()
  fireEvent.change(screen.getByLabelText('두 번째 장르'), { target: { value: 'SF' } })
  fireEvent.change(screen.getByLabelText('해시태그'), { target: { value: '#회귀, 성장' } })
  fireEvent.click(screen.getByRole('button', { name: '작품 만들기' }))
  await screen.findByRole('heading', { level: 1, name: '별의 기록' })
  // 만든 작품의 관리 화면 주소로 바뀐다.
  expect(screen.getByText('위치 /content?work=w1')).toBeTruthy()
  expect(calls.mock.calls[1][0]).toBe('/api/v1/works')
  expect(JSON.parse(calls.mock.calls[1][1].body)).toEqual({ title: '별의 기록', summary: '', creationType: 'EXTERNAL_DERIVATIVE', genres: ['판타지', 'SF'], hashtags: ['회귀', '성장'], rightsConfirmed: true })
})

it('does not reuse the previous cover when creating another work', async () => {
  const first = { id: '11111111-1111-4111-8111-111111111111', title: '첫 작품', summary: '', visibility: 'private', allowFork: false, revision: 0, source: null, episodes: [], draft: { title: '새 회차', body: '', revision: 0 } }
  const second = { ...first, id: '22222222-2222-4222-8222-222222222222', title: '두 번째 작품' }
  const calls = vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second))
  const uploads = vi.fn(async (path: string, init: RequestInit) => {
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
    return Response.json({ id: '33333333-3333-4333-8333-333333333333', filename: 'first.png', mediaType: 'image/png', kind: 'IMAGE', byteSize: 3, createdAt: '2026-11-03T00:00:00Z', url: `${path}/content` })
  })
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'content-csrf' }) : init?.method === 'PUT' ? uploads(path, init) : new Response(null, { status: 404 })))
  stubPreviewUrl()
  const router = createMemoryRouter([{ path: '/content', element: <EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))} /> }], { initialEntries: ['/content'] })
  renderIn(<RouterProvider router={router} useTransitions={false} />)
  await screen.findByText('새 작품 만들기')
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: first.title } })
  fireEvent.change(screen.getByLabelText('표지 이미지 선택'), { target: { files: [new File(['png'], 'first.png', { type: 'image/png' })] } })
  fillRegistration()
  fireEvent.click(screen.getByRole('button', { name: '작품 만들기' }))
  await screen.findByText('비공개 작품과 표지를 저장했어요.')
  expect(uploads).toHaveBeenCalledTimes(1)
  expect(uploads.mock.calls[0][0]).toBe(`/api/v1/works/${first.id}/cover`)
  expect(router.state.location.search).toBe(`?work=${first.id}`)
  // 서재의 '＋ 새 소설 쓰기'로 /content에 다시 들어온 것과 같다.
  await act(async () => { await router.navigate('/content') })
  fireEvent.change(screen.getByLabelText('작품 제목'), { target: { value: second.title } })
  expect(screen.getByText('PNG·JPEG · 10 MiB 이하. 작품 생성 후 실제 작품 ID로 표지를 저장해요.')).toBeTruthy()
  expect((screen.getByLabelText('이 작품을 등록할 권리가 있음을 확인합니다.') as HTMLInputElement).checked).toBe(false)
  fillRegistration()
  fireEvent.click(screen.getByRole('button', { name: '작품 만들기' }))
  await screen.findByRole('heading', { name: second.title })
  expect(uploads).toHaveBeenCalledTimes(1)
  expect(screen.getByText('비공개 작품을 만들었어요. 첫 회차를 작성해 보세요.')).toBeTruthy()
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

it('uses the shared top bar and footer instead of a dedicated studio header', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  expect(shell.gnb).toHaveBeenCalledWith('lib')
  expect(shell.footer).toHaveBeenCalled()
  // 작품 설정 화면인데 '집필 작업실'이라 적혀 있던 전용 헤더(로고·부제·스튜디오 이름·칩)는 없다.
  for (const text of ['에피소드 스튜디오', '집필 작업실', '이야기가 갈라지는 순간']) expect(screen.queryByText(text)).toBeNull()
  expect(document.querySelector('.ep-header')).toBeNull()
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

it('has one text back link to the library at the top of the main area, not a pill button', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  const back = screen.getAllByRole('link', { name: '내가 쓰는 소설' })
  expect(back).toHaveLength(1)
  expect(back[0].getAttribute('href')).toBe('/lib?tab=write')
  expect(back[0].classList.contains('ep-back')).toBe(true)
  expect(back[0].classList.contains('back')).toBe(false)
  expect(screen.getByRole('main').firstElementChild).toBe(back[0])
})

it('opens the work named by ?work= from the start and shows its management hero with the saved fork policy', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, allowFork: true }]) }))
  expect(screen.getByRole('button', { name: '작품 정보 편집' })).toBeTruthy()
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
  for (const name of AREAS) {
    // 영역마다 하나뿐이고, 보이는 글자가 곧 이름이라 어느 영역의 버튼인지 구별된다.
    expect(screen.getAllByRole('button', { name })).toHaveLength(1)
    expect(screen.getByRole('button', { name }).textContent).toBe(name)
    // 편집 폼은 편집을 누르기 전에는 없다.
    expect(screen.queryByRole('form', { name })).toBeNull()
  }
  expect(await screen.findByAltText('기본 작품 표지')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '포크 정보' })).toBeNull()
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
  expect((screen.getByRole('button', { name: '분기 정책 편집' }) as HTMLButtonElement).disabled).toBe(true)
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
  fireEvent.click(screen.getByRole('button', { name: '분기 정책 편집' }))
  expect(screen.getByLabelText('분기 만들기 허용')).toBeTruthy()
  expect(screen.getByLabelText('분기 작품 최초 공개 허용')).toBeTruthy()
  expect(screen.getByRole('button', { name: '저장·AI·발행 이력' })).toBeTruthy()
})

// ── 원고 작성은 집필실로: 이 화면에는 없고 링크만 있다 ───────────────────

it('has no manuscript tab: the tabs are the episodes, world, fork, received feedback and history, and the episodes open first', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]) }))
  const nav = screen.getByRole('navigation', { name: '작품 메뉴' })
  expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['회차 · 0', '세계관·설정집', '이야기 분기', '받은 피드백', '저장·AI·발행 이력'])
  expect(within(nav).getByRole('button', { name: '회차 · 0' }).getAttribute('aria-current')).toBe('page')
  // 공개한 회차가 없어도 안내 문구와 아래쪽 '새 회차 집필하기'는 남는다.
  expect(screen.getByText('아직 공개한 회차가 없어요. 첫 회차를 작성해 보세요.')).toBeTruthy()
  expect(screen.getByRole('link', { name: '새 회차 집필하기' }).getAttribute('href')).toBe('/studio/w')
  expect(screen.queryByRole('button', { name: '원고 작성' })).toBeNull()
  expect(screen.queryByRole('button', { name: '원고 저장' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: '원고 본문' })).toBeNull()
  expect(screen.queryByRole('button', { name: /회차 공개하기/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /AI 이어쓰기/ })).toBeNull()
})

it('links to the studio instead of offering manuscript editing or AI continuation, even when there is no writing episode', async () => {
  stubCover()
  const w = { ...owned, title: '회차 삭제됨', draft: { title: '새 회차', body: '', revision: 4 }, hasWritingEpisode: false }
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([w]) }), '회차 삭제됨')
  expect(screen.getByRole('link', { name: '회차 작성하기' }).getAttribute('href')).toBe('/studio/w')
  expect(screen.queryByRole('button', { name: '원고 저장' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: '원고 본문' })).toBeNull()
})

it('lists public episodes as rows without their bodies and links to the studio from the hero, each row and the bottom button', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, episodes: [episode(1), episode(2)] }]) }))
  expect(screen.getByRole('link', { name: '회차 작성하기' }).getAttribute('href')).toBe('/studio/w')
  expect(screen.getByRole('link', { name: '1화 1화 제목 수정하기' }).getAttribute('href')).toBe('/studio/w?ep=1')
  expect(screen.getByRole('link', { name: '2화 2화 제목 수정하기' }).getAttribute('href')).toBe('/studio/w?ep=2')
  expect(screen.getByRole('link', { name: '새 회차 집필하기' }).getAttribute('href')).toBe('/studio/w')
  // 소설 상세처럼 번호·제목·메타 한 줄만 보이고 본문은 펼치지 않는다.
  expect(screen.queryByText('1화 본문')).toBeNull()
  expect(within(screen.getByRole('link', { name: '1화 1화 제목 수정하기' }).closest('li')!).getByText('1화 제목')).toBeTruthy()
})

it('shows how many public forks branched off each episode and nothing for episodes without any', async () => {
  stubCover()
  const forkCounts = vi.spyOn(appContainer.resolve('readingUseCase'), 'forkCountsByEpisode').mockResolvedValue({ 2: 3 })
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, episodes: [episode(1), episode(2)] }]) }))
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
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, episodes: [episode(1)] }]) }))
  await act(async () => {})
  const row = screen.getByRole('link', { name: '1화 1화 제목 수정하기' }).closest('li')!
  expect(row.textContent).not.toMatch(/갈라진 포크|0편/)
  expect(row.querySelector('svg')).toBeNull()
})

it('tells a private work is not public yet and marks inherited episodes as read-only 원작 회차 without an edit link', async () => {
  stubCover()
  const inheritedEpisode = (number: number) => ({ ...episode(number), inherited: true })
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...myFork, visibility: 'private', episodes: [inheritedEpisode(1), inheritedEpisode(2), episode(3)] }]) }), '내 포크')
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
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...owned, visibility: 'public', episodes: [episode(1)] }]) }))
  expect(screen.getByText('공개된 회차만 표시해요. 작성 중인 초안은 포함되지 않아요.')).toBeTruthy()
  expect(screen.queryByText('아직 독자에게 공개하지 않은 작품이에요.')).toBeNull()
  expect(screen.queryByText(/이어받은 회차/)).toBeNull()
  expect(screen.queryByText('원작 회차')).toBeNull()
})

it('shows only the settings book summary in the world tab with the studio button disabled', async () => {
  stubCover()
  const world = { id: 'w', name: '설정집', revision: 0, mode: 'following', basis: { episode: 2, version: 7, settings: [] }, draft: null, drafts: [], settings: [], history: [], changes: [], sourceToken: 't' }
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([owned]), 'GET /api/v1/works/w/world': () => Response.json(world) }))
  fireEvent.click(screen.getByRole('button', { name: '세계관·설정집' }))
  const card = await screen.findByRole('region', { name: '세계관 설정집' })
  expect(within(card).getByText('최초 분기 기준: 2화 · 원고 버전 7 · 설정 0개')).toBeTruthy()
  expect((within(card).getByRole('button', { name: '세계관 스튜디오에서 관리' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(card).getByText('연결 예정')).toBeTruthy()
  // 설정 항목 편집은 세계관 스튜디오로 옮길 예정이라 이 탭에는 없다.
  expect(screen.queryByLabelText('설정 이름')).toBeNull()
  expect(screen.queryByRole('button', { name: '새 설정 항목' })).toBeNull()
})

it('lists saved versions, AI requests and publications read-only while restore and publish-target actions stay in the studio', async () => {
  stubCover()
  const version = { id: 'v1', episode: 1, title: '첫 화', body: '저장된 원고', revision: 1, savedAt: '2026-11-02T00:00:00Z' }
  await openWork(contentApi({
    'GET /api/v1/works': () => Response.json([owned]),
    'GET /api/v1/works/w/history': () => Response.json({ versions: [version], proposals: [], publicationHistory: [] }),
  }))
  fireEvent.click(screen.getByRole('button', { name: '저장·AI·발행 이력' }))
  expect(await screen.findByRole('heading', { name: '1화 · 저장 버전 1 · 첫 화' })).toBeTruthy()
  for (const name of ['이 원고를 새 버전으로 복원', '이 버전을 공개 대상으로 선택', '이 제안 다시 열기']) expect(screen.queryByRole('button', { name })).toBeNull()
})

// ── 분기 작품: 포크 정보와 만들기 ────────────────────────────────────

it('labels a fork as 분기 작품 and shows its pinned basis and direction instead of the original-work chip', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([myFork]) }), '내 포크')
  expect(screen.getByText('분기 작품')).toBeTruthy()
  // 원작 칩은 없다(포크 정보 카드의 '원작' 항목 이름과는 다르다).
  expect(screen.queryByText('원작', { selector: '.chip' })).toBeNull()
  const card = screen.getByRole('region', { name: '포크 정보' })
  expect(within(card).getByText('원작').nextElementSibling?.textContent).toBe('「원작」 2화 · 버전 7에서 분기')
  expect(within(card).getByText('분기 방향').nextElementSibling?.textContent).toBe('다른 결말')
  expect(screen.queryByRole('region', { name: '분기 정책' })).toBeNull()
  expect(screen.queryByRole('button', { name: '분기 정책 편집' })).toBeNull()
  expect(screen.getByRole('button', { name: '작품 정보 편집' })).toBeTruthy()
})

it('lines up the fork actions in one row: original, stop publication, and an outlined delete at the end', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([myFork]) }), '내 포크')
  const row = screen.getByRole('region', { name: '포크 정보' }).querySelector('.ep-card-actions')
  expect(Array.from(row?.children ?? [], (el) => el.textContent)).toEqual(['원작으로 가기', '포크 공개 중단', '포크 삭제'])
  // 삭제는 가장 눈에 띄는 꽉 찬 빨간 버튼(.danger)이 아니라 위험 외곽선 버튼이다.
  const remove = screen.getByRole('button', { name: '포크 삭제' })
  expect(remove.classList.contains('ep-danger')).toBe(true)
  expect(remove.classList.contains('danger')).toBe(false)
})

it('locks stopping a fork publication while the work info is being edited, so the re-read cannot reset the unsaved input', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([myFork]) }), '내 포크')
  const stop = () => within(screen.getByRole('region', { name: '포크 정보' })).getByRole('button', { name: '포크 공개 중단' }) as HTMLButtonElement
  expect(stop().disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '작품 정보 편집' }))
  expect(stop().disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(stop().disabled).toBe(false)
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
  const card = screen.getByRole('region', { name: '포크 정보' })
  fireEvent.click(within(card).getByRole('button', { name: '포크 공개 중단' }))
  expect(confirm).toHaveBeenCalledWith(STOP_CONFIRM)
  await screen.findByText('포크 공개를 중단했어요.')
  await waitFor(() => expect(within(screen.getByRole('region', { name: '포크 정보' })).queryByRole('button', { name: '포크 공개 중단' })).toBeNull())
  expect(screen.getByRole('heading', { level: 1, name: '내 포크' })).toBeTruthy()
  expect(screen.getByText('비공개 작품')).toBeTruthy()
  expect(fetcher.mock.calls.some(([input, init]) => String(input) === '/api/v1/works/w/fork-publication' && init?.method === 'DELETE')).toBe(true)
  expect(fetcher.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET')).toHaveLength(2)
})

it('links back to a live original and only explains a deleted one, and offers no stop button for a private fork', async () => {
  stubCover()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...myFork, visibility: 'private' }]) }), '내 포크')
  expect(screen.getByRole('link', { name: '원작으로 가기' }).getAttribute('href')).toBe('/work/o')
  expect(screen.queryByRole('button', { name: '포크 공개 중단' })).toBeNull()
  expect(screen.getByRole('button', { name: '포크 삭제' })).toBeTruthy()
  cleanup()
  await openWork(contentApi({ 'GET /api/v1/works': () => Response.json([{ ...myFork, source: { ...myFork.source, deleted: true } }]) }), '내 포크')
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
  fireEvent.click(screen.getByRole('button', { name: '포크 삭제' }))
  expect(confirm).toHaveBeenCalledWith('「내 포크」 포크를 삭제할까요? 서재와 공개 화면에서 숨겨지고 되돌릴 수 없어요. 같은 원작에서 포크를 다시 만들 수 없어요.')
  expect(await screen.findByText('위치 /lib?tab=write')).toBeTruthy()
  expect(fetcher.mock.calls.some(([input, init]) => String(input) === '/api/v1/works/w' && init?.method === 'DELETE')).toBe(true)
})

it('does not delete or leave when the fork deletion is not confirmed', async () => {
  stubCover()
  const fetcher = contentApi({ 'GET /api/v1/works': () => Response.json([myFork]) })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  await openWork(fetcher, '내 포크')
  fireEvent.click(screen.getByRole('button', { name: '포크 삭제' }))
  expect(screen.getByRole('heading', { level: 1, name: '내 포크' })).toBeTruthy()
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
