import type { OperationsPage } from './operations'

/** 작업 감시(DEC-55): 회차 원고 전처리와 운영 정기 작업을 같은 실행 기록 모양으로 봅니다. 출처(Airflow 등)가 바뀌어도 모양은 같습니다. */
export type JobRun = {
  id: string; kind: string
  /** operations-scheduler | content-preprocessing (| airflow) */
  source: string
  /** queued | running | succeeded | failed | cancelled */
  status: string
  /** schedule | manual | user */
  trigger: string
  progress?: { done: number; total: number } | null
  startedAt?: string | null; finishedAt?: string | null; error?: string | null; targetId?: string | null
}
/** unavailable에 전처리 출처 이름이 있으면 그 출처를 읽지 못한 것이고, 읽은 출처(운영 정기 작업)의 기록은 그대로 보입니다. */
export type JobRunPage = OperationsPage<JobRun>
/** 비어 있는 값(전체)은 서버에 보내지 않습니다. page는 0부터입니다. */
export type JobRunQuery = { status: string; kind: string; page: number }
export type Schedule = {
  id: string; kind: string; cron: string; enabled: boolean; params: Record<string, unknown>; createdAt: string; updatedAt: string; lastRun?: JobRun | null
}
export type ScheduleInput = { kind: string; cron: string; enabled: boolean; params: Record<string, unknown> }

/** 운영 스케줄러가 실행할 수 있는 작업 종류(handler가 등록된 kind만 일정으로 받습니다). */
export const JOB_KINDS: [string, string][] = [
  ['llm_alert_check', 'LLM 경고 점검'], ['leak_sample_check', '정보 누설 표본 검사'], ['regression_eval', '회귀 평가'], ['alert_cleanup', '해결 경고 정리'],
]
export const JOB_STATUSES: [string, string][] = [['queued', '대기'], ['running', '실행 중'], ['succeeded', '성공'], ['failed', '실패'], ['cancelled', '취소']]
const SOURCES = new Map([['operations-scheduler', '운영 스케줄러'], ['content-preprocessing', '원고 전처리'], ['airflow', 'Airflow']])
const TRIGGERS = new Map([['schedule', '일정'], ['manual', '수동'], ['user', '사용자 요청']])

// Map이라 'constructor' 같은 객체 기본 속성 이름이 라벨 대신 함수로 새지 않습니다.
const KINDS = new Map(JOB_KINDS), STATUSES = new Map(JOB_STATUSES)
export const jobKindLabel = (kind: string) => KINDS.get(kind) ?? kind
export const jobStatusLabel = (status: string) => STATUSES.get(status) ?? status
export const jobSourceLabel = (source: string) => SOURCES.get(source) ?? source
export const jobTriggerLabel = (trigger: string) => TRIGGERS.get(trigger) ?? trigger

/** 진행률: 전체를 모르면(0) 끝낸 수만 보입니다. */
export const jobProgress = (progress: JobRun['progress']) =>
  !progress ? '—' : progress.total > 0 ? `${progress.done}/${progress.total} (${Math.round((progress.done / progress.total) * 100)}%)` : `${progress.done}건`
