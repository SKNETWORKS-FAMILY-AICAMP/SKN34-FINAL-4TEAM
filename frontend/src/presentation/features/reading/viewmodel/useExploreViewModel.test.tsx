// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect, type ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { PublicWorldCardHit, PublicWorldSummary } from '../../../../domain/entities/publicWorld'
import type { Work } from '../../../../domain/entities/work'
import type { PublicWorldUseCase } from '../../../../domain/usecases/PublicWorldUseCase'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useSearchViewModel } from './useExploreViewModel'

afterEach(cleanup)

type Page = Awaited<ReturnType<ReadingUseCase['findWorks']>>
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j })
  return { promise, resolve, reject }
}
const page = (ids: string[], hasMore = true): Page => ({ list: ids.map((id) => ({ id }) as Work), hasMore })
const ids = (list?: Work[]) => list?.map((w) => w.id)

/** findWorks 호출마다 응답을 대기시켜, 테스트가 응답 순서(늦은 응답 포함)를 직접 정한다. */
function setup(path: string, loadOnFirstPage = false) {
  const calls: { query: Parameters<ReadingUseCase['findWorks']>[0]; signal?: AbortSignal; response: ReturnType<typeof deferred<Page>> }[] = []
  const readingUseCase = {
    findWorks: vi.fn((query: Parameters<ReadingUseCase['findWorks']>[0], signal?: AbortSignal) => {
      const response = deferred<Page>()
      calls.push({ query, signal, response })
      return response.promise
    }),
  } as unknown as ReadingUseCase
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={createAppStore()}><MemoryRouter initialEntries={[path]} useTransitions={false}>{children}</MemoryRouter></Provider>
  return { ...renderHook(() => {
    const vm = useSearchViewModel(readingUseCase)
    useLayoutEffect(() => {
      if (loadOnFirstPage && vm.list && calls.length === 1) vm.more.load()
    }, [vm])
    return vm
  }, { wrapper }), calls }
}
/** 첫 서버 페이지를 받아 화면이 목록을 보이는 상태까지 만든다. */
async function loaded(path: string, first: Page) {
  const view = setup(path)
  await waitFor(() => expect(view.calls).toHaveLength(1))
  await act(async () => view.calls[0].response.resolve(first))
  return view
}

it('더 보기는 page 1, 2…를 차례로 받아 이어 붙이고 마지막 페이지(hasMore false)에서 멈춘다', async () => {
  const { result, calls } = setup('/search?q=a&f=title&sort=like')
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].query).toEqual({ q: 'a', f: 'title', sort: 'like', page: 0 })
  expect(result.current.list).toBeUndefined()
  await act(async () => calls[0].response.resolve(page(['a1', 'a2'])))
  expect(ids(result.current.list)).toEqual(['a1', 'a2'])
  expect(result.current.more).toMatchObject({ hasMore: true, loading: false, failed: false })

  act(() => result.current.more.load())
  expect(calls[1].query).toEqual({ q: 'a', f: 'title', sort: 'like', page: 1 })
  expect(result.current.more.loading).toBe(true)
  await act(async () => calls[1].response.resolve(page(['a3', 'a4'])))
  expect(ids(result.current.list)).toEqual(['a1', 'a2', 'a3', 'a4'])

  act(() => result.current.more.load())
  expect(calls[2].query).toEqual({ q: 'a', f: 'title', sort: 'like', page: 2 })
  await act(async () => calls[2].response.resolve(page(['a5'], false)))
  expect(ids(result.current.list)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5'])
  expect(result.current.more.hasMore).toBe(false)
  act(() => result.current.more.load())
  expect(calls).toHaveLength(3)
})

it('첫 페이지가 화면에 반영되는 즉시 더 보기를 요청해도 그 요청을 취소하지 않는다', async () => {
  const { result, calls } = setup('/search?type=work', true)
  await waitFor(() => expect(calls).toHaveLength(1))
  await act(async () => calls[0].response.resolve(page(['a1'])))
  expect(calls[1].query.page).toBe(1)
  expect(calls[1].signal?.aborted).toBe(false)
  await act(async () => calls[1].response.resolve(page(['a2'], false)))
  expect(ids(result.current.list)).toEqual(['a1', 'a2'])
})

it('첫 페이지가 마지막이면 더 보기가 없고, 불러오지 못한 첫 페이지에도 없다', async () => {
  const last = await loaded('/search?type=work', page(['a1'], false))
  expect(last.result.current.more.hasMore).toBe(false)
  const failed = setup('/search?type=work')
  await waitFor(() => expect(failed.calls).toHaveLength(1))
  await act(async () => failed.calls[0].response.reject(new Error('offline')))
  expect(failed.result.current.isError).toBe(true)
  expect(failed.result.current.more.hasMore).toBe(false)
})

it('더 보기를 같은 순간 두 번 호출해도 요청은 한 번이다', async () => {
  const { result, calls } = await loaded('/search?type=work', page(['a1']))
  act(() => { result.current.more.load(); result.current.more.load() })
  expect(calls).toHaveLength(2)
})

it('이미 보인 작품(서버 목록이 밀려 겹친 항목)은 이어 붙이지 않아 key가 겹치지 않는다', async () => {
  const { result, calls } = await loaded('/search?type=work', page(['a1', 'a2']))
  act(() => result.current.more.load())
  await act(async () => calls[1].response.resolve(page(['a2', 'a3'], false)))
  expect(ids(result.current.list)).toEqual(['a1', 'a2', 'a3'])
})

it('더 보기가 실패해도 보인 목록은 그대로이고, 다시 시도하면 같은 page를 다시 받는다', async () => {
  const { result, calls } = await loaded('/search?type=work', page(['a1', 'a2']))
  act(() => result.current.more.load())
  await act(async () => calls[1].response.reject(new Error('offline')))
  expect(ids(result.current.list)).toEqual(['a1', 'a2'])
  expect(result.current.isError).toBe(false)
  expect(result.current.more).toMatchObject({ hasMore: true, loading: false, failed: true })

  act(() => result.current.more.load())
  expect(calls[2].query).toMatchObject({ page: 1 })
  expect(result.current.more).toMatchObject({ loading: true, failed: false })
  await act(async () => calls[2].response.resolve(page(['a3'], false)))
  expect(ids(result.current.list)).toEqual(['a1', 'a2', 'a3'])
  expect(result.current.more).toMatchObject({ hasMore: false, failed: false })
})

it('검색어가 바뀌면 진행 중인 더 보기를 취소하고, 늦게 와도 새 목록에 붙이지 않고 첫 페이지부터 다시 받는다', async () => {
  const { result, calls } = await loaded('/search?q=a&type=work', page(['a1', 'a2']))
  act(() => result.current.more.load())
  const stale = calls[1]
  expect(stale.signal?.aborted).toBe(false)

  act(() => result.current.submit('b'))
  await waitFor(() => expect(calls).toHaveLength(3))
  expect(stale.signal?.aborted).toBe(true)
  expect(calls[2].query).toEqual({ q: 'b', f: 'all', sort: 'latest', page: 0 })
  await act(async () => calls[2].response.resolve(page(['b1'], false)))
  await act(async () => stale.response.resolve(page(['a3'])))
  expect(ids(result.current.list)).toEqual(['b1'])
  expect(result.current.more).toMatchObject({ hasMore: false, loading: false, failed: false })
})

it('더 보기 중이던 조건이 바뀌어도 처음 받은 새 첫 페이지 뒤에서 page 1부터 이어 받는다', async () => {
  const { result, calls } = await loaded('/search?q=a&type=work', page(['a1']))
  act(() => result.current.more.load())
  await act(async () => calls[1].response.resolve(page(['a2'])))
  act(() => result.current.submit('b'))
  await waitFor(() => expect(calls).toHaveLength(3))
  await act(async () => calls[2].response.resolve(page(['b1'])))
  act(() => result.current.more.load())
  expect(calls[3].query).toEqual({ q: 'b', f: 'all', sort: 'latest', page: 1 })
})

it('화면을 떠나면 진행 중인 더 보기 요청을 취소한다', async () => {
  const { result, calls, unmount } = await loaded('/search?type=work', page(['a1']))
  act(() => result.current.more.load())
  expect(calls[1].signal?.aborted).toBe(false)
  unmount()
  expect(calls[1].signal?.aborted).toBe(true)
})

// ── 전체 탭·번호 쪽 (#505) ────────────────────────────────────────────────────
type WorldQuery = Parameters<PublicWorldUseCase['searchWorlds']>[0]
type WorldAnswer = Awaited<ReturnType<PublicWorldUseCase['searchWorlds']>>
type CardAnswer = Awaited<ReturnType<PublicWorldUseCase['searchCards']>>
const worldsOf = (count: number, total: number, { page: at, size = 24 }: WorldQuery): WorldAnswer => ({
  items: Array.from({ length: count }, (_, i) => ({ id: `w${at * size + i}`, name: `세계 ${at * size + i}` }) as PublicWorldSummary), page: at, size, total,
})
const cardsOf = (count: number, total: number, { page: at, size = 24 }: WorldQuery): CardAnswer => ({
  items: Array.from({ length: count }, (_, i) => ({ worldId: 'w', cardId: `c${at * size + i}`, title: `카드 ${at * size + i}` }) as PublicWorldCardHit), page: at, size, total,
})
type Answers = { works?: Page; worlds?: (query: WorldQuery) => WorldAnswer; cards?: (query: WorldQuery) => CardAnswer }

/** 전체·작품·세계관·설정 카드 탭: 세 조회를 vi.fn으로 두고 응답은 호출마다 만들며, 주소와 이동 방식(PUSH·REPLACE)도 함께 돌려준다. */
function setupTabs(path: string, answers: Answers = {}) {
  const findWorks = vi.fn(async (..._args: unknown[]) => answers.works ?? page([], false))
  const searchWorlds = vi.fn(async (query: WorldQuery, _signal?: AbortSignal) => (answers.worlds ?? ((at) => worldsOf(0, 0, at)))(query))
  const searchCards = vi.fn(async (query: WorldQuery, _signal?: AbortSignal) => (answers.cards ?? ((at) => cardsOf(0, 0, at)))(query))
  // UseCase 객체는 한 번만 만든다: 렌더마다 새로 만들면 조회 범위(deps)가 매번 바뀌어 끝없이 다시 읽는다.
  const readingUseCase = { findWorks } as unknown as ReadingUseCase
  const publicWorldUseCase = { searchWorlds, searchCards } as unknown as PublicWorldUseCase
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={createAppStore()}><MemoryRouter initialEntries={[path]} useTransitions={false}>{children}</MemoryRouter></Provider>
  const view = renderHook(() => {
    const vm = useSearchViewModel(readingUseCase, publicWorldUseCase)
    const location = useLocation()
    return { vm, at: location.pathname + location.search, how: useNavigationType() }
  }, { wrapper })
  return { ...view, findWorks, searchWorlds, searchCards }
}
const q = encodeURIComponent('달')
const calls3 = (view: ReturnType<typeof setupTabs>) => [view.findWorks.mock.calls.length, view.searchWorlds.mock.calls.length, view.searchCards.mock.calls.length]

it.each([
  ['/search', 'all'], ['/search?q=달', 'all'], ['/search?type=all', 'all'], ['/search?type=zzz', 'all'],
  ['/search?f=title', 'work'], ['/search?sort=like', 'work'], ['/search?f=body&sort=pop', 'work'], ['/search?type=zzz&f=tag', 'work'],
  ['/search?type=all&f=title', 'all'], ['/search?type=world&sort=like', 'world'],
  ['/search?type=work', 'work'], ['/search?type=world', 'world'], ['/search?type=card', 'card'], ['/search?type=chat', 'chat'],
])('주소 %s는 %s 탭이다 (type이 없으면 전체, f·sort가 있으면 작품)', async (path, tab) => {
  const view = setupTabs(path)
  expect(view.result.current.vm.tab).toBe(tab)
  await act(async () => {})
})

it.each([['work', [1, 0, 0]], ['world', [0, 1, 0]], ['card', [0, 0, 1]], ['all', [1, 1, 1]], ['chat', [0, 0, 0]]] as const)('%s 탭은 그 탭에 필요한 조회만 한다', async (tab, expected) => {
  const view = setupTabs(`/search?q=${q}&type=${tab}`)
  await waitFor(() => expect(calls3(view)).toEqual(expected))
  await act(async () => {})
  expect(calls3(view)).toEqual(expected)
})

it('탭 링크는 모든 탭에 type을 적고 검색어·범위·정렬은 이어 가며 쪽은 버린다', async () => {
  const { result } = setupTabs(`/search?q=${q}&f=author&sort=like&type=world&page=3`)
  const tabs = ['all', 'work', 'world', 'card', 'chat'] as const
  expect(tabs.map((tab) => result.current.vm.tabHref(tab))).toEqual(tabs.map((tab) => `/search?q=${q}&f=author&sort=like&type=${tab}`))
  await act(async () => {})
})

it('검색을 제출하면 고른 탭에서 검색어만 바꾸고 쪽은 1쪽(주소에서 뺌)으로 돌아간다', async () => {
  const { result } = setupTabs(`/search?q=${q}&type=world&page=3`)
  act(() => result.current.vm.submit(' 별 '))
  expect(result.current.at).toBe(`/search?q=${encodeURIComponent('별')}&type=world`)
  await act(async () => {})
})

it('전체 탭은 작품(첫 쪽의 앞 6개)·세계관·설정 카드(각 6개)를 묶음마다 따로 읽는다', async () => {
  const view = setupTabs(`/search?q=${q}`, {
    works: page(Array.from({ length: 9 }, (_, i) => `a${i}`)),
    worlds: (query) => worldsOf(6, 40, query),
    cards: (query) => cardsOf(6, 9, query),
  })
  await waitFor(() => expect(view.result.current.vm.groups.cards.list).toHaveLength(6))
  const { groups } = view.result.current.vm
  expect(ids(groups.works.list)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'])
  expect(groups.worlds.list).toHaveLength(6)
  expect(view.findWorks).toHaveBeenCalledWith({ q: '달', f: 'all', sort: 'latest', page: 0 }, expect.any(AbortSignal))
  expect(view.searchWorlds).toHaveBeenCalledWith({ q: '달', page: 0, size: 6 }, expect.any(AbortSignal))
  expect(view.searchCards).toHaveBeenCalledWith({ q: '달', page: 0, size: 6 }, expect.any(AbortSignal))
  expect(calls3(view)).toEqual([1, 1, 1])
})

it('전체 탭에서 한 묶음이 실패해도 다른 묶음은 그대로이고, 다시 시도는 그 묶음만 다시 읽는다', async () => {
  let offline = true
  const view = setupTabs(`/search?q=${q}`, {
    works: page(['a0']),
    worlds: (query) => { if (offline) throw new Error('offline'); return worldsOf(2, 2, query) },
    cards: (query) => cardsOf(1, 1, query),
  })
  await waitFor(() => expect(view.result.current.vm.groups.worlds.isError).toBe(true))
  await waitFor(() => expect(view.result.current.vm.groups.cards.list).toHaveLength(1))
  const { groups } = view.result.current.vm
  expect(groups.worlds.list).toBeUndefined()
  expect([groups.works.isError, groups.cards.isError]).toEqual([false, false])
  expect(ids(groups.works.list)).toEqual(['a0'])
  offline = false
  act(() => view.result.current.vm.groups.worlds.retry())
  await waitFor(() => expect(view.result.current.vm.groups.worlds.list).toHaveLength(2))
  expect(view.result.current.vm.groups.worlds.isError).toBe(false)
  expect(calls3(view)).toEqual([1, 2, 1])
})

it('전체 탭은 검색어가 없으면 설정 카드를 요청하지 않고(needsQuery) 작품·세계관은 처음 목록을 읽는다', async () => {
  const view = setupTabs('/search', { worlds: (query) => worldsOf(1, 1, query) })
  await waitFor(() => expect(view.result.current.vm.groups.worlds.list).toHaveLength(1))
  expect(view.searchWorlds).toHaveBeenCalledWith({ q: '', page: 0, size: 6 }, expect.any(AbortSignal))
  expect(view.searchCards).not.toHaveBeenCalled()
  expect(view.result.current.vm.groups.cards).toMatchObject({ needsQuery: true, list: undefined })
})

it('세계관 탭은 주소 page(1부터)로 서버 쪽(0부터)을 읽고 total로 번호 쪽을 만든다', async () => {
  const view = setupTabs(`/search?type=world&q=${q}&page=3`, { worlds: (query) => worldsOf(1, 100, query) })
  await waitFor(() => expect(view.result.current.vm.worlds.list).toHaveLength(1))
  expect(view.searchWorlds).toHaveBeenCalledTimes(1)
  expect(view.searchWorlds).toHaveBeenCalledWith({ q: '달', page: 2 }, expect.any(AbortSignal))
  expect(view.result.current.vm.worlds).toMatchObject({ total: 100, page: 3, pages: 5 })
})

it('설정 카드 탭도 같은 번호 쪽이고 검색어가 없으면 요청 없이 needsQuery다', async () => {
  const filled = setupTabs(`/search?type=card&q=${q}&page=2`, { cards: (query) => cardsOf(6, 30, query) })
  await waitFor(() => expect(filled.result.current.vm.cards.list).toHaveLength(6))
  expect(filled.searchCards).toHaveBeenCalledWith({ q: '달', page: 1 }, expect.any(AbortSignal))
  expect(filled.result.current.vm.cards).toMatchObject({ total: 30, page: 2, pages: 2, needsQuery: false })
  const empty = setupTabs('/search?type=card')
  await act(async () => {})
  expect(empty.result.current.vm.cards.needsQuery).toBe(true)
  expect(empty.searchCards).not.toHaveBeenCalled()
})

it('쪽을 옮기면 주소 page를 바꿔 그 쪽을 읽고(기록을 쌓는다), 1쪽은 page를 주소에서 뺀다', async () => {
  const view = setupTabs(`/search?type=world&q=${q}`, { worlds: (query) => worldsOf(1, 100, query) })
  await waitFor(() => expect(view.result.current.vm.worlds.list).toHaveLength(1))
  act(() => view.result.current.vm.goPage(4))
  expect(view.result.current.at).toBe(`/search?q=${q}&type=world&page=4`)
  expect(view.result.current.how).toBe('PUSH')
  await waitFor(() => expect(view.searchWorlds).toHaveBeenLastCalledWith({ q: '달', page: 3 }, expect.any(AbortSignal)))
  await waitFor(() => expect(view.result.current.vm.worlds).toMatchObject({ page: 4, pages: 5 }))
  act(() => view.result.current.vm.goPage(1))
  expect(view.result.current.at).toBe(`/search?q=${q}&type=world`)
})

it('지금 쪽을 다시 누르면 기록을 쌓지 않는다', async () => {
  const view = setupTabs(`/search?type=world&q=${q}&page=2`, { worlds: (query) => worldsOf(1, 100, query) })
  await waitFor(() => expect(view.result.current.vm.worlds.list).toHaveLength(1))
  act(() => view.result.current.vm.goPage(2))
  expect(view.result.current.at).toBe(`/search?type=world&q=${q}&page=2`)
  expect(view.result.current.how).toBe('POP')
})

it.each(['abc', '0', '-1', '2.5'])('잘못된 page=%s는 1쪽으로 읽는다', async (bad) => {
  const view = setupTabs(`/search?type=world&page=${bad}`)
  await waitFor(() => expect(view.searchWorlds).toHaveBeenCalledWith({ q: '', page: 0 }, expect.any(AbortSignal)))
  expect(view.result.current.vm.worlds.page).toBe(1)
})

it('마지막 쪽을 넘은 page(목록이 줄었거나 주소를 고친 경우)는 마지막 쪽으로 바꾸되 기록을 쌓지 않고, 결과가 하나도 없으면 그대로 둔다', async () => {
  const view = setupTabs(`/search?type=world&q=${q}&page=9`, { worlds: (query) => worldsOf(query.page >= 2 ? 0 : 6, 30, query) })
  await waitFor(() => expect(view.result.current.at).toBe(`/search?q=${q}&type=world&page=2`))
  expect(view.result.current.how).toBe('REPLACE')
  await waitFor(() => expect(view.result.current.vm.worlds.list).toHaveLength(6))
  expect(view.searchWorlds).toHaveBeenLastCalledWith({ q: '달', page: 1 }, expect.any(AbortSignal))
  const none = setupTabs(`/search?type=world&q=${q}&page=9`)
  await waitFor(() => expect(none.result.current.vm.worlds.list).toEqual([]))
  expect(none.result.current.at).toBe(`/search?type=world&q=${q}&page=9`)
})
