import type { JobRun, JobRunPage, JobRunQuery, Schedule, ScheduleInput } from '../../domain/entities/jobMonitor'
import type {
  Evaluation, EvaluationInput, LeakCheck, LlmOpsSettings, Metrics, MetricsQuery, Model, ModelInput, Prompt, PromptVersionInput, TraceDetail, TraceItem, TraceQuery,
} from '../../domain/entities/llmOps'
import { OperationsError, OperationsRejected, type OperationsPage } from '../../domain/entities/operations'
import type { Alert, AlertRule, AlertRuleInput, AlertStatus } from '../../domain/entities/operationsAlert'
import type { Dashboard } from '../../domain/entities/operationsDashboard'
import type { JobMonitorRepository } from '../../domain/repositories/JobMonitorRepository'
import type { LlmOpsRepository } from '../../domain/repositories/LlmOpsRepository'
import type { OperationsDashboardRepository } from '../../domain/repositories/OperationsDashboardRepository'

/**
 * 서버 없는 시연(`--mode mockup`)·렌더 테스트용 운영 LLMOps 대역입니다. 값은 예시이고 새로 고치면 처음으로 돌아갑니다.
 * Langfuse·AI·Content를 읽지 않으며, production 승격은 서버처럼 최신 평가가 통과한 버전만 받습니다.
 */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const NOT_FOUND = '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'
const found = <T>(row: T | undefined): T => { if (!row) throw new OperationsError(NOT_FOUND); return row }
const paged = <T>(rows: T[], page: number, size = 20): OperationsPage<T> => ({ items: rows.slice(page * size, (page + 1) * size), page, size, total: rows.length, unavailable: [] })
const summary = (requests: number, failed: number, timeouts: number) => ({ requests, failed, timeouts, failureRate: requests ? failed / requests : null, costUser: 0, costPlatform: requests * 0.0021 })

export class InMemoryOperationsDashboardRepository implements OperationsDashboardRepository {
  private readonly rows: Alert[] = [
    { id: 'alert-1', ruleKey: 'ai_failure_rate', status: 'open', message: '최근 60분 AI 실패율 32%가 기준 20%를 넘었어요.', value: 0.32, targetRef: null, createdAt: ago(25) },
    { id: 'alert-2', ruleKey: 'job_failed', status: 'open', message: '회차 원고 전처리 작업이 실패했어요.', value: null, targetRef: 'job-failed-1', createdAt: ago(90) },
    { id: 'alert-3', ruleKey: 'leak_suspected', status: 'resolved', message: '비공개 카드 제목이 Fork 작품의 답변에 그대로 나왔어요.', value: null, targetRef: 'work-demo', createdAt: ago(1800), actedAt: ago(1700), note: '프롬프트 수정 뒤 재확인' },
  ]

  async dashboard(): Promise<Dashboard> {
    return {
      members: { total: 1284, joinedLast7Days: 37, withdrawalPending: 3 },
      ai: { today: summary(48, 5, 1), last7Days: summary(412, 21, 4) },
      jobs: { running: 1, failedLast24h: 1 },
      pending: { inquiries: 3, reports: 2, authorReviews: 5 },
      openAlerts: this.rows.filter((row) => row.status === 'open').length,
      unavailable: [],
    }
  }
  async alerts(status: AlertStatus | null) { return structuredClone(this.rows.filter((row) => !status || row.status === status)) }
  async updateAlert(id: string, status: 'acknowledged' | 'resolved', note: string) {
    Object.assign(found(this.rows.find((row) => row.id === id)), { status, note: note || null, actedAt: new Date().toISOString() })
  }
}

const trace = (id: string, feature: string, status: string, minutes: number, latencyMs: number, cost: number): TraceItem => ({
  id, timestamp: ago(minutes), feature, status, latencyMs, inputTokens: 1200, outputTokens: 340, cost, userId: 'demo-member', workId: 'demo-work',
})

export class InMemoryLlmOpsRepository implements LlmOpsRepository {
  private readonly traceRows = [
    trace('trace-1', 'qa', 'success', 5, 1840, 0.0042), trace('trace-2', 'writing', 'failed', 40, 920, 0.0011),
    trace('trace-3', 'manuscript_review', 'timeout', 95, 30000, 0.0087), trace('trace-4', 'qa', 'success', 180, 1620, 0.0039),
  ]
  private readonly prompts_: Prompt[] = [
    { name: 'qa-answer', versions: [
      { version: 3, labels: [], createdAt: ago(300), evaluation: { runId: 'run-2', passed: false, createdAt: ago(240) } },
      { version: 2, labels: ['production'], createdAt: ago(4000), evaluation: { runId: 'run-1', passed: true, createdAt: ago(3900) } },
      { version: 1, labels: [], createdAt: ago(9000) },
    ] },
    { name: 'writing-assist', versions: [{ version: 1, labels: ['production'], createdAt: ago(9000) }] },
  ]
  private readonly modelRows: Model[] = [
    { id: 'model-1', modelName: 'gpt-demo', matchPattern: '(?i)^gpt-demo$', inputPrice: 0.0000025, outputPrice: 0.00001 },
    { id: 'model-2', modelName: 'embed-demo', matchPattern: '(?i)^embed-demo$', inputPrice: 0.0000001, outputPrice: 0 },
  ]
  private readonly evaluationRows: Evaluation[] = [
    { runId: 'run-2', dataset: 'qa-regression', prompt: 'qa-answer', version: 3, status: 'completed', passed: false, createdAt: ago(240), metrics: [
      { name: 'faithfulness', score: 0.78, baseline: 0.9, delta: -0.12 }, { name: 'answer_relevancy', score: 0.91, baseline: 0.89, delta: 0.02 }] },
    { runId: 'run-1', dataset: 'qa-regression', prompt: 'qa-answer', version: 2, status: 'completed', passed: true, createdAt: ago(3900), metrics: [
      { name: 'faithfulness', score: 0.9, baseline: null, delta: null }, { name: 'answer_relevancy', score: 0.89, baseline: null, delta: null }] },
  ]
  private readonly leakRows: LeakCheck[] = [
    { id: 'leak-1', traceId: 'trace-1', workId: 'demo-work', checkedAt: ago(60), matched: ['세계수의 비밀'], suspected: true, reason: '비공개 카드 제목이 답변에 그대로 나왔어요.' },
    { id: 'leak-2', traceId: 'trace-4', workId: 'demo-work', checkedAt: ago(200), matched: [], suspected: false },
  ]
  private readonly ruleRows: AlertRule[] = ['ai_failure_rate', 'ai_timeout_rate', 'ai_daily_cost_usd', 'ai_p95_latency_ms', 'job_failed', 'leak_suspected']
    .map((key) => ({ key, metric: key, threshold: null, windowMinutes: 60, enabled: false, updatedAt: ago(9000) }))
  private setting: LlmOpsSettings = { leakSampleRate: 0.1 }

  async traces(query: TraceQuery) {
    const rows = this.traceRows.filter((row) => (!query.feature || row.feature === query.feature) && (!query.status || row.status === query.status)
      && (!query.userId || row.userId === query.userId) && (!query.requestId || query.requestId === `req-${row.id}`))
    return paged(rows, query.page)
  }
  async trace(id: string): Promise<TraceDetail> {
    const row = found(this.traceRows.find((item) => item.id === id))
    const failed = row.status !== 'success'
    return {
      ...row, input: { question: '세계수의 비밀은 무엇인가요?' }, output: failed ? null : '아직 공개되지 않은 설정이라 말씀드릴 수 없어요.',
      observations: [
        { id: `${id}-1`, name: 'retrieve', type: 'SPAN', startTime: row.timestamp, endTime: row.timestamp, latencyMs: 210, level: 'DEFAULT' },
        { id: `${id}-2`, name: 'generate', type: 'GENERATION', startTime: row.timestamp, endTime: row.timestamp, latencyMs: row.latencyMs, model: 'gpt-demo', inputTokens: 1200, outputTokens: 340, level: failed ? 'ERROR' : 'DEFAULT', statusMessage: failed ? '모델 응답 실패(예시)' : null, promptName: 'qa-answer', promptVersion: 2 },
      ],
    }
  }
  async metrics({ groupBy }: MetricsQuery): Promise<Metrics> {
    const keys = groupBy === 'day' ? [0, 1, 2].map((d) => ago(d * 1440).slice(0, 10)) : groupBy === 'feature' ? ['qa', 'writing', 'manuscript_review'] : ['gpt-demo', 'embed-demo']
    return {
      rows: keys.map((key, i) => ({ key, requests: 120 - i * 30, failureRate: 0.04 + i * 0.02, timeoutRate: i * 0.01, p50LatencyMs: 1500, p95LatencyMs: 4200 + i * 900, inputTokens: 150000 - i * 20000, outputTokens: 42000 - i * 6000, costUser: 0, costPlatform: 0.31 - i * 0.07 })),
      adoptionRate: 0.42, approvalRate: 0.67, filterRestoreRate: null,
    }
  }
  async prompts() { return structuredClone(this.prompts_.map(({ name }) => ({ name, versions: [] }))) }
  async prompt(name: string) { return structuredClone(found(this.prompts_.find((p) => p.name === name))) }
  async createPromptVersion(name: string, _input: PromptVersionInput) {
    const p = found(this.prompts_.find((item) => item.name === name))
    p.versions.unshift({ version: Math.max(...p.versions.map((v) => v.version)) + 1, labels: [], createdAt: new Date().toISOString() })
  }
  async promote(name: string, version: number) {
    const p = found(this.prompts_.find((item) => item.name === name)), target = found(p.versions.find((v) => v.version === version))
    if (target.evaluation?.passed !== true) throw new OperationsRejected('이 버전은 최신 회귀 평가를 통과해야 production으로 올릴 수 있어요.')
    for (const v of p.versions) v.labels = v === target ? ['production'] : v.labels.filter((label) => label !== 'production')
  }
  async models() { return structuredClone(this.modelRows) }
  async createModel(input: ModelInput) { this.modelRows.push({ id: `model-${this.modelRows.length + 1}`, ...input }) }
  async evaluations() { return structuredClone(this.evaluationRows.map((row) => ({ ...row, metrics: [] }))) }
  async evaluation(runId: string) { return structuredClone(found(this.evaluationRows.find((row) => row.runId === runId))) }
  async runEvaluation(input: EvaluationInput) {
    found(this.prompts_.find((p) => p.name === input.prompt)?.versions.find((v) => v.version === input.version))
    this.evaluationRows.unshift({ runId: `run-${this.evaluationRows.length + 1}`, ...input, status: 'running', passed: null, createdAt: new Date().toISOString(), metrics: [] })
  }
  async leakChecks() { return structuredClone(this.leakRows) }
  async alertRules() { return structuredClone(this.ruleRows) }
  async updateAlertRule(key: string, input: AlertRuleInput) { Object.assign(found(this.ruleRows.find((rule) => rule.key === key)), input, { updatedAt: new Date().toISOString() }) }
  async settings() { return { ...this.setting } }
  async updateSettings(settings: LlmOpsSettings) { this.setting = { ...settings } }
}

export class InMemoryJobMonitorRepository implements JobMonitorRepository {
  private readonly runRows: JobRun[] = [
    { id: 'run-a', kind: 'llm_alert_check', source: 'operations-scheduler', status: 'succeeded', trigger: 'schedule', startedAt: ago(3), finishedAt: ago(2) },
    { id: 'run-b', kind: 'regression_eval', source: 'operations-scheduler', status: 'running', trigger: 'manual', startedAt: ago(8), progress: { done: 12, total: 40 } },
    { id: 'job-failed-1', kind: 'manuscript_preprocessing', source: 'content-preprocessing', status: 'failed', trigger: 'user', startedAt: ago(120), finishedAt: ago(100), progress: { done: 38, total: 100 }, error: '39화 전처리 중 AI 요청이 시간 초과됐어요.', targetId: 'demo-work' },
    { id: 'run-c', kind: 'alert_cleanup', source: 'operations-scheduler', status: 'succeeded', trigger: 'schedule', startedAt: ago(1440), finishedAt: ago(1439) },
  ]
  private readonly scheduleRows: Schedule[] = [
    { id: 'schedule-1', kind: 'llm_alert_check', cron: '0 */5 * * * *', enabled: true, params: {}, createdAt: ago(9000), updatedAt: ago(9000), lastRun: this.runRows[0] },
    { id: 'schedule-2', kind: 'alert_cleanup', cron: '0 0 4 * * *', enabled: true, params: { retentionDays: 90 }, createdAt: ago(9000), updatedAt: ago(9000), lastRun: this.runRows[3] },
  ]

  async runs(query: JobRunQuery): Promise<JobRunPage> {
    return paged(structuredClone(this.runRows.filter((row) => (!query.status || row.status === query.status) && (!query.kind || row.kind === query.kind))), query.page)
  }
  async retry(id: string) {
    const row = found(this.runRows.find((item) => item.id === id))
    if (row.status !== 'failed') throw new OperationsRejected('실패한 작업만 다시 실행할 수 있어요.')
    Object.assign(row, { status: 'queued', error: null, finishedAt: null, trigger: 'manual' })
  }
  async schedules() { return structuredClone(this.scheduleRows) }
  async createSchedule(input: ScheduleInput) {
    const now = new Date().toISOString()
    this.scheduleRows.push({ id: `schedule-${this.scheduleRows.length + 1}`, ...input, createdAt: now, updatedAt: now })
  }
  async updateSchedule(id: string, input: Pick<ScheduleInput, 'cron' | 'enabled' | 'params'>) { Object.assign(found(this.scheduleRows.find((row) => row.id === id)), input, { updatedAt: new Date().toISOString() }) }
  async cancelSchedule(id: string) { Object.assign(found(this.scheduleRows.find((row) => row.id === id)), { enabled: false, updatedAt: new Date().toISOString() }) }
}
