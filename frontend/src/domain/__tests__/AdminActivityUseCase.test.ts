import { describe, expect, it } from 'vitest'

import type { AdminActivity } from '../entities/adminActivity'
import { OperationsError, OperationsForbidden } from '../entities/operations'
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

  it('권한이 없으면(403) 실패가 아니라 null을 돌려줘 화면이 권한 안내를 보이게 한다', async () => {
    const repository: AdminActivityRepository = { list: async () => { throw new OperationsForbidden('이 작업을 할 권한이 없어요.') } }
    expect(await new AdminActivityUseCase(repository).list()).toBeNull()
  })

  it('그 밖의 실패는 null로 바꾸지 않고 그대로 던져 다시 불러오게 한다', async () => {
    const generic = new OperationsError('연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.')
    await expect(new AdminActivityUseCase({ list: async () => { throw generic } }).list()).rejects.toBe(generic)
    const unexpected = new Error('네트워크 오류')
    await expect(new AdminActivityUseCase({ list: async () => { throw unexpected } }).list()).rejects.toBe(unexpected)
  })
})
