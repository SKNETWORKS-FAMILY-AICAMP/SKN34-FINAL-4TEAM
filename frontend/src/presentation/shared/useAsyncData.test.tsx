// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../app/store'
import { useAsyncData } from './useAsyncData'

afterEach(cleanup)
it('재조회 중 이전 성공 데이터를 유지하고 실패·재시도·복구를 구분한다 (CI 통합)', async () => {
  const store = createAppStore()
  const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(['기존 데이터']).mockRejectedValueOnce(new Error('실패')).mockResolvedValue(['새 데이터'])
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  const { result } = renderHook(() => useAsyncData(load, [load]), { wrapper })
  await waitFor(() => expect(result.current.data).toEqual(['기존 데이터']))
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.data).toEqual(['기존 데이터'])
  expect(result.current.isLoading).toBe(false)
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.data).toEqual(['새 데이터']))
  expect(result.current.isError).toBe(false)
  expect(result.current.isRefreshing).toBe(false)
})
