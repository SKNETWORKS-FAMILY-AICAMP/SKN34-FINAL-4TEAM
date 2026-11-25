import { describe, expect, it } from 'vitest'

import { PIPELINE_FLOWS, type PipelineFlowKey } from '../entities/admin'
import { AGENT_EVALUATIONS } from '../entities/llmOpsEvalTable'
import { FLOW_DEFS } from '../entities/llmOpsFlows'
import { flowPrompts, scopeEvaluations, scopePrompts } from '../entities/llmOpsScope'

const KEYS = PIPELINE_FLOWS.map(([key]) => key).filter((key): key is Exclude<PipelineFlowKey, 'all'> => key !== 'all')

describe('흐름 범위(#857 사이드바 하위 탭이 프롬프트·평가의 모든 보기를 거른다)', () => {
  it('flowPrompts: 전체는 거르지 않으므로 null이고, 흐름은 단계 순서대로 겹치지 않는 프롬프트 코드다(서버 노드 단계는 프롬프트가 없다)', () => {
    expect(flowPrompts('all')).toBeNull()
    expect(flowPrompts('simulation')).toEqual(['character_simulation.plan', 'character_simulation.direct', 'character_simulation.act', 'character_simulation.narrate', 'character_simulation.check'])
    expect(flowPrompts('preprocessing')).toEqual(['manuscript_extraction.extract', 'manuscript_extraction.resolve'])
    for (const key of KEYS) expect(flowPrompts(key), key).toEqual([...new Set(FLOW_DEFS[key].steps.flatMap((step) => step.prompts ?? []))])
  })

  it('scopePrompts: 전체는 목록 그대로이고, 흐름은 그 흐름의 프롬프트만 남기며 목록 순서를 지킨다', () => {
    const rows = ['orchestration.main', 'character_simulation.narrate', 'x', 'character_simulation.act'].map((name) => ({ name }))
    expect(scopePrompts(rows, 'all')).toBe(rows)
    expect(scopePrompts(rows, 'simulation').map((row) => row.name)).toEqual(['character_simulation.narrate', 'character_simulation.act'])
    expect(scopePrompts(rows, 'review')).toEqual([])
  })

  it('scopeEvaluations: 전체는 범용 세트까지 모든 행이고, 흐름은 그 프롬프트들의 짝 세트 행만이며 짝 세트가 없는 흐름은 빈 목록이다', () => {
    expect(scopeEvaluations(AGENT_EVALUATIONS, 'all')).toBe(AGENT_EVALUATIONS)
    const features = (key: PipelineFlowKey) => scopeEvaluations(AGENT_EVALUATIONS, key).map((row) => row.feature)
    expect(features('simulation')).toEqual(['character_simulation.act', 'character_simulation.narrate'])
    expect(features('preprocessing')).toEqual(['manuscript_extraction.extract'])
    // 프롬프트는 있어도 짝 세트가 없는 흐름(웹 고증 검색 행은 '평가 세트 없음')·행이 없는 흐름은 비어 있다. 범용 세트(leak·world·writing)는 전체에서만 보인다.
    for (const key of ['review', 'research', 'writing'] as const) expect(features(key), key).toEqual([])
    expect(AGENT_EVALUATIONS.some((row) => row.dataset && !row.prompt)).toBe(true)
  })
})
