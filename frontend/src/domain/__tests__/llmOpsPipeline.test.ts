import { describe, expect, it } from 'vitest'

import { lastPage } from '../entities/operations'
import {
  NODE_HEIGHT, NODE_WIDTH, PIPELINE_RECORDS_LIMIT, RECORD_RESULTS, filterRecords, flowTree, guardVerdict, layoutPipeline, nodeStats, pipelineSummary, promptTargets, recalledTitles, recordResult, serverLevel, splitOutput, verdictText,
  type PipelineNode, type PipelineRecord,
} from '../entities/llmOpsPipeline'

const node = (id: string, next: string[] = [], extra: Partial<PipelineNode> = {}): PipelineNode => ({ id, label: id, next, standalone: false, count: 0, errors: 0, promptNames: [], ...extra })
const AGENTS = ['qa', 'writing', 'manuscript_review', 'world', 'research', 'rating', 'character_simulation']
// 계약(DEC-58) 표의 흐름: 요청 → Guard → 메인 → 업무 Agent 7개·도구 → 반영.
const flow = () => [node('request', ['guard']), node('guard', ['main']), node('main', [...AGENTS, 'mcp']), ...AGENTS.map((id) => node(id, ['apply'])), node('mcp'), node('apply')]
// 운영 서버(PipelineNodes.kt)가 정한 단독 기능 7개(단독 rating은 흐름의 rating과 구분하려 rating_direct).
const SOLO = ['proposals', 'initial_world', 'manuscript_extraction', 'work_tags', 'world_review', 'rating_direct', 'writing_editing']
const solo = () => SOLO.map((id) => node(id, [], { standalone: true }))
const placedById = (nodes: PipelineNode[]) => Object.fromEntries(layoutPipeline(nodes).nodes.map((n) => [n.id, n]))

describe('layoutPipeline: 서버가 준 노드를 고정 좌표(왼→오 흐름)에 놓는다', () => {
  it('요청 → Guard → 메인 → 업무 Agent·도구 → 반영 순으로 칸(x)이 늘고, 같은 칸의 노드는 서버 순서대로 겹치지 않게 세로로 쌓는다', () => {
    const placed = placedById(flow())
    const xs = ['request', 'guard', 'main', 'qa', 'apply'].map((id) => placed[id].x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(new Set(xs).size).toBe(5)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(NODE_WIDTH)
    const column = [...AGENTS, 'mcp'].map((id) => placed[id])
    expect(new Set(column.map((n) => n.x))).toEqual(new Set([placed.qa.x]))
    for (let i = 1; i < column.length; i++) expect(column[i].y - column[i - 1].y).toBeGreaterThanOrEqual(NODE_HEIGHT)
    // 반영은 모든 업무 Agent보다 오른쪽 칸이다(도구는 메인의 다음 칸이라 같은 칸에 남는다).
    expect(placed.apply.x).toBeGreaterThan(placed.qa.x)
  })

  it('단독 기능은 흐름 아래에 따로, 한 줄에 5개를 넘지 않게 고르게 나눠 흐름 가운데 아래에 놓는다', () => {
    const placed = placedById([...flow(), ...solo()])
    const flowIds = ['request', 'guard', 'main', ...AGENTS, 'mcp', 'apply']
    const flowBottom = Math.max(...flowIds.map((id) => placed[id].y)) + NODE_HEIGHT / 2
    for (const id of SOLO) expect(placed[id].y - NODE_HEIGHT / 2, id).toBeGreaterThan(flowBottom)
    const rows = new Map<number, number[]>()
    for (const id of SOLO) rows.set(placed[id].y, [...(rows.get(placed[id].y) ?? []), placed[id].x])
    const lines = [...rows.entries()].sort(([a], [b]) => a - b).map(([, xs]) => xs)
    expect(lines.map((xs) => xs.length)).toEqual([4, 3])
    const center = (placed.request.x + placed.apply.x) / 2
    for (const xs of lines) expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(center)
  })

  it('원점이 가운데가 되게 놓고, 크기는 노드 상자까지 포함한다', () => {
    const layout = layoutPipeline([...flow(), ...solo()])
    const xs = layout.nodes.map((n) => n.x), ys = layout.nodes.map((n) => n.y)
    expect(layout.width).toBe(Math.max(...xs) - Math.min(...xs) + NODE_WIDTH)
    expect(layout.height).toBe(Math.max(...ys) - Math.min(...ys) + NODE_HEIGHT)
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0)
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0)
  })

  it('선은 next를 따라 그리고 없는 노드를 가리키는 선은 버린다', () => {
    expect(layoutPipeline([node('a', ['b', 'ghost']), node('b')]).links).toEqual([{ source: 'a', target: 'b' }])
    expect(layoutPipeline(flow()).links).toHaveLength(1 + 1 + 8 + 7)
  })

  it('순환이 있어도 끝나고 모든 노드를 놓으며, 같은 입력이면 같은 좌표다', () => {
    const loop = [node('a', ['b']), node('b', ['a'])]
    expect(layoutPipeline(loop).nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(layoutPipeline(flow())).toEqual(layoutPipeline(flow()))
  })

  it('노드가 없으면 크기 0이다', () => {
    expect(layoutPipeline([])).toEqual({ nodes: [], links: [], width: 0, height: 0 })
  })
})

// 운영 서버가 NovelBrain 기억 회상(novelbrain)을 인물 시뮬레이션 다음에 이은 두 모양: 반영과 나란히 이은 것, 인물 시뮬레이션과 반영 사이에 끼운 것.
const linkedAfter = (id: string, next: string[]) => (n: PipelineNode) => (n.id === id ? { ...n, next } : n)
const novelBrainBeside = () => [...flow().map(linkedAfter('character_simulation', ['apply', 'novelbrain'])), node('novelbrain')]
const novelBrainBetween = () => [...flow().map(linkedAfter('character_simulation', ['novelbrain'])), node('novelbrain', ['apply'])]
/** 같은 칸(x)의 노드들이 세로로 겹치지 않는지: 칸마다 y를 정렬해 이웃 간격이 노드 높이 이상이어야 한다. */
const overlapping = (nodes: PipelineNode[]) => {
  const columns = new Map<number, number[]>()
  for (const n of layoutPipeline(nodes).nodes) columns.set(n.x, [...(columns.get(n.x) ?? []), n.y])
  return [...columns.values()].some((ys) => ys.sort((a, b) => a - b).some((y, i) => i > 0 && y - ys[i - 1] < NODE_HEIGHT))
}

describe('layoutPipeline: NovelBrain 기억 회상과 모르는 노드', () => {
  it('NovelBrain 기억 회상(인물 시뮬레이션 다음)은 어느 쪽으로 이었든 인물 시뮬레이션 오른쪽 칸에 놓이고 다른 노드와 겹치지 않는다', () => {
    for (const nodes of [novelBrainBeside(), novelBrainBetween()]) {
      const placed = placedById(nodes)
      expect(placed.novelbrain.x).toBeGreaterThan(placed.character_simulation.x)
      expect(placed.apply.x).toBeGreaterThan(placed.character_simulation.x)
      expect(overlapping(nodes)).toBe(false)
    }
    // 반영과 나란히 이으면 같은 칸, 인물 시뮬레이션과 반영 사이에 끼우면 반영이 그 오른쪽 칸이다.
    const beside = placedById(novelBrainBeside())
    expect(beside.novelbrain.x).toBe(beside.apply.x)
    const between = placedById(novelBrainBetween())
    expect(between.apply.x).toBeGreaterThan(between.novelbrain.x)
  })

  it('모르는 id의 노드도 빠지지 않는다: 연결이 있으면 그 노드 오른쪽 칸에, 연결이 없으면 첫 칸(요청과 같은 칸)에 겹치지 않게 놓인다', () => {
    const loose = placedById([...flow(), node('mystery')])
    expect(Object.keys(loose)).toContain('mystery')
    expect(loose.mystery.x).toBe(loose.request.x)
    expect(Math.abs(loose.mystery.y - loose.request.y)).toBeGreaterThanOrEqual(NODE_HEIGHT)
    expect(overlapping([...flow(), node('mystery')])).toBe(false)
    const wired = [...flow().map(linkedAfter('qa', ['apply', 'mystery'])), node('mystery')]
    expect(placedById(wired).mystery.x).toBeGreaterThan(placedById(wired).qa.x)
    expect(overlapping(wired)).toBe(false)
    // 단독 기능으로 오면 단독 줄(흐름 아래)에 놓인다.
    const solo = placedById([...flow(), node('mystery', [], { standalone: true })])
    expect(solo.mystery.y).toBeGreaterThan(solo.apply.y)
  })
})

describe('노드 표시 글', () => {
  it('요약은 노드 수와 오류가 있는 노드 수를, 건수 줄은 건수와 오류 수를 쉼표 숫자로 말한다', () => {
    expect(pipelineSummary([node('a', [], { count: 3 }), node('b', [], { count: 5, errors: 2 })])).toBe('집필 AI 파이프라인: 노드 2개, 오류가 있는 노드 1개')
    expect(nodeStats(node('g', [], { count: 1234, errors: 0 }))).toBe('1,234건 · 오류 0건')
  })

  it('결과 필터는 전체·통과·거절/오류이고 전체만 서버에 보내지 않는 빈 값이다', () => {
    expect(RECORD_RESULTS.map(([, label]) => label)).toEqual(['전체', '통과', '거절/오류'])
    expect(RECORD_RESULTS[0][0]).toBe('')
  })

  it('서버는 노드 기록을 최신 1,000건(20건씩 0~49쪽)까지만 주고 그 밖의 쪽은 400이라, 그 안의 쪽까지만 열 수 있다', () => {
    expect(PIPELINE_RECORDS_LIMIT).toBe(1000)
    expect(lastPage(41, 20, PIPELINE_RECORDS_LIMIT)).toBe(2)
    expect(lastPage(5000, 20, PIPELINE_RECORDS_LIMIT)).toBe(49)
  })
})

const rec = (extra: Partial<PipelineRecord> = {}): PipelineRecord => ({ id: 'o1', traceId: 't1', name: 'decision_guard', type: 'SPAN', startTime: '2026-11-21T01:00:00Z', latencyMs: 120, level: 'DEFAULT', ...extra })

describe('flowTree: 한 작업의 observation 트리', () => {
  const obs = (id: string, parent: string | null, startTime: string | null = null) => ({ id, parentObservationId: parent, startTime })

  it('부모 아래에 자식을 시작 시각 순으로, 깊이와 함께 펼친다', () => {
    const rows = flowTree([
      obs('c2', 'root', '2026-11-21T01:00:02Z'), obs('root', null, '2026-11-21T01:00:00Z'), obs('c1', 'root', '2026-11-21T01:00:01Z'), obs('g1', 'c1', '2026-11-21T01:00:01.500Z'),
    ])
    expect(rows.map((row) => [row.observation.id, row.depth])).toEqual([['root', 0], ['c1', 1], ['g1', 2], ['c2', 1]])
  })

  it('시작 시각이 같거나 없으면 받은 순서를 지킨다', () => {
    expect(flowTree([obs('r', null), obs('b', 'r'), obs('a', 'r')]).map((row) => row.observation.id)).toEqual(['r', 'b', 'a'])
  })

  it('부모가 목록에 없는 단계는 맨 위 줄로 올리고, 순환이어도 한 줄도 잃거나 되풀이하지 않는다', () => {
    const rows = flowTree([obs('a', 'missing'), obs('b', 'c'), obs('c', 'b')])
    expect(rows.map((row) => row.observation.id).sort()).toEqual(['a', 'b', 'c'])
    expect(rows.find((row) => row.observation.id === 'a')?.depth).toBe(0)
  })
})

describe('Guard 판정·메인 출력 읽기', () => {
  it('허용·거절 판정은 decision_guard 출력에서 이유와 기능별 판정까지 읽는다', () => {
    expect(guardVerdict(rec({ output: { allowed: true, reason: null, capabilities: ['qa', 'writing_editing'] } }))).toEqual({ allowed: true, reason: null, capabilities: ['qa', 'writing_editing'] })
    expect(guardVerdict(rec({ output: { allowed: false, reason: 'out_of_scope', capabilities: [] } }))).toEqual({ allowed: false, reason: 'out_of_scope', capabilities: [] })
  })

  it('출력이 아직 없던 이전 기록은 metadata의 판정을 쓰고, Guard 기록이 아니거나 판정 모양이 아니면 null이다', () => {
    expect(guardVerdict(rec({ metadata: { allowed: false, reason: 'greeting', capabilities: [] } }))).toEqual({ allowed: false, reason: 'greeting', capabilities: [] })
    expect(guardVerdict(rec({ name: 'main_agent', output: { allowed: true } }))).toBeNull()
    expect(guardVerdict(rec({ output: '글' }))).toBeNull()
    expect(guardVerdict(rec({ output: { allowed: 'yes' } }))).toBeNull()
    expect(guardVerdict(rec())).toBeNull()
  })

  it('결과 칸은 오류, Guard의 허용·거절, 경고, 그 밖의 통과로 가른다', () => {
    expect(recordResult(rec({ level: 'ERROR', output: { allowed: true } }))).toEqual({ label: '오류', tone: 'bad' })
    expect(recordResult(rec({ output: { allowed: true, capabilities: ['qa'] } }))).toEqual({ label: '허용', tone: 'ok' })
    expect(recordResult(rec({ output: { allowed: false, reason: 'out_of_scope', capabilities: [] } }))).toEqual({ label: '거절', tone: '' })
    expect(recordResult(rec({ name: 'step.qa', level: 'WARNING' }))).toEqual({ label: '경고', tone: '' })
    expect(recordResult(rec({ name: 'step.qa' }))).toEqual({ label: '통과', tone: 'ok' })
    // 메인이 실행하지 않고 돌려보낸 도구 호출 기록(level은 DEFAULT)은 통과가 아니라 차단이다.
    expect(recordResult(rec({ name: 'main_agent.blocked' }))).toEqual({ label: '차단', tone: '' })
    expect(recordResult(rec({ name: 'main_agent.blocked', level: 'ERROR' }))).toEqual({ label: '오류', tone: 'bad' })
  })

  it('메인 출력({text, toolCalls})은 글과 도구 호출(이름·인자)로 나누고 이름 없는 항목은 버린다', () => {
    const call = { name: 'ask_story_qa', args: { request: '주인공 이름이 뭐지?' } }
    expect(splitOutput({ text: '조회할게요.', toolCalls: [call, { args: {} }, 'x', null] })).toEqual({ text: '조회할게요.', calls: [call] })
    expect(splitOutput({ toolCalls: [call] })).toEqual({ text: '', calls: [call] })
    expect(splitOutput({ text: '글', toolCalls: [] })).toEqual({ text: '글', calls: [] })
  })

  it('toolCalls·text 말고 다른 필드가 있는 출력은 메인 에이전트 모양이 아니라 JSON 그대로 보이고 다른 필드를 버리지 않는다', () => {
    const output = { toolCalls: [], summary: '조사 결과' }
    expect(splitOutput(output)).toEqual({ text: JSON.stringify(output, null, 2), calls: [] })
    const withCall = { text: '글', toolCalls: [{ name: 'ask_story_qa', args: {} }], extra: 1 }
    expect(splitOutput(withCall)).toEqual({ text: JSON.stringify(withCall, null, 2), calls: [] })
  })

  it('Guard 결과 칸의 보조 글은 거절 이유 코드와 필요한 기능을 쓰고, 기능은 집필 채팅이 쓰는 표시 이름이며 모르는 코드는 그대로 둔다', () => {
    expect(verdictText({ allowed: true, reason: null, capabilities: ['writing_editing', 'story_context'] })).toBe('기능 기획·집필·수정, 작품 질문')
    expect(verdictText({ allowed: true, reason: null, capabilities: ['story_context', 'brand_new'] })).toBe('기능 작품 질문, brand_new')
    expect(verdictText({ allowed: false, reason: 'out_of_scope', capabilities: [] })).toBe('out_of_scope')
    expect(verdictText({ allowed: true, reason: null, capabilities: [] })).toBe('')
    // 객체 기본 속성 이름이 표시 이름 대신 함수로 새지 않는다.
    expect(verdictText({ allowed: true, reason: null, capabilities: ['constructor'] })).toBe('기능 constructor')
  })

  it('Decision Guard가 고를 수 있는 일곱 기능 코드는 모두 표시 이름이 있다(코드가 그대로 보이지 않는다)', () => {
    const codes = ['story_context', 'manuscript_review', 'world', 'character_simulation', 'writing_editing', 'research', 'rating']
    for (const code of codes) expect(verdictText({ allowed: true, reason: null, capabilities: [code] }), code).not.toBe(`기능 ${code}`)
  })

  it('그 밖의 출력은 글은 그대로, 객체는 들여쓴 JSON이고 비어 있으면 빈 글이다', () => {
    expect(splitOutput('그냥 글')).toEqual({ text: '그냥 글', calls: [] })
    expect(splitOutput({ allowed: true })).toEqual({ text: JSON.stringify({ allowed: true }, null, 2), calls: [] })
    expect(splitOutput({ text: '도구 목록 없음' })).toEqual({ text: JSON.stringify({ text: '도구 목록 없음' }, null, 2), calls: [] })
    expect(splitOutput(null)).toEqual({ text: '', calls: [] })
    expect(splitOutput(undefined)).toEqual({ text: '', calls: [] })
  })

  it('NovelBrain 회상 기록은 recalled 목록의 제목을 읽고(글 항목·title·name·ref 순), 출력에 없으면 metadata에서 읽으며, 목록이 아니면 null이다', () => {
    const recalled = ['리안', { title: '카엘', ref: 'card:1' }, { name: '세계수', ref: 'card:2' }, { ref: 'ep:2#4' }, {}, 5, null, { title: '' }]
    expect(recalledTitles(rec({ name: 'novelbrain.recall', output: { recalled, gaps: [] } }))).toEqual(['리안', '카엘', '세계수', 'ep:2#4'])
    // AI가 남기는 모양: 카드 항목은 제목이 있고 관계·원고 항목은 ref와 점수뿐이라 ref로 보인다.
    const traced = { count: 3, recalled: [{ ref: 'card:lira#identity', card_id: 'lira', title: '리라', score: 0.8 }, { ref: 'relation:r-kl', score: 0.6 }, { ref: 'manuscript:m1', score: 0.5 }] }
    expect(recalledTitles(rec({ name: 'novelbrain.recall', output: traced }))).toEqual(['리라', 'relation:r-kl', 'manuscript:m1'])
    expect(recalledTitles(rec({ metadata: { recalled: [{ title: '메타데이터 쪽' }] } }))).toEqual(['메타데이터 쪽'])
    expect(recalledTitles(rec({ output: { recalled: [] } }))).toEqual([])
    expect(recalledTitles(rec({ output: { recalled: '카엘' } }))).toBeNull()
    expect(recalledTitles(rec({ output: '글' }))).toBeNull()
    expect(recalledTitles(rec())).toBeNull()
  })

  it('프롬프트 보기 대상은 그 기록의 프롬프트이고, 없으면 노드에 연결된 프롬프트다', () => {
    const guard = node('guard', [], { promptNames: ['decision_guard.judge'] })
    expect(promptTargets(guard, rec({ promptName: 'decision_guard.judge' }))).toEqual(['decision_guard.judge'])
    expect(promptTargets(node('qa', [], { promptNames: ['qa-answer', 'qa-check'] }), rec({ name: 'step.qa' }))).toEqual(['qa-answer', 'qa-check'])
    expect(promptTargets(node('apply'), rec({ name: 'step.qa.apply' }))).toEqual([])
  })
})

describe('결과 필터: Guard는 거절이 level이 아니라 출력(allowed=false)이라 받은 쪽 안에서 가린다', () => {
  const allowed = rec({ id: 'a', output: { allowed: true, reason: null, capabilities: ['qa'] } })
  const rejected = rec({ id: 'r', output: { allowed: false, reason: 'out_of_scope', capabilities: [] } })
  const failed = rec({ id: 'e', level: 'ERROR' })
  const generation = rec({ id: 'g', name: 'decision_guard.generation' })
  const rows = [allowed, rejected, failed, generation]
  const ids = (list: PipelineRecord[]) => list.map((r) => r.id)

  it('Guard 노드는 서버에 level 조건을 보내지 않고, 다른 노드는 고른 값 그대로 보낸다', () => {
    expect(['', 'DEFAULT', 'ERROR'].map((value) => serverLevel('guard', value))).toEqual(['', '', ''])
    expect(['', 'DEFAULT', 'ERROR'].map((value) => serverLevel('qa', value))).toEqual(['', 'DEFAULT', 'ERROR'])
  })

  it('Guard의 거절/오류는 오류 수준이거나 판정이 거절인 기록, 통과는 나머지 중 수준이 DEFAULT인 기록이다', () => {
    expect(ids(filterRecords('guard', 'ERROR', rows))).toEqual(['r', 'e'])
    expect(ids(filterRecords('guard', 'DEFAULT', rows))).toEqual(['a', 'g'])
    expect(ids(filterRecords('guard', 'DEFAULT', [...rows, rec({ id: 'w', level: 'WARNING' })]))).toEqual(['a', 'g'])
    expect(ids(filterRecords('guard', '', rows))).toEqual(['a', 'r', 'e', 'g'])
  })

  it('다른 노드의 기록은 서버가 이미 가려 줬으므로 그대로 둔다', () => {
    expect(ids(filterRecords('qa', 'ERROR', rows))).toEqual(['a', 'r', 'e', 'g'])
  })
})
