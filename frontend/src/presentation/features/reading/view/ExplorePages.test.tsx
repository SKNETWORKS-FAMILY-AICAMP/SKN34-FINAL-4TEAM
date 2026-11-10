// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { seedWorks } from '../../../../data/mock/seed'
import { stubWorkSearch } from '../../../../test/stubWorkSearch'
import { IfsPage, RankPage, SearchPage, TagPage } from './ExplorePages'

beforeEach(() => { stubWorkSearch() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderAt(path: string) {
  return render(<Provider store={createAppStore()}><MemoryRouter initialEntries={[path]} useTransitions={false}>
    <Routes>
      <Route path="/search" element={<SearchPage />} />
      <Route path="/rank" element={<RankPage />} />
      <Route path="/ifs" element={<IfsPage />} />
      <Route path="/tag/:tag?" element={<TagPage />} />
    </Routes>
  </MemoryRouter></Provider>)
}
const current = (group: HTMLElement, name: string) => within(group).getByRole('link', { name }).getAttribute('aria-current')

it.each([['/search', '소설 검색'], ['/rank', '랭킹'], ['/tag/%EA%BF%88', '#꿈'], ['/ifs?w=guunmong', '포크 소설']])('%s 화면은 h1 하나를 본문 랜드마크 안에 둔다', async (path, name) => {
  renderAt(path)
  const h1 = await screen.findByRole('heading', { level: 1, name })
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  const main = screen.getByRole('main')
  expect(main.id).toBe('main')
  expect(main.getAttribute('tabindex')).toBe('-1')
  expect(main.contains(h1)).toBe(true)
})

it('검색 범위와 정렬의 선택 상태를 aria-current로 알린다', async () => {
  renderAt('/search?f=title&sort=latest')
  const scope = await screen.findByRole('group', { name: '검색 범위' })
  const sort = screen.getByRole('group', { name: '정렬' })
  expect(current(scope, '제목')).toBe('true')
  expect(scope.querySelectorAll('[aria-current]')).toHaveLength(1)
  expect(current(sort, '최신 순')).toBe('true')
  expect(sort.querySelectorAll('[aria-current]')).toHaveLength(1)
})

it('서버가 지원하지 않는 옛 주소의 범위·정렬 값(f=body·sort=pop)은 기본값(전체·최신 순)으로 읽는다 — 인기 순은 sort=like다', async () => {
  renderAt('/search?f=body&sort=pop')
  const scope = await screen.findByRole('group', { name: '검색 범위' })
  const sort = screen.getByRole('group', { name: '정렬' })
  expect(current(scope, '전체')).toBe('true')
  expect(current(sort, '최신 순')).toBe('true')
  expect(current(sort, '인기 순')).toBeNull()
  expect(sort.querySelectorAll('[aria-current]')).toHaveLength(1)
})

it('정렬은 최신 순·인기 순(like)·조회 순이고 주소의 sort=like가 인기 순으로 선택된다', async () => {
  renderAt('/search?sort=like')
  const sort = await screen.findByRole('group', { name: '정렬' })
  expect([...sort.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['최신 순', '인기 순', '조회 순'])
  expect(current(sort, '인기 순')).toBe('true')
  expect(sort.querySelectorAll('[aria-current]')).toHaveLength(1)
})

it('작가 범위는 서버가 지원하므로 주소의 f=author가 그대로 선택된다', async () => {
  renderAt('/search?f=author')
  const scope = await screen.findByRole('group', { name: '검색 범위' })
  expect(current(scope, '작가')).toBe('true')
  expect(scope.querySelectorAll('[aria-current]')).toHaveLength(1)
})

it('검색이 실패하면 빈 결과가 아니라 오류 안내를 보여 준다', async () => {
  vi.spyOn(appContainer.resolve('workSearchRepository'), 'search').mockRejectedValue(new Error('offline'))
  renderAt('/search?q=구운몽')
  expect((await screen.findByRole('alert')).textContent).toBe('소설을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  expect(screen.queryByText('0편')).toBeNull()
  expect(screen.queryByText('검색 결과가 없어요. 다른 검색어나 범위로 찾아 보세요.')).toBeNull()
})

it('검색·랭킹 결과가 없으면 0편과 빈 상태 문구를 보여 준다', async () => {
  vi.spyOn(appContainer.resolve('workSearchRepository'), 'search').mockResolvedValue([])
  renderAt('/search?q=없는소설')
  await screen.findByText('검색 결과가 없어요. 다른 검색어나 범위로 찾아 보세요.')
  screen.getByText('0편')
  cleanup()
  renderAt('/rank')
  await screen.findByText('조건에 맞는 소설이 없어요.')
})

it('랭킹은 조회 순일 때 최근 24시간 조회 기준임을 알리고 데모 데이터 문구를 쓰지 않는다', async () => {
  renderAt('/rank')
  await screen.findByText('조회 순 · 최근 24시간 조회 기준')
  expect(screen.queryByText(/데모 데이터/)).toBeNull()
  cleanup()
  renderAt('/rank?sort=latest')
  await waitFor(() => expect(document.querySelector('.sec-h .muted')?.textContent).toBe('최신 순'))
})

it('랭킹 탭과 태그 링크, 포크 소설 정렬도 선택 상태를 aria-current로 알린다', async () => {
  renderAt('/rank?t=if')
  const tabs = document.querySelector<HTMLElement>('.libtabs')!
  expect(current(tabs, '포크 소설')).toBe('true')
  expect(tabs.querySelectorAll('[aria-current]')).toHaveLength(1)
  cleanup()
  renderAt('/tag/%EA%BF%88')
  await screen.findByRole('heading', { level: 1, name: '#꿈' })
  expect(document.querySelector('.tagbar')!.querySelectorAll('[aria-current]')).toHaveLength(1)
  expect(document.querySelector('.tagbar [aria-current]')!.className).toBe('on')
  cleanup()
  renderAt('/ifs?w=guunmong&sort=pop')
  expect(current(await screen.findByRole('group', { name: '정렬' }), '인기 순')).toBe('true')
})

it.each([
  ['/search', '검색 · STORYFORK'],
  ['/rank', '랭킹 · STORYFORK'],
  ['/tag/%EA%BF%88', '#꿈 · STORYFORK'],
  ['/ifs?w=guunmong', '포크 소설 모아보기 · STORYFORK'],
])('%s 화면의 탭 제목은 %s이고 화면을 떠나면 기본 제목으로 돌아간다', async (path, title) => {
  const view = renderAt(path)
  await waitFor(() => expect(document.title).toBe(title))
  view.unmount()
  expect(document.title).toBe('STORYFORK')
})

// 서버 페이지(size 20)와 더 보기. 시드 작품 수(<20)로는 한 페이지뿐이라 검색 저장소 응답을 직접 만든다.
const card = (id: string) => ({ ...seedWorks(0)[0], id, title: `소설 ${id}`, parent: undefined, forkAt: undefined })
const serverPage = (page: number, count: number) => Array.from({ length: count }, (_, i) => card(`p${page}-${i}`))
const titles = () => [...document.querySelectorAll('.rgrid .ri b')].map((b) => b.textContent)
const searchRepository = () => appContainer.resolve('workSearchRepository')
const more = () => screen.getByRole('button', { name: '더 보기' })

it('검색은 첫 20개를 보이고 더 보기로 다음 서버 페이지를 이어 붙이며, 20개보다 적게 오면 버튼이 사라진다', async () => {
  const search = vi.spyOn(searchRepository(), 'search').mockImplementation(async ({ page = 0 }) => serverPage(page, page === 0 ? 20 : 5))
  renderAt('/search?q=소설&sort=like')
  // 총 개수를 모르니 더 보기가 남은 동안은 '20편'이 아니라 '20편 이상'이다.
  await screen.findByText('20편 이상')
  expect(search).toHaveBeenLastCalledWith({ q: '소설', f: 'all', sort: 'like', page: 0, size: 20 }, undefined)
  fireEvent.click(more())
  await screen.findByText('25편')
  expect(search).toHaveBeenLastCalledWith({ q: '소설', f: 'all', sort: 'like', page: 1, size: 20 }, expect.any(AbortSignal))
  expect(titles()).toEqual([...serverPage(0, 20), ...serverPage(1, 5)].map((w) => w.title))
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
})

it('한 페이지에 다 담기는 결과에는 더 보기가 없고 편수도 그대로 보여 준다', async () => {
  renderAt('/search?q=회색')
  await screen.findByText('3편')
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
})

it('더 보기 요청 중에는 버튼이 비활성이고 불러오는 중…을 알리며, 끝나면 이어 붙인다', async () => {
  let finish: (works: ReturnType<typeof serverPage>) => void = () => {}
  const next = new Promise<ReturnType<typeof serverPage>>((done) => { finish = done })
  const search = vi.spyOn(searchRepository(), 'search').mockImplementation(({ page = 0 }) => (page === 0 ? Promise.resolve(serverPage(0, 20)) : next))
  renderAt('/search')
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  const busy = await screen.findByRole('button', { name: '불러오는 중…' })
  expect(busy.hasAttribute('disabled')).toBe(true)
  expect(search).toHaveBeenCalledTimes(2)
  await act(async () => finish(serverPage(1, 3)))
  await screen.findByText('23편')
  expect(screen.queryByRole('button', { name: '불러오는 중…' })).toBeNull()
})

it('더 보기가 실패하면 보인 목록은 그대로 두고 버튼 곁에 실패를 알리며, 다시 시도로 이어 받는다', async () => {
  let offline = true
  vi.spyOn(searchRepository(), 'search').mockImplementation(async ({ page = 0 }) => {
    if (page === 1 && offline) throw new Error('offline')
    return serverPage(page, page === 0 ? 20 : 2)
  })
  renderAt('/search')
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  expect((await screen.findByRole('alert')).textContent).toBe('소설을 더 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  expect(titles()).toHaveLength(20)
  expect(screen.getByText('20편 이상')).toBeTruthy()
  offline = false
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('22편')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('정렬을 바꾸면 이어 붙인 목록을 버리고 첫 페이지부터 다시 받는다', async () => {
  const search = vi.spyOn(searchRepository(), 'search').mockImplementation(async ({ page = 0, sort }) => serverPage(page, page === 0 ? 20 : 2).map((w) => ({ ...w, title: `${sort} ${w.title}` })))
  renderAt('/search')
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  await screen.findByText('22편')
  fireEvent.click(screen.getByRole('link', { name: '인기 순' }))
  await waitFor(() => { expect(titles()).toHaveLength(20); expect(titles()[0]).toBe('like 소설 p0-0') })
  expect(search).toHaveBeenLastCalledWith({ q: '', f: 'all', sort: 'like', page: 0, size: 20 }, undefined)
  screen.getByText('20편 이상')
})

it('랭킹 원작 탭은 받은 페이지를 거르므로 비어 보여도 서버 페이지가 가득이면 더 보기가 있고, 순위 번호는 이어진다', async () => {
  vi.spyOn(searchRepository(), 'search').mockImplementation(async ({ page = 0 }) => (page === 0
    ? serverPage(0, 20).map((w) => ({ ...w, parent: 'o1', forkAt: 2 }))
    : serverPage(1, 2)))
  renderAt('/rank?t=orig')
  await screen.findByText('조건에 맞는 소설이 없어요.')
  fireEvent.click(more())
  await waitFor(() => expect(titles()).toEqual(['소설 p1-0', '소설 p1-1']))
  expect(screen.queryByText('조건에 맞는 소설이 없어요.')).toBeNull()
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
  cleanup()

  vi.spyOn(searchRepository(), 'search').mockImplementation(async ({ page = 0 }) => serverPage(page, page === 0 ? 20 : 3))
  renderAt('/rank?t=all')
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  await waitFor(() => expect(titles()).toHaveLength(23))
  expect([...document.querySelectorAll('.rc .big')].map((n) => n.textContent).slice(-3)).toEqual(['21', '22', '23'])
})
