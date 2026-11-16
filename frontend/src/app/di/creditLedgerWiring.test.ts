// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

import { HttpCreditLedgerRepository } from '../../data/api/HttpCreditLedgerRepository'
import { InMemoryCreditLedgerRepository } from '../../data/mock/InMemoryCreditLedgerRepository'
import { createAppContainer } from './container'

afterEach(() => vi.unstubAllEnvs())

it('서버 모드는 크레딧 원장을 Core HTTP 저장소로 등록한다', () => {
  expect(createAppContainer().resolve('creditLedgerRepository')).toBeInstanceOf(HttpCreditLedgerRepository)
})

it('목업 모드는 서버를 부르지 않고 데모 크레딧 잔액만 보여 주며 지급·사용·소멸 내역은 만들지 않는다', async () => {
  vi.stubEnv('MODE', 'mockup')
  const container = createAppContainer()
  expect(container.resolve('creditLedgerRepository')).toBeInstanceOf(InMemoryCreditLedgerRepository)
  const overview = await container.resolve('creditLedgerUseCase').overview()
  expect(overview.balance).toEqual({ total: container.resolve('mockDb').credits.credits, items: [] })
  expect(overview.history).toEqual([])
})
