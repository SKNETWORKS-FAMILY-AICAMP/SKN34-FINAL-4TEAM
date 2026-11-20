import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { LlmPage } from '../../../../domain/entities/admin'
import { PERIODS, periodRange, type MetricsGroup } from '../../../../domain/entities/llmOps'
import type { AlertRuleInput } from '../../../../domain/entities/operationsAlert'
import type { LlmOpsUseCase } from '../../../../domain/usecases/LlmOpsUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

/** 추적 목록 조건. 기간은 시간(지금부터 거꾸로)이고, 비어 있는 값은 서버에 보내지 않습니다. page는 0부터입니다. */
type TraceFilters = { hours: number; feature: string; status: string; userId: string; requestId: string; page: number }
const FIRST_TRACES: TraceFilters = { hours: PERIODS[1][0], feature: '', status: '', userId: '', requestId: '', page: 0 }

/**
 * LLMOps 화면(DEC-55)의 쪽(page, 주소의 view)별 조회 조건·조회 결과·관리 조치. 보고 있는 쪽의 패널이 읽는 것만 서버에서 읽고, 조건이나 선택을 바꾸면 그 범위를 다시 읽습니다.
 * 열어 둔 상세(추적·프롬프트·평가 하나)는 그 상세가 속한 쪽에서만 보이고 쪽을 옮기면 닫힙니다. 다른 쪽에 있는 상세로 가는 버튼(누설 검사의 추적 보기, 프롬프트 버전의 평가 결과 보기)은 openPage로 그 쪽으로 옮겨 엽니다.
 * 변경 조치는 관리자 화면 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회를 한곳에서 합니다.
 */
export function useLlmOpsViewModel(mutate: AdminMutate, page: LlmPage, openPage: (page: LlmPage) => void, useCase: LlmOpsUseCase = appContainer.resolve('llmOpsUseCase')) {
  const [traceFilters, setTraceFilters] = useState(FIRST_TRACES)
  const [metricsQuery, setMetricsQuery] = useState<{ hours: number; groupBy: MetricsGroup }>({ hours: PERIODS[1][0], groupBy: 'day' })
  // 열어 둔 상세 하나: traces 쪽은 추적 ID, prompts 쪽은 프롬프트 이름, quality 쪽은 평가 실행 ID. 쪽마다 하나뿐이라 쪽 이름표와 값만 둡니다.
  const [open, setOpen] = useState<{ page: LlmPage; id: string } | null>(null)
  // 쪽이 바뀐 렌더에서 다른 쪽의 상세를 비웁니다(되돌아왔을 때 목록부터 보이게). 옮겨 갈 쪽에 열도록 정해 둔 상세는 남깁니다.
  const [seen, setSeen] = useState(page)
  if (seen !== page) { setSeen(page); setOpen((now) => now?.page === page ? now : null) }
  const opened = open?.page === page ? open.id : null
  const traceId = page === 'traces' ? opened : null
  const promptName = page === 'prompts' ? opened : null
  const runId = page === 'quality' ? opened : null
  const openOn = (target: LlmPage, id: string) => { setOpen({ page: target, id }); if (target !== page) openPage(target) }

  // 기간(지금부터 거꾸로)은 읽는 순간에 계산해 다시 읽을 때마다 최신 구간이 됩니다.
  const traces = useAsyncData(async () => {
    const { hours, ...rest } = traceFilters
    return page === 'traces' && !traceId ? useCase.traces({ ...periodRange(hours), ...rest }) : null
  }, [useCase, page, traceId, traceFilters])
  const trace = useAsyncData(async () => traceId ? useCase.trace(traceId) : null, [useCase, traceId])
  const metrics = useAsyncData(async () => page === 'traces' ? useCase.metrics({ ...periodRange(metricsQuery.hours), groupBy: metricsQuery.groupBy }) : null, [useCase, page, metricsQuery])
  const prompts = useAsyncData(async () => page === 'prompts' && !promptName ? useCase.prompts() : null, [useCase, page, promptName])
  const prompt = useAsyncData(async () => promptName ? useCase.prompt(promptName) : null, [useCase, promptName])
  const models = useAsyncData(async () => page === 'prompts' ? useCase.models() : null, [useCase, page])
  const evaluations = useAsyncData(async () => page === 'quality' && !runId ? useCase.evaluations() : null, [useCase, page, runId])
  const evaluation = useAsyncData(async () => runId ? useCase.evaluation(runId) : null, [useCase, runId])
  const leaks = useAsyncData(async () => page === 'quality' ? useCase.leakChecks() : null, [useCase, page])
  const rules = useAsyncData(async () => page === 'alerts' ? useCase.alertRules() : null, [useCase, page])
  const settings = useAsyncData(async () => page === 'quality' ? useCase.settings() : null, [useCase, page])

  return {
    traces, traceFilters,
    applyTraceFilters: (next: Omit<TraceFilters, 'page'>) => setTraceFilters({ ...next, page: 0 }),
    setTracePage: (next: number) => setTraceFilters((filters) => ({ ...filters, page: next })),
    trace, traceId, openTrace: (id: string) => openOn('traces', id), closeTrace: () => setOpen(null),
    metrics, metricsQuery, setMetricsQuery,
    prompts, prompt, promptName, openPrompt: (name: string) => openOn('prompts', name), closePrompt: () => setOpen(null),
    createPromptVersion: (name: string, text: string, note: string) =>
      mutate(`prompt:${name}:new`, '새 버전을 등록했어요. production으로 올리려면 먼저 회귀 평가를 통과해야 해요.', () => useCase.createPromptVersion(name, text, note)),
    promote: (name: string, version: number) =>
      mutate(`prompt:${name}:${version}`, `프롬프트 ${name}의 production이 ${version}번 버전으로 바뀌었어요.`, () => useCase.promote(name, version)),
    models,
    createModel: (input: { modelName: string; matchPattern: string; inputPerMillion: number; outputPerMillion: number }) =>
      mutate('model:new', '모델 단가를 등록했어요.', () => useCase.createModel(input)),
    evaluations, evaluation, runId, openEvaluation: (id: string) => openOn('quality', id), closeEvaluation: () => setOpen(null),
    runEvaluation: (dataset: string, promptNameToEvaluate: string, version: number) =>
      mutate('eval:new', '회귀 평가 실행을 요청했어요. 끝나면 평가 목록에서 결과를 확인해 주세요.', () => useCase.runEvaluation(dataset, promptNameToEvaluate, version)),
    leaks, rules, settings,
    updateRule: (key: string, input: AlertRuleInput) => mutate(`rule:${key}`, '경고 기준을 저장했어요.', () => useCase.updateAlertRule(key, input)),
    updateSettings: (leakSampleRate: number) => mutate('setting:leak', '누설 검사 표본 비율을 저장했어요.', () => useCase.updateSettings(leakSampleRate)),
  }
}
