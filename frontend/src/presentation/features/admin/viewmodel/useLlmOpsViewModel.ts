import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { LlmPage, PromptSub } from '../../../../domain/entities/admin'
import { PERIODS, periodRange, type MetricsGroup } from '../../../../domain/entities/llmOps'
import { serverLevel } from '../../../../domain/entities/llmOpsPipeline'
import type { AlertRuleInput } from '../../../../domain/entities/operationsAlert'
import type { LlmOpsUseCase } from '../../../../domain/usecases/LlmOpsUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

/** 추적 목록 조건. 기간은 시간(지금부터 거꾸로)이고, 비어 있는 값은 서버에 보내지 않습니다. page는 0부터입니다. */
type TraceFilters = { hours: number; feature: string; status: string; userId: string; requestId: string; page: number }
const FIRST_TRACES: TraceFilters = { hours: PERIODS[1][0], feature: '', status: '', userId: '', requestId: '', page: 0 }
/** 파이프라인 노드 기록의 조건. result는 결과 필터 값(RECORD_RESULTS, 빈 값이 전체)이고 page는 0부터입니다. */
type RecordFilter = { result: string; page: number }
const FIRST_RECORDS: RecordFilter = { result: '', page: 0 }

/**
 * LLMOps 화면(DEC-55)의 쪽(page, 주소의 view)별 조회 조건·조회 결과·관리 조치. 보고 있는 쪽의 패널이 읽는 것만 서버에서 읽고, 조건이나 선택을 바꾸면 그 범위를 다시 읽습니다.
 * 프롬프트·모델 쪽은 보기(sub, 주소의 sub)가 또 나뉩니다(DEC-58): 전체(AI 파이프라인)·프롬프트·모델 중 보고 있는 것만 읽습니다.
 * 열어 둔 상세(추적·프롬프트·평가 하나)는 그 상세가 속한 자리(쪽, 프롬프트·모델은 보기까지)에서만 보이고 자리를 옮기면 닫힙니다.
 * 다른 자리에 있는 상세로 가는 버튼(누설 검사의 추적 보기, 프롬프트 버전의 평가 결과 보기, 파이프라인의 프롬프트 보기)은 openPage로 그 자리로 옮겨 엽니다.
 * 변경 조치는 관리자 화면 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회를 한곳에서 합니다.
 */
export function useLlmOpsViewModel(
  mutate: AdminMutate, page: LlmPage, openPage: (page: LlmPage, sub?: PromptSub) => void, sub: PromptSub, useCase: LlmOpsUseCase = appContainer.resolve('llmOpsUseCase'),
) {
  const [traceFilters, setTraceFilters] = useState(FIRST_TRACES)
  const [metricsQuery, setMetricsQuery] = useState<{ hours: number; groupBy: MetricsGroup }>({ hours: PERIODS[1][0], groupBy: 'day' })
  // 열어 둔 상세 하나: traces 쪽은 추적 ID, 프롬프트·모델의 프롬프트 보기는 프롬프트 이름, quality 쪽은 평가 실행 ID. 자리마다 하나뿐이라 자리 이름표와 값만 둡니다.
  const here: string = page === 'prompts' ? 'prompts:' + sub : page
  const [open, setOpen] = useState<{ at: string; id: string } | null>(null)
  // 자리가 바뀐 렌더에서 다른 자리의 상세를 비웁니다(되돌아왔을 때 목록부터 보이게). 옮겨 갈 자리에 열도록 정해 둔 상세는 남깁니다.
  const [seen, setSeen] = useState(here)
  if (seen !== here) { setSeen(here); setOpen((now) => now?.at === here ? now : null) }
  const opened = open?.at === here ? open.id : null
  const traceId = page === 'traces' ? opened : null
  const promptName = here === 'prompts:prompts' ? opened : null
  const runId = page === 'quality' ? opened : null
  const openOn = (target: LlmPage, id: string, targetSub?: PromptSub) => {
    const at = target === 'prompts' ? 'prompts:' + (targetSub ?? 'all') : target
    setOpen({ at, id })
    if (at !== here) openPage(target, targetSub)
  }

  // 기간(지금부터 거꾸로)은 읽는 순간에 계산해 다시 읽을 때마다 최신 구간이 됩니다.
  const traces = useAsyncData(async () => {
    const { hours, ...rest } = traceFilters
    return page === 'traces' && !traceId ? useCase.traces({ ...periodRange(hours), ...rest }) : null
  }, [useCase, page, traceId, traceFilters])
  const trace = useAsyncData(async () => traceId ? useCase.trace(traceId) : null, [useCase, traceId])
  const metrics = useAsyncData(async () => page === 'traces' ? useCase.metrics({ ...periodRange(metricsQuery.hours), groupBy: metricsQuery.groupBy }) : null, [useCase, page, metricsQuery])
  const prompts = useAsyncData(async () => here === 'prompts:prompts' && !promptName ? useCase.prompts() : null, [useCase, here, promptName])
  const prompt = useAsyncData(async () => promptName ? useCase.prompt(promptName) : null, [useCase, promptName])
  // 프롬프트 상세의 새 버전 폼도 모델 목록(Langfuse 모델 정의)에서 고른다(#705).
  const models = useAsyncData(async () => here === 'prompts:models' || promptName ? useCase.models() : null, [useCase, here, promptName])
  const evaluations = useAsyncData(async () => page === 'quality' && !runId ? useCase.evaluations() : null, [useCase, page, runId])
  const evaluation = useAsyncData(async () => runId ? useCase.evaluation(runId) : null, [useCase, runId])
  const leaks = useAsyncData(async () => page === 'quality' ? useCase.leakChecks() : null, [useCase, page])
  const rules = useAsyncData(async () => page === 'alerts' ? useCase.alertRules() : null, [useCase, page])
  const settings = useAsyncData(async () => page === 'quality' ? useCase.settings() : null, [useCase, page])

  // AI 파이프라인(DEC-58, 프롬프트·모델의 전체 보기): 노드 목록, 고른 노드의 기록, 기록 한 줄의 실행 흐름. 기본 기간은 최근 7일이고 기록은 서버가 최신순 20건씩 줍니다.
  // Guard는 거절이 level이 아니라 출력에 있어 서버 level 조건을 보내지 않으므로(serverLevel) 결과 필터만 바꿀 때는 다시 읽지 않고 받은 쪽에서 가립니다.
  const onPipeline = here === 'prompts:all'
  const [pipelineHours, setPipelineHours] = useState<number>(PERIODS[1][0])
  const [nodeId, setNodeId] = useState<string | null>(null)
  const [recordFilter, setRecordFilter] = useState(FIRST_RECORDS)
  const [flow, setFlow] = useState<{ traceId: string; recordId: string } | null>(null)
  const level = nodeId ? serverLevel(nodeId, recordFilter.result) : ''
  const pipeline = useAsyncData(async () => onPipeline ? useCase.pipeline(periodRange(pipelineHours)) : null, [useCase, onPipeline, pipelineHours])
  const records = useAsyncData(
    async () => onPipeline && nodeId ? useCase.pipelineRecords({ nodeId, ...periodRange(pipelineHours), level, page: recordFilter.page }) : null,
    [useCase, onPipeline, nodeId, pipelineHours, level, recordFilter.page],
  )
  const flowTrace = useAsyncData(async () => onPipeline && flow ? useCase.trace(flow.traceId) : null, [useCase, onPipeline, flow?.traceId])

  return {
    traces, traceFilters,
    applyTraceFilters: (next: Omit<TraceFilters, 'page'>) => setTraceFilters({ ...next, page: 0 }),
    setTracePage: (next: number) => setTraceFilters((filters) => ({ ...filters, page: next })),
    trace, traceId, openTrace: (id: string) => openOn('traces', id), closeTrace: () => setOpen(null),
    metrics, metricsQuery, setMetricsQuery,
    prompts, prompt, promptName, openPrompt: (name: string) => openOn('prompts', name, 'prompts'), closePrompt: () => setOpen(null),
    createPromptVersion: (name: string, text: string, note: string, model: string) =>
      mutate(`prompt:${name}:new`, '조합을 저장했어요. 후보로 등록하면 서비스에 반영할 수 있어요.', () => useCase.createPromptVersion(name, text, note, model)),
    registerCandidate: (name: string, version: number) =>
      mutate(`prompt:${name}:${version}`, `${name} ${version}번 버전을 후보로 등록했어요. 이제 서비스에 반영할 수 있어요.`, () => useCase.candidate(name, version)),
    promote: (name: string, version: number) =>
      mutate(`prompt:${name}:${version}`, `${name}의 서비스 반영이 ${version}번 버전으로 바뀌었어요.`, () => useCase.promote(name, version)),
    models,
    createModel: (input: { modelName: string; matchPattern: string; inputPerMillion: number; outputPerMillion: number }) =>
      mutate('model:new', '모델 단가를 등록했어요.', () => useCase.createModel(input)),
    evaluations, evaluation, runId, openEvaluation: (id: string) => openOn('quality', id), closeEvaluation: () => setOpen(null),
    runEvaluation: (dataset: string, promptNameToEvaluate: string, version: number) =>
      mutate('eval:new', '회귀 평가 실행을 요청했어요. 끝나면 평가 목록에서 결과를 확인해 주세요.', () => useCase.runEvaluation(dataset, promptNameToEvaluate, version)),
    leaks, rules, settings,
    updateRule: (key: string, input: AlertRuleInput) => mutate(`rule:${key}`, '경고 기준을 저장했어요.', () => useCase.updateAlertRule(key, input)),
    updateSettings: (leakSampleRate: number) => mutate('setting:leak', '누설 검사 표본 비율을 저장했어요.', () => useCase.updateSettings(leakSampleRate)),
    pipeline, pipelineHours, setPipelineHours: (hours: number) => { setPipelineHours(hours); setRecordFilter((filter) => ({ ...filter, page: 0 })) },
    nodeId, selectNode: (id: string) => { setNodeId(id); setRecordFilter(FIRST_RECORDS); setFlow(null) }, closeNode: () => { setNodeId(null); setFlow(null) },
    records, recordFilter,
    setRecordResult: (result: string) => setRecordFilter({ result, page: 0 }),
    setRecordPage: (next: number) => setRecordFilter((filter) => ({ ...filter, page: next })),
    flow, flowTrace, openFlow: (traceId: string, recordId: string) => setFlow({ traceId, recordId }), closeFlow: () => setFlow(null),
  }
}
