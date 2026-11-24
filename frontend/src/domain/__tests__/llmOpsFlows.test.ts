import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { PIPELINE_FLOWS, type PipelineFlowKey } from '../entities/admin'
import { FLOW_DEFS, flowNodes, flowOfNode, isFlowStepId } from '../entities/llmOpsFlows'
import { NODE_HEIGHT, NODE_WIDTH, layoutPipeline, type PipelineNode } from '../entities/llmOpsPipeline'
import { PROMPT_NAMES } from '../entities/promptNames'

const read = (path: string) => readFileSync(new URL('../../../../' + path, import.meta.url), 'utf8')
/** 운영 서비스의 서버 고정 노드 id(PipelineNodes.kt): chat("id", …)·alone("id", …)·NodeSpec("id", …). */
const SERVER_IDS = [...read('backend/operations-service/src/main/kotlin/ai/storyfork/operations/llmops/service/PipelineNodes.kt').matchAll(/(?:chat|alone)\("([a-z_]+)"|NodeSpec\("([a-z_]+)"/g)].map((m) => m[1] ?? m[2])
/** AI 서비스가 기동 때 등록하는 프롬프트(prompts.py SEEDS). */
const SEEDS = [...read('backend/ai-service/app/prompts.py').split('SEEDS: dict[str, str] = {')[1].split('\n}')[0].matchAll(/^\s+'([a-z_.0-9]+)':/gm)].map((m) => m[1])

const KEYS = PIPELINE_FLOWS.map(([key]) => key).filter((key): key is Exclude<PipelineFlowKey, 'all'> => key !== 'all')
const node = (id: string, extra: Partial<PipelineNode> = {}): PipelineNode => ({ id, label: `서버 ${id}`, next: ['main'], standalone: true, count: 7, errors: 1, p95LatencyMs: 900, promptNames: ['server.prompt'], ...extra })
const server = SERVER_IDS.map((id) => node(id))
const edges = (key: Exclude<PipelineFlowKey, 'all'>) => FLOW_DEFS[key].steps.flatMap((s) => s.next.map((to) => [s.id, to]))
const promptsOf = (key: Exclude<PipelineFlowKey, 'all'>) => [...new Set(FLOW_DEFS[key].steps.flatMap((s) => s.prompts ?? []))].sort()

describe('워크플로우 정의(#857 3차): 내부에 순서 있는 여러 LLM 단계가 있는 에이전트의 단계·연결', () => {
  it('드롭다운 항목(전체 제외)마다 정의가 하나씩 있다', () => {
    expect(Object.keys(FLOW_DEFS)).toEqual(KEYS)
    expect(SERVER_IDS.length).toBeGreaterThan(15)
  })

  it('단계 id는 흐름 안에서 겹치지 않고, 연결은 같은 흐름의 단계만 가리키며, 처음 단계(앞이 없는 단계)가 있다', () => {
    for (const key of KEYS) {
      const ids = FLOW_DEFS[key].steps.map((s) => s.id)
      expect(new Set(ids).size, key).toBe(ids.length)
      for (const [from, to] of edges(key)) expect(ids, `${key} ${from}→${to}`).toContain(to)
      expect(ids.filter((id) => !edges(key).some(([, to]) => to === id)).length, key).toBeGreaterThan(0)
    }
  })

  it('서버 노드와 1:1인 단계는 실제 서버 노드 id이고 구조용 단계는 흐름 이름 뒤에 :가 붙은 id이며, 흐름이 속한 노드(parent)는 실제 서버 노드다', () => {
    for (const key of KEYS) {
      const def = FLOW_DEFS[key]
      expect(SERVER_IDS, `${key} node`).toContain(def.node)
      expect(flowOfNode(def.node)).toBe(key)
      for (const step of def.steps) {
        if (step.server) expect([SERVER_IDS.includes(step.id), isFlowStepId(step.id)], step.id).toEqual([true, false])
        else expect([step.id.startsWith(key + ':'), isFlowStepId(step.id)], step.id).toEqual([true, true])
      }
    }
    expect([flowOfNode('guard'), flowOfNode('nope')]).toEqual([null, null])
  })

  it('구조용 단계는 설명을 가지고, LLM 호출 단계는 프롬프트가 있고(알려진 프롬프트) LLM 아님 단계는 프롬프트가 없다', () => {
    for (const key of KEYS) {
      for (const step of FLOW_DEFS[key].steps.filter((s) => !s.server)) {
        expect(step.note?.trim(), step.id).toBeTruthy()
        if (step.llm) expect(step.prompts?.length, step.id).toBeGreaterThan(0)
        else expect(step.prompts ?? [], step.id).toEqual([])
        for (const prompt of step.prompts ?? []) expect(PROMPT_NAMES.has(prompt), prompt).toBe(true)
      }
    }
  })

  it('각 흐름의 프롬프트는 그 에이전트가 AI 서비스에 등록하는 프롬프트(SEEDS) 전부와 같다(코드에 프롬프트가 더해지면 흐름도 고친다)', () => {
    const owned = (...prefixes: string[]) => SEEDS.filter((code) => prefixes.some((p) => code.startsWith(p))).sort()
    expect(promptsOf('simulation')).toEqual(owned('character_simulation.'))
    expect(promptsOf('preprocessing')).toEqual(owned('manuscript_extraction.'))
    expect(promptsOf('review')).toEqual(owned('manuscript_review.'))
    expect(promptsOf('research')).toEqual(owned('research.', 'web_research.'))
    expect(promptsOf('writing')).toEqual(owned('writing_editing.'))
  })
})

describe('flowNodes: 흐름 정의 + 서버 노드 목록 → 캔버스 노드', () => {
  it('전체는 서버 노드 그대로라 null이고, 서버 노드와 1:1인 단계는 서버의 이름·건수·오류·프롬프트를 쓰되 연결은 흐름의 것이다', () => {
    expect(flowNodes('all', server)).toBeNull()
    const nodes = flowNodes('simulation', server)!
    const recall = nodes.find((n) => n.id === 'novelbrain')!
    expect(recall).toEqual({ id: 'novelbrain', label: '서버 novelbrain', next: ['simulation:write'], standalone: false, count: 7, errors: 1, p95LatencyMs: 900, promptNames: ['server.prompt'] })
    expect(nodes.map((n) => n.id)).toEqual(FLOW_DEFS.simulation.steps.map((s) => s.id))
  })

  it('서버 노드가 없는 단계는 구조용 노드다: 건수·오류 0, 이름·프롬프트·설명은 정의의 것이고 LLM 여부가 붙는다', () => {
    const director = flowNodes('simulation', server)!.find((n) => n.id === 'simulation:director')!
    expect(director).toMatchObject({ label: '연출 결정', standalone: false, count: 0, errors: 0, promptNames: ['character_simulation.direct'], next: ['novelbrain'], step: { llm: true } })
    expect(director.step?.note).toContain('Decisions')
    const apply = flowNodes('simulation', server)!.find((n) => n.id === 'simulation:apply')!
    expect([apply.step?.llm, apply.promptNames, apply.next]).toEqual([false, [], []])
  })

  it('서버 응답에 없는 서버 노드 단계는 구조용으로 그려 흐름이 끊기지 않는다: id는 흐름 키를 붙여 늘 콜론(:)을 품고(서버에 기록을 묻지 않는다) 이웃의 연결이 그 id를 따라가며, 입력 목록은 바꾸지 않는다', () => {
    const without = server.filter((n) => n.id !== 'novelbrain')
    const before = JSON.stringify(without)
    const nodes = flowNodes('simulation', without)!
    const recall = nodes.find((n) => n.label === 'NovelBrain 기억 회상')!
    expect(recall).toMatchObject({ id: 'simulation:novelbrain', count: 0, errors: 0, step: { llm: false } })
    expect(recall.step?.note).toContain('서버 응답에 이 노드가 있으면')
    expect(nodes.filter((n) => n.step).every((n) => isFlowStepId(n.id))).toBe(true)   // 구조용 노드는 모두 ':' id
    expect(nodes.find((n) => n.id === 'simulation:director')!.next).toEqual(['simulation:novelbrain'])
    const ids = new Set(nodes.map((n) => n.id))
    expect(nodes.flatMap((n) => n.next).every((to) => ids.has(to))).toBe(true)         // 끊긴 연결이 없다
    expect(JSON.stringify(without)).toBe(before)
    expect(flowNodes('simulation', [])!).toHaveLength(FLOW_DEFS.simulation.steps.length)
  })
})

describe('흐름 배치: 기존 layoutPipeline을 그대로 쓴다', () => {
  const layoutOf = (key: Exclude<PipelineFlowKey, 'all'>) => layoutPipeline(flowNodes(key, server)!)

  it('모든 단계가 겹치지 않게 놓이고 앞으로 가는 선은 왼쪽에서 오른쪽으로 간다', () => {
    for (const key of KEYS) {
      const layout = layoutOf(key)
      expect(layout.nodes, key).toHaveLength(FLOW_DEFS[key].steps.length)
      layout.nodes.forEach((a, i) => layout.nodes.slice(i + 1).forEach((b) => expect(Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT, `${key} ${a.id} ${b.id}`).toBe(false)))
      const at = new Map(layout.nodes.map((n) => [n.id, n]))
      for (const link of layout.links.filter((l) => !l.back)) expect(at.get(link.source)!.x, `${key} ${link.source}→${link.target}`).toBeLessThan(at.get(link.target)!.x)
      expect(layout.links, key).toHaveLength(edges(key).length)
    }
  })

  it('되돌아가는 선은 인물 시뮬레이션 검사의 다시 쓰기·다음 턴 둘뿐이다', () => {
    const backs = (key: Exclude<PipelineFlowKey, 'all'>) => layoutOf(key).links.filter((l) => l.back).map((l) => [l.source, l.target])
    expect(backs('simulation')).toEqual([['simulation:check', 'simulation:director'], ['simulation:check', 'simulation:write']])
    for (const key of KEYS.filter((k) => k !== 'simulation')) expect(backs(key), key).toEqual([])
  })

  it('한 줄 흐름(전처리·시뮬레이션)은 같은 높이에 놓이고, 멀리 되돌아가는 호(다음 턴)는 노드 아래로 내려오는 자리를 전체 높이에 더한다', () => {
    for (const key of ['preprocessing', 'simulation'] as const) expect(new Set(layoutOf(key).nodes.map((n) => n.y)).size, key).toBe(1)
    expect(layoutOf('preprocessing').height).toBe(NODE_HEIGHT)
    expect(layoutOf('simulation').height).toBeGreaterThan(NODE_HEIGHT)
  })
})
