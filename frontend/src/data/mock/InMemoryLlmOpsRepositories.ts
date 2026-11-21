import type { JobRun, JobRunPage, JobRunQuery, Schedule, ScheduleInput } from '../../domain/entities/jobMonitor'
import { EVALUATION_REQUIRED_MESSAGE } from '../../domain/entities/llmOps'
import type {
  Evaluation, EvaluationInput, LeakCheck, LlmOpsSettings, Metrics, MetricsQuery, Model, ModelInput, Prompt, PromptVersionInput, TraceDetail, TraceItem, TraceQuery,
} from '../../domain/entities/llmOps'
import type { PipelineNode, PipelineRecord, PipelineRecordQuery } from '../../domain/entities/llmOpsPipeline'
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
      // 서비스 지표 예시(시연 데이터): 비율과 오차를 보이도록 단계마다 수가 줄어드는 값입니다.
      funnel: {
        readers: { viewed: 300, readAny: 180, readNext: 72 },
        reactions: { publishedEpisodes: 46, likes: 214, interests: 97, comments: 38 },
        forks: {
          readers: 180, readerForked: 21,
          baseEpisodes: [{ bucket: '1', count: 9 }, { bucket: '2', count: 6 }, { bucket: '3', count: 4 }, { bucket: '4-5', count: 3 }, { bucket: '6-10', count: 2 }, { bucket: '11+', count: 1 }],
        },
        writers: { forks: 25, saved: 17, published: 8, medianHoursToPublish: 31.5 },
        proposals: { adopted: 64, total: 210 },
        feedback: { approved: 11, decided: 19 },
      },
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

const flowNode = (id: string, label: string, next: string[], count: number, errors = 0, p95LatencyMs: number | null = null, promptNames: string[] = []): PipelineNode => ({ id, label, next, standalone: false, count, errors, p95LatencyMs, promptNames })
/** 서버 고정 목록(DEC-58)과 같은 노드 id. 건수·오류 수는 예시입니다. */
const PIPELINE: PipelineNode[] = [
  flowNode('request', '집필 AI 요청', ['guard'], 52, 0, 6200),
  flowNode('guard', 'Decision Guard', ['main'], 104, 1, 820, ['decision_guard.judge']),
  flowNode('main', '메인 에이전트', ['qa', 'writing', 'manuscript_review', 'world', 'research', 'rating', 'character_simulation', 'mcp'], 71, 1, 5400, ['main-agent']),
  flowNode('qa', '작품 질문', ['apply'], 30, 1, 3100, ['qa-answer']),
  flowNode('writing', '기획·집필·수정', ['apply'], 14, 0, 9800, ['writing-assist']),
  flowNode('manuscript_review', '원고 검수', ['apply'], 9, 0, 7700),
  flowNode('world', '세계관', ['apply'], 6, 0, 4200),
  flowNode('research', '고증 조사', ['apply'], 4, 0, 6100),
  flowNode('rating', '심의 등급', ['apply'], 3, 0, 2800),
  flowNode('character_simulation', '인물 시뮬레이션', ['apply'], 2, 0, 12000),
  flowNode('mcp', 'Content MCP 도구', [], 23, 1, 640),
  flowNode('apply', '작가 승인 반영', [], 11, 0, 900),
  ...([['proposals', '전개 제안'], ['initial_world', '초기 세계관 분석'], ['manuscript_extraction', '원고 설정 추출'], ['work_tags', '장르·키워드 추천'], ['world_review', '설정집 검토'], ['rating_direct', '심의 등급(단독)'], ['writing_editing', '새 원고·부분 수정']] as const)
    .map(([id, label]): PipelineNode => ({ ...flowNode(id, label, [], 5), standalone: true })),
]
const entry = (id: string, traceId: string, name: string, minutes: number, extra: Partial<PipelineRecord> = {}): PipelineRecord => ({ id, traceId, name, type: 'SPAN', startTime: ago(minutes), latencyMs: 600, level: 'DEFAULT', ...extra })
/** 노드별 기록 예시(최신순). 추적 id는 데모 추적(trace-1~4)이라 실행 흐름 보기도 열립니다. Guard의 거절은 수준이 아니라 출력의 allowed=false입니다. */
const PIPELINE_RECORDS: Record<string, PipelineRecord[]> = {
  guard: [
    entry('guard-1', 'trace-1', 'decision_guard', 5, { latencyMs: 410, input: { request: '세계수의 비밀을 알려줘' }, output: { allowed: true, reason: null, capabilities: ['qa'] } }),
    entry('guard-2', 'trace-2', 'decision_guard', 40, { latencyMs: 380, input: { request: '오늘 날씨 어때?' }, output: { allowed: false, reason: 'out_of_scope', capabilities: [] } }),
    entry('guard-3', 'trace-3', 'decision_guard', 95, { latencyMs: 30000, level: 'ERROR', statusMessage: '판정 응답 시간 초과(예시)', input: { request: '3화를 검수하고 고쳐 줘' } }),
    entry('guard-4', 'trace-1', 'decision_guard.generation', 5, { type: 'GENERATION', model: 'gpt-demo', promptName: 'decision_guard.judge', promptVersion: 1, latencyMs: 395, input: [{ role: 'user', content: '세계수의 비밀을 알려줘' }], output: { answers: [{ name: 'guard', choice: 'in_scope' }] } }),
  ],
  main: [
    entry('main-1', 'trace-1', 'main_agent', 5, {
      type: 'GENERATION', model: 'gpt-demo', promptName: 'main-agent', promptVersion: 1, latencyMs: 2100, input: [{ role: 'user', content: '세계수의 비밀을 알려줘' }],
      output: { text: '스토리 Q&A로 조회할게요.', toolCalls: [{ name: 'ask_story_qa', args: { request: '세계수의 비밀' } }] },
    }),
    entry('main-2', 'trace-4', 'main_agent', 180, { type: 'GENERATION', model: 'gpt-demo', promptName: 'main-agent', promptVersion: 1, latencyMs: 1700, output: { text: '조회 결과를 정리했어요.', toolCalls: [] } }),
    // 메인이 실행하지 않고 돌려보낸 도구 호출: level은 DEFAULT이고 이름은 input, 이유는 output에 남는다.
    entry('main-3', 'trace-2', 'main_agent.blocked', 40, { input: { name: 'ask_writing' }, output: { reason: '이번 요청에서 노출되지 않은 도구예요.' } }),
    entry('main-4', 'trace-3', 'main_agent', 95, { type: 'GENERATION', model: 'gpt-demo', promptName: 'main-agent', promptVersion: 1, latencyMs: 30000, level: 'ERROR', statusMessage: '모델 응답 실패(예시)' }),
  ],
}
const recordsOf = (node: PipelineNode): PipelineRecord[] => PIPELINE_RECORDS[node.id]
  ?? [entry(`${node.id}-1`, 'trace-1', `step.${node.id}`, 8, { latencyMs: 900, input: { request: '예시 입력' }, output: '예시 출력' }), ...(node.errors ? [entry(`${node.id}-2`, 'trace-2', `step.${node.id}`, 60, { level: 'ERROR', statusMessage: '단계 실패(예시)' })] : [])]

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
    { name: 'decision_guard.judge', versions: [{ version: 1, labels: ['production'], createdAt: ago(9000) }] },
    { name: 'main-agent', versions: [{ version: 1, labels: ['production'], createdAt: ago(9000) }] },
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
        { id: `${id}-1`, name: 'retrieve', type: 'SPAN', startTime: row.timestamp, endTime: row.timestamp, latencyMs: 210, level: 'DEFAULT', input: { question: '세계수의 비밀은 무엇인가요?' }, output: { passages: 2 }, metadata: { source: 'story_context' } },
        {
          id: `${id}-2`, parentObservationId: `${id}-1`, name: 'generate', type: 'GENERATION', startTime: row.timestamp, endTime: row.timestamp, latencyMs: row.latencyMs, model: 'gpt-demo', inputTokens: 1200, outputTokens: 340,
          level: failed ? 'ERROR' : 'DEFAULT', statusMessage: failed ? '모델 응답 실패(예시)' : null, promptName: 'qa-answer', promptVersion: 2,
          input: [{ role: 'user', content: '세계수의 비밀은 무엇인가요?' }], output: failed ? null : '아직 공개되지 않은 설정이라 말씀드릴 수 없어요.', metadata: { turn: 1 },
        },
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
    if (target.evaluation?.passed !== true) throw new OperationsRejected(EVALUATION_REQUIRED_MESSAGE)
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
  async pipeline() { return structuredClone(PIPELINE) }
  /** level은 서버처럼 Langfuse 수준과 같은 기록만 남깁니다. */
  async pipelineRecords({ nodeId, level, page }: PipelineRecordQuery) {
    return structuredClone(paged(recordsOf(found(PIPELINE.find((n) => n.id === nodeId))).filter((row) => !level || row.level === level), page))
  }
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
  /** 서버처럼 전체 본문으로 교체하되 종류는 바꿀 수 없습니다. */
  async updateSchedule(id: string, { kind, ...rest }: ScheduleInput) {
    const row = found(this.scheduleRows.find((item) => item.id === id))
    if (kind !== row.kind) throw new OperationsRejected('작업 종류는 바꿀 수 없어요.')
    Object.assign(row, rest, { updatedAt: new Date().toISOString() })
  }
  async cancelSchedule(id: string) { Object.assign(found(this.scheduleRows.find((row) => row.id === id)), { enabled: false, updatedAt: new Date().toISOString() }) }
}
