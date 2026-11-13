// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../app/store'
import type { CreditBalance } from '../../../domain/entities/creditLedger'
import { useCreditBalance } from './useCreditBalance'

afterEach(cleanup)

const store = createAppStore({ role: 'user' })
const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
const balanceOf = (total: number): CreditBalance => ({ total, items: [] })
/** UseCase 대역은 콜백 밖에서 한 번만 만든다. 렌더마다 새 객체면 조회 범위가 바뀌어 계속 다시 읽는다. */
const render = (balance: (signal?: AbortSignal) => Promise<CreditBalance>) => {
  const creditLedger = { balance }
  return renderHook(() => useCreditBalance(creditLedger), { wrapper })
}

it('읽는 동안은 loading, 읽히면 보유 크레딧 합계를 돌려준다', async () => {
  let finish: (balance: CreditBalance) => void = () => {}
  const pending = new Promise<CreditBalance>((done) => { finish = done })
  const { result } = render(() => pending)
  expect(result.current).toEqual({ status: 'loading' })
  await act(async () => { finish(balanceOf(1234)) })
  expect(result.current).toEqual({ status: 'ready', total: 1234 })
})

it('읽지 못하면 failed이고 합계를 0으로 채우지 않는다', async () => {
  const { result } = render(async () => { throw new Error('offline') })
  await waitFor(() => expect(result.current).toEqual({ status: 'failed' }))
})

it('잔액이 0이면 실패가 아니라 0으로 읽힌다', async () => {
  const { result } = render(async () => balanceOf(0))
  await waitFor(() => expect(result.current).toEqual({ status: 'ready', total: 0 }))
})
