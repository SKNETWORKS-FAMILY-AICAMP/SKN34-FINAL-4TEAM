import { bodyText, count } from './llmOps'
import { featureLabel } from './writingChat'

/**
 * AI 파이프라인 관찰 값(DEC-58)과 순수 함수. 노드 목록·건수는 운영 서비스가 Langfuse observation에서 모아 주고, 화면은 그 노드를 고정 좌표에 그립니다.
 * 비어 올 수 있는 값은 `?: T | null`이고 0으로 바꾸지 않습니다.
 */
export type PipelineNode = {
  id: string; label: string; next: string[]
  /** 요청 흐름 밖의 단독 기능입니다(캔버스 아래 줄에 따로 놓습니다). */
  standalone: boolean
  count: number; errors: number; p95LatencyMs?: number | null
  /** 그 노드의 generation에 연결된 프롬프트 이름 */
  promptNames: string[]
}
export type PipelineQuery = { from: string; to: string }
export type PipelineRecord = {
  id: string; traceId: string; name: string; type: string; startTime?: string | null; latencyMs?: number | null; level: string
  statusMessage?: string | null; model?: string | null; promptName?: string | null; promptVersion?: number | null
  /** 칸마다 앞 8,000자까지입니다. 모양은 노드마다 달라 그대로 둡니다. */
  input?: unknown; output?: unknown; metadata?: unknown
}
/** 비어 있는 조건(전체)은 서버에 보내지 않습니다. page는 0부터이고 한 쪽은 20건입니다. */
export type PipelineRecordQuery = PipelineQuery & { nodeId: string; level: string; page: number }

/** 서버는 노드 기록을 최신 1,000건까지만 주고(20건씩 0~49쪽) 그 밖의 쪽은 400으로 거절합니다. */
export const PIPELINE_RECORDS_LIMIT = 1000

/** 기록 결과 필터. 값은 서버 level 조건이고 전체만 빈 값(보내지 않음)입니다. */
export const RECORD_RESULTS: [string, string][] = [['', '전체'], ['DEFAULT', '통과'], ['ERROR', '거절/오류']]

export const NODE_WIDTH = 132
export const NODE_HEIGHT = 48
/** 묶음 라벨 글줄의 높이. 캔버스는 라벨 y를 글줄의 가운데로 그립니다. */
export const LABEL_HEIGHT = 14
const COLUMN_GAP = 48
const ROW_GAP = 14
/** 묶음 사이는 같은 묶음 안(ROW_GAP)보다 이만큼 더 벌립니다: 라벨이 들어가고, 가운데 줄의 메인→도구 직접 선이 업무 Agent 위를 지나지 않고 통과하는 빈칸입니다. */
const GROUP_GAP = 42
const LABEL_GAP = 4
const SOLO_GAP = 36
const SOLO_COLUMN_GAP = 14
const SOLO_PER_ROW = 5
/** 되돌아가는 선을 같은 두 노드의 앞으로 가는 선과 겹치지 않게 내려 그리는 높이와, 굽는 자리를 되돌아가는 쪽으로 당기는 거리입니다. */
const RETURN_DROP = 10
const RETURN_BEND = 10

/**
 * 업무 Agent 묶음(DEC-58 화면): 같은 칸 안에서 묶음끼리 따로 쌓고(앞 묶음이 위) 각 묶음의 가장 위 노드 위에 라벨을 답니다.
 * ponytail: 표는 코드에 고정입니다. 표에 없는 노드는 묶음 밖(맨 아래)에 놓이고 라벨 없이 그려지며, 새 Agent는 서버 노드 목록과 함께 여기에도 넣습니다.
 */
const GROUPS = [
  { label: '읽기·검토', ids: ['qa', 'manuscript_review', 'rating', 'research'] },
  { label: '작성', ids: ['writing', 'world', 'character_simulation'] },
]
const groupOf = (id: string) => { const i = GROUPS.findIndex((group) => group.ids.includes(id)); return i < 0 ? GROUPS.length : i }

export type PlacedNode = PipelineNode & { x: number; y: number }
type Point = { x: number; y: number }
type PipelineLayout = {
  nodes: PlacedNode[]
  /** back: 앞으로 이어진 길을 거슬러 돌아오는 선(순환을 닫는 선, 업무 Agent→메인). 칸을 정하는 데 세지 않고 따로 그립니다. */
  links: { source: string; target: string; back: boolean }[]
  labels: { text: string; x: number; y: number }[]
  width: number; height: number
}

const linkKey = (source: string, target: string) => JSON.stringify([source, target])
/**
 * 되돌아가는 선: 앞이 없는 노드(요청)부터 깊이 우선으로 이어 따라가다가 아직 끝나지 않은 노드로 돌아오는 선입니다. 이 선들을 빼면 흐름에 순환이 없어
 * 서버 노드 배열 순서와 무관하게 칸이 정해집니다. 앞이 없는 노드가 없는 순환뿐이면 적힌 순서의 첫 노드부터 따라갑니다.
 */
function returnLinks(flow: PipelineNode[]): Set<string> {
  const byId = new Map(flow.map((n) => [n.id, n])), open = new Set<string>(), done = new Set<string>(), back = new Set<string>()
  const walk = (n: PipelineNode) => {
    open.add(n.id)
    for (const id of n.next) {
      if (open.has(id)) back.add(linkKey(n.id, id))
      else if (!done.has(id) && byId.has(id)) walk(byId.get(id)!)
    }
    open.delete(n.id)
    done.add(n.id)
  }
  const roots = flow.filter((n) => !flow.some((m) => m.next.includes(n.id)))
  for (const n of [...roots, ...flow]) if (!done.has(n.id)) walk(n)
  return back
}

/**
 * 고정 좌표 배치. 요청 흐름 노드는 앞에서 이어지는 가장 긴 길의 길이를 칸(x)으로 삼아 왼→오로 놓습니다. 되돌아가는 선(returnLinks)은 칸을 정하는 데 세지 않아 순환이어도 끝납니다.
 * 같은 칸은 앞 칸 노드들의 높이 평균에 맞춰(연결된 노드가 오른쪽 같은 줄에, 앞이 없으면 가운데) 놓고, 겹치면 아래로 밀어 간격을 지킨 뒤 평균 위치로 되돌립니다(같은 높이를 원하는 노드는 서버 순서대로 쌓임).
 * 칸 안의 업무 Agent 묶음(GROUPS)은 따로 쌓아 사이를 벌리고 그 빈칸을 평균 높이(가운데 줄)에 맞춰, 요청·Guard·메인과 도구를 잇는 직접 선이 빈칸을 지나게 합니다. id 표가 없는 노드도 연결(next)대로 놓입니다.
 * 단독 기능은 흐름 아래에 한 줄 5개까지(고르게 나눠) 흐름 가운데 아래에 놓습니다. 전체 상자(라벨 포함)의 가운데가 원점이라 캔버스는 별도 중심 이동 없이 크기만 맞추면 됩니다.
 * 같은 입력은 늘 같은 좌표이고, 없는 노드를 가리키는 선은 버립니다.
 */
export function layoutPipeline(nodes: PipelineNode[]): PipelineLayout {
  if (!nodes.length) return { nodes: [], links: [], labels: [], width: 0, height: 0 }
  const ids = new Set(nodes.map((n) => n.id))
  const flow = nodes.filter((n) => !n.standalone), solo = nodes.filter((n) => n.standalone)
  const back = returnLinks(flow)
  const before = new Map(flow.map((n) => [n.id, flow.filter((m) => m.next.includes(n.id) && !back.has(linkKey(m.id, n.id))).map((m) => m.id)]))
  const columnOf = new Map<string, number>()
  const column = (id: string): number => {
    let value = columnOf.get(id)
    if (value === undefined) { value = Math.max(-1, ...before.get(id)!.map(column)) + 1; columnOf.set(id, value) }
    return value
  }
  const columns = new Map<number, PipelineNode[]>()
  for (const n of flow) columns.set(column(n.id), [...(columns.get(column(n.id)) ?? []), n])
  const spot = new Map<string, Point>()
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)
  for (const [col, members] of [...columns].sort(([a], [b]) => a - b)) {
    const want = members.map((n) => { const ys = before.get(n.id)!.map((id) => spot.get(id)!.y); return ys.length ? sum(ys) / ys.length : 0 })
    const group = (i: number) => groupOf(members[i].id)
    const order = members.map((_, i) => i).sort((a, b) => want[a] - want[b] || group(a) - group(b) || a - b)
    const ys: number[] = []
    order.forEach((i, k) => { ys[k] = k ? Math.max(want[i], ys[k - 1] + NODE_HEIGHT + ROW_GAP + (group(order[k - 1]) !== group(i) ? GROUP_GAP : 0)) : want[i] })
    const split = order.findIndex((i, k) => k > 0 && group(order[k - 1]) !== group(i)) // 첫 묶음 경계
    const shift = sum(want) / members.length - (split > 0 ? (ys[split - 1] + ys[split]) / 2 : sum(ys) / members.length)
    order.forEach((i, k) => spot.set(members[i].id, { x: col * (NODE_WIDTH + COLUMN_GAP), y: ys[k] + shift }))
  }
  const labels = GROUPS.flatMap(({ label, ids: members }) => {
    const placed = flow.filter((n) => members.includes(n.id)).map((n) => spot.get(n.id)!)
    if (!placed.length) return []
    const first = placed.reduce((a, b) => (b.y < a.y ? b : a))
    return [{ text: label, x: first.x - NODE_WIDTH / 2, y: first.y - NODE_HEIGHT / 2 - LABEL_GAP - LABEL_HEIGHT / 2 }]
  })
  const flowXs = flow.map((n) => spot.get(n.id)!.x), flowYs = flow.map((n) => spot.get(n.id)!.y)
  const centerX = flow.length ? (Math.min(...flowXs) + Math.max(...flowXs)) / 2 : 0
  const soloTop = flow.length ? Math.max(...flowYs) + NODE_HEIGHT / 2 + SOLO_GAP : 0
  const perRow = Math.ceil(solo.length / Math.ceil(solo.length / SOLO_PER_ROW))
  solo.forEach((n, i) => {
    const row = Math.floor(i / perRow), inRow = Math.min(perRow, solo.length - row * perRow)
    spot.set(n.id, { x: centerX + ((i % perRow) - (inRow - 1) / 2) * (NODE_WIDTH + SOLO_COLUMN_GAP), y: soloTop + NODE_HEIGHT / 2 + row * (NODE_HEIGHT + ROW_GAP) })
  })
  const all = nodes.map((n) => spot.get(n.id)!)
  const left = Math.min(...all.map((p) => p.x)) - NODE_WIDTH / 2, right = Math.max(...all.map((p) => p.x)) + NODE_WIDTH / 2
  const top = Math.min(Math.min(...all.map((p) => p.y)) - NODE_HEIGHT / 2, ...labels.map((l) => l.y - LABEL_HEIGHT / 2)), bottom = Math.max(...all.map((p) => p.y)) + NODE_HEIGHT / 2
  const cx = (left + right) / 2, cy = (top + bottom) / 2
  return {
    nodes: nodes.map((n) => ({ ...n, x: spot.get(n.id)!.x - cx, y: spot.get(n.id)!.y - cy })),
    links: nodes.flatMap((n) => n.next.filter((target) => ids.has(target)).map((target) => ({ source: n.id, target, back: back.has(linkKey(n.id, target)) }))),
    labels: labels.map((l) => ({ ...l, x: l.x - cx, y: l.y - cy })),
    width: right - left, height: bottom - top,
  }
}

/**
 * 선 하나의 곡선(베지어 네 점)과 화살촉이 향하는 쪽(오른쪽 1, 왼쪽 -1). 앞으로 가는 선은 앞 노드 오른쪽 가장자리에서 다음 노드 왼쪽 가장자리로 양 끝이 수평이게 잇습니다.
 * 되돌아가는 선은 거꾸로 오른쪽 노드 왼쪽 가장자리에서 왼쪽 노드 오른쪽 가장자리로 잇되, 같은 두 노드를 잇는 앞으로 가는 선과 겹치지 않게 아래로 비키고 굽는 자리를 돌아가는 쪽으로 당깁니다.
 */
export function linkCurve(from: Point, to: Point, back: boolean) {
  const dir = back ? -1 : 1, drop = back ? RETURN_DROP : 0
  const start = { x: from.x + (dir * NODE_WIDTH) / 2, y: from.y + drop }, end = { x: to.x - (dir * NODE_WIDTH) / 2, y: to.y + drop }
  const bend = (start.x + end.x) / 2 + (back ? RETURN_BEND : 0)
  return { points: [start, { x: bend, y: start.y }, { x: bend, y: end.y }, end] as [Point, Point, Point, Point], dir }
}

/** 캔버스(role="img")의 요약 이름. 캔버스는 보조라 같은 정보가 아래 노드 버튼 목록에도 있습니다. */
export const pipelineSummary = (nodes: PipelineNode[]) => `집필 AI 파이프라인: 노드 ${nodes.length}개, 오류가 있는 노드 ${nodes.filter((n) => n.errors > 0).length}개`
export const nodeStats = (n: Pick<PipelineNode, 'count' | 'errors'>) => `${count(n.count)}건 · 오류 ${count(n.errors)}건`

type Step = { id: string; parentObservationId?: string | null; startTime?: string | null }
/**
 * 작업 하나의 observation을 부모 아래 자식(시작 시각 순, 같거나 없으면 받은 순서) 트리로 펼쳐 깊이와 함께 줍니다.
 * 부모가 목록에 없는 단계는 맨 위 줄이고, 순환에 갇힌 단계도 한 번씩 보입니다.
 */
export function flowTree<T extends Step>(steps: T[]): { observation: T; depth: number }[] {
  const ids = new Set(steps.map((s) => s.id))
  const children = new Map<string, T[]>(), roots: T[] = []
  for (const s of steps) {
    const parent = s.parentObservationId
    if (parent && parent !== s.id && ids.has(parent)) children.set(parent, [...(children.get(parent) ?? []), s])
    else roots.push(s)
  }
  const byTime = (a: T, b: T) => Date.parse(a.startTime ?? '') - Date.parse(b.startTime ?? '') || 0
  const rows: { observation: T; depth: number }[] = [], seen = new Set<string>()
  const walk = (s: T, depth: number) => {
    if (seen.has(s.id)) return
    seen.add(s.id)
    rows.push({ observation: s, depth })
    ;[...(children.get(s.id) ?? [])].sort(byTime).forEach((child) => walk(child, depth + 1))
  }
  ;[...roots].sort(byTime).forEach((s) => walk(s, 0))
  steps.forEach((s) => walk(s, 0))
  return rows
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Decision Guard 판정: 서비스 범위 허용 여부, 거절 이유 코드, 이번 요청에 필요하다고 본 기능. */
export type GuardVerdict = { allowed: boolean; reason: string | null; capabilities: string[] }
/** decision_guard 기록의 판정. 출력에 판정을 남기기 전 기록은 metadata에만 있어 그쪽도 읽습니다. 판정 모양이 아니면 null입니다. */
export function guardVerdict(record: Pick<PipelineRecord, 'name' | 'output' | 'metadata'>): GuardVerdict | null {
  if (record.name !== 'decision_guard') return null
  const source = [record.output, record.metadata].find((v) => isObject(v) && typeof v.allowed === 'boolean')
  if (!isObject(source)) return null
  return {
    allowed: source.allowed as boolean,
    reason: typeof source.reason === 'string' ? source.reason : null,
    capabilities: Array.isArray(source.capabilities) ? source.capabilities.filter((c): c is string => typeof c === 'string') : [],
  }
}

/** Guard 결과 칸의 보조 글: 거절 이유 코드와 필요한 기능. 기능은 집필 채팅이 쓰는 표시 이름(featureLabel)이고 모르는 코드는 그대로 둡니다. */
export const verdictText = ({ reason, capabilities }: GuardVerdict) =>
  [reason, capabilities.length ? `기능 ${capabilities.map((code) => (Object.hasOwn(featureLabel, code) ? featureLabel[code] : code)).join(', ')}` : null].filter(Boolean).join(' · ')

/** 기록 표 결과 칸: 오류만 위험 색이고 거절·차단(메인이 돌려보낸 도구 호출)은 오류가 아니라 판정이라 중립입니다. */
export function recordResult(record: Pick<PipelineRecord, 'name' | 'level' | 'output' | 'metadata'>): { label: string; tone: '' | 'ok' | 'bad' } {
  if (record.level === 'ERROR') return { label: '오류', tone: 'bad' }
  if (record.name === 'main_agent.blocked') return { label: '차단', tone: '' }
  const verdict = guardVerdict(record)
  if (verdict) return verdict.allowed ? { label: '허용', tone: 'ok' } : { label: '거절', tone: '' }
  return record.level === 'WARNING' ? { label: '경고', tone: '' } : { label: '통과', tone: 'ok' }
}

type ToolCall = { name: string; args?: unknown }
/** 출력을 글과 도구 호출로 나눕니다. 메인 에이전트 출력({text, toolCalls}, 다른 필드 없음)만 나뉘고 이름 없는 호출은 버립니다. 그 밖은 글 그대로, 객체는 다른 필드를 잃지 않게 들여쓴 JSON입니다. */
export function splitOutput(output: unknown): { text: string; calls: ToolCall[] } {
  if (isObject(output) && Array.isArray(output.toolCalls) && Object.keys(output).every((key) => key === 'text' || key === 'toolCalls')) {
    return {
      text: typeof output.text === 'string' ? output.text : '',
      calls: output.toolCalls.flatMap((c): ToolCall[] => (isObject(c) && typeof c.name === 'string' ? [{ name: c.name, args: c.args }] : [])),
    }
  }
  return { text: bodyText(output), calls: [] }
}

export const GUARD_NODE_ID = 'guard'
/** 서버에 보낼 level 조건. Guard는 거절이 level이 아니라 출력(allowed=false)에 있어 서버 필터 없이 받은 쪽 안에서 가립니다(filterRecords). */
export const serverLevel = (nodeId: string, result: string) => (nodeId === GUARD_NODE_ID ? '' : result)
/**
 * 결과 필터를 받은 기록에 적용합니다(Guard만, 다른 노드는 서버가 이미 가려 줍니다). 거절/오류는 오류 수준이거나 Guard 판정이 거절인 기록이고, 통과는 수준이 같고 거절이 아닌 기록입니다.
 * ponytail: 서버가 준 한 쪽(20건) 안에서만 가려 합계·쪽 수는 가리기 전 값입니다. 쪽을 넘어 가리려면 서버가 판정(allowed)을 조건으로 받아야 합니다.
 */
export function filterRecords<T extends Pick<PipelineRecord, 'name' | 'level' | 'output' | 'metadata'>>(nodeId: string, result: string, records: T[]): T[] {
  if (nodeId !== GUARD_NODE_ID || !result) return records
  const rejected = (r: T) => guardVerdict(r)?.allowed === false
  return records.filter((r) => (result === 'ERROR' ? r.level === 'ERROR' || rejected(r) : r.level === result && !rejected(r)))
}

/**
 * NovelBrain 기억 회상 기록의 recalled 목록 제목. 항목은 글(제목) 또는 객체이고 객체는 title, 없으면 name, 없으면 ref를 제목으로 읽으며 그것도 없으면 건너뜁니다.
 * 출력에 recalled 목록이 없으면 metadata에서 읽고, 둘 다 목록이 아니면 null입니다(회상 기록이 아님).
 */
export function recalledTitles(record: Pick<PipelineRecord, 'output' | 'metadata'>): string[] | null {
  const source = [record.output, record.metadata].find((v) => isObject(v) && Array.isArray(v.recalled))
  if (!isObject(source)) return null
  return (source.recalled as unknown[]).flatMap((item) => {
    const title = typeof item === 'string' ? item : isObject(item) ? [item.title, item.name, item.ref].find((v) => typeof v === 'string' && v !== '') : undefined
    return typeof title === 'string' && title !== '' ? [title] : []
  })
}

/** 프롬프트 보기 대상: 그 기록의 프롬프트이고, 기록에 없으면 노드에 연결된 프롬프트입니다. */
export const promptTargets = (node: Pick<PipelineNode, 'promptNames'>, record: Pick<PipelineRecord, 'promptName'>) => (record.promptName ? [record.promptName] : node.promptNames)
