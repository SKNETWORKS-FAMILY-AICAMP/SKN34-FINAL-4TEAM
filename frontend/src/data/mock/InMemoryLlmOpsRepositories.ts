import type { JobRun, JobRunPage, JobRunQuery, Schedule, ScheduleInput } from '../../domain/entities/jobMonitor'
import type { DatasetItem, EvalDataset } from '../../domain/entities/llmDatasets'
import { CANDIDATE_REQUIRED_MESSAGE, versionAction } from '../../domain/entities/llmOps'
import { AGENT_EVALUATIONS, pairedPrompt, setItems } from '../../domain/entities/llmOpsEvalTable'
import type {
  Evaluation, EvaluationInput, LeakCheck, LlmOpsSettings, MetricRow, Metrics, MetricsQuery, Model, ModelInput, OptimizationInput, Prompt, PromptVersionInput, TraceDetail, TraceItem, TraceQuery,
} from '../../domain/entities/llmOps'
import type { PipelineNode, PipelineRecord, PipelineRecordQuery } from '../../domain/entities/llmOpsPipeline'
import { PROMPT_NAMES, promptLabel } from '../../domain/entities/promptNames'
import { OperationsError, OperationsRejected, type OperationsPage } from '../../domain/entities/operations'
import type { Alert, AlertRule, AlertRuleInput, AlertStatus } from '../../domain/entities/operationsAlert'
import type { Dashboard } from '../../domain/entities/operationsDashboard'
import type { JobMonitorRepository } from '../../domain/repositories/JobMonitorRepository'
import type { LlmDatasetRepository } from '../../domain/repositories/LlmDatasetRepository'
import type { LlmOpsRepository } from '../../domain/repositories/LlmOpsRepository'
import type { OperationsDashboardRepository } from '../../domain/repositories/OperationsDashboardRepository'

/**
 * 서버 없는 시연(`--mode mockup`)·렌더 테스트용 운영 LLMOps 대역입니다. 값은 예시이고 새로 고치면 처음으로 돌아갑니다.
 * Langfuse·AI·Content를 읽지 않으며, production 승격은 서버처럼 최신 평가가 통과한 버전만 받습니다.
 */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const NOT_FOUND = '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'
const candidatesOf = (versions: Prompt['versions']) => versions.filter((v) => versionAction(v) === 'promote').length
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
/** 서버 고정 목록(DEC-58, PipelineNodes.kt)과 같은 노드 id·순서·연결. 업무 Agent는 결과를 메인에 돌려주고(되돌아가는 선) 반영은 작성 Agent 셋에서만 이어집니다. 건수·오류 수는 예시입니다. */
const PIPELINE: PipelineNode[] = [
  flowNode('request', '집필 AI 요청', ['guard'], 52, 0, 6200),
  flowNode('guard', 'Decision Guard', ['main'], 104, 1, 820, ['decision_guard.judge']),
  flowNode('main', '메인 에이전트', ['qa', 'manuscript_review', 'rating', 'research', 'writing', 'world', 'character_simulation', 'mcp'], 71, 1, 5400, ['orchestration.main']),
  flowNode('qa', '작품 질문', ['main'], 30, 1, 3100, ['story_context.answer']),
  flowNode('manuscript_review', '원고 검수', ['main'], 9, 0, 7700, ['manuscript_review.mechanical', 'manuscript_review.semantic']),
  flowNode('rating', '심의 등급', ['main'], 3, 0, 2800, ['rating.assess']),
  flowNode('research', '고증 조사', ['main'], 4, 0, 6100, ['research.pick', 'research.refer', 'web_research.search']),
  flowNode('writing', '기획·집필·수정', ['apply', 'main'], 14, 0, 9800, ['writing_editing.plan', 'writing_editing.plan_pick', 'writing_editing.plan_revise']),
  flowNode('world', '세계관', ['apply', 'main'], 6, 0, 4200, ['world_review.check', 'world_review.enrich', 'world_review.impact']),
  flowNode('character_simulation', '인물 시뮬레이션', ['apply', 'novelbrain', 'main'], 2, 0, 12000, [
    'character_simulation.act', 'character_simulation.check', 'character_simulation.direct', 'character_simulation.narrate', 'character_simulation.plan',
  ]),
  flowNode('novelbrain', 'NovelBrain 기억 회상', [], 18, 0, 410),
  flowNode('mcp', 'Content MCP 도구', [], 23, 1, 640),
  flowNode('apply', '작가 승인 반영', ['mcp'], 11, 0, 900),
  // 단독 기능도 그 기능이 쓰는 프롬프트가 연결됩니다(없는 노드는 '프롬프트 보기' 버튼이 없습니다).
  ...([
    ['proposals', '전개 제안', ['proposals.continue']], ['initial_world', '초기 세계관 분석', ['initial_world.extract']], ['manuscript_extraction', '원고 설정 추출', ['manuscript_extraction.extract', 'manuscript_extraction.resolve']],
    ['work_tags', '장르·키워드 추천', ['work_tags.suggest']], ['world_review', '설정집 검토', ['world_review.check']], ['rating_direct', '심의 등급(단독)', ['rating.assess']],
    ['writing_editing', '새 원고·부분 수정', ['writing_editing.draft', 'writing_editing.patch']],
  ] as const)
    .map(([id, label, promptNames]): PipelineNode => ({ ...flowNode(id, label, [], 5, 0, null, [...promptNames]), standalone: true })),
]
const entry = (id: string, traceId: string, name: string, minutes: number, extra: Partial<PipelineRecord> = {}): PipelineRecord => ({ id, traceId, name, type: 'SPAN', startTime: ago(minutes), latencyMs: 600, level: 'DEFAULT', ...extra })
/** 노드별 기록 예시(최신순). 추적 id는 데모 추적(trace-1~4)이라 실행 흐름 보기도 열립니다. Guard의 거절은 수준이 아니라 출력의 allowed=false입니다. */
const PIPELINE_RECORDS: Record<string, PipelineRecord[]> = {
  guard: [
    entry('guard-1', 'trace-1', 'decision_guard', 5, { latencyMs: 410, input: { request: '세계수의 비밀을 알려줘' }, output: { allowed: true, reason: null, capabilities: ['story_context'] } }),
    entry('guard-2', 'trace-2', 'decision_guard', 40, { latencyMs: 380, input: { request: '오늘 날씨 어때?' }, output: { allowed: false, reason: 'out_of_scope', capabilities: [] } }),
    entry('guard-3', 'trace-3', 'decision_guard', 95, { latencyMs: 30000, level: 'ERROR', statusMessage: '판정 응답 시간 초과(예시)', input: { request: '3화를 검수하고 고쳐 줘' } }),
    entry('guard-4', 'trace-1', 'decision_guard.generation', 5, { type: 'GENERATION', model: 'gpt-demo', promptName: 'decision_guard.judge', promptVersion: 1, latencyMs: 395, input: [{ role: 'user', content: '세계수의 비밀을 알려줘' }], output: { answers: [{ name: 'guard', choice: 'in_scope' }] } }),
  ],
  main: [
    entry('main-1', 'trace-1', 'main_agent', 5, {
      type: 'GENERATION', model: 'gpt-demo', promptName: 'orchestration.main', promptVersion: 1, latencyMs: 2100, input: [{ role: 'user', content: '세계수의 비밀을 알려줘' }],
      output: { text: '스토리 Q&A로 조회할게요.', toolCalls: [{ name: 'ask_story_qa', args: { request: '세계수의 비밀' } }] },
    }),
    entry('main-2', 'trace-4', 'main_agent', 180, { type: 'GENERATION', model: 'gpt-demo', promptName: 'orchestration.main', promptVersion: 1, latencyMs: 1700, output: { text: '조회 결과를 정리했어요.', toolCalls: [] } }),
    // 메인이 실행하지 않고 돌려보낸 도구 호출: level은 DEFAULT이고 이름은 input, 이유는 output에 남는다.
    entry('main-3', 'trace-2', 'main_agent.blocked', 40, { input: { name: 'ask_writing' }, output: { reason: '이번 요청에서 노출되지 않은 도구예요.' } }),
    entry('main-4', 'trace-3', 'main_agent', 95, { type: 'GENERATION', model: 'gpt-demo', promptName: 'orchestration.main', promptVersion: 1, latencyMs: 30000, level: 'ERROR', statusMessage: '모델 응답 실패(예시)' }),
  ],
  // 인물 시뮬레이션: 생성 기록에 프롬프트·버전·모델이 남는다. 모델을 고르지 않은 버전은 환경 설정의 기본 모델로 돌아(인물 대사는 따로 정한 모델) 이 기록이 '기본 모델 · 최근 사용'의 근거가 된다.
  character_simulation: [
    entry('character_simulation-1', 'trace-1', 'simulation.act', 12, {
      type: 'GENERATION', model: 'gpt-demo-mini', promptName: 'character_simulation.act', promptVersion: 1, latencyMs: 4200, input: [{ role: 'user', content: '카엘의 다음 대사를 써 줘' }], output: { text: '"세계수가 시들면 이 숲도 끝이야."' },
    }),
    entry('character_simulation-2', 'trace-1', 'simulation.narrate', 13, {
      type: 'GENERATION', model: 'gpt-demo', promptName: 'character_simulation.narrate', promptVersion: 1, latencyMs: 3100, input: [{ role: 'user', content: '장면의 나레이션을 이어 써 줘' }], output: { text: '숲 위로 바람이 지나갔다.' },
    }),
  ],
  // NovelBrain 기억 회상(novelbrain.recall): 출력의 recalled가 인물이 그 시점에 떠올린 근거다. 카드 항목은 제목이 있고 관계·원고 항목은 ref와 점수뿐이다(본문은 남기지 않는다).
  novelbrain: [
    entry('novelbrain-1', 'trace-1', 'novelbrain.recall', 6, {
      latencyMs: 330, input: { character: '카엘', episode: 3, query: '카엘이 아는 세계수의 비밀' },
      output: { count: 3, recalled: [{ ref: 'card:wtree#identity', card_id: 'wtree', title: '세계수', score: 0.82 }, { ref: 'relation:r-kl', score: 0.64 }, { ref: 'manuscript:m1', score: 0.51 }] },
    }),
    entry('novelbrain-2', 'trace-4', 'novelbrain.recall', 150, { latencyMs: 280, input: { character: '리안', episode: 3, query: '리안의 맹세' }, output: { count: 0, recalled: [] } }),
  ],
}
const recordsOf = (node: PipelineNode): PipelineRecord[] => PIPELINE_RECORDS[node.id]
  ?? [entry(`${node.id}-1`, 'trace-1', `step.${node.id}`, 8, { latencyMs: 900, input: { request: '예시 입력' }, output: '예시 출력' }), ...(node.errors ? [entry(`${node.id}-2`, 'trace-2', `step.${node.id}`, 60, { level: 'ERROR', statusMessage: '단계 실패(예시)' })] : [])]

/** AI 서비스가 기동 때 등록하는 나머지 프롬프트(코드 시드 버전 1): 파이프라인 노드의 '프롬프트 보기'가 모두 열리도록 이름만 있는 예시 본문으로 채웁니다(#857). */
const withSeeds = (rows: Omit<Prompt, 'candidates'>[]): Omit<Prompt, 'candidates'>[] => [
  ...rows,
  ...[...PROMPT_NAMES.keys()].filter((name) => !rows.some((row) => row.name === name)).map((name) => ({
    name, versions: [{ version: 1, labels: ['production', 'seed'], createdAt: ago(9000), prompt: `${promptLabel(name)} 호출에 쓰는 지시문(시연용 예시 본문)입니다.` }],
  })),
]

const featureRow = (key: string, requests: number, failureRate: number | null, timeoutRate: number | null, p50: number | null, p95: number | null, tokens: [number, number], costPlatform: number): MetricRow => ({
  key, requests, failureRate, timeoutRate, p50LatencyMs: p50, p95LatencyMs: p95, inputTokens: tokens[0], outputTokens: tokens[1], costUser: 0, costPlatform,
})
/** 에이전트 지표 카드 예시(기능별, 요청 많은 순): AI 서비스가 trace에 다는 실제 기능 키. 실패가 잦은 기능·시간 초과가 있는 기능·요청 없이 비용만 있는 기능(데이터 없음)도 한 장씩 있습니다. */
const FEATURE_ROWS: MetricRow[] = [
  featureRow('orchestration', 412, 0.051, 0.012, 5200, 14800, [1_240_000, 310_000], 4.82),
  featureRow('manuscript_review', 96, 0.083, 0.052, 7600, 21000, [410_000, 96_000], 1.37),
  featureRow('writing_editing', 74, 0.027, 0, 9100, 16500, [330_000, 142_000], 1.64),
  featureRow('world_review', 51, 0.02, 0, 4300, 8200, [210_000, 61_000], 0.73),
  featureRow('proposals', 44, 0, 0, 3300, 5100, [96_000, 38_000], 0.31),
  featureRow('rating', 23, 0.13, 0.043, 2800, 9400, [52_000, 9_000], 0.12),
  featureRow('web_research', 18, 0.278, 0.111, 6100, 27000, [88_000, 21_000], 0.29),
  featureRow('prompt_optimization', 0, null, null, null, null, [640_000, 120_000], 2.1),
]

export class InMemoryLlmOpsRepository implements LlmOpsRepository {
  private readonly traceRows = [
    trace('trace-1', 'orchestration', 'success', 5, 1840, 0.0042), trace('trace-2', 'writing_editing', 'failed', 40, 920, 0.0011),
    trace('trace-3', 'manuscript_review', 'timeout', 95, 30000, 0.0087), trace('trace-4', 'orchestration', 'success', 180, 1620, 0.0039),
  ]
  private readonly prompts_: Omit<Prompt, 'candidates'>[] = withSeeds([
    { name: 'qa-answer', versions: [
      { version: 3, labels: ['seed'], createdAt: ago(300), evaluation: { runId: 'run-2', passed: false, createdAt: ago(240) }, model: 'gpt-demo', prompt: '근거가 있는 내용만 답하고 근거를 함께 보여 주세요.' },
      { version: 2, labels: ['production'], createdAt: ago(4000), evaluation: { runId: 'run-1', passed: true, createdAt: ago(3900) }, model: 'gpt-demo', prompt: '근거가 있는 내용만 답하세요.' },
      { version: 1, labels: [], createdAt: ago(9000), prompt: '질문에 답하세요.' },
    ] },
    { name: 'writing-assist', versions: [{ version: 1, labels: ['production', 'seed'], createdAt: ago(9000), prompt: '작가의 요청대로 원고를 고치세요.' }] },
    { name: 'decision_guard.judge', versions: [{ version: 1, labels: ['production', 'seed'], createdAt: ago(9000), prompt: '요청이 범위 안인지 판정하세요.' }] },
    { name: 'main-agent', versions: [{ version: 1, labels: ['production', 'seed'], createdAt: ago(9000), prompt: '작가를 돕는 집필 AI입니다.' }] },
    // 개선 루프(#857) 예시: 실제 프롬프트 이름과 짝 평가 세트(evaluationDataset)를 쓴다. 인물 대사는 네 버전이 통과·미통과·후보·반영 중을 모두 보이고 자동 개선(GEPA) 대상이다.
    { name: 'character_simulation.act', evaluationDataset: 'simulation.act', versions: [
      { version: 4, labels: [], createdAt: ago(60), evaluation: { runId: 'run-act-4', passed: true, createdAt: ago(30) }, model: 'gpt-demo', commitMessage: '자동 개선(GEPA) · 기준 1번 버전', prompt: '인물의 말투와 의도를 지키고, 아직 모르는 사실은 말하지 마세요. 짧게 한 줄로 답하세요.' },
      { version: 3, labels: [], createdAt: ago(300), evaluation: { runId: 'run-act-3', passed: false, createdAt: ago(240) }, model: 'gpt-demo', commitMessage: '말투 지침 강화', prompt: '인물의 말투를 최대한 살려 길게 말하세요.' },
      { version: 2, labels: ['candidate-2'], createdAt: ago(1500), evaluation: { runId: 'run-act-2', passed: true, createdAt: ago(1400) }, model: 'gpt-demo', commitMessage: '의도 지침 추가', prompt: '인물의 말투와 의도를 지켜 말하세요.' },
      { version: 1, labels: ['production', 'seed'], createdAt: ago(9000), evaluation: { runId: 'run-act-1', passed: true, createdAt: ago(8800) }, prompt: '인물로서 다음 대사를 말하세요.' },
    ] },
    { name: 'character_simulation.narrate', evaluationDataset: 'simulation.narrate', versions: [
      { version: 1, labels: ['production', 'seed'], createdAt: ago(9000), evaluation: { runId: 'run-narrate-1', passed: true, createdAt: ago(200) }, prompt: '장면의 나레이션을 원작의 문체로 이어 쓰세요.' },
    ] },
    { name: 'story_context.answer', evaluationDataset: 'qa.grounding', versions: [
      { version: 1, labels: ['production', 'seed'], createdAt: ago(9000), evaluation: { runId: 'run-qa-1', passed: true, createdAt: ago(120) }, model: 'gpt-demo', prompt: '근거가 있는 내용만 답하고 근거를 함께 보여 주세요.' },
    ] },
    { name: 'manuscript_extraction.extract', evaluationDataset: 'extraction.extract', versions: [{ version: 1, labels: ['production', 'seed'], createdAt: ago(9000), model: 'gpt-demo', prompt: '회차에서 설정 대상·진술·관계를 근거 인용과 함께 뽑으세요.' }] },
    { name: 'world_review.check', versions: [{ version: 1, labels: ['production', 'seed'], createdAt: ago(9000), prompt: '새 설정이 기존 설정과 충돌하는지 지적하세요.' }] },
    { name: 'orchestration.main', versions: [{ version: 1, labels: ['production', 'seed'], createdAt: ago(9000), prompt: '작가의 요청을 분석해 알맞은 업무 에이전트에 맡기세요.' }] },
    { name: 'web_research.search', versions: [{ version: 1, labels: ['production', 'seed'], createdAt: ago(9000), prompt: '고증에 필요한 자료를 웹에서 찾아 출처와 함께 정리하세요.' }] },
    { name: 'rating.assess', versions: [{ version: 1, labels: ['production', 'seed'], createdAt: ago(9000), prompt: '원고의 심의 등급을 판정하고 근거를 적으세요.' }] },
  ])
  private readonly modelRows: Model[] = [
    { id: 'model-1', modelName: 'gpt-demo', matchPattern: '(?i)^gpt-demo$', inputPrice: 0.0000025, outputPrice: 0.00001 },
    { id: 'model-2', modelName: 'embed-demo', matchPattern: '(?i)^embed-demo$', inputPrice: 0.0000001, outputPrice: 0 },
  ]
  private readonly evaluationRows: Evaluation[] = [
    // 개선 루프 예시 Run(최신순): 짝 세트 Run, 범용 세트(world.conflict) Run, 문항별 결과(실패 먼저).
    { runId: 'run-act-4', dataset: 'simulation.act', prompt: 'character_simulation.act', version: 4, status: 'completed', passed: true, createdAt: ago(30), metrics: [
      { name: 'voice', score: 0.82, baseline: 0.78, delta: 0.04 }, { name: 'intent', score: 0.88, baseline: 0.85, delta: 0.03 }, { name: 'pov_ok', score: 1, baseline: 1, delta: 0 }],
    items: [{ itemId: 'simulation.act-07', scores: { voice: 0.25, intent: 0.5, pov_ok: 1 }, failed: true }, { itemId: 'simulation.act-01', scores: { voice: 0.75, intent: 1, pov_ok: 1 }, failed: false }, { itemId: 'simulation.act-02', scores: { voice: 1, intent: 0.75, pov_ok: 1 }, failed: false }] },
    { runId: 'run-world-1', dataset: 'world.conflict', prompt: 'world_review.check', version: 1, status: 'completed', passed: true, createdAt: ago(50), metrics: [{ name: 'conflict_geval', score: 0.8, baseline: null, delta: null }] },
    { runId: 'run-qa-1', dataset: 'qa.grounding', prompt: 'story_context.answer', version: 1, status: 'completed', passed: true, createdAt: ago(120), metrics: [
      { name: 'faithfulness', score: 0.92, baseline: null, delta: null }, { name: 'context_precision', score: 0.88, baseline: null, delta: null }] },
    { runId: 'run-narrate-1', dataset: 'simulation.narrate', prompt: 'character_simulation.narrate', version: 1, status: 'completed', passed: true, createdAt: ago(200), metrics: [
      { name: 'style', score: 0.8, baseline: null, delta: null }, { name: 'info', score: 0.84, baseline: null, delta: null }, { name: 'pov_ok', score: 1, baseline: null, delta: null }] },
    { runId: 'run-act-3', dataset: 'simulation.act', prompt: 'character_simulation.act', version: 3, status: 'completed', passed: false, createdAt: ago(240), metrics: [
      { name: 'voice', score: 0.7, baseline: 0.78, delta: -0.08 }, { name: 'intent', score: 0.62, baseline: 0.85, delta: -0.23 }, { name: 'pov_ok', score: 0.92, baseline: 1, delta: -0.08 }],
    items: [
      { itemId: 'simulation.act-19', scores: {}, failed: true, error: '생성 또는 채점에 실패했어요.' }, { itemId: 'simulation.act-12', scores: { voice: 1, intent: 1, pov_ok: 0 }, failed: true },
      { itemId: 'simulation.act-07', scores: { voice: 0.25, intent: 0.5, pov_ok: 1 }, failed: true }, { itemId: 'simulation.act-01', scores: { voice: 0.75, intent: 1, pov_ok: 1 }, failed: false }] },
    { runId: 'run-act-2', dataset: 'simulation.act', prompt: 'character_simulation.act', version: 2, status: 'completed', passed: true, createdAt: ago(1400), metrics: [
      { name: 'voice', score: 0.78, baseline: 0.77, delta: 0.01 }, { name: 'intent', score: 0.85, baseline: 0.84, delta: 0.01 }, { name: 'pov_ok', score: 1, baseline: 1, delta: 0 }] },
    { runId: 'run-act-1', dataset: 'simulation.act', prompt: 'character_simulation.act', version: 1, status: 'completed', passed: true, createdAt: ago(8800), metrics: [
      { name: 'voice', score: 0.77, baseline: null, delta: null }, { name: 'intent', score: 0.84, baseline: null, delta: null }, { name: 'pov_ok', score: 1, baseline: null, delta: null }] },
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
          level: failed ? 'ERROR' : 'DEFAULT', statusMessage: failed ? '모델 응답 실패(예시)' : null, promptName: 'story_context.answer', promptVersion: 1,
          input: [{ role: 'user', content: '세계수의 비밀은 무엇인가요?' }], output: failed ? null : '아직 공개되지 않은 설정이라 말씀드릴 수 없어요.', metadata: { turn: 1 },
        },
      ],
    }
  }
  async metrics({ groupBy }: MetricsQuery): Promise<Metrics> {
    const keys = groupBy === 'day' ? [0, 1, 2].map((d) => ago(d * 1440).slice(0, 10)) : ['gpt-demo', 'embed-demo']
    return {
      rows: groupBy === 'feature'
        ? FEATURE_ROWS
        : keys.map((key, i) => ({ key, requests: 120 - i * 30, failureRate: 0.04 + i * 0.02, timeoutRate: i * 0.01, p50LatencyMs: 1500, p95LatencyMs: 4200 + i * 900, inputTokens: 150000 - i * 20000, outputTokens: 42000 - i * 6000, costUser: 0, costPlatform: 0.31 - i * 0.07 })),
      adoptionRate: 0.42, approvalRate: 0.67, filterRestoreRate: null,
    }
  }
  // 서버처럼 목록은 production·seed 버전의 라벨·모델과 후보 수만, 상세는 모든 버전과 본문까지 준다(#786).
  async prompts() {
    return structuredClone(this.prompts_.map(({ name, versions, evaluationDataset }) => ({
      name, candidates: candidatesOf(versions), evaluationDataset,
      versions: versions.filter((v) => v.labels.includes('production') || v.labels.includes('seed')).map(({ prompt: _body, ...v }) => v),
    })))
  }
  async prompt(name: string) {
    const p = found(this.prompts_.find((item) => item.name === name))
    return structuredClone({ ...p, candidates: candidatesOf(p.versions), models: ['gpt-demo', 'gpt-demo-mini'] })
  }
  async createPromptVersion(name: string, input: PromptVersionInput) {
    const p = found(this.prompts_.find((item) => item.name === name))
    p.versions.unshift({ version: Math.max(...p.versions.map((v) => v.version)) + 1, labels: [], createdAt: new Date().toISOString(), model: input.model || null, prompt: input.prompt, commitMessage: input.commitMessage || null })
  }
  async candidate(name: string, version: number) {
    const target = found(found(this.prompts_.find((item) => item.name === name)).versions.find((v) => v.version === version))
    if (!target.labels.includes(`candidate-${version}`)) target.labels = [...target.labels, `candidate-${version}`]
  }
  async promote(name: string, version: number) {
    const p = found(this.prompts_.find((item) => item.name === name)), target = found(p.versions.find((v) => v.version === version))
    if (!target.labels.includes(`candidate-${version}`)) throw new OperationsRejected(CANDIDATE_REQUIRED_MESSAGE)
    for (const v of p.versions) v.labels = [...v.labels.filter((label) => label !== 'production'), ...(v === target ? ['production'] : [])]
  }
  /** 데모에는 개선을 돌리는 쪽이 없어 요청이 받아들여질 뿐이고(대상 버전만 확인), 데모 프롬프트에는 자동 개선 대상이 없어 화면에서는 이 요청이 나가지 않습니다. */
  async optimize(name: string, { version }: OptimizationInput) {
    found(this.prompts_.find((p) => p.name === name)?.versions.find((v) => v.version === version))
  }
  async models() { return structuredClone(this.modelRows) }
  async createModel(input: ModelInput) { this.modelRows.push({ id: `model-${this.modelRows.length + 1}`, ...input }) }
  async evaluations() { return structuredClone(this.evaluationRows.map(({ items: _items, ...row }) => ({ ...row, metrics: [] }))) }
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

/** 평가 데이터셋 예시(#857, 서버 API 예정): 저장소의 7개 세트를 에이전트별 평가 표의 문항 수에 맞춘 예시 문항으로 보이고, 올린 문항은 메모리에만 쌓이며 새로 고치면 사라집니다. */
const demoItems = (name: string, count: number): DatasetItem[] => Array.from({ length: count }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return { id: `${name}-${n}`, input: { 예시: `${name} 문항 ${n}의 입력(시연용 예시 문장)` }, expectedOutput: `${name} 문항 ${n}의 기대 답변(시연용)`, metadata: { source: '시연용 예시' } }
})
const SEED_SOURCE = '저장소 시드(ai-eval-seed)'

export class InMemoryLlmDatasetRepository implements LlmDatasetRepository {
  private readonly sets = new Map<string, { source: string; items: DatasetItem[] }>(
    AGENT_EVALUATIONS.flatMap((row) => (row.dataset ? [[row.dataset, { source: SEED_SOURCE, items: demoItems(row.dataset, setItems(row) ?? 0) }] as const] : [])),
  )

  async datasets(): Promise<EvalDataset[]> {
    return [...this.sets].map(([name, { source, items }]) => ({ name, prompt: pairedPrompt(name), items: items.length, source })).sort((a, b) => a.name.localeCompare(b.name))
  }
  async items(name: string) { return structuredClone(found(this.sets.get(name)).items) }
  /** 서버가 Langfuse 항목을 id로 upsert하듯 같은 id는 덮어쓰고 새 id는 뒤에 붙입니다. */
  async upload(name: string, fileName: string, items: DatasetItem[]) {
    const set = this.sets.get(name) ?? { source: `업로드 · ${fileName}`, items: [] }
    for (const item of items) {
      const at = set.items.findIndex((row) => row.id === item.id)
      if (at < 0) set.items.push(item)
      else set.items[at] = item
    }
    this.sets.set(name, set)
  }
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
