import type { JobRunQuery, ScheduleInput } from '../entities/jobMonitor'
import { OperationsError, orNullIfForbidden } from '../entities/operations'
import type { JobMonitorRepository } from '../repositories/JobMonitorRepository'

/** 비면 빈 객체이고, JSON 객체가 아니면(배열·null·숫자 포함) 입력 오류입니다. */
function parseParams(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  const fail = () => new OperationsError('매개변수는 JSON 객체로 입력해 주세요. 예: {}')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw fail() }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fail()
  return Object.fromEntries(Object.entries(value))
}
const required = (...values: string[]) => { if (values.some((value) => !value.trim())) throw new OperationsError('작업 종류와 cron 식을 입력해 주세요.') }
function scheduleInput(kind: string, cron: string, enabled: boolean, params: string): ScheduleInput {
  required(kind, cron)
  return { kind: kind.trim(), cron: cron.trim(), enabled, params: parseParams(params) }
}

/** 작업 감시·정기 작업 일정(DEC-55). 실행은 소유 서비스가 하고, 여기서는 감시·재실행 요청과 일정 입력만 다룹니다. */
export class JobMonitorUseCase {
  private readonly repository: JobMonitorRepository
  constructor(repository: JobMonitorRepository) { this.repository = repository }

  // 조회는 권한('정기 작업')이 없으면(403) 실패가 아니라 null이라 화면이 다시 불러오기 대신 필요한 권한을 안내합니다.
  runs(query: JobRunQuery) { return orNullIfForbidden(this.repository.runs(query)) }
  retry(id: string) { return this.repository.retry(id) }
  schedules() { return orNullIfForbidden(this.repository.schedules()) }
  cancelSchedule(id: string) { return this.repository.cancelSchedule(id) }

  async createSchedule(kind: string, cron: string, enabled: boolean, params: string) {
    return this.repository.createSchedule(scheduleInput(kind, cron, enabled, params))
  }

  /** 서버가 전체 교체로 받으므로 수정 중인 일정의 기존 종류를 함께 보냅니다(종류는 바꿀 수 없음). */
  async updateSchedule(id: string, kind: string, cron: string, enabled: boolean, params: string) {
    required(id)
    return this.repository.updateSchedule(id, scheduleInput(kind, cron, enabled, params))
  }
}
