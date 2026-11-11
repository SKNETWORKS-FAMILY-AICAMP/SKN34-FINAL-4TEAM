import { describe, expect, it, vi } from 'vitest'

import type { CreditBalance, CreditHistoryItem } from '../entities/creditLedger'
import { creditHistoryLabel, creditKindLabel } from '../entities/creditLedger'
import type { CreditLedgerRepository } from '../repositories/CreditLedgerRepository'
import { CreditLedgerUseCase } from '../usecases/CreditLedgerUseCase'

const balance: CreditBalance = { total: 40, items: [{ kind: 'reward', remaining: 10, expiresAt: '2026-12-01T00:00:00+09:00' }] }
const history: CreditHistoryItem[] = [{ type: 'grant', kind: 'reward', amount: 10, occurredAt: '2026-11-10T01:00:00Z' }]
const repo = (over: Partial<CreditLedgerRepository> = {}): CreditLedgerRepository => ({ balance: async () => balance, history: async () => history, ...over })

describe('CreditLedgerUseCase', () => {
  it('보유 크레딧과 지급·사용·소멸 내역을 함께 돌려준다', async () => {
    expect(await new CreditLedgerUseCase(repo()).overview()).toEqual({ balance, history })
  })

  it('둘 중 하나라도 읽지 못하면 일부만 보여 주지 않고 실패한다', async () => {
    await expect(new CreditLedgerUseCase(repo({ history: async () => { throw new Error('boom') } })).overview()).rejects.toThrow('boom')
    await expect(new CreditLedgerUseCase(repo({ balance: async () => { throw new Error('boom') } })).overview()).rejects.toThrow('boom')
  })

  it('취소 신호를 두 조회에 모두 전달한다', async () => {
    const balanceFn = vi.fn(async () => balance), historyFn = vi.fn(async () => history)
    const signal = new AbortController().signal
    await new CreditLedgerUseCase(repo({ balance: balanceFn, history: historyFn })).overview(signal)
    expect(balanceFn).toHaveBeenCalledWith(signal)
    expect(historyFn).toHaveBeenCalledWith(signal)
  })
})

describe('크레딧 표시 이름', () => {
  it('지급 종류 코드를 화면 이름으로 바꾸고 모르는 코드는 그대로 둔다', () => {
    expect(creditKindLabel('signup-trial')).toBe('가입 체험 크레딧')
    expect(creditKindLabel('reward')).toBe('보상 크레딧')
    expect(creditKindLabel('event')).toBe('이벤트 크레딧')
    expect(creditKindLabel('new-kind')).toBe('new-kind')
  })
  it('내역 종류를 지급·사용·소멸로 부른다', () => {
    expect(creditHistoryLabel).toEqual({ grant: '지급', spend: '사용', expire: '소멸' })
  })
})
