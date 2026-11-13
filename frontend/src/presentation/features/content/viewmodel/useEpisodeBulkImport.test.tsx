// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BulkImportResult } from '../../../../domain/entities/manuscript'
import { useEpisodeBulkImport } from './useEpisodeBulkImport'

afterEach(cleanup)

it('회차 조회 실패 중에는 파일 입력이 오류를 지우지 않고 다시 조회할 수 있다', async () => {
  const useCase = {
    bulkBasis: vi.fn()
      .mockRejectedValueOnce(new Error('연결 실패'))
      .mockResolvedValueOnce({ lastNumber: 4, workRevision: 9 }),
    importBulk: vi.fn(),
  }
  const { result } = renderHook(() => useEpisodeBulkImport('work', useCase))
  await waitFor(() => expect(result.current.error).toBe('연결 실패'))
  act(() => { result.current.selectFiles([new File(['원고'], '5화.txt')]) })
  expect(result.current.rows).toHaveLength(0)
  expect(result.current.error).toBe('연결 실패')
  act(() => { result.current.refreshBasis() })
  await waitFor(() => expect(result.current.editable).toBe(true))
  expect(result.current.start).toBe('5')
})

it('정렬을 바꿔 저장하고 실패 파일만 원래 번호와 마지막 revision으로 재시도한다', async () => {
  const saved: BulkImportResult = { number: 5, title: '10화', status: 'created', versionId: 'v5', reason: null }
  const failed: BulkImportResult = { number: 6, title: '2화', status: 'failed', versionId: null, reason: '읽기 실패' }
  const fixed: BulkImportResult = { number: 6, title: '2화', status: 'created', versionId: 'v6', reason: null }
  const useCase = {
    bulkBasis: vi.fn().mockResolvedValue({ lastNumber: 4, workRevision: 9 }),
    importBulk: vi.fn()
      .mockResolvedValueOnce({ workRevision: 11, results: [saved, failed], stopReason: null })
      .mockResolvedValueOnce({ workRevision: 13, results: [fixed], stopReason: null }),
  }
  const { result } = renderHook(() => useEpisodeBulkImport('work', useCase))
  await waitFor(() => expect(result.current.start).toBe('5'))
  const ten = new File(['열째'], '10화.txt')
  const two = new File(['둘째'], '2화.epub')
  act(() => { result.current.selectFiles([ten, two]) })
  expect(result.current.rows.map((row) => row.file.name)).toEqual(['2화.epub', '10화.txt'])
  act(() => { result.current.move(result.current.rows[1].id, -1) })
  act(() => { result.current.setRightsConfirmed(true) })
  await act(async () => { await result.current.submit() })
  expect(result.current.savedCount).toBe(1)
  expect(result.current.failedCount).toBe(1)

  const replacement = new File(['교체 본문'], '수정.epub')
  act(() => { result.current.replaceFailed(6, replacement) })
  act(() => { result.current.setRightsConfirmed(true) })
  await act(async () => { await result.current.retryFailed() })
  expect(useCase.importBulk.mock.calls[1].slice(1, 4)).toEqual([
    [expect.objectContaining({ number: 6, title: '2화', file: replacement })], true, 11,
  ])
  expect(result.current.savedCount).toBe(2)
  expect(result.current.canRetry).toBe(false)
})
