import type {
  Evaluation, EvaluationInput, LeakCheck, LlmOpsSettings, Metrics, MetricsQuery, Model, ModelInput, Prompt, PromptVersionInput, TraceDetail, TraceItem, TraceQuery,
} from '../entities/llmOps'
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
  promote(name: string, version: number): Promise<void>
  models(): Promise<Model[]>
  createModel(input: ModelInput): Promise<void>
  evaluations(): Promise<Evaluation[]>
  evaluation(runId: string): Promise<Evaluation>
  runEvaluation(input: EvaluationInput): Promise<void>
  leakChecks(): Promise<LeakCheck[]>
  alertRules(): Promise<AlertRule[]>
  updateAlertRule(key: string, input: AlertRuleInput): Promise<void>
  settings(): Promise<LlmOpsSettings>
  updateSettings(settings: LlmOpsSettings): Promise<void>
}
