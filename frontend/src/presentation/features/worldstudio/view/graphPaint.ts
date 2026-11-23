import type { GraphSettings } from '../viewmodel/graphForces'
import { drawRadius, endId, labelFont, nodeRadius, relationNames, textAlpha, type GLink, type GNode } from '../viewmodel/graphModel'
import { textWidth } from '../../../shared/textWidth'
import { placeLabels, type Label, type LabelNode, type View } from '../viewmodel/labelLayout'
import { CANVAS_FONT } from '../../worlds/worldAtlas'

/*
 * 관계도 그래프(react-force-graph-2d 캔버스)의 그리기. 캔버스 호출만 하는 순수한 함수라 가짜 캔버스로 시험한다.
 * 노드는 그래프 좌표(확대에 따라 커진다)에 채운 원으로, 이름은 화면 크기(12px 이상)로 노드 바로 아래에 그린다.
 */

/** 강조 중 중심·이웃이 아닌 노드·선·이름의 투명도(옵시디언 수준 0.15~0.2)와 검색에 맞지 않는 노드의 투명도. */
export const DIM = 0.16, SEARCH_DIM = 0.25
/** 이름표를 만드는 화면 밖 여백(px): `placeLabels`의 여백과 같다. */
const OFFSCREEN = 200
const LINK_BASE = 'rgba(160,178,210,.35)', LINK_ACTIVE = 'rgba(234,240,255,.95)', LINK_DIM = 'rgba(160,178,210,.07)', LINK_SEARCH_DIM = 'rgba(160,178,210,.1)'
const LABEL_FILL = '#EAF0FF', LABEL_HALO = 'rgba(8,14,27,.9)', CHIP_FILL = 'rgba(8,14,27,.92)', RING = '#ffffff', HUB_RING = 'rgba(255,255,255,.6)'

/** 그리는 데 쓰는 화면 상태: 값이 바뀔 때마다 새로 만들어 그리기 함수에 넘긴다. */
export type PaintState = {
  settings: GraphSettings
  /** 강조 중심과 그 이웃 노드·닿는 선(없으면 강조 없음). */
  around: { id: string; nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null
  /** 검색에 맞는 노드(맞지 않으면 흐리다). 검색이 없으면 모든 노드다. */
  visible: ReadonlySet<string>
  /** 고른 노드 id, 연결 모드의 주체 노드 id(연결 모드가 아니면 null). */
  selected: string
  connecting: string | null
  /** 마우스를 올린 선 id, 고른(클릭했거나 관계 작성 중인) 선 id들. */
  hotLink: string
  pickedLinks: ReadonlySet<string>
  /** 멀리서도 이름을 보이는 노드(관계 상위)와 크기 기준의 최댓값(관계 수 + 접힌 위성 수의 최대). */
  top: ReadonlySet<string>
  maxDegree: number
  /** 접힌 위성이 있는 허브 id → 접힌 위성 수(펼친 허브는 없다). */
  folded: ReadonlyMap<string, number>
}

export function nodeAlpha(id: string, s: PaintState) {
  let alpha = 1
  if (s.around && !s.around.nodes.has(id)) alpha = DIM
  if (!s.visible.has(id)) alpha = Math.min(alpha, SEARCH_DIM)
  return alpha
}

/** 크기·이름표 순서의 기준: 관계 수 + 접힌 위성 수. */
const weightOf = (node: GNode, s: PaintState) => node.degree + (s.folded.get(node.id) ?? 0)
/** 그릴 반지름(그래프 단위): 지름이 √(기준)에 비례하고 어느 배율에서도 화면 3px 아래로 줄지 않는다. */
const radiusOf = (node: GNode, s: PaintState, k: number) => drawRadius(nodeRadius(weightOf(node, s), s.maxDegree, s.settings.nodeSize), k, s.settings.nodeSize)
/** 이름표 글: 접힌 위성이 있는 허브는 '이름 +N'이다. */
const labelText = (node: GNode, s: PaintState) => node.name + (s.folded.has(node.id) ? ' +' + s.folded.get(node.id) : '')

/** 노드를 채운 원으로 그린다. 고리는 고른 노드·강조 중심·연결 주체에 실선, 연결 상대가 될 수 있는 노드에 점선으로만 그리고 평소에는 없다. */
export function paintNode(node: GNode, ctx: CanvasRenderingContext2D, k: number, s: PaintState) {
  const x = node.x ?? 0, y = node.y ?? 0, r = radiusOf(node, s, k)
  ctx.globalAlpha = nodeAlpha(node.id, s)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, 2 * Math.PI)
  ctx.fillStyle = node.color
  ctx.fill()
  if (s.folded.has(node.id)) { // 접힌 위성이 있는 허브: 안쪽의 얇은 고리
    ctx.beginPath()
    ctx.arc(x, y, r * 0.6, 0, 2 * Math.PI)
    ctx.lineWidth = 1 / k
    ctx.strokeStyle = HUB_RING
    ctx.stroke()
  }
  const ring = (dash: boolean) => {
    ctx.beginPath()
    ctx.arc(x, y, r + 2.5 / k, 0, 2 * Math.PI)
    ctx.lineWidth = 1.5 / k
    ctx.strokeStyle = RING
    if (dash) ctx.setLineDash([3 / k, 3 / k])
    ctx.stroke()
    if (dash) ctx.setLineDash([])
  }
  if (node.id === s.selected || node.id === s.around?.id || node.id === s.connecting) ring(false)
  else if (s.connecting) ring(true)
  ctx.globalAlpha = 1
}

/** 눌리는 자리의 반지름: 점보다 조금 넓고 멀리서도(배율이 작아도) 화면 8px 반지름 아래로 줄지 않는다. */
export const hitRadius = (node: GNode, k: number, s: PaintState) => Math.max(radiusOf(node, s, k), 8 / k) + 3 / k

/**
 * 접힌 허브의 이름표('이름 +N') 영역(노드 중심 기준 그래프 좌표): 반쪽 폭(`halfW`)과 점 아래쪽 끝(`top`)에서 이름표 끝(`bottom`)까지의 세로 범위다. 눌리는 자리에 더해 이름표를 눌러 위성을 펼치게 한다.
 * 접힌 허브가 아니면(다른 노드·펼친 허브) null이다.
 */
export function labelHit(node: GNode, k: number, s: PaintState) {
  if (!s.folded.has(node.id)) return null
  const size = labelFont(weightOf(node, s), s.maxDegree)
  const top = radiusOf(node, s, k)
  return { halfW: (textWidth(labelText(node, s), size) + 8) / 2 / k, top, bottom: top + (4 + size * 1.3) / k }
}

export type Hit = { kind: 'node' | 'link'; id: string }
/** 선을 누르는 거리(화면 px). */
const LINK_HIT = 6
/**
 * 누른 자리(그래프 좌표)에 있는 것: 눌리는 반지름 안의 노드(여럿이면 중심이 가장 가까운 것), 없으면 화면 6px 안의 가장 가까운 선, 없으면 null.
 * 마우스는 react-force-graph가 가리킨 것을 알려 주지만 터치의 긴 누르기는 가리킴이 없어 우리가 직접 찾는다.
 */
export function hitAt(nodes: readonly GNode[], links: readonly GLink[], x: number, y: number, k: number, s: PaintState): Hit | null {
  let best: Hit | null = null, bestDistance = Infinity
  for (const node of nodes) {
    const distance = Math.hypot((node.x ?? 0) - x, (node.y ?? 0) - y)
    if (distance <= hitRadius(node, k, s) && distance < bestDistance) { best = { kind: 'node', id: node.id }; bestDistance = distance }
  }
  if (best) return best
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const link of links) {
    const a = byId.get(endId(link.source)), b = byId.get(endId(link.target))
    if (!a || !b) continue
    const distance = segmentDistance(x, y, a.x ?? 0, a.y ?? 0, b.x ?? 0, b.y ?? 0)
    if (distance <= LINK_HIT / k && distance < bestDistance) { best = { kind: 'link', id: link.id }; bestDistance = distance }
  }
  return best
}
/** 점 (px, py)에서 선분 (ax, ay)-(bx, by)까지의 거리. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export type PlannedLabel = Label & { alpha: number; text: string }
/**
 * 지금 그릴 이름표(화면 좌표)를 정한다: 텍스트 표시 임계값 아래에서는 관계 상위 노드·강조 중심과 이웃·고른 노드·연결 주체의 이름만 남고 나머지는 서서히 사라진다.
 * 겹치면 작은 노드부터 숨는다(`placeLabels`): 강조 중에는 이웃이 먼저 자리를 잡고, 중심·고른 노드·연결 주체는 가려져 있어도 항상 보인다. 강조 밖 이름은 흐리다.
 */
export function labelPlan(nodes: readonly GNode[], view: View, s: PaintState): PlannedLabel[] {
  const fade = textAlpha(view.k, s.settings.textThreshold), lit = s.around?.nodes
  const always = new Set([s.around?.id, s.selected, s.connecting].filter((id): id is string => !!id))
  const candidates = new Set<string>(), alpha = new Map<string, number>(), texts = new Map<string, string>(), labelNodes: LabelNode[] = []
  for (const n of nodes) {
    const near = !!lit?.has(n.id), base = s.top.has(n.id) || near || always.has(n.id) ? 1 : fade
    if (base <= 0) continue
    const sx = (n.x ?? 0) * view.k + view.x, sy = (n.y ?? 0) * view.k + view.y // 화면 밖(여백 포함) 노드는 이름표를 만들지 않는다: 수천 노드에서도 프레임마다 화면 안 노드만 센다
    if (sx < -OFFSCREEN || sx > view.w + OFFSCREEN || sy < -OFFSCREEN || sy > view.h + OFFSCREEN) continue
    const weight = weightOf(n, s), text = labelText(n, s)
    candidates.add(n.id)
    alpha.set(n.id, base * nodeAlpha(n.id, s))
    texts.set(n.id, text)
    labelNodes.push({ id: n.id, cx: n.x ?? 0, cy: n.y ?? 0, d: 2 * radiusOf(n, s, view.k), name: text, degree: weight + (near ? 1e6 : 0), size: labelFont(weight, s.maxDegree) })
  }
  return placeLabels(labelNodes, view, candidates, always).map((label) => ({ ...label, alpha: alpha.get(label.id) ?? 1, text: texts.get(label.id) ?? '' }))
}

/** 정한 이름표를 그린다: 화면 크기의 글자(`size / k`)를 어두운 테두리 위에 채워 노드 위에서도 읽히게 하고, 투명도를 적용한 뒤 되돌린다. */
export function paintLabels(ctx: CanvasRenderingContext2D, plan: readonly PlannedLabel[], view: View) {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  for (const label of plan) {
    const x = (label.x - view.x) / view.k, y = (label.y - view.y) / view.k
    ctx.globalAlpha = label.alpha
    ctx.font = '700 ' + label.size / view.k + 'px ' + CANVAS_FONT
    ctx.lineWidth = 3 / view.k
    ctx.strokeStyle = LABEL_HALO
    ctx.strokeText(label.text, x, y)
    ctx.fillStyle = LABEL_FILL
    ctx.fillText(label.text, x, y)
  }
  ctx.globalAlpha = 1
}

const dimmedBySearch = (link: GLink, s: PaintState) => !s.visible.has(endId(link.source)) || !s.visible.has(endId(link.target))

/** 선 색: 평소는 가는 회색 한 가지, 강조 중이면 닿는 선만 강조색이고 나머지는 거의 안 보이며, 올린·고른 선은 강조색이다. 검색에 맞지 않는 노드로 가는 선은 흐리다. */
export function linkColor(link: GLink, s: PaintState) {
  if (s.hotLink === link.id || s.pickedLinks.has(link.id)) return LINK_ACTIVE // 올린·고른 선은 노드 강조 중에도 강조색이다
  if (s.around) return s.around.edges.has(link.id) ? LINK_ACTIVE : LINK_DIM
  return dimmedBySearch(link, s) ? LINK_SEARCH_DIM : LINK_BASE
}
/**
 * 선 두께(화면 px): react-force-graph가 확대 배율로 나누어 그리므로 확대해도 화면에서 같다. 가장 가는 선(1px, 고해상도에서는 장치 픽셀 한 줄인 1/배율)에 설정 배수를 곱한다.
 * 강조·올린·고른 선은 색만 바뀌고 굵기는 1.5배(기본에서 최대 1.5px)다. 합친 평행 관계의 수는 굵기에 반영하지 않는다(개수는 선에 올렸을 때 이름으로만 알린다).
 */
export function linkWidth(link: GLink, s: PaintState) {
  const strong = (s.around?.edges.has(link.id) ?? false) || s.hotLink === link.id || s.pickedLinks.has(link.id)
  return (1 / ((globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1)) * s.settings.linkWidth * (strong ? 1.5 : 1)
}
/** 화살표 길이: 화살표를 켜고 방향 있는 선에만 있다(옵시디언처럼 기본 꺼짐). */
export const arrowLength = (link: GLink, s: PaintState) => (s.settings.arrows && link.directed ? 4 + 2 * s.settings.linkWidth : 0)

/** 화살표 자리(선 위 상대 위치 0~1): 목적지 노드의 가장자리 바로 앞이라 큰 노드에 가려지지 않는다. 노드가 가까워 가장자리가 선의 가운데를 넘으면 가운데(0.5)다. 끝점 좌표가 아직 없으면 0.9다. */
export function arrowPos(link: GLink, s: PaintState, k: number) {
  const a = link.source, b = link.target
  if (typeof a !== 'object' || typeof b !== 'object') return 0.9
  const length = Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0)) || 1
  return Math.min(0.98, Math.max(0.5, 1 - (radiusOf(b, s, k) + 3) / length))
}

/** 올린·고른 선에만 관계 이름을 선 가운데에 화면 12px 글자로 그린다(어두운 바탕 위라 뒤의 선이 글자를 가르지 않는다). 끝점 좌표가 아직 없으면 건너뛴다. */
export function paintLinkLabels(ctx: CanvasRenderingContext2D, links: readonly GLink[], k: number, s: PaintState) {
  for (const link of links) {
    if (s.hotLink !== link.id && !s.pickedLinks.has(link.id)) continue
    const a = link.source, b = link.target
    if (typeof a !== 'object' || typeof b !== 'object') continue
    const text = relationNames(link), x = ((a.x ?? 0) + (b.x ?? 0)) / 2, y = ((a.y ?? 0) + (b.y ?? 0)) / 2
    const w = (textWidth(text, 12) + 10) / k, h = 18 / k
    ctx.globalAlpha = 1
    ctx.fillStyle = CHIP_FILL
    ctx.fillRect(x - w / 2, y - h / 2, w, h)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '700 ' + 12 / k + 'px ' + CANVAS_FONT
    ctx.fillStyle = LABEL_FILL
    ctx.fillText(text, x, y)
  }
}
