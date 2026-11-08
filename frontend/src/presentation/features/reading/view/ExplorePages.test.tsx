// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
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

it('서버가 지원하지 않는 옛 주소의 범위·정렬 값은 기본값(전체·최신 순)으로 읽는다', async () => {
  renderAt('/search?f=author&sort=pop')
  const scope = await screen.findByRole('group', { name: '검색 범위' })
  const sort = screen.getByRole('group', { name: '정렬' })
  expect(current(scope, '전체')).toBe('true')
  expect(current(sort, '최신 순')).toBe('true')
  expect(within(scope).queryByRole('link', { name: '작가' })).toBeNull()
  expect(within(sort).queryByRole('link', { name: '인기 순' })).toBeNull()
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
