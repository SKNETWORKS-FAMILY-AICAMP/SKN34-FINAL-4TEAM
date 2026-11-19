/** 운영 경고(DEC-55). 규칙은 관리자가 화면에서 정하며, 초기 시드는 꺼진 상태입니다. */
export type AlertStatus = 'open' | 'acknowledged' | 'resolved'
export const ALERT_STATUSES: [AlertStatus, string][] = [['open', '미확인'], ['acknowledged', '확인함'], ['resolved', '조치 완료']]
export type Alert = {
  id: string; ruleKey: string; status: string; message: string; value?: number | null; targetRef?: string | null; createdAt: string
  actedAt?: string | null; note?: string | null
}
export type AlertRule = { key: string; metric: string; threshold?: number | null; windowMinutes: number; enabled: boolean; updatedAt: string }
export type AlertRuleInput = { threshold: number | null; windowMinutes: number; enabled: boolean }

const RULES = new Map([
  ['ai_failure_rate', 'AI 실패율'], ['ai_timeout_rate', 'AI 시간 초과율'], ['ai_daily_cost_usd', 'AI 일 비용(USD)'],
  ['ai_p95_latency_ms', 'AI p95 지연(ms)'], ['job_failed', '작업 실패'], ['leak_suspected', '정보 누설 의심'],
])
export const alertRuleLabel = (key: string) => RULES.get(key) ?? key
export const alertStatusLabel = (status: string) => ALERT_STATUSES.find(([value]) => value === status)?.[1] ?? status

/** 경고 조회·처리는 `llm` 또는 `jobs` 권한이 있어야 합니다. 403이면 다시 시도 대신 이 안내를 보입니다. */
export const ALERT_FORBIDDEN = "경고를 보려면 'LLM Ops 조회' 또는 '정기 작업' 권한이 필요해요."
