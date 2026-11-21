import { describe, expect, it, vi } from 'vitest'

import { OperationsError, OperationsForbidden } from '../entities/operations'
import type { MemberCredits } from '../entities/operationsCredit'
import type { OperationsCreditRepository } from '../repositories/OperationsCreditRepository'
import { OperationsCreditUseCase } from '../usecases/OperationsCreditUseCase'

const overview: MemberCredits = {
  balance: { total: 120, items: [{ kind: 'reward', remaining: 120, expiresAt: '2027-01-01T00:00:00Z' }] },
  history: [{ type: 'grant', kind: 'reward', amount: 120, occurredAt: '2026-11-10T00:00:00Z' }],
}
const make = (over: Partial<OperationsCreditRepository> = {}) =>
  new OperationsCreditUseCase({ member: async () => overview, grant: async () => {}, revoke: async () => {}, ...over })

describe('OperationsCreditUseCase 회원 크레딧 조회', () => {
  it('회원의 잔액과 내역을 그대로 돌려준다', async () => {
    const member = vi.fn(async () => overview)
    expect(await make({ member }).member('m1')).toBe(overview)
    expect(member).toHaveBeenCalledWith('m1')
  })

  it('크레딧 운영 권한이 없으면(403) 실패가 아니라 null이고, 그 밖의 실패는 그대로 던진다', async () => {
    expect(await make({ member: async () => { throw new OperationsForbidden('권한 없음') } }).member('m1')).toBeNull()
    await expect(make({ member: async () => { throw new OperationsError('연결 실패') } }).member('m1')).rejects.toThrow('연결 실패')
  })
})

describe.each(['grant', 'revoke'] as const)('OperationsCreditUseCase %s', (kind) => {
  it('금액과 앞뒤 공백을 뗀 사유를 보낸다', async () => {
    const change = vi.fn(async () => {})
    await make({ [kind]: change })[kind]('m1', 500, '  이벤트 보상 \n')
    expect(change).toHaveBeenCalledWith('m1', { amount: 500, reason: '이벤트 보상' })
  })

  it('금액 1·100,000과 사유 200자 경계를 허용한다', async () => {
    const change = vi.fn(async () => {})
    await make({ [kind]: change })[kind]('m1', 1, '가'.repeat(200))
    await make({ [kind]: change })[kind]('m1', 100_000, ' 나 ')
    expect(change).toHaveBeenCalledTimes(2)
  })

  it.each([0, -5, 1.5, 100_001, Number.NaN, Number.POSITIVE_INFINITY])('금액 %s는 요청 없이 거절한다', async (amount) => {
    const change = vi.fn(async () => {})
    await expect(make({ [kind]: change })[kind]('m1', amount, '사유')).rejects.toThrow(new OperationsError('금액은 1~100,000 사이의 정수로 입력해 주세요.'))
    expect(change).not.toHaveBeenCalled()
  })

  it.each(['', '   \n ', '가'.repeat(201)])('사유 %j는 요청 없이 거절한다', async (reason) => {
    const change = vi.fn(async () => {})
    await expect(make({ [kind]: change })[kind]('m1', 10, reason)).rejects.toThrow(new OperationsError('사유는 1~200자로 입력해 주세요.'))
    expect(change).not.toHaveBeenCalled()
  })
})
