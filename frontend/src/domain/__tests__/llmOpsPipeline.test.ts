import { describe, expect, it } from 'vitest'

import { lastPage } from '../entities/operations'
import {
  LABEL_HEIGHT, NODE_HEIGHT, NODE_WIDTH, PIPELINE_RECORDS_LIMIT, RECORD_RESULTS, filterRecords, flowTree, guardVerdict, layoutPipeline, linkCurve, nodeStats, pipelineSummary, promptTargets, recalledTitles, recordResult, serverLevel, spanMillis, splitOutput, verdictText,
  type PipelineNode, type PipelineRecord,
} from '../entities/llmOpsPipeline'

const node = (id: string, next: string[] = [], extra: Partial<PipelineNode> = {}): PipelineNode => ({ id, label: id, next, standalone: false, count: 0, errors: 0, promptNames: [], ...extra })
const READ = ['qa', 'manuscript_review', 'rating', 'research'], WRITE = ['writing', 'world', 'character_simulation']
const AGENTS = [...READ, ...WRITE]
// 운영 서버(PipelineNodes.kt)의 흐름(DEC-58): 요청 → Guard → 메인 → 업무 Agent 7개(읽기·검토 4개, 작성 3개)·도구, 작성 Agent → 반영 → 도구(메인→도구 직접 선도 있다).
// 모든 업무 Agent는 결과를 메인에 돌려주는 선(되돌아가는 선)이 있어 흐름이 순환이고, 인물 시뮬레이션은 NovelBrain 기억 회상도 잇는다. 노드 배열은 서버 순서다.
const flow = () => [
  node('request', ['guard']), node('guard', ['main']), node('main', [...AGENTS, 'mcp']),
  ...READ.map((id) => node(id, ['main'])),
  ...WRITE.map((id) => node(id, [...(id === 'character_simulation' ? ['apply', 'novelbrain'] : ['apply']), 'main'])),
  node('novelbrain'), node('mcp'), node('apply', ['mcp']),
]
// 운영 서버(PipelineNodes.kt)가 정한 단독 기능 7개(단독 rating은 흐름의 rating과 구분하려 rating_direct).
const SOLO = ['proposals', 'initial_world', 'manuscript_extraction', 'work_tags', 'world_review', 'rating_direct', 'writing_editing']
const solo = () => SOLO.map((id) => node(id, [], { standalone: true }))
const placedById = (nodes: PipelineNode[]) => Object.fromEntries(layoutPipeline(nodes).nodes.map((n) => [n.id, n]))
/** 같은 칸(x)의 노드들이 세로로 겹치지 않는지: 칸마다 y를 정렬해 이웃 간격이 노드 높이 이상이어야 한다. */
const overlapping = (nodes: PipelineNode[]) => {
  const columns = new Map<number, number[]>()
  for (const n of layoutPipeline(nodes).nodes) columns.set(n.x, [...(columns.get(n.x) ?? []), n.y])
  return [...columns.values()].some((ys) => ys.sort((a, b) => a - b).some((y, i) => i > 0 && y - ys[i - 1] < NODE_HEIGHT))
}

describe('layoutPipeline: 서버가 준 노드를 고정 좌표(왼→오 흐름)에 놓는다', () => {
  it('요청 → Guard → 메인 → 업무 Agent 열 → 반영 → 도구 순으로 칸(x)이 늘고, 업무 Agent 7개는 되돌아가는 선이 있어도 한 칸에 모인다', () => {
    const placed = placedById(flow())
    const xs = ['request', 'guard', 'main', 'qa', 'apply', 'mcp'].map((id) => placed[id].x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(new Set(xs).size).toBe(6)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(NODE_WIDTH)
    expect(new Set(AGENTS.map((id) => placed[id].x))).toEqual(new Set([placed.qa.x]))
  })

  it('칸은 서버 배열 순서와 무관하고(순환을 따라간 순서에 칸이 밀리지 않는다), 업무 Agent 열은 읽기·검토가 위·작성이 아래로 겹치지 않게 쌓인다', () => {
    const placed = placedById(flow())
    const mixed = placedById([...flow()].reverse())
    for (const id of Object.keys(placed)) expect(mixed[id].x, id).toBeCloseTo(placed[id].x)
    // 서버 순서대로 위에서 아래로 쌓고, 서버가 두 묶음을 섞어 줘도 읽기·검토가 위다.
    const ys = AGENTS.map((id) => placed[id].y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(NODE_HEIGHT)
    expect(Math.max(...READ.map((id) => mixed[id].y))).toBeLessThan(Math.min(...WRITE.map((id) => mixed[id].y)))
    expect(overlapping([...flow()].reverse())).toBe(false)
  })

  it('요청·Guard·메인은 한 줄에 놓이고 그 줄이 두 묶음 사이 빈칸 가운데를 지나며, 빈칸은 묶음 안 간격보다 넓다(라벨 자리)', () => {
    const placed = placedById(flow())
    expect(new Set(['request', 'guard', 'main'].map((id) => placed[id].y)).size).toBe(1)
    const above = placed.research.y + NODE_HEIGHT / 2, below = placed.writing.y - NODE_HEIGHT / 2
    expect((above + below) / 2).toBeCloseTo(placed.main.y)
    expect(below - above).toBeGreaterThan(placed.world.y - placed.writing.y - NODE_HEIGHT)
  })

  it('메인→도구 직접 선(곡선)은 가운데 줄의 빈칸을 지나 어떤 노드 상자도 가로지르지 않는다', () => {
    const placed = placedById(flow())
    const [p0, p1, p2, p3] = linkCurve(placed.main, placed.mcp, false).points
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, u = 1 - t
      const x = u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x
      const y = u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y
      for (const n of Object.values(placed).filter((other) => other.id !== 'main' && other.id !== 'mcp')) {
        // 선이 노드 가장자리에서 3px 안으로 들어오면 가로지른 것으로 본다.
        expect(Math.abs(x - n.x) < NODE_WIDTH / 2 + 3 && Math.abs(y - n.y) < NODE_HEIGHT / 2 + 3, `${n.id} ${i}`).toBe(false)
      }
    }
  })

  it('단독 기능은 흐름 아래에 따로, 한 줄에 5개를 넘지 않게 고르게 나눠 흐름 가운데 아래에 놓는다', () => {
    const placed = placedById([...flow(), ...solo()])
    const flowIds = ['request', 'guard', 'main', ...AGENTS, 'novelbrain', 'mcp', 'apply']
    const flowBottom = Math.max(...flowIds.map((id) => placed[id].y)) + NODE_HEIGHT / 2
    for (const id of SOLO) expect(placed[id].y - NODE_HEIGHT / 2, id).toBeGreaterThan(flowBottom)
    const rows = new Map<number, number[]>()
    for (const id of SOLO) rows.set(placed[id].y, [...(rows.get(placed[id].y) ?? []), placed[id].x])
    const lines = [...rows.entries()].sort(([a], [b]) => a - b).map(([, xs]) => xs)
    expect(lines.map((xs) => xs.length)).toEqual([4, 3])
    const center = (placed.request.x + placed.mcp.x) / 2
    for (const xs of lines) expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(center)
  })

  it('원점이 가운데가 되게 놓고, 크기는 노드 상자와 묶음 라벨까지 포함한다', () => {
    const layout = layoutPipeline([...flow(), ...solo()])
    const lefts = layout.nodes.map((n) => n.x - NODE_WIDTH / 2), rights = layout.nodes.map((n) => n.x + NODE_WIDTH / 2)
    const tops = [...layout.nodes.map((n) => n.y - NODE_HEIGHT / 2), ...layout.labels.map((l) => l.y - LABEL_HEIGHT / 2)], bottoms = layout.nodes.map((n) => n.y + NODE_HEIGHT / 2)
    expect(layout.width).toBeCloseTo(Math.max(...rights) - Math.min(...lefts))
    expect(layout.height).toBeCloseTo(Math.max(...bottoms) - Math.min(...tops))
    expect(Math.min(...lefts) + Math.max(...rights)).toBeCloseTo(0)
    expect(Math.min(...tops) + Math.max(...bottoms)).toBeCloseTo(0)
  })

  it('업무 Agent 묶음 라벨은 읽기·검토 묶음과 작성 묶음의 첫 노드 위에(왼쪽 가장자리에 맞춰) 달리고, 두 번째 라벨은 두 묶음 사이 빈칸에 들어가며, 묶음 노드가 없으면 달리지 않는다', () => {
    const layout = layoutPipeline(flow()), placed = placedById(flow())
    expect(layout.labels.map((label) => label.text)).toEqual(['읽기·검토', '작성'])
    const [read, write] = layout.labels
    expect([read.x, write.x]).toEqual([placed.qa.x - NODE_WIDTH / 2, placed.writing.x - NODE_WIDTH / 2])
    expect(read.y + LABEL_HEIGHT / 2).toBeLessThan(placed.qa.y - NODE_HEIGHT / 2)
    expect(write.y + LABEL_HEIGHT / 2).toBeLessThan(placed.writing.y - NODE_HEIGHT / 2)
    expect(write.y - LABEL_HEIGHT / 2).toBeGreaterThan(placed.research.y + NODE_HEIGHT / 2)
    expect(layoutPipeline([node('request', ['guard']), node('guard')]).labels).toEqual([])
  })

  it('선은 next를 따라 그리고 없는 노드를 가리키는 선은 버리며, 업무 Agent→메인 7개만 되돌아가는 선(back)이다', () => {
    expect(layoutPipeline([node('a', ['b', 'ghost']), node('b')]).links).toEqual([{ source: 'a', target: 'b', back: false }])
    const links = layoutPipeline(flow()).links
    expect(links).toHaveLength(1 + 1 + 8 + 7 + 3 + 1 + 1)
    expect(links.filter((link) => link.back).map((link) => link.source).sort()).toEqual([...AGENTS].sort())
    expect(links.filter((link) => link.back).every((link) => link.target === 'main')).toBe(true)
    // 메인→도구 직접 선과 반영→도구 선은 앞으로 가는 선이다.
    expect(links).toContainEqual({ source: 'main', target: 'mcp', back: false })
    expect(links).toContainEqual({ source: 'apply', target: 'mcp', back: false })
  })

  it('순환이 있어도 끝나고 모든 노드를 앞에서 이어진 순서대로 놓으며, 돌아오는 선만 back이고 같은 입력이면 같은 좌표다', () => {
    const two = layoutPipeline([node('a', ['b']), node('b', ['a'])])
    expect(two.nodes.map((n) => [n.id, n.x])).toEqual([['a', -(NODE_WIDTH + 48) / 2], ['b', (NODE_WIDTH + 48) / 2]])
    expect(two.links).toEqual([{ source: 'a', target: 'b', back: false }, { source: 'b', target: 'a', back: true }])
    const self = layoutPipeline([node('a', ['a'])])
    expect(self.nodes.map((n) => n.id)).toEqual(['a'])
    expect(self.links).toEqual([{ source: 'a', target: 'a', back: true }])
    const ring = layoutPipeline([node('a', ['b']), node('b', ['c']), node('c', ['a'])])
    expect(ring.links.map((link) => link.back)).toEqual([false, false, true])
    expect(new Set(ring.nodes.map((n) => n.x)).size).toBe(3)
    // 앞이 있는 노드부터 따라가므로 순환 안쪽 노드가 먼저 적혀 있어도 요청이 맨 앞 칸이다.
    const entered = placedById([node('a', ['b']), node('b', ['a']), node('request', ['a'])])
    expect(entered.request.x).toBeLessThan(entered.a.x)
    expect(entered.a.x).toBeLessThan(entered.b.x)
    expect(layoutPipeline(flow())).toEqual(layoutPipeline(flow()))
  })

  it('노드가 없으면 크기 0이다', () => {
    expect(layoutPipeline([])).toEqual({ nodes: [], links: [], labels: [], width: 0, height: 0 })
  })
})

describe('linkCurve: 선의 곡선', () => {
  const from = { x: 0, y: 0 }, to = { x: 180, y: 62 }

  it('앞으로 가는 선은 앞 노드 오른쪽 가장자리에서 다음 노드 왼쪽 가장자리로, 양 끝이 수평으로 닿게 이어 오른쪽을 가리킨다', () => {
    const { points: [p0, p1, p2, p3], dir } = linkCurve(from, to, false)
    expect([p0, p3]).toEqual([{ x: NODE_WIDTH / 2, y: 0 }, { x: 180 - NODE_WIDTH / 2, y: 62 }])
    expect([p1.y, p2.y, p1.x === p2.x]).toEqual([p0.y, p3.y, true])
    expect(dir).toBe(1)
  })

  it('되돌아가는 선은 거꾸로 오른쪽 노드 왼쪽 가장자리에서 왼쪽 노드 오른쪽 가장자리로 이어 왼쪽을 가리키고, 같은 두 노드의 앞으로 가는 선과 겹치지 않게 아래로 비켜 그린다', () => {
    const forward = linkCurve(from, to, false), back = linkCurve(to, from, true)
    const [b0, , , b3] = back.points
    expect([b0.x, b3.x, back.dir]).toEqual([to.x - NODE_WIDTH / 2, from.x + NODE_WIDTH / 2, -1])
    expect(b0.y).toBeGreaterThan(to.y)
    expect(b3.y - from.y).toBe(b0.y - to.y)
    expect([b0.y > forward.points[3].y, b3.y > forward.points[0].y]).toEqual([true, true])
  })
})

const linkedAfter = (id: string, next: string[]) => (n: PipelineNode) => (n.id === id ? { ...n, next } : n)

describe('layoutPipeline: NovelBrain 기억 회상과 모르는 노드', () => {
  it('NovelBrain 기억 회상(인물 시뮬레이션 다음)은 인물 시뮬레이션 오른쪽 같은 줄에 놓이고, 같은 칸의 반영과 겹치지 않는다', () => {
    const placed = placedById(flow())
    expect(placed.novelbrain.x).toBeGreaterThan(placed.character_simulation.x)
    expect(placed.novelbrain.y).toBeCloseTo(placed.character_simulation.y)
    expect(placed.novelbrain.x).toBe(placed.apply.x)
    expect(overlapping(flow())).toBe(false)
  })

  it('모르는 id의 노드도 빠지지 않는다: 연결이 있으면 그 노드 오른쪽 칸에, 연결이 없으면 첫 칸(요청과 같은 칸)에 겹치지 않게 놓인다', () => {
    const loose = placedById([...flow(), node('mystery')])
    expect(Object.keys(loose)).toContain('mystery')
    expect(loose.mystery.x).toBe(loose.request.x)
    expect(Math.abs(loose.mystery.y - loose.request.y)).toBeGreaterThanOrEqual(NODE_HEIGHT)
    expect(overlapping([...flow(), node('mystery')])).toBe(false)
    const wired = [...flow().map(linkedAfter('qa', ['main', 'mystery'])), node('mystery')]
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

  it('지연 글은 같은 밀리초 안에 끝나 0인 값을 1ms 미만으로, 값이 없으면(종료 없음) —로 말한다', () => {
    expect([0, 1, 250, 1500].map((ms) => spanMillis(ms))).toEqual(['1ms 미만', '1ms', '250ms', '1,500ms'])
    expect([null, undefined].map((ms) => spanMillis(ms))).toEqual(['—', '—'])
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
    expect(recalledTitles(rec({ name: 'novelbrain.recall', output: traced }))).toEqual(['리라 · 정체', 'relation:r-kl', 'manuscript:m1'])
    expect(recalledTitles(rec({ metadata: { recalled: [{ title: '메타데이터 쪽' }] } }))).toEqual(['메타데이터 쪽'])
    expect(recalledTitles(rec({ output: { recalled: [] } }))).toEqual([])
    expect(recalledTitles(rec({ output: { recalled: '카엘' } }))).toBeNull()
    expect(recalledTitles(rec({ output: '글' }))).toBeNull()
    expect(recalledTitles(rec())).toBeNull()
  })

  it('회상한 카드 항목은 ref의 문서 조각을 제목 뒤에 붙인다(정체·성격·목표, 그 밖의 조각은 원문 그대로, 조각이 없으면 제목만)', () => {
    const card = (ref: string, title = '하린') => ({ ref, card_id: 'c1', title, score: 0.5 })
    const recalled = [
      card('card:c1#identity'), card('card:c1#goal'), card('card:c1#soul'), card('card:c1#ep03'),
      card('card:w1', '세계수'), card('card:c1#'), { name: '카엘', ref: 'card:c2#soul' }, { ref: 'card:c1#goal' },
    ]
    // 같은 인물 카드가 정체·목표·성격 문서로 따로 회상돼도 줄마다 어느 문서인지 보인다. 제목이 없는 항목은 ref가 이미 조각을 담아 그대로다.
    expect(recalledTitles(rec({ output: { recalled } }))).toEqual([
      '하린 · 정체', '하린 · 목표', '하린 · 성격', '하린 · ep03', '세계수', '하린', '카엘 · 성격', 'card:c1#goal',
    ])
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
