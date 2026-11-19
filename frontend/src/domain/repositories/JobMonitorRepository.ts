import type { JobRunPage, JobRunQuery, Schedule, ScheduleInput } from '../entities/jobMonitor'

/** 작업 감시 API 계약(DEC-55). 전처리 작업과 운영 정기 작업을 같은 실행 기록 모양으로 주며 jobs 권한이 필요합니다. */
export interface JobMonitorRepository {
  runs(query: JobRunQuery): Promise<JobRunPage>
  /** 실패한 작업의 수동 재실행 요청입니다(전처리는 Content가 실패 회차만 다시 접수). */
  retry(id: string): Promise<void>
  schedules(): Promise<Schedule[]>
  createSchedule(input: ScheduleInput): Promise<void>
  /** 서버는 생성과 같은 전체 본문으로 교체하며 종류는 바꿀 수 없습니다(다르면 422). */
  updateSchedule(id: string, input: ScheduleInput): Promise<void>
  /** 취소는 삭제가 아니라 enabled=false입니다. */
  cancelSchedule(id: string): Promise<void>
}
