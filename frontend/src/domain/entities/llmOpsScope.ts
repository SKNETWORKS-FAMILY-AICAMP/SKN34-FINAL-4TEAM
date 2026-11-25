import type { PipelineFlowKey } from './admin'
import type { AgentEvaluation } from './llmOpsEvalTable'
import { FLOW_DEFS } from './llmOpsFlows'

/**
 * 흐름 범위(#857): 사이드바 하위 탭이 고른 워크플로우가 프롬프트·평가의 보기(파이프라인·프롬프트 목록·에이전트별 평가)를 거릅니다. 범위의 정본은 흐름 정의(llmOpsFlows)의 단계별 프롬프트라
 * 서버 목록을 다시 해석하지 않습니다. 전체(서버 노드 흐름)는 거르지 않으므로 null입니다.
 */
export const flowPrompts = (key: PipelineFlowKey): string[] | null => (key === 'all' ? null : [...new Set(FLOW_DEFS[key].steps.flatMap((step) => step.prompts ?? []))])

/** 프롬프트 목록을 흐름의 프롬프트로 거릅니다(전체는 그대로, 목록 순서 유지). */
export function scopePrompts<T extends { name: string }>(rows: T[], key: PipelineFlowKey): T[] {
  const names = flowPrompts(key)
  return names ? rows.filter((row) => names.includes(row.name)) : rows
}

/**
 * 에이전트별 평가 표를 흐름 범위로 거릅니다: 그 흐름의 프롬프트들의 짝 세트 행만 남깁니다(전체는 범용 세트(누설·세계관 충돌 등)와 검색 행까지 모든 행).
 * 짝 세트가 없는 흐름은 빈 목록이라 화면이 빈 표 대신 '평가 세트가 없어요'를 보입니다.
 */
export function scopeEvaluations(rows: AgentEvaluation[], key: PipelineFlowKey): AgentEvaluation[] {
  const names = flowPrompts(key)
  return names ? rows.filter((row) => row.dataset && row.prompt && names.includes(row.prompt)) : rows
}
