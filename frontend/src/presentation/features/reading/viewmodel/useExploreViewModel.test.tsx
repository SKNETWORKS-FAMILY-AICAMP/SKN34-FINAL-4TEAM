// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { Work } from '../../../../domain/entities/work'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useRankViewModel, useSearchViewModel } from './useExploreViewModel'

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
function setup(path: string, hook: typeof useSearchViewModel | typeof useRankViewModel = useSearchViewModel) {
  const calls: { query: Parameters<ReadingUseCase['findWorks']>[0]; signal?: AbortSignal; response: ReturnType<typeof deferred<Page>> }[] = []
  const readingUseCase = {
    findWorks: vi.fn((query: Parameters<ReadingUseCase['findWorks']>[0], signal?: AbortSignal) => {
      const response = deferred<Page>()
      calls.push({ query, signal, response })
      return response.promise
    }),
  } as unknown as ReadingUseCase
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={createAppStore()}><MemoryRouter initialEntries={[path]} useTransitions={false}>{children}</MemoryRouter></Provider>
  return { ...renderHook(() => hook(readingUseCase), { wrapper }), calls }
}
/** 첫 서버 페이지를 받아 화면이 목록을 보이는 상태까지 만든다. */
async function loaded(path: string, first: Page, hook?: typeof useSearchViewModel | typeof useRankViewModel) {
  const view = setup(path, hook)
  await waitFor(() => expect(view.calls).toHaveLength(1))
  await act(async () => view.calls[0].response.resolve(first))
  return view
}

it('더 보기는 page 1, 2…를 차례로 받아 이어 붙이고 마지막 페이지(hasMore false)에서 멈춘다', async () => {
  const { result, calls } = setup('/search?q=a&f=title&sort=like')
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].query).toEqual({ q: 'a', f: 'title', sort: 'like' })
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

it('첫 페이지가 마지막이면 더 보기가 없고, 불러오지 못한 첫 페이지에도 없다', async () => {
  const last = await loaded('/search', page(['a1'], false))
  expect(last.result.current.more.hasMore).toBe(false)
  const failed = setup('/search')
  await waitFor(() => expect(failed.calls).toHaveLength(1))
  await act(async () => failed.calls[0].response.reject(new Error('offline')))
  expect(failed.result.current.isError).toBe(true)
  expect(failed.result.current.more.hasMore).toBe(false)
})

it('더 보기를 같은 순간 두 번 호출해도 요청은 한 번이다', async () => {
  const { result, calls } = await loaded('/search', page(['a1']))
  act(() => { result.current.more.load(); result.current.more.load() })
  expect(calls).toHaveLength(2)
})

it('이미 보인 작품(서버 목록이 밀려 겹친 항목)은 이어 붙이지 않아 key가 겹치지 않는다', async () => {
  const { result, calls } = await loaded('/search', page(['a1', 'a2']))
  act(() => result.current.more.load())
  await act(async () => calls[1].response.resolve(page(['a2', 'a3'], false)))
  expect(ids(result.current.list)).toEqual(['a1', 'a2', 'a3'])
})

it('더 보기가 실패해도 보인 목록은 그대로이고, 다시 시도하면 같은 page를 다시 받는다', async () => {
  const { result, calls } = await loaded('/search', page(['a1', 'a2']))
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
  const { result, calls } = await loaded('/search?q=a', page(['a1', 'a2']))
  act(() => result.current.more.load())
  const stale = calls[1]
  expect(stale.signal?.aborted).toBe(false)

  act(() => result.current.submit('b'))
  await waitFor(() => expect(calls).toHaveLength(3))
  expect(stale.signal?.aborted).toBe(true)
  expect(calls[2].query).toEqual({ q: 'b', f: 'all', sort: 'latest' })
  await act(async () => calls[2].response.resolve(page(['b1'], false)))
  await act(async () => stale.response.resolve(page(['a3'])))
  expect(ids(result.current.list)).toEqual(['b1'])
  expect(result.current.more).toMatchObject({ hasMore: false, loading: false, failed: false })
})

it('더 보기 중이던 조건이 바뀌어도 처음 받은 새 첫 페이지 뒤에서 page 1부터 이어 받는다', async () => {
  const { result, calls } = await loaded('/search?q=a', page(['a1']))
  act(() => result.current.more.load())
  await act(async () => calls[1].response.resolve(page(['a2'])))
  act(() => result.current.submit('b'))
  await waitFor(() => expect(calls).toHaveLength(3))
  await act(async () => calls[2].response.resolve(page(['b1'])))
  act(() => result.current.more.load())
  expect(calls[3].query).toEqual({ q: 'b', f: 'all', sort: 'latest', page: 1 })
})

it('화면을 떠나면 진행 중인 더 보기 요청을 취소한다', async () => {
  const { result, calls, unmount } = await loaded('/search', page(['a1']))
  act(() => result.current.more.load())
  expect(calls[1].signal?.aborted).toBe(false)
  unmount()
  expect(calls[1].signal?.aborted).toBe(true)
})

it('/rank는 탭(t)을 함께 보내 원작·Fork를 거르게 하고 더 보기도 같은 조건으로 받는다', async () => {
  const { result, calls } = await loaded('/rank?t=orig', page(['o1']), useRankViewModel)
  expect(calls[0].query).toEqual({ t: 'orig', q: '', f: 'all', sort: 'view' })
  act(() => result.current.more.load())
  expect(calls[1].query).toEqual({ t: 'orig', q: '', f: 'all', sort: 'view', page: 1 })
  await act(async () => calls[1].response.resolve(page(['o2'], false)))
  expect(ids(result.current.list)).toEqual(['o1', 'o2'])
})
