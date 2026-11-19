import { z } from 'zod'

import type { Dashboard } from '../../domain/entities/operationsDashboard'
import type { JobRunPage, JobRunQuery, Schedule, ScheduleInput } from '../../domain/entities/jobMonitor'
import type {
  Evaluation, EvaluationInput, LeakCheck, LlmOpsSettings, Metrics, MetricsQuery, Model, ModelInput, Prompt, PromptVersionInput, TraceDetail, TraceItem, TraceQuery,
} from '../../domain/entities/llmOps'
import type { OperationsPage } from '../../domain/entities/operations'
import type { Alert, AlertRule, AlertRuleInput, AlertStatus } from '../../domain/entities/operationsAlert'
import type { JobMonitorRepository } from '../../domain/repositories/JobMonitorRepository'
import type { LlmOpsRepository } from '../../domain/repositories/LlmOpsRepository'
import type { OperationsDashboardRepository } from '../../domain/repositories/OperationsDashboardRepository'
import { MESSAGES, items, read, send } from './operationsApi'

const instant = z.string().datetime({ offset: true })
/** 비어 올 수 있는 숫자. 비어 있음(null·생략)을 0으로 바꾸지 않습니다. */
const num = z.number().nullish()
const text = z.string().nullish()

const aiSummary = z.object({ requests: z.number(), failed: z.number(), timeouts: z.number(), failureRate: num, costUser: z.number(), costPlatform: z.number() })
// 출처 하나가 실패하면 그 칸만 null이고, 칸 안의 값도 비어 올 수 있습니다.
const dashboard = z.object({
  members: z.object({ total: num, joinedLast7Days: num, withdrawalPending: num }).nullish(),
  ai: z.object({ today: aiSummary, last7Days: aiSummary }).nullish(),
  jobs: z.object({ running: num, failedLast24h: num }).nullish(),
  pending: z.object({ inquiries: num, reports: num, authorReviews: num }).nullish(),
  openAlerts: num,
  unavailable: z.array(z.string()).default([]),
})
const alert = z.object({
  id: z.string(), ruleKey: z.string(), status: z.string(), message: z.string(), value: num, targetRef: text, createdAt: instant,
  actedBy: text, actedAt: instant.nullish(), note: text,
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
  id: z.string(), name: z.string(), type: z.string(), startTime: instant, endTime: instant.nullish(), latencyMs: num, model: text, inputTokens: num, outputTokens: num,
  level: z.string(), statusMessage: text, promptName: text, promptVersion: num,
})
const traceDetail = traceItem.extend({ input: z.unknown(), output: z.unknown(), observations: z.array(observation) })
const metricRow = z.object({
  key: z.string(), requests: z.number(), failureRate: num, timeoutRate: num, p50LatencyMs: num, p95LatencyMs: num,
  inputTokens: z.number(), outputTokens: z.number(), costUser: z.number(), costPlatform: z.number(),
})
const metrics = z.object({ rows: z.array(metricRow), adoptionRate: num, approvalRate: num, filterRestoreRate: num })
const prompt = z.object({
  name: z.string(),
  versions: z.array(z.object({
    version: z.number(), labels: z.array(z.string()), createdAt: instant,
    evaluation: z.object({ runId: z.string(), passed: z.boolean().nullish(), createdAt: instant }).nullish(),
  })).default([]),
})
const model = z.object({ id: z.string(), modelName: z.string(), matchPattern: z.string(), inputPrice: num, outputPrice: num, unit: text })
const evaluation = z.object({
  runId: z.string(), dataset: z.string(), prompt: z.string(), version: z.number(), status: z.string(), passed: z.boolean().nullish(), createdAt: instant,
  metrics: z.array(z.object({ name: z.string(), score: z.number(), baseline: num, delta: num })).default([]),
})
const leakCheck = z.object({ id: z.string(), traceId: z.string(), workId: z.string(), checkedAt: instant, matched: z.array(z.string()), suspected: z.boolean(), reason: text })
const settings = z.object({ leakSampleRate: z.number() })

const jobRun = z.object({
  id: z.string(), kind: z.string(), source: z.string(), status: z.string(), trigger: z.string(), progress: z.object({ done: z.number(), total: z.number() }).nullish(),
  startedAt: instant.nullish(), finishedAt: instant.nullish(), error: text, targetId: text,
})
const schedule = z.object({
  id: z.string(), kind: z.string(), cron: z.string(), enabled: z.boolean(), params: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  createdAt: instant, updatedAt: instant, lastRun: jobRun.nullish(),
})

/** 읽기·변경 실패 안내. 502는 Langfuse·AI·Core·Content 같은 연결 서비스 실패라 반영 여부를 단정하지 않습니다. */
const MESSAGES_UPSTREAM = { ...MESSAGES, 502: '연결된 서비스(Langfuse·AI·Core·Content)에서 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' }
const id = encodeURIComponent
/** 비어 있는 조건은 서버에 보내지 않습니다. */
function withQuery(path: string, params: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)])).toString()
  return query ? `${path}?${query}` : path
}

class LlmOpsApi {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }
  protected get<T>(path: string, schema: z.ZodType<T>) { return read(this.fetcher, path, schema, [], MESSAGES_UPSTREAM) }
  /** 변경 응답은 쓰지 않고 화면이 목록을 다시 조회합니다. 400·404·409는 대상 상태 때문이므로 서버 문구를 그대로 보입니다. */
  protected async change(path: string, method: string, body?: unknown) { await send(this.fetcher, path, method, body, MESSAGES_UPSTREAM, [400, 404, 409]) }
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
  createPromptVersion(name: string, input: PromptVersionInput) { return this.change(`/llmops/prompts/${id(name)}`, 'POST', input) }
  promote(name: string, version: number) { return this.change(`/llmops/prompts/${id(name)}/production`, 'PUT', { version }) }
  models(): Promise<Model[]> { return this.get('/llmops/models', items(model)) }
  createModel(input: ModelInput) { return this.change('/llmops/models', 'POST', input) }
  evaluations(): Promise<Evaluation[]> { return this.get('/llmops/evaluations', items(evaluation)) }
  evaluation(runId: string): Promise<Evaluation> { return this.get(`/llmops/evaluations/${id(runId)}`, evaluation) }
  runEvaluation(input: EvaluationInput) { return this.change('/llmops/evaluations', 'POST', input) }
  leakChecks(): Promise<LeakCheck[]> { return this.get('/llmops/leak-checks', items(leakCheck)) }
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
  updateSchedule(scheduleId: string, input: Pick<ScheduleInput, 'cron' | 'enabled' | 'params'>) { return this.change(`/jobs/schedules/${id(scheduleId)}`, 'PUT', input) }
  cancelSchedule(scheduleId: string) { return this.change(`/jobs/schedules/${id(scheduleId)}`, 'DELETE') }
}
