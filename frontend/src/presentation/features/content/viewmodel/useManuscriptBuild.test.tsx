// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { ManuscriptBuildRepository } from '../../../../domain/repositories/ManuscriptBuildRepository'
import { ManuscriptBuildUseCase } from '../../../../domain/usecases/ManuscriptBuildUseCase'
import { useManuscriptBuild } from './useManuscriptBuild'

afterEach(cleanup)

/** 응답하지 않는 조회 대역: 호출 횟수와 취소 신호만 본다. */
const setup = (options: { enabled?: boolean; refreshKey?: number }) => {
  const read = vi.fn<ManuscriptBuildRepository['read']>(() => new Promise(() => {}))
  const useCase = new ManuscriptBuildUseCase({ read, start: vi.fn(), resume: vi.fn() })
  const hook = renderHook((props: typeof options) => useManuscriptBuild('w', null, useCase, props), { initialProps: options })
  return { read, ...hook }
}

it('enabled가 false인 동안은 조회하지 않고, true로 바뀌면 한 번 조회한다', () => {
  const { read, rerender } = setup({ enabled: false })
  expect(read).not.toHaveBeenCalled()
  rerender({ enabled: true })
  expect(read).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledWith('w', expect.any(AbortSignal))
})

it('refreshKey가 바뀌면 진행 중이던 조회를 취소하고 다시 조회한다', () => {
  const { read, rerender } = setup({ refreshKey: 0 })
  const first = read.mock.calls[0][1]
  expect(first?.aborted).toBe(false)
  rerender({ refreshKey: 1 })
  expect(first?.aborted).toBe(true)
  expect(read).toHaveBeenCalledTimes(2)
  expect(read.mock.calls[1][1]?.aborted).toBe(false)
})
