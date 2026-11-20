import { describe, expect, it, vi } from 'vitest'

import { OperationsError, OperationsForbidden } from '../entities/operations'
import type { OperationsDashboardRepository } from '../repositories/OperationsDashboardRepository'
import { OperationsDashboardUseCase } from '../usecases/OperationsDashboardUseCase'

const make = (repo: Partial<OperationsDashboardRepository>) => new OperationsDashboardUseCase(repo as OperationsDashboardRepository)

describe('운영 대시보드 경고', () => {
  it('경고 조회 권한(llm·jobs)이 없으면(403) 실패가 아니라 null이고, 그 밖의 실패는 그대로 던진다', async () => {
    expect(await make({ alerts: async () => { throw new OperationsForbidden('권한 없음') } }).alerts('open')).toBeNull()
    await expect(make({ alerts: async () => { throw new OperationsError('연결 실패') } }).alerts(null)).rejects.toThrow('연결 실패')
    const alerts = vi.fn(async () => [])
    expect(await make({ alerts }).alerts('resolved')).toEqual([])
    expect(alerts).toHaveBeenCalledWith('resolved')
  })

  it('확인·조치 완료는 상태와 다듬은 메모를 보낸다', async () => {
    const updateAlert = vi.fn(async () => {})
    await make({ updateAlert }).updateAlert('a1', 'resolved', '  재시작함 ')
    expect(updateAlert).toHaveBeenCalledWith('a1', 'resolved', '재시작함')
  })
})
