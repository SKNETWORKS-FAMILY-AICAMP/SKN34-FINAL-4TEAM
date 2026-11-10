import { describe, expect, it } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import type { AdminRepository } from '../repositories/AdminRepository'
import type { WorkInterestRepository } from '../repositories/WorkInterestRepository'
import type { WorkRepository } from '../repositories/WorkRepository'
import type { WorldRepository } from '../repositories/WorldRepository'
import { AccountUseCase } from '../usecases/AccountUseCase'

const works = seedWorks(0)
const workRepository = { listWorks: async () => works } as unknown as WorkRepository
const worldRepository = { list: async () => seedWorlds() } as unknown as WorldRepository
const adminRepository = {} as AdminRepository
const interests = (ids: string[] | Error): WorkInterestRepository => ({
  list: async () => { if (ids instanceof Error) throw ids; return ids },
  add: async () => {}, remove: async () => {},
})

describe('AccountUseCase 관심 소설 (U32)', () => {
  it('서버 관심 목록 순서대로 작품을 주고, 목록에 없는 작품 ID는 건너뛴다', async () => {
    const useCase = new AccountUseCase(workRepository, worldRepository, interests(['starlight', 'gone', 'guunmong']), adminRepository)
    expect((await useCase.liked()).map((w) => w.id)).toEqual(['starlight', 'guunmong'])
  })

  it('관심 목록을 읽지 못하면 빈 목록으로 숨기지 않고 던진다', async () => {
    const useCase = new AccountUseCase(workRepository, worldRepository, interests(new Error('offline')), adminRepository)
    await expect(useCase.liked()).rejects.toThrow('offline')
  })
})
