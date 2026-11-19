import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { PERIODS, periodRange, type MetricsGroup } from '../../../../domain/entities/llmOps'
import type { AlertRuleInput } from '../../../../domain/entities/operationsAlert'
import type { LlmOpsUseCase } from '../../../../domain/usecases/LlmOpsUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

type LlmView = 'alerts' | 'traces' | 'metrics' | 'prompts' | 'models' | 'evaluations' | 'leaks' | 'settings'
export const LLM_VIEWS: [LlmView, string][] = [
  ['alerts', '경고'], ['traces', '추적'], ['metrics', '지표'], ['prompts', '프롬프트'], ['models', '모델'], ['evaluations', '평가'], ['leaks', '누설 검사'], ['settings', '경고 기준·설정'],
]
/** 추적 목록 조건. 기간은 시간(지금부터 거꾸로)이고, 비어 있는 값은 서버에 보내지 않습니다. page는 0부터입니다. */
type TraceFilters = { hours: number; feature: string; status: string; userId: string; requestId: string; page: number }
const FIRST_TRACES: TraceFilters = { hours: PERIODS[1][0], feature: '', status: '', userId: '', requestId: '', page: 0 }

/**
 * LLMOps 화면(DEC-55)의 보기 선택·조회 조건·조회 결과·관리 조치. 보고 있는 보기의 것만 서버에서 읽고, 조건이나 선택을 바꾸면 그 범위를 다시 읽습니다.
 * 변경 조치는 관리자 화면 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회를 한곳에서 합니다.
 */
export function useLlmOpsViewModel(mutate: AdminMutate, useCase: LlmOpsUseCase = appContainer.resolve('llmOpsUseCase')) {
  // 운영 경고 알림이 /admin?tab=llm으로 오므로 경고가 첫 보기입니다.
  const [view, setView] = useState<LlmView>('alerts')
  const [traceFilters, setTraceFilters] = useState(FIRST_TRACES)
  const [traceId, setTraceId] = useState<string | null>(null)
  const [metricsQuery, setMetricsQuery] = useState<{ hours: number; groupBy: MetricsGroup }>({ hours: PERIODS[1][0], groupBy: 'day' })
  const [promptName, setPromptName] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  // 기간(지금부터 거꾸로)은 읽는 순간에 계산해 다시 읽을 때마다 최신 구간이 됩니다.
  const traces = useAsyncData(async () => {
    const { hours, ...rest } = traceFilters
    return view === 'traces' && !traceId ? useCase.traces({ ...periodRange(hours), ...rest }) : null
  }, [useCase, view, traceId, traceFilters])
  const trace = useAsyncData(async () => traceId ? useCase.trace(traceId) : null, [useCase, traceId])
  const metrics = useAsyncData(async () => view === 'metrics' ? useCase.metrics({ ...periodRange(metricsQuery.hours), groupBy: metricsQuery.groupBy }) : null, [useCase, view, metricsQuery])
  const prompts = useAsyncData(async () => view === 'prompts' && !promptName ? useCase.prompts() : null, [useCase, view, promptName])
  const prompt = useAsyncData(async () => promptName ? useCase.prompt(promptName) : null, [useCase, promptName])
  const models = useAsyncData(async () => view === 'models' ? useCase.models() : null, [useCase, view])
  const evaluations = useAsyncData(async () => view === 'evaluations' && !runId ? useCase.evaluations() : null, [useCase, view, runId])
  const evaluation = useAsyncData(async () => runId ? useCase.evaluation(runId) : null, [useCase, runId])
  const leaks = useAsyncData(async () => view === 'leaks' ? useCase.leakChecks() : null, [useCase, view])
  const config = useAsyncData(async () => {
    if (view !== 'settings') return null
    const rules = await useCase.alertRules()
    const settings = rules && await useCase.settings()
    return rules && settings ? { rules, settings } : null
  }, [useCase, view])

  return {
    view,
    /** 보기를 바꾸면 이전 보기에서 열어 둔 상세는 닫습니다. */
    choose: (next: LlmView) => { setView(next); setTraceId(null); setPromptName(null); setRunId(null) },
    traces, traceFilters,
    applyTraceFilters: (next: Omit<TraceFilters, 'page'>) => setTraceFilters({ ...next, page: 0 }),
    setTracePage: (page: number) => setTraceFilters((filters) => ({ ...filters, page })),
    trace, traceId, openTrace: (id: string) => { setView('traces'); setTraceId(id) }, closeTrace: () => setTraceId(null),
    metrics, metricsQuery, setMetricsQuery,
    prompts, prompt, promptName, openPrompt: setPromptName, closePrompt: () => setPromptName(null),
    createPromptVersion: (name: string, text: string, note: string) =>
      mutate(`prompt:${name}:new`, '새 버전을 등록했어요. production으로 올리려면 먼저 회귀 평가를 통과해야 해요.', () => useCase.createPromptVersion(name, text, note)),
    promote: (name: string, version: number) =>
      mutate(`prompt:${name}:${version}`, `프롬프트 ${name}의 production이 ${version}번 버전으로 바뀌었어요.`, () => useCase.promote(name, version)),
    models,
    createModel: (input: { modelName: string; matchPattern: string; inputPerMillion: number; outputPerMillion: number }) =>
      mutate('model:new', '모델 단가를 등록했어요.', () => useCase.createModel(input)),
    evaluations, evaluation, runId, openEvaluation: (id: string) => { setView('evaluations'); setRunId(id) }, closeEvaluation: () => setRunId(null),
    runEvaluation: (dataset: string, promptNameToEvaluate: string, version: number) =>
      mutate('eval:new', '회귀 평가 실행을 요청했어요. 끝나면 평가 목록에서 결과를 확인해 주세요.', () => useCase.runEvaluation(dataset, promptNameToEvaluate, version)),
    leaks, config,
    updateRule: (key: string, input: AlertRuleInput) => mutate(`rule:${key}`, '경고 기준을 저장했어요.', () => useCase.updateAlertRule(key, input)),
    updateSettings: (leakSampleRate: number) => mutate('setting:leak', '누설 검사 표본 비율을 저장했어요.', () => useCase.updateSettings(leakSampleRate)),
  }
}
