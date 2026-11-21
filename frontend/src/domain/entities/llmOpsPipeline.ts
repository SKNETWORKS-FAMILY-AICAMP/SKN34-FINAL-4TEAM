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
const COLUMN_GAP = 48
const ROW_GAP = 14
const SOLO_GAP = 36
const SOLO_COLUMN_GAP = 14
const SOLO_PER_ROW = 5

export type PlacedNode = PipelineNode & { x: number; y: number }
type PipelineLayout = { nodes: PlacedNode[]; links: { source: string; target: string }[]; width: number; height: number }

/**
 * 고정 좌표 배치. 요청 흐름 노드는 앞에서 이어지는 가장 긴 길의 길이를 칸(x)으로 삼아 왼→오로 놓고 같은 칸은 서버 순서대로 세로로 쌓습니다.
 * 단독 기능은 흐름 아래에 한 줄 5개까지(고르게 나눠) 흐름 가운데 아래에 놓습니다. 전체 상자의 가운데가 원점이라 캔버스는 별도 중심 이동 없이 크기만 맞추면 됩니다.
 * 같은 입력은 늘 같은 좌표이고, 없는 노드를 가리키는 선은 버리며, 순환은 끊어 끝납니다.
 */
export function layoutPipeline(nodes: PipelineNode[]): PipelineLayout {
  if (!nodes.length) return { nodes: [], links: [], width: 0, height: 0 }
  const ids = new Set(nodes.map((n) => n.id))
  const flow = nodes.filter((n) => !n.standalone), solo = nodes.filter((n) => n.standalone)
  const before = new Map(flow.map((n) => [n.id, flow.filter((m) => m.next.includes(n.id)).map((m) => m.id)]))
  const columnOf = new Map<string, number>(), walking = new Set<string>()
  const column = (id: string): number => {
    const known = columnOf.get(id)
    if (known !== undefined) return known
    if (walking.has(id)) return -1 // 순환을 닫는 선은 세지 않는다
    walking.add(id)
    const value = Math.max(-1, ...(before.get(id) ?? []).map(column)) + 1
    walking.delete(id)
    columnOf.set(id, value)
    return value
  }
  const columns = new Map<number, PipelineNode[]>()
  for (const n of flow) columns.set(column(n.id), [...(columns.get(column(n.id)) ?? []), n])
  const spot = new Map<string, { x: number; y: number }>()
  for (const [x, members] of columns) members.forEach((n, i) => spot.set(n.id, { x: x * (NODE_WIDTH + COLUMN_GAP), y: (i - (members.length - 1) / 2) * (NODE_HEIGHT + ROW_GAP) }))
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
  const top = Math.min(...all.map((p) => p.y)) - NODE_HEIGHT / 2, bottom = Math.max(...all.map((p) => p.y)) + NODE_HEIGHT / 2
  return {
    nodes: nodes.map((n) => ({ ...n, x: spot.get(n.id)!.x - (left + right) / 2, y: spot.get(n.id)!.y - (top + bottom) / 2 })),
    links: nodes.flatMap((n) => n.next.filter((target) => ids.has(target)).map((target) => ({ source: n.id, target }))),
    width: right - left, height: bottom - top,
  }
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
