import { describe, expect, it } from 'vitest'

import type { AdminActivity } from '../entities/adminActivity'
import type { AdminActivityRepository } from '../repositories/AdminActivityRepository'
import { AdminActivityUseCase } from '../usecases/AdminActivityUseCase'

const row: AdminActivity = {
  id: 'a1', actorId: 'admin-1', actorNickname: '운영자', action: 'WORK_RESTRICT', targetType: 'WORK', targetId: 'w1',
  detail: '별빛 서약의 탑', createdAt: '2026-11-10T01:00:00Z',
}

describe('AdminActivityUseCase (72 관리자 활동 기록)', () => {
  it('활동 기록은 Repository가 준 순서(서버의 최신순)를 그대로 돌려준다', async () => {
    const older = { ...row, id: 'a0', createdAt: '2026-11-09T01:00:00Z' }
    let calls = 0
    const repository: AdminActivityRepository = { list: async () => { calls++; return [row, older] } }
    expect(await new AdminActivityUseCase(repository).list()).toEqual([row, older])
    expect(calls).toBe(1)
  })
})
