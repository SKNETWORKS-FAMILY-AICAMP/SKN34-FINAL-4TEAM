// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { IfsPage, RankPage, SearchPage, TagPage } from './ExplorePages'

afterEach(cleanup)

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
  renderAt('/search?f=title&sort=new')
  const scope = await screen.findByRole('group', { name: '검색 범위' })
  const sort = screen.getByRole('group', { name: '정렬' })
  expect(current(scope, '제목')).toBe('true')
  expect(scope.querySelectorAll('[aria-current]')).toHaveLength(1)
  expect(current(sort, '최신 순')).toBe('true')
  expect(sort.querySelectorAll('[aria-current]')).toHaveLength(1)
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
