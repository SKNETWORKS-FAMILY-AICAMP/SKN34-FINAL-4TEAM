import { periodRange, type EvaluationInput, type Metrics, type MetricsQuery, type TraceQuery } from '../entities/llmOps'
import { OperationsError, OperationsForbidden } from '../entities/operations'
import type { AlertRuleInput } from '../entities/operationsAlert'
import type { LlmOpsRepository } from '../repositories/LlmOpsRepository'

const invalid = (message: string): never => { throw new OperationsError(message) }
/** 단가 입력 단위는 사람이 읽는 100만 토큰당 USD이고, 서버·Langfuse는 토큰당 USD입니다. */
const perToken = (perMillion: number) => (Number.isFinite(perMillion) && perMillion >= 0 ? perMillion / 1_000_000 : invalid('단가는 0 이상의 숫자로 입력해 주세요.'))

/** LLMOps 조회·관리(DEC-55). 서버가 다시 검사하므로 여기서는 사람이 곧바로 고칠 수 있는 입력 오류만 먼저 알립니다. */
export class LlmOpsUseCase {
  private readonly repository: LlmOpsRepository
  constructor(repository: LlmOpsRepository) { this.repository = repository }

  traces(query: TraceQuery) { return this.repository.traces(query) }
  trace(id: string) { return this.repository.trace(id) }
  metrics(query: MetricsQuery) { return this.repository.metrics(query) }

  /** 대시보드 차트: 지금부터 7일 전까지의 날짜별 지표('지표' 보기의 최근 7일과 같은 구간). 조회 권한(llm)이 없으면(403) 실패가 아니라 null이라 화면이 다시 불러오기 대신 권한 안내를 보입니다. */
  async weeklyMetrics(now = new Date()): Promise<Metrics | null> {
    try {
      return await this.repository.metrics({ ...periodRange(24 * 7, now), groupBy: 'day' })
    } catch (error) {
      if (error instanceof OperationsForbidden) return null
      throw error
    }
  }
  prompts() { return this.repository.prompts() }
  prompt(name: string) { return this.repository.prompt(name) }
  models() { return this.repository.models() }
  evaluations() { return this.repository.evaluations() }
  evaluation(runId: string) { return this.repository.evaluation(runId) }
  leakChecks() { return this.repository.leakChecks() }
  alertRules() { return this.repository.alertRules() }
  settings() { return this.repository.settings() }
  promote(name: string, version: number) { return this.repository.promote(name, version) }

  /** 본문은 그대로 보냅니다(앞뒤 공백·줄바꿈도 프롬프트의 일부). 비어 있을 때만 막습니다. */
  async createPromptVersion(name: string, prompt: string, commitMessage: string) {
    if (!prompt.trim()) invalid('프롬프트 본문을 입력해 주세요.')
    return this.repository.createPromptVersion(name, { prompt, commitMessage: commitMessage.trim() })
  }

  async createModel(input: { modelName: string; matchPattern: string; inputPerMillion: number; outputPerMillion: number }) {
    const modelName = input.modelName.trim(), matchPattern = input.matchPattern.trim()
    if (!modelName || !matchPattern) invalid('모델 이름과 매칭 패턴을 입력해 주세요.')
    return this.repository.createModel({ modelName, matchPattern, inputPrice: perToken(input.inputPerMillion), outputPrice: perToken(input.outputPerMillion) })
  }

  async runEvaluation(dataset: string, prompt: string, version: number) {
    const input: EvaluationInput = { dataset: dataset.trim(), prompt: prompt.trim(), version }
    if (!input.dataset || !input.prompt) invalid('데이터셋과 프롬프트 이름을 입력해 주세요.')
    if (!Number.isInteger(version) || version < 1) invalid('버전은 1 이상의 정수로 입력해 주세요.')
    return this.repository.runEvaluation(input)
  }

  async updateAlertRule(key: string, input: AlertRuleInput) {
    if (!Number.isInteger(input.windowMinutes) || input.windowMinutes < 1) invalid('기준 시간(분)은 1 이상의 정수로 입력해 주세요.')
    if (input.threshold !== null && !(Number.isFinite(input.threshold) && input.threshold >= 0)) invalid('기준값은 0 이상의 숫자로 입력해 주세요.')
    return this.repository.updateAlertRule(key, input)
  }

  async updateSettings(leakSampleRate: number) {
    if (!(leakSampleRate >= 0 && leakSampleRate <= 1)) invalid('표본 비율은 0 이상 1 이하의 숫자로 입력해 주세요.')
    return this.repository.updateSettings({ leakSampleRate })
  }
}
