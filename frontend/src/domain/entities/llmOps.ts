/**
 * LLMOps 화면 값(DEC-55). 정본은 Langfuse이고 운영 서비스가 중계합니다.
 * 비어 올 수 있는 값은 `?: T | null`이며, 화면은 비어 있음을 0으로 바꾸지 않습니다.
 */
export type TraceItem = {
  id: string; timestamp: string; feature: string
  /** success | failed | timeout. 새 값이 생겨도 받을 수 있게 문자열로 둡니다. */
  status: string
  latencyMs?: number | null; inputTokens?: number | null; outputTokens?: number | null; cost?: number | null
  userId?: string | null; workId?: string | null
}
export type Observation = {
  id: string; name: string; type: string; startTime: string; endTime?: string | null; latencyMs?: number | null
  model?: string | null; inputTokens?: number | null; outputTokens?: number | null; level: string
  statusMessage?: string | null; promptName?: string | null; promptVersion?: number | null
}
export type TraceDetail = TraceItem & { input?: unknown; output?: unknown; observations: Observation[] }
/** 비어 있는 값(전체)은 서버에 보내지 않습니다. from·to는 UTC ISO 시각, page는 0부터입니다. */
export type TraceQuery = { from: string; to: string; feature: string; status: string; userId: string; requestId: string; page: number }

export type MetricRow = {
  key: string; requests: number; failureRate?: number | null; timeoutRate?: number | null
  p50LatencyMs?: number | null; p95LatencyMs?: number | null; inputTokens: number; outputTokens: number; costUser: number; costPlatform: number
}
/** 비율은 0~1이고 데이터가 없으면 null입니다(필터 복원률은 필터 기능이 생기기 전까지 비어 있습니다). */
export type Metrics = { rows: MetricRow[]; adoptionRate?: number | null; approvalRate?: number | null; filterRestoreRate?: number | null }
export type MetricsGroup = 'day' | 'feature' | 'model'
export type MetricsQuery = { from: string; to: string; groupBy: MetricsGroup }
export const METRICS_GROUPS: [MetricsGroup, string][] = [['day', '날짜'], ['feature', '기능'], ['model', '모델']]

export type PromptVersion = { version: number; labels: string[]; createdAt: string; evaluation?: { runId: string; passed?: boolean | null; createdAt: string } | null }
export type Prompt = { name: string; versions: PromptVersion[] }
/** 새 버전은 라벨 없이 등록되며, production 라벨 이동은 승격으로 따로 합니다. */
export type PromptVersionInput = { prompt: string; commitMessage: string }

/** 가격은 토큰당 USD입니다. */
export type Model = { id: string; modelName: string; matchPattern: string; inputPrice?: number | null; outputPrice?: number | null; unit?: string | null }
export type ModelInput = { modelName: string; matchPattern: string; inputPrice: number; outputPrice: number }

export type EvaluationMetric = { name: string; score: number; baseline?: number | null; delta?: number | null }
export type Evaluation = {
  runId: string; dataset: string; prompt: string; version: number
  /** running | completed | failed */
  status: string
  passed?: boolean | null; createdAt: string; metrics: EvaluationMetric[]
}
export type EvaluationInput = { dataset: string; prompt: string; version: number }

export type LeakCheck = { id: string; traceId: string; workId: string; checkedAt: string; matched: string[]; suspected: boolean; reason?: string | null }
export type LlmOpsSettings = { leakSampleRate: number }

const TRACE_STATUSES = new Map([['success', '성공'], ['failed', '실패'], ['timeout', '시간 초과']])
export const TRACE_STATUS_OPTIONS = [...TRACE_STATUSES]
const EVALUATION_STATUSES = new Map([['running', '실행 중'], ['completed', '완료'], ['failed', '실패']])
// Map이라 'toString' 같은 객체 기본 속성 이름이 라벨 대신 함수로 새지 않습니다.
export const traceStatusLabel = (status: string) => TRACE_STATUSES.get(status) ?? status
export const evaluationStatusLabel = (status: string) => EVALUATION_STATUSES.get(status) ?? status
/** 평가 통과 여부: 아직 결과가 없으면(실행 중) 대시입니다. */
export const passedLabel = (passed: boolean | null | undefined) => (passed == null ? '—' : passed ? '통과' : '미통과')

/** 조회 기간 선택지(시간). 지금부터 거꾸로 센 구간으로 보냅니다. */
export const PERIODS: [number, string][] = [[24, '최근 24시간'], [24 * 7, '최근 7일'], [24 * 30, '최근 30일']]
export const periodRange = (hours: number, now = new Date()) => ({ from: new Date(now.getTime() - hours * 3_600_000).toISOString(), to: now.toISOString() })

export const percent = (rate: number | null | undefined) => rate == null ? '데이터 없음' : `${(rate * 100).toFixed(1).replace(/\.0$/, '')}%`
export const usd = (value: number | null | undefined) => value == null ? '—' : `$${value.toFixed(4)}`
export const count = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('ko-KR')
export const millis = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value).toLocaleString('ko-KR')}ms`
/** 토큰당 USD를 사람이 읽는 100만 토큰당 USD로 바꿉니다(모델 단가 표시·입력 단위). */
export const perMillion = (price: number | null | undefined) => price == null ? '—' : `$${(price * 1_000_000).toFixed(2)}`

/** 추적 입력·출력 본문: 문자열은 그대로, 그 밖은 들여쓴 JSON입니다. */
export const bodyText = (value: unknown) => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)

/** 승격 버튼 이름: production보다 새 버전은 승격, 오래된 버전은 이전 버전 복원, production 자신은 null입니다. */
export function promoteLabel(versions: PromptVersion[], version: PromptVersion): '승격' | '복원' | null {
  if (version.labels.includes('production')) return null
  const live = versions.find((v) => v.labels.includes('production'))
  return live && version.version < live.version ? '복원' : '승격'
}
