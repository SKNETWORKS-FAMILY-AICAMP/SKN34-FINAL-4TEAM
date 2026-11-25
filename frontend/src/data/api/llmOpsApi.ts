import { z } from 'zod'

import type { Dashboard } from '../../domain/entities/operationsDashboard'
import type { JobRunPage, JobRunQuery, Schedule, ScheduleInput } from '../../domain/entities/jobMonitor'
import type {
  Evaluation, EvaluationInput, LeakCheck, LlmOpsSettings, Metrics, MetricsQuery, Model, ModelInput, OptimizationInput, Prompt, PromptVersionInput, TraceDetail, TraceItem, TraceQuery,
} from '../../domain/entities/llmOps'
import { CANDIDATE_REQUIRED_MESSAGE, EVALUATION_REQUIRED_MESSAGE, OPTIMIZATION_RUNNING_MESSAGE, OPTIMIZATION_UNSUPPORTED_MESSAGE } from '../../domain/entities/llmOps'
import type { PipelineNode, PipelineQuery, PipelineRecord, PipelineRecordQuery } from '../../domain/entities/llmOpsPipeline'
import type { OperationsPage } from '../../domain/entities/operations'
import type { Alert, AlertRule, AlertRuleInput, AlertStatus } from '../../domain/entities/operationsAlert'
import type { JobMonitorRepository } from '../../domain/repositories/JobMonitorRepository'
import type { LlmOpsRepository } from '../../domain/repositories/LlmOpsRepository'
import type { OperationsDashboardRepository } from '../../domain/repositories/OperationsDashboardRepository'
import { MESSAGES, items, read, send, type ServerReason } from './operationsApi'

const instant = z.string().datetime({ offset: true })
/** 비어 올 수 있는 숫자. 비어 있음(null·생략)을 0으로 바꾸지 않습니다. */
const num = z.number().nullish()
const text = z.string().nullish()

const funnel = z.object({
  readers: z.object({ viewed: z.number(), readAny: z.number(), readNext: z.number() }),
  reactions: z.object({ publishedEpisodes: z.number(), likes: z.number(), interests: z.number(), comments: z.number() }),
  forks: z.object({ readers: z.number(), readerForked: z.number(), baseEpisodes: z.array(z.object({ bucket: z.string(), count: z.number() })) }),
  writers: z.object({ forks: z.number(), saved: z.number(), published: z.number(), medianHoursToPublish: num }),
  proposals: z.object({ adopted: z.number(), total: z.number() }),
  feedback: z.object({ approved: z.number(), decided: z.number() }),
})
const aiSummary = z.object({ requests: z.number(), failed: z.number(), timeouts: z.number(), failureRate: num, costUser: z.number(), costPlatform: z.number() })
// 출처 하나가 실패하면 그 칸만 null이고, 칸 안의 값도 비어 올 수 있습니다.
const dashboard = z.object({
  members: z.object({ total: num, joinedLast7Days: num, withdrawalPending: num }).nullish(),
  ai: z.object({ today: aiSummary, last7Days: aiSummary }).nullish(),
  jobs: z.object({ running: num, failedLast24h: num }).nullish(),
  pending: z.object({ inquiries: num, reports: num, authorReviews: num }).nullish(),
  openAlerts: num,
  funnel: funnel.nullish(),
  unavailable: z.array(z.string()).default([]),
})
const alert = z.object({
  id: z.string(), ruleKey: z.string(), status: z.string(), message: z.string(), value: num, targetRef: text, createdAt: instant,
  actedAt: instant.nullish(), note: text,
})
const alertRule = z.object({ key: z.string(), metric: z.string(), threshold: num, windowMinutes: z.number(), enabled: z.boolean(), updatedAt: instant })

/** 목록 합계는 계약의 total이고, 운영 공통 PageResponse의 totalElements로 와도 받습니다. */
const pageOf = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item), page: z.number(), size: z.number(), total: z.number().optional(), totalElements: z.number().optional(), unavailable: z.array(z.string()).default([]),
}).refine((v) => v.total !== undefined || v.totalElements !== undefined).transform(({ total, totalElements, ...rest }) => ({ ...rest, total: total ?? totalElements ?? 0 }))

const traceItem = z.object({
  id: z.string(), timestamp: instant, feature: z.string(), status: z.string(), latencyMs: num, inputTokens: num, outputTokens: num, cost: num,
  userId: text, workId: text,
})
const observation = z.object({
  id: z.string(), name: z.string(), type: z.string(), startTime: instant.nullish(), endTime: instant.nullish(), latencyMs: num, model: text, inputTokens: num, outputTokens: num,
  level: z.string(), statusMessage: text, promptName: text, promptVersion: num,
  // 실행 흐름 트리(DEC-58): 부모 단계와 단계마다 입력·출력·메타데이터(선택 값이라 생략돼도 받는다).
  parentObservationId: text, input: z.unknown().optional(), output: z.unknown().optional(), metadata: z.unknown().optional(),
})
// zod 4의 z.unknown()은 객체에서 필수 키라, 계약상 선택 값인 입력·출력이 생략돼도 받도록 optional을 붙입니다.
const traceDetail = traceItem.extend({ input: z.unknown().optional(), output: z.unknown().optional(), observations: z.array(observation) })
const metricRow = z.object({
  key: z.string(), requests: z.number(), failureRate: num, timeoutRate: num, p50LatencyMs: num, p95LatencyMs: num,
  inputTokens: z.number(), outputTokens: z.number(), costUser: z.number(), costPlatform: z.number(),
})
const metrics = z.object({ rows: z.array(metricRow), adoptionRate: num, approvalRate: num, filterRestoreRate: num })
const prompt = z.object({
  name: z.string(),
  versions: z.array(z.object({
    version: z.number(), labels: z.array(z.string()), createdAt: instant.nullish(),
    evaluation: z.object({ runId: z.string(), passed: z.boolean().nullish(), createdAt: instant }).nullish(),
    model: text, prompt: z.unknown().optional().transform((value) => (typeof value === 'string' ? value : undefined)), commitMessage: text,
  })).default([]),
  candidates: z.number().default(0), evaluationDataset: text, models: z.array(z.string()).nullish(),
})
const model = z.object({ id: z.string(), modelName: z.string(), matchPattern: z.string(), inputPrice: num, outputPrice: num })
const evaluation = z.object({
  runId: z.string(), dataset: z.string(), prompt: z.string(), version: z.number(), status: z.string(), passed: z.boolean().nullish(), createdAt: instant,
  metrics: z.array(z.object({ name: z.string(), score: z.number(), baseline: num, delta: num })).default([]),
  // 문항별 결과(#823)는 상세에만 오고 목록에는 없다.
  items: z.array(z.object({ itemId: z.string(), scores: z.record(z.string(), z.number()), failed: z.boolean(), error: text })).nullish(),
})
const leakCheck = z.object({ id: z.string(), traceId: z.string(), workId: z.string(), checkedAt: instant, matched: z.array(z.string()), suspected: z.boolean(), reason: text })
const settings = z.object({ leakSampleRate: z.number() })
// AI 파이프라인(DEC-58): 노드 모양은 서버 고정 목록의 계약 그대로이고, 기록의 입력·출력·메타데이터는 노드마다 모양이 달라 그대로 받는다.
const pipelineNode = z.object({
  id: z.string(), label: z.string(), next: z.array(z.string()), standalone: z.boolean(), count: z.number(), errors: z.number(), p95LatencyMs: num, promptNames: z.array(z.string()).default([]),
})
const pipelineNodes = z.object({ nodes: z.array(pipelineNode) }).transform((v) => v.nodes)
const pipelineRecord = z.object({
  id: z.string(), traceId: z.string(), name: z.string(), type: z.string(), startTime: instant.nullish(), latencyMs: num, level: z.string(),
  statusMessage: text, model: text, promptName: text, promptVersion: num, input: z.unknown().optional(), output: z.unknown().optional(), metadata: z.unknown().optional(),
})

const jobRun = z.object({
  id: z.string(), kind: z.string(), source: z.string(), status: z.string(), trigger: z.string(), progress: z.object({ done: z.number(), total: z.number() }).nullish(),
  startedAt: instant.nullish(), finishedAt: instant.nullish(), error: text, targetId: text,
})
const schedule = z.object({
  id: z.string(), kind: z.string(), cron: z.string(), enabled: z.boolean(), params: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  createdAt: instant, updatedAt: instant, lastRun: jobRun.nullish(),
})

/** 읽기·변경 실패 안내. 502는 Langfuse·AI·Core·Content 같은 연결 서비스 실패라 반영 여부를 단정하지 않습니다. */
const MESSAGES_UPSTREAM = { ...MESSAGES, 422: MESSAGES[400], 502: '연결된 서비스(Langfuse·AI·Core·Content)에서 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' }
const id = encodeURIComponent
/**
 * 변경 요청의 오류 안내. 서버의 영문 고정 문구("Invalid request." 등)는 상태별 한국어 안내(MESSAGES)로 바꾸고, 후보가 아닌 버전의 서비스 반영(CANDIDATE_REQUIRED)·
 * 평가 통과 전 후보 등록(EVALUATION_REQUIRED)이 막힌 409는 code로 정해진 한국어 문구를 보입니다.
 * 상위 서비스(Content 등)가 준 안내는 그대로 보입니다: code가 UPSTREAM…이거나 한글로 쓴 문구인 경우이고, 서버가 상위 서비스 거절을 일반 오류와 같은 code로 주고 문구만 바꾸기 때문에 한글 여부도 함께 봅니다.
 */
const changeReason: ServerReason = (status, { code, message }) => {
  if (code === 'CANDIDATE_REQUIRED') return CANDIDATE_REQUIRED_MESSAGE
  if (code === 'EVALUATION_REQUIRED') return EVALUATION_REQUIRED_MESSAGE
  if (code === 'OPTIMIZATION_RUNNING') return OPTIMIZATION_RUNNING_MESSAGE
  if (code === 'OPTIMIZATION_UNSUPPORTED') return OPTIMIZATION_UNSUPPORTED_MESSAGE
  return message && [400, 404, 409, 422].includes(status) && (code?.startsWith('UPSTREAM') || /[가-힣]/.test(message)) ? message : undefined
}
/** 비어 있는 조건은 서버에 보내지 않습니다. */
function withQuery(path: string, params: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)])).toString()
  return query ? `${path}?${query}` : path
}

class LlmOpsApi {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }
  protected get<T>(path: string, schema: z.ZodType<T>) { return read(this.fetcher, path, schema, [], MESSAGES_UPSTREAM) }
  /** 변경 응답은 쓰지 않고 화면이 목록을 다시 조회합니다. 오류 문구는 changeReason이 정합니다. */
  protected async change(path: string, method: string, body?: unknown) { await send(this.fetcher, path, method, body, MESSAGES_UPSTREAM, changeReason) }
}

export class HttpOperationsDashboardRepository extends LlmOpsApi implements OperationsDashboardRepository {
  dashboard(): Promise<Dashboard> { return this.get('/dashboard', dashboard) }
  alerts(status: AlertStatus | null): Promise<Alert[]> { return this.get(withQuery('/alerts', { status: status ?? '' }), items(alert)) }
  updateAlert(alertId: string, status: 'acknowledged' | 'resolved', note: string) { return this.change(`/alerts/${id(alertId)}`, 'PUT', { status, note }) }
}

export class HttpLlmOpsRepository extends LlmOpsApi implements LlmOpsRepository {
  traces({ from, to, feature, status, userId, requestId, page }: TraceQuery): Promise<OperationsPage<TraceItem>> {
    return this.get(withQuery('/llmops/traces', { from, to, feature, status, userId, requestId, page }), pageOf(traceItem))
  }
  trace(traceId: string): Promise<TraceDetail> { return this.get(`/llmops/traces/${id(traceId)}`, traceDetail) }
  metrics({ from, to, groupBy }: MetricsQuery): Promise<Metrics> { return this.get(withQuery('/llmops/metrics', { from, to, groupBy }), metrics) }
  prompts(): Promise<Prompt[]> { return this.get('/llmops/prompts', items(prompt)) }
  prompt(name: string): Promise<Prompt> { return this.get(`/llmops/prompts/${id(name)}`, prompt) }
  createPromptVersion(name: string, { prompt, commitMessage, model }: PromptVersionInput) {
    // 모델을 고르지 않은 버전은 config 없이 등록돼 AI 서비스의 환경 변수 기본 모델로 돈다(#705).
    return this.change(`/llmops/prompts/${id(name)}`, 'POST', { prompt, commitMessage, ...(model ? { config: { model } } : {}) })
  }
  candidate(name: string, version: number) { return this.change(`/llmops/prompts/${id(name)}/candidate`, 'PUT', { version }) }
  promote(name: string, version: number) { return this.change(`/llmops/prompts/${id(name)}/production`, 'PUT', { version }) }
  optimize(name: string, { version, maxMetricCalls }: OptimizationInput) { return this.change(`/llmops/prompts/${id(name)}/optimizations`, 'POST', { version, maxMetricCalls }) }
  models(): Promise<Model[]> { return this.get('/llmops/models', items(model)) }
  createModel(input: ModelInput) { return this.change('/llmops/models', 'POST', input) }
  evaluations(): Promise<Evaluation[]> { return this.get('/llmops/evaluations', items(evaluation)) }
  evaluation(runId: string): Promise<Evaluation> { return this.get(`/llmops/evaluations/${id(runId)}`, evaluation) }
  runEvaluation(input: EvaluationInput) { return this.change('/llmops/evaluations', 'POST', input) }
  leakChecks(): Promise<LeakCheck[]> { return this.get('/llmops/leak-checks', items(leakCheck)) }
  pipeline({ from, to }: PipelineQuery): Promise<PipelineNode[]> { return this.get(withQuery('/llmops/pipeline', { from, to }), pipelineNodes) }
  pipelineRecords({ nodeId, from, to, level, page }: PipelineRecordQuery): Promise<OperationsPage<PipelineRecord>> {
    return this.get(withQuery(`/llmops/pipeline/${id(nodeId)}/records`, { from, to, level, page }), pageOf(pipelineRecord))
  }
  alertRules(): Promise<AlertRule[]> { return this.get('/alerts/rules', items(alertRule)) }
  updateAlertRule(key: string, input: AlertRuleInput) { return this.change(`/alerts/rules/${id(key)}`, 'PUT', input) }
  settings(): Promise<LlmOpsSettings> { return this.get('/llmops/settings', settings) }
  updateSettings(value: LlmOpsSettings) { return this.change('/llmops/settings', 'PUT', value) }
}

export class HttpJobMonitorRepository extends LlmOpsApi implements JobMonitorRepository {
  runs({ status, kind, page }: JobRunQuery): Promise<JobRunPage> { return this.get(withQuery('/jobs/runs', { status, kind, page }), pageOf(jobRun)) }
  retry(runId: string) { return this.change(`/jobs/runs/${id(runId)}/retry`, 'POST') }
  schedules(): Promise<Schedule[]> { return this.get('/jobs/schedules', items(schedule)) }
  createSchedule(input: ScheduleInput) { return this.change('/jobs/schedules', 'POST', input) }
  updateSchedule(scheduleId: string, input: ScheduleInput) { return this.change(`/jobs/schedules/${id(scheduleId)}`, 'PUT', input) }
  cancelSchedule(scheduleId: string) { return this.change(`/jobs/schedules/${id(scheduleId)}`, 'DELETE') }
}
