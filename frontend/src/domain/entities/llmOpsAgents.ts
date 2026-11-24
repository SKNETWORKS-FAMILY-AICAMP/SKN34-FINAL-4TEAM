import { count, millis, type MetricRow } from './llmOps'

/**
 * 에이전트 지표 카드(#857, LLM Ops 에이전트 지표). 지표 API(`groupBy=feature`)의 행 하나가 카드 하나이고 기능 키는 AI 서비스가 trace마다 다는 `feature:<키>` 태그(tracing.request의 이름)입니다.
 * 지표 API에는 기능별 날짜 추이가 없어 카드의 작은 막대(처리 결과·지연)는 그 기능의 집계 행 하나로 그립니다. 같은 값은 카드 숫자로도 보이고 막대는 보조입니다.
 */
const AGENT_LABELS = new Map([
  ['orchestration', '집필 AI 채팅'], ['proposals', '전개 제안'], ['initial_world', '초기 세계관 분석'], ['manuscript_review', '원고 검수'], ['rating', '심의 등급'],
  ['web_research', '고증 조사'], ['manuscript_extraction', '원고 설정 추출'], ['world_review', '설정집 검토'], ['writing_editing', '새 원고·부분 수정'], ['work_tags', '장르·키워드 추천'],
  ['serial.episode', 'AI 자율 연재'], ['prompt_optimization', '프롬프트 자동 개선'], ['image_job_submit', '이미지 생성 요청'], ['cover_moderation', '표지 검수'],
])
/** 모르는 기능 키는 키 그대로 보입니다(Map이라 'toString' 같은 객체 기본 속성 이름이 라벨 대신 새지 않습니다). */
export const agentLabel = (key: string) => AGENT_LABELS.get(key) ?? key

export type AgentCard = {
  key: string; label: string; requests: number
  failureRate: number | null; timeoutRate: number | null; p50LatencyMs: number | null; p95LatencyMs: number | null
  inputTokens: number; outputTokens: number; costUser: number; costPlatform: number
  /** 전체 요청 중 이 기능의 비중(0~1). 요청이 하나도 없으면 0입니다. */
  share: number
  /** 처리 결과 건수: 요청 수에 실패율·시간 초과율을 곱해 반올림하고 나머지가 성공입니다. 비율을 하나라도 모르면 null(막대를 그리지 않음). */
  outcome: { success: number; failed: number; timeout: number } | null
  /** 지연 막대 위치(0~1): 카드들 중 가장 느린 p95를 1로 본 p50·p95입니다. 하나라도 모르면 null. */
  latency: { p50: number; p95: number } | null
}

/** 지표 행(기능별)을 카드로 바꿉니다. 요청이 많은 순(같으면 키순)이고, 비어 온 값은 0이 아니라 null로 둡니다. */
export function agentCards(rows: MetricRow[]): AgentCard[] {
  const total = rows.reduce((sum, row) => sum + row.requests, 0)
  const slowest = Math.max(0, ...rows.map((row) => row.p95LatencyMs ?? 0))
  const at = (ms: number) => (slowest > 0 ? ms / slowest : 0)
  return [...rows].sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key)).map((row) => {
    const failureRate = row.failureRate ?? null, timeoutRate = row.timeoutRate ?? null, p50 = row.p50LatencyMs ?? null, p95 = row.p95LatencyMs ?? null
    const failed = failureRate === null ? null : Math.round(row.requests * failureRate), timeout = timeoutRate === null ? null : Math.round(row.requests * timeoutRate)
    return {
      key: row.key, label: agentLabel(row.key), requests: row.requests, failureRate, timeoutRate, p50LatencyMs: p50, p95LatencyMs: p95,
      inputTokens: row.inputTokens, outputTokens: row.outputTokens, costUser: row.costUser, costPlatform: row.costPlatform,
      share: total > 0 ? row.requests / total : 0,
      outcome: failed === null || timeout === null ? null : { success: Math.max(0, row.requests - failed - timeout), failed, timeout },
      latency: p50 === null || p95 === null ? null : { p50: at(p50), p95: at(p95) },
    }
  })
}

// 카드 안 작은 막대를 말로 옮긴 요약(role="img"의 aria-label). 같은 값이 카드 숫자에 있습니다.
export const outcomeSummary = ({ outcome }: Pick<AgentCard, 'outcome'>) =>
  `처리 결과: ${outcome ? `성공 ${count(outcome.success)}건, 실패 ${count(outcome.failed)}건, 시간 초과 ${count(outcome.timeout)}건` : '데이터 없음'}`
export const latencyBarSummary = ({ latency, p50LatencyMs, p95LatencyMs }: Pick<AgentCard, 'latency' | 'p50LatencyMs' | 'p95LatencyMs'>) =>
  `지연: ${latency ? `p50 ${millis(p50LatencyMs)}, p95 ${millis(p95LatencyMs)}` : '데이터 없음'}`
