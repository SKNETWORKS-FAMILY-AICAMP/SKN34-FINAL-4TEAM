// @vitest-environment jsdom
// 운영자는 남의 집필실을 열람만 한다(2026-11-23 사용자 결정).
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { useOperatorViewOnly } from './useOperatorViewOnly'

afterEach(cleanup)
const render = (session: Parameters<typeof createAppStore>[0], ownerOf: () => Promise<string | null>) => {
  const reading = { ownerOf: vi.fn(ownerOf) }
  const store = createAppStore(session)
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  return { reading, ...renderHook(() => useOperatorViewOnly('w', reading), { wrapper }) }
}

it('운영자가 남의 작품을 열면 열람 전용이고, 확인 중에는 안내하지 않다가 확인되면 남의 작품이라고 알린다', async () => {
  const { result, reading } = render({ role: 'admin', memberId: 'admin' }, async () => 'author')
  expect(result.current).toMatchObject({ viewOnly: true, notice: null })
  await waitFor(() => expect(reading.ownerOf).toHaveBeenCalledWith('w'))
  await waitFor(() => expect(result.current).toMatchObject({ viewOnly: true, notice: 'others' }))
})

it('운영자 본인 작품은 수정할 수 있다', async () => {
  const { result, reading } = render({ role: 'admin', memberId: 'admin' }, async () => 'admin')
  await waitFor(() => expect(reading.ownerOf).toHaveBeenCalled())
  await waitFor(() => expect(result.current).toMatchObject({ viewOnly: false, notice: null }))
})

it('소유자를 읽지 못하면 열람 전용으로 두고 실패를 알리며, 다시 시도하면 다시 확인한다', async () => {
  let offline = true
  const { result, reading } = render({ role: 'admin', memberId: 'admin' }, async () => { if (offline) throw new Error('offline'); return 'author' })
  await waitFor(() => expect(result.current).toMatchObject({ viewOnly: true, notice: 'failed' }))
  offline = false
  act(() => { result.current.retry() })
  await waitFor(() => expect(result.current).toMatchObject({ viewOnly: true, notice: 'others' }))
  expect(reading.ownerOf).toHaveBeenCalledTimes(2)
})

it('소유자를 알 수 없는 저장소(데모)는 열람 전용으로 만들지 않는다', async () => {
  const { result, reading } = render({ role: 'admin', memberId: 'admin' }, async () => null)
  await waitFor(() => expect(reading.ownerOf).toHaveBeenCalled())
  await waitFor(() => expect(result.current).toMatchObject({ viewOnly: false, notice: null }))
})

it('일반 회원은 작품을 더 읽지 않고 수정 화면을 그대로 쓴다', async () => {
  const { result, reading } = render({ role: 'user', memberId: 'me' }, async () => 'me')
  expect(result.current).toMatchObject({ viewOnly: false, notice: null })
  await act(async () => {})
  expect(reading.ownerOf).not.toHaveBeenCalled()
  expect(result.current).toMatchObject({ viewOnly: false, notice: null })
})
