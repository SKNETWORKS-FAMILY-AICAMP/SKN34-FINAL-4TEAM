// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { History, PublicationEvent } from '../../../../domain/entities/content'
import { useWorkDashboard } from './useWorkDashboard'

afterEach(cleanup)
const wrapper = ({ children }: { children: ReactNode }) => <Provider store={createAppStore()}>{children}</Provider>

const event = (episode: number, publishedAt: string): PublicationEvent => ({ episode, versionId: `v${episode}`, publishedAt, action: 'publish' })
/** 서비스 대역: 안 쓰는 호출은 부르면 실패해야 하므로 vi.fn이다. */
const setup = (over: { visibility?: 'public' | 'private'; mockup?: boolean; history?: Partial<History>; stats?: { likes: number; views: number } | null; fail?: 'reader' | 'feedback' } = {}) => {
  const offline = async (): Promise<never> => { throw new Error('offline') }
  const use = {
    reading: { readerStats: vi.fn(over.fail === 'reader' ? offline : async () => over.stats === undefined ? { likes: 9, views: 7 } : over.stats) },
    episodes: { history: vi.fn(async () => ({ versions: [], proposals: [], publicationHistory: [], ...over.history }) as History) },
    reports: { listInbox: vi.fn(over.fail === 'feedback' ? offline : async () => [{}, {}, {}] as never[]) },
    suggestions: { inbox: vi.fn(async () => [{}, {}] as never[]) },
  }
  const hook = renderHook(() => useWorkDashboard({ id: 'w', visibility: over.visibility ?? 'public' }, over.mockup ?? false, use as never), { wrapper })
  return { use, ...hook }
}

it('비공개 작품은 독자 지표를 읽지 않고 공개 전(before)으로 둔다', async () => {
  const { use, result } = setup({ visibility: 'private' })
  await waitFor(() => expect(result.current.reader.data).toBe('before'))
  expect(use.reading.readerStats).not.toHaveBeenCalled()
})

it('공개 작품은 독자 지표(좋아요·조회 합계)를 그대로 둔다', async () => {
  const { use, result } = setup()
  await waitFor(() => expect(result.current.reader.data).toEqual({ likes: 9, views: 7 }))
  expect(use.reading.readerStats).toHaveBeenCalledWith('w', expect.any(AbortSignal))
})

it('집계가 없으면(공개 작품이 아니라는 서버 답) null이고 0으로 바꾸지 않는다', async () => {
  const { result } = setup({ stats: null })
  await waitFor(() => expect(result.current.reader.isLoading).toBe(false))
  expect(result.current.reader.data).toBeNull()
  expect(result.current.reader.isError).toBe(false)
})

it('독자 지표를 못 읽으면 실패로 알리고 0으로 바꾸지 않는다(다른 구획은 그대로 읽힌다)', async () => {
  const { result } = setup({ fail: 'reader' })
  await waitFor(() => expect(result.current.reader.isError).toBe(true))
  expect(result.current.reader.data).toBeUndefined()
  await waitFor(() => expect(result.current.feedback.data).toBe(5))
})

it('서버 없는 시연(목업)의 공개 작품은 독자 지표를 읽지 않고 집계 없음(null)이다', async () => {
  const { use, result } = setup({ mockup: true })
  await waitFor(() => expect(result.current.reader.isLoading).toBe(false))
  expect(result.current.reader.data).toBeNull()
  expect(use.reading.readerStats).not.toHaveBeenCalled()
})

it('발행 이력은 최신순 5건만 둔다', async () => {
  const history = ['01', '07', '03', '09', '05', '02', '08'].map((day, i) => event(i + 1, `2026-11-${day}T00:00:00Z`))
  const { result } = setup({ history: { publicationHistory: history } })
  await waitFor(() => expect(result.current.publications.data).toBeDefined())
  expect(result.current.publications.data!.map((e) => e.publishedAt.slice(8, 10))).toEqual(['09', '08', '07', '05', '03'])
})

it('발행 이력이 비어 있으면 빈 목록이고, 응답에 발행 이력이 없으면 오류로 둔다', async () => {
  const empty = setup()
  await waitFor(() => expect(empty.result.current.publications.data).toEqual([]))
  cleanup()
  const missing = setup({ history: { publicationHistory: undefined } })
  await waitFor(() => expect(missing.result.current.publications.isError).toBe(true))
})

it('받은 피드백은 독자 제보와 수정 제안의 개수 합이고 이 작품 것만 묻는다', async () => {
  const { use, result } = setup()
  await waitFor(() => expect(result.current.feedback.data).toBe(5))
  expect(use.reports.listInbox).toHaveBeenCalledWith('w')
  expect(use.suggestions.inbox).toHaveBeenCalledWith('w')
})

it('목업은 서버 수정 제안을 부르지 않고 독자 제보만 센다', async () => {
  const { use, result } = setup({ mockup: true })
  await waitFor(() => expect(result.current.feedback.data).toBe(3))
  expect(use.suggestions.inbox).not.toHaveBeenCalled()
})

it('받은 피드백을 못 읽으면 0으로 채우지 않고 실패로 알린다', async () => {
  const { result } = setup({ fail: 'feedback' })
  await waitFor(() => expect(result.current.feedback.isError).toBe(true))
  expect(result.current.feedback.data).toBeUndefined()
})
