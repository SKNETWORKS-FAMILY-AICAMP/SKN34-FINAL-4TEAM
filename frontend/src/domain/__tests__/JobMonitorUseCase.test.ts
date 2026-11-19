import { describe, expect, it, vi } from 'vitest'

import { OperationsError } from '../entities/operations'
import type { JobMonitorRepository } from '../repositories/JobMonitorRepository'
import { JobMonitorUseCase } from '../usecases/JobMonitorUseCase'

const make = (repo: Partial<JobMonitorRepository>) => new JobMonitorUseCase(repo as JobMonitorRepository)
const rejects = (promise: Promise<unknown>, message: string) => expect(promise).rejects.toThrow(new OperationsError(message))

describe('정기 작업 일정', () => {
  it('매개변수 글을 JSON 객체로 바꿔 등록하고 비우면 빈 객체다', async () => {
    const createSchedule = vi.fn(async () => {})
    const uc = make({ createSchedule })
    await uc.createSchedule('regression_eval', ' 0 0 3 * * * ', true, '{"dataset":"qa-set","version":2}')
    await uc.createSchedule('alert_cleanup', '0 0 4 * * *', false, '  ')
    expect(createSchedule).toHaveBeenNthCalledWith(1, { kind: 'regression_eval', cron: '0 0 3 * * *', enabled: true, params: { dataset: 'qa-set', version: 2 } })
    expect(createSchedule).toHaveBeenNthCalledWith(2, { kind: 'alert_cleanup', cron: '0 0 4 * * *', enabled: false, params: {} })
  })

  it('종류·cron이 비었거나 매개변수가 JSON 객체가 아니면 보내지 않는다', async () => {
    const createSchedule = vi.fn(async () => {}), updateSchedule = vi.fn(async () => {})
    const uc = make({ createSchedule, updateSchedule })
    await rejects(uc.createSchedule('', '0 0 3 * * *', true, '{}'), '작업 종류와 cron 식을 입력해 주세요.')
    await rejects(uc.createSchedule('alert_cleanup', '  ', true, '{}'), '작업 종류와 cron 식을 입력해 주세요.')
    await rejects(uc.createSchedule('alert_cleanup', '0 0 3 * * *', true, '{깨짐'), '매개변수는 JSON 객체로 입력해 주세요. 예: {}')
    await rejects(uc.createSchedule('alert_cleanup', '0 0 3 * * *', true, '[1]'), '매개변수는 JSON 객체로 입력해 주세요. 예: {}')
    await rejects(uc.createSchedule('alert_cleanup', '0 0 3 * * *', true, 'null'), '매개변수는 JSON 객체로 입력해 주세요. 예: {}')
    await rejects(uc.updateSchedule('s1', '', true, '{}'), '작업 종류와 cron 식을 입력해 주세요.')
    await rejects(uc.updateSchedule('s1', '0 0 3 * * *', true, '3'), '매개변수는 JSON 객체로 입력해 주세요. 예: {}')
    expect(createSchedule).not.toHaveBeenCalled()
    expect(updateSchedule).not.toHaveBeenCalled()
  })

  it('변경은 종류를 바꾸지 않고 cron·사용 여부·매개변수만 보낸다', async () => {
    const updateSchedule = vi.fn(async () => {})
    await make({ updateSchedule }).updateSchedule('s1', ' 0 30 3 * * * ', false, '{"a":1}')
    expect(updateSchedule).toHaveBeenCalledWith('s1', { cron: '0 30 3 * * *', enabled: false, params: { a: 1 } })
  })
})
