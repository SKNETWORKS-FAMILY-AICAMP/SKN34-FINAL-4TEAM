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
  id: string; name: string; type: string; startTime?: string | null; endTime?: string | null; latencyMs?: number | null
  model?: string | null; inputTokens?: number | null; outputTokens?: number | null; level: string
  statusMessage?: string | null; promptName?: string | null; promptVersion?: number | null
  /** 실행 흐름 트리(DEC-58): 부모 단계와 단계마다 입력·출력·메타데이터(칸마다 앞 8,000자까지). */
  parentObservationId?: string | null; input?: unknown; output?: unknown; metadata?: unknown
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

/**
 * model은 그 버전에 고른 모델(#705, Langfuse 버전 config.model)이고 비면 AI 서비스의 환경 변수 기본 모델입니다.
 * prompt는 텍스트 본문으로 상세에서만 옵니다(목록·채팅 프롬프트는 비어 있습니다).
 */
export type PromptVersion = {
  version: number; labels: string[]; createdAt?: string | null; evaluation?: { runId: string; passed?: boolean | null; createdAt: string } | null
  model?: string | null; prompt?: string | null
}
/**
 * 목록의 versions는 production·seed 버전뿐이고(#786) 상세는 모든 버전입니다. candidates는 production이 아닌 후보 버전 수입니다.
 * evaluationDataset은 후보로 등록하려면 통과해야 하는 평가 세트이고(#787) 비면 평가 없이 후보로 등록합니다.
 */
export type Prompt = { name: string; versions: PromptVersion[]; candidates: number; evaluationDataset?: string | null }
/** 새 버전은 라벨 없이 등록되며, production 라벨 이동은 승격으로 따로 합니다. model이 비면 기본 모델 버전입니다. */
export type PromptVersionInput = { prompt: string; commitMessage: string; model: string }

/** 가격은 토큰당 USD입니다. */
export type Model = { id: string; modelName: string; matchPattern: string; inputPrice?: number | null; outputPrice?: number | null }
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

/** LLM Ops 조회 API는 `llm` 권한이 필요합니다. 403이면 다시 불러오기 대신 이 안내만 보입니다. */
export const LLM_FORBIDDEN = 'LLM Ops 조회 권한이 있어야 볼 수 있어요.'

/** 후보가 아닌 버전을 서비스에 반영하려다 막힐 때(409 CANDIDATE_REQUIRED, #705) 보이는 문구. 서버의 영문 문구 대신 이 문구를 씁니다. */
export const CANDIDATE_REQUIRED_MESSAGE = '후보로 등록한 조합만 서비스에 반영할 수 있어요.'
/** 평가 세트가 있는 프롬프트를 평가 통과 전에 후보로 등록하려다 막힐 때(409 EVALUATION_REQUIRED, #787) 보이는 문구. */
export const EVALUATION_REQUIRED_MESSAGE = '이 프롬프트는 평가 세트의 회귀 평가를 통과한 버전만 후보로 등록할 수 있어요.'

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

export const productionOf = (p: Prompt) => p.versions.find((v) => v.labels.includes('production')) ?? null
/** 코드 시드(AI 서비스가 seed 라벨로 등록한 버전, #705)가 production과 다르면 그 버전. 회귀 평가를 통과하면 승격할 수 있습니다. */
export function pendingSeed(p: Prompt) {
  const seed = p.versions.find((v) => v.labels.includes('seed'))
  return seed && !seed.labels.includes('production') ? seed : null
}
/**
 * 버전에 모델을 고르지 않았을 때 AI 서비스가 쓰는 기본 모델(#705 결정: gpt-6-luna, 인물 대사만 2026-11-23 결정대로 gpt-6.1-terra).
 * shortcut: AI 서비스의 환경 변수 기본값(OPENAI_MODEL·ACT_MODEL)을 화면에 옮겨 적었다. 환경마다 기본 모델이 달라지면 운영 API가 기본값을 주게 한다.
 */
export const defaultModel = (name: string) => (name === 'character_simulation.act' ? 'gpt-6.1-terra' : 'gpt-6-luna')
export const modelLabel = (model: string | null | undefined, name: string) => model ?? `${defaultModel(name)} (기본)`
/** Decisions API(gpt-6-luna만 지원)로 부르는 프롬프트: 버전에 모델을 골라도 AI 서비스가 쓰지 않습니다. */
const FIXED_MODEL_PROMPTS = new Set(['decision_guard.judge', 'character_simulation.direct'])
export const fixedModel = (name: string) => FIXED_MODEL_PROMPTS.has(name)

/** 버전에 붙는 후보 라벨. Langfuse는 라벨을 한 버전에만 두므로 버전 번호를 넣어 후보 여럿이 함께 있을 수 있다(#705). */
const candidateOf = (version: number) => `candidate-${version}`
/** 버전 표의 조치: 서비스에 반영 중(live), 후보라 반영할 수 있음(promote), 아직 후보가 아님(candidate). */
export function versionAction(version: PromptVersion): 'live' | 'promote' | 'candidate' {
  if (version.labels.includes('production')) return 'live'
  return version.labels.includes(candidateOf(version.version)) ? 'promote' : 'candidate'
}
const LABELS = new Map<string, string | null>([['production', '서비스 반영 중'], ['seed', '코드 시드'], ['latest', null]])
/** 라벨의 화면 이름. Langfuse가 스스로 관리하는 latest는 숨기고(null) 후보 라벨은 번호 없이 '후보'로 보인다. */
export const labelText = (label: string): string | null => (/^candidate-\d+$/.test(label) ? '후보' : LABELS.has(label) ? LABELS.get(label) ?? null : label)
