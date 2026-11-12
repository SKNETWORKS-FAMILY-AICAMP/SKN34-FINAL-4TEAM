import { describe, expect, it, vi } from 'vitest'

import type { WithdrawalRepository } from '../repositories/WithdrawalRepository'
import { WithdrawalInputError, WithdrawalUseCase } from '../usecases/WithdrawalUseCase'

const repo = () => ({
  status: vi.fn(async () => ({ status: 'NONE' as const })),
  request: vi.fn(async () => ({ status: 'PENDING' as const, requestedAt: 'a', dueAt: 'b' })),
  restore: vi.fn(async () => {}),
}) satisfies WithdrawalRepository

describe('WithdrawalUseCase', () => {
  it('사유는 앞뒤 공백을 지우고 비어 있으면 보내지 않는다', async () => {
    const r = repo()
    const useCase = new WithdrawalUseCase(r)
    await useCase.request('pw', '  더 이상 쓰지 않아요 ')
    await useCase.request('pw', '   ')
    expect(r.request.mock.calls).toEqual([['pw', '더 이상 쓰지 않아요'], ['pw', null]])
  })

  it('비어 있거나 공백뿐인 비밀번호와 300자를 넘는 사유는 서버에 보내지 않는다', async () => {
    const r = repo()
    const useCase = new WithdrawalUseCase(r)
    await expect(useCase.request('', '')).rejects.toBeInstanceOf(WithdrawalInputError)
    await expect(useCase.request('   ', '')).rejects.toBeInstanceOf(WithdrawalInputError)
    await expect(useCase.request('pw', 'x'.repeat(301))).rejects.toThrow('300자')
    await useCase.request('pw', ` ${'x'.repeat(300)} `)
    expect(r.request).toHaveBeenCalledTimes(1)
  })
})
