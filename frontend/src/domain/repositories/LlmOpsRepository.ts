import type {
  Evaluation, EvaluationInput, LeakCheck, LlmOpsSettings, Metrics, MetricsQuery, Model, ModelInput, Prompt, PromptVersionInput, TraceDetail, TraceItem, TraceQuery,
} from '../entities/llmOps'
import type { PipelineNode, PipelineQuery, PipelineRecord, PipelineRecordQuery } from '../entities/llmOpsPipeline'
import type { OperationsPage } from '../entities/operations'
import type { AlertRule, AlertRuleInput } from '../entities/operationsAlert'

/** LLMOps API 계약(DEC-55). 운영 서비스가 Langfuse Public API를 중계하며 모두 llm 권한이 필요합니다. */
export interface LlmOpsRepository {
  traces(query: TraceQuery): Promise<OperationsPage<TraceItem>>
  trace(id: string): Promise<TraceDetail>
  metrics(query: MetricsQuery): Promise<Metrics>
  prompts(): Promise<Prompt[]>
  prompt(name: string): Promise<Prompt>
  createPromptVersion(name: string, input: PromptVersionInput): Promise<void>
  /** 그 버전의 최신 회귀 평가가 통과가 아니면 서버가 409로 거절하고 문구를 줍니다(OperationsRejected). */
  /** 조합(본문+모델) 버전을 서비스 반영 후보로 등록합니다(#705). 반영(promote)은 후보만 됩니다. */
  candidate(name: string, version: number): Promise<void>
  promote(name: string, version: number): Promise<void>
  models(): Promise<Model[]>
  createModel(input: ModelInput): Promise<void>
  evaluations(): Promise<Evaluation[]>
  evaluation(runId: string): Promise<Evaluation>
  runEvaluation(input: EvaluationInput): Promise<void>
  leakChecks(): Promise<LeakCheck[]>
  /** AI 파이프라인(DEC-58): 노드별 observation 수·오류 수·p95 지연과 그 노드에 연결된 프롬프트 이름. */
  pipeline(query: PipelineQuery): Promise<PipelineNode[]>
  /** 한 노드의 observation 기록(최신순, 한 쪽 20건). level은 Langfuse 수준(DEFAULT·WARNING·ERROR)이고 비면 전체입니다. */
  pipelineRecords(query: PipelineRecordQuery): Promise<OperationsPage<PipelineRecord>>
  alertRules(): Promise<AlertRule[]>
  updateAlertRule(key: string, input: AlertRuleInput): Promise<void>
  settings(): Promise<LlmOpsSettings>
  updateSettings(settings: LlmOpsSettings): Promise<void>
}
