// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useServerWorks } from './useServerWorks'

afterEach(cleanup)
it('권한 오류를 숨기지 않고 사용자가 재조회할 때만 목록을 다시 요청한다', async () => {
  const api = { list: vi.fn().mockRejectedValueOnce(new Error('접근 권한이 없어요')).mockResolvedValueOnce([]) }
  const { result } = renderHook(() => useServerWorks(api))
  await act(async () => {})
  expect(result.current.error).toBe('접근 권한이 없어요')
  expect(result.current.works).toEqual([])
  act(() => result.current.reload())
  await act(async () => {})
  expect(api.list).toHaveBeenCalledTimes(2)
  expect(result.current.error).toBe('')
  expect(result.current.loading).toBe(false)
})

it('해제 후 늦게 도착한 응답을 취소된 요청으로 구분한다', async () => {
  const api = { list: vi.fn().mockResolvedValue([]) }
  const { unmount } = renderHook(() => useServerWorks(api))
  const signal = api.list.mock.calls[0][0] as AbortSignal
  unmount()
  expect(signal.aborted).toBe(true)
})
