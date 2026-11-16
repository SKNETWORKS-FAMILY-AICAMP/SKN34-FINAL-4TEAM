// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { EditSuggestionUseCase } from '../../../../domain/usecases/EditSuggestionUseCase'
import type { FeedbackReportUseCase } from '../../../../domain/usecases/FeedbackReportUseCase'
import { useEditSuggestionInboxViewModel } from './useEditSuggestionInboxViewModel'
import { useFeedbackReportInboxViewModel } from './useFeedbackReportInboxViewModel'

afterEach(cleanup)

const store = createAppStore()
const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>

// 작품별로 거르는 일은 서버가 한다. 대역이 일부러 다른 작품 항목(other)을 섞어 줘도 화면이 다시 거르지 않고 받은 그대로 보여야 한다.
it('작가 피드백함 제보: 작품 ID를 서버 조회에 그대로 넘기고 받은 목록을 다시 거르지 않으며, 작품이 바뀌면 다시 묻는다', async () => {
  const listInbox = vi.fn(async (workId?: string) => workId === 'w2' ? [{ id: 'r2', workId: 'w2' }] : [{ id: 'r1', workId: 'w1' }, { id: 'r9', workId: 'other' }])
  const useCase = { listInbox } as unknown as FeedbackReportUseCase
  const { result, rerender } = renderHook(({ workId }: { workId?: string }) => useFeedbackReportInboxViewModel(workId, useCase), { initialProps: { workId: 'w1' as string | undefined }, wrapper })
  await waitFor(() => expect(result.current.reports?.map((r) => r.id)).toEqual(['r1', 'r9']))
  expect(listInbox).toHaveBeenLastCalledWith('w1')
  rerender({ workId: 'w2' })
  await waitFor(() => expect(result.current.reports?.map((r) => r.id)).toEqual(['r2']))
  expect(listInbox).toHaveBeenLastCalledWith('w2')
  // 작품을 정하지 않은 /inbox는 쿼리 없이 전체를 묻는다.
  rerender({ workId: undefined })
  await waitFor(() => expect(listInbox).toHaveBeenLastCalledWith(undefined))
})

it('작가 피드백함 수정 제안: 작품 ID를 서버 조회에 그대로 넘기고 받은 목록을 다시 거르지 않으며, 작품이 바뀌면 다시 묻는다', async () => {
  const inbox = vi.fn(async (workId?: string) => workId === 'w2' ? [{ id: 's2', workId: 'w2' }] : [{ id: 's1', workId: 'w1' }, { id: 's9', workId: 'other' }])
  const useCase = { inbox } as unknown as EditSuggestionUseCase
  const { result, rerender } = renderHook(({ workId }: { workId?: string }) => useEditSuggestionInboxViewModel(workId, useCase), { initialProps: { workId: 'w1' as string | undefined }, wrapper })
  await waitFor(() => expect(result.current.items?.map((s) => s.id)).toEqual(['s1', 's9']))
  expect(inbox).toHaveBeenLastCalledWith('w1')
  rerender({ workId: 'w2' })
  await waitFor(() => expect(result.current.items?.map((s) => s.id)).toEqual(['s2']))
  expect(inbox).toHaveBeenLastCalledWith('w2')
  rerender({ workId: undefined })
  await waitFor(() => expect(inbox).toHaveBeenLastCalledWith(undefined))
})
