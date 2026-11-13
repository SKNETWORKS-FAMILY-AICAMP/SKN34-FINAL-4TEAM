// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { useReportSender } from './useReportSender'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../events', () => ({ toast }))

afterEach(() => { cleanup(); toast.mockReset() })

it('성공하면 목록을 다시 읽고, 어느 제보의 결과인지와 함께 완료를 남기며 토스트 안내도 그대로 한다', async () => {
  const reload = vi.fn()
  const { result } = renderHook(() => useReportSender(reload))
  expect(result.current.notice).toBeNull()
  await act(async () => { expect(await result.current.send(async () => {}, '확인했어요', 'r1')).toBe(true) })
  expect(result.current.notice).toEqual({ key: 'r1', ok: true, msg: '확인했어요' })
  expect(result.current.busy).toBe(false)
  expect(reload).toHaveBeenCalledTimes(1)
  expect(toast).toHaveBeenCalledExactlyOnceWith('확인했어요')
})

it('실패하면 서버 문구를 그 제보의 오류로 남기고 목록은 다시 읽지 않는다', async () => {
  const reload = vi.fn()
  const { result } = renderHook(() => useReportSender(reload))
  await act(async () => { expect(await result.current.send(() => Promise.reject(new Error('작품 소유자만 할 수 있어요.')), '확인했어요', 'r1')).toBe(false) })
  expect(result.current.notice).toEqual({ key: 'r1', ok: false, msg: '작품 소유자만 할 수 있어요.' })
  expect(reload).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledExactlyOnceWith('작품 소유자만 할 수 있어요.')
})

it('새 요청을 보내면 이전 결과를 지우고, 대상 없이 보내는 기존 호출도 그대로 동작한다', async () => {
  const { result } = renderHook(() => useReportSender(() => {}))
  await act(async () => { await result.current.send(() => Promise.reject(new Error('실패')), '완료', 'r1') })
  let finish!: () => void
  let pending!: Promise<boolean>
  act(() => { pending = result.current.send(() => new Promise<void>((resolve) => { finish = resolve }), '철회했어요') })
  expect(result.current.notice).toBeNull()
  expect(result.current.busy).toBe(true)
  await act(async () => { finish(); expect(await pending).toBe(true) })
  expect(result.current.notice).toEqual({ key: undefined, ok: true, msg: '철회했어요' })
})
