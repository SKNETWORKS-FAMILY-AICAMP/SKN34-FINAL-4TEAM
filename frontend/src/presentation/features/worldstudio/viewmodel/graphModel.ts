import type { CardType } from '../../../../domain/entities/studioCards'
import { CARD_COLORS, CARD_KIND } from '../../../shared/worldBoard'
import { mapEndpoint, type MapLink, type MapNode } from './useWorldMapViewModel'

/*
 * 관계도 그래프(옵시디언 그래프 뷰처럼 react-force-graph-2d 캔버스에 그린다)의 순수 규칙: 노드·선 만들기, 노드 크기, 이름표 크기·투명도.
 * 그리기·힘·화면은 view(RelationGraph·graphPaint)와 graphForces가 맡는다.
 */

/** 노드 반지름(그래프 단위, 크기 슬라이더가 1일 때): 관계가 가장 많은 노드가 최대, 관계가 없으면 최소다. 지름이 √(관계 수)에 비례해 늘어난다(관계 수에 비례해 늘리면 허브가 화면을 덮는다). 허브는 확실히 크다. */
export const NODE_R_MIN = 4, NODE_R_MAX = 24
/** 화면 반지름의 범위(px): 하한은 수백 노드를 한눈에 볼 만큼 멀어져도 점이 사라지지 않게, 상한(크기 슬라이더 1 기준)은 확대해도 지름 150~240px의 거대한 원이 되지 않게 한다. */
export const NODE_SCREEN_MIN = 3, NODE_SCREEN_MAX = 24
/**
 * 그릴 반지름(그래프 단위): 배율 `k`에서 화면 반지름이 `NODE_SCREEN_MIN`~`NODE_SCREEN_MAX × size`(`size` = 크기 슬라이더 배수) 안이 되게 묶는다(화면 px를 `k`로 나눈 값).
 * 범위 안이면 `radius` 그대로다. 겹침 방지 힘도 같은 값을 쓴다(화면에 그려진 크기 기준).
 */
export const drawRadius = (radius: number, k: number, size = 1) => Math.max(NODE_SCREEN_MIN / k, Math.min(radius, (NODE_SCREEN_MAX * size) / k))
/** 맞춤의 최대 확대 배율: 노드가 적은 세계관이 화면 가득 거대하게 확대되지 않게 한다(큰 세계관은 화면에 맞춰 줄어든다). */
export const FIT_MAX_ZOOM = 1.5
/** 노드 좌표의 상자(`getGraphBbox`)를 `width`×`height` 화면에 여백 `padding`(px)을 두고 맞추는 중심·배율: force-graph의 `zoomToFit`과 같되 배율이 `FIT_MAX_ZOOM`을 넘지 않는다. */
export function fitView(bbox: { x: readonly [number, number]; y: readonly [number, number] }, width: number, height: number, padding: number) {
  const k = Math.min(FIT_MAX_ZOOM, (width - 2 * padding) / (bbox.x[1] - bbox.x[0]), (height - 2 * padding) / (bbox.y[1] - bbox.y[0]))
  return { x: (bbox.x[0] + bbox.x[1]) / 2, y: (bbox.y[0] + bbox.y[1]) / 2, k }
}
export const nodeRadius = (degree: number, maxDegree: number, size = 1) => (NODE_R_MIN + (NODE_R_MAX - NODE_R_MIN) * (maxDegree > 0 ? Math.sqrt(Math.min(degree, maxDegree) / maxDegree) : 0)) * size

/** 카드마다 이어진 관계 수: 관계 하나가 양쪽 끝 카드에 한 번씩 더해진다. 그래프에 없는 끝점은 세지 않는다. */
export function degrees(ids: readonly string[], links: readonly { source: string; target: string }[]): Map<string, number> {
  const count = new Map(ids.map((id) => [id, 0]))
  for (const { source, target } of links) {
    if (count.has(source)) count.set(source, count.get(source)! + 1)
    if (count.has(target)) count.set(target, count.get(target)! + 1)
  }
  return count
}

/** 멀리서도 이름을 붙이는 카드 수: 관계가 많은 상위 8~12개(카드의 약 20%, 최소 8개·최대 12개). */
export const labelLimit = (count: number) => Math.min(12, Math.max(8, Math.ceil(count * 0.2)))
/** 멀리서도 이름을 붙이는 카드: 관계가 있는 카드 중 관계가 많은 쪽부터 `limit`개(같으면 `order`에서 앞선 카드). */
export function topDegreeIds(order: readonly string[], degree: ReadonlyMap<string, number>, limit: number): Set<string> {
  const ranked = order.map((id, index) => ({ id, index, n: degree.get(id) ?? 0 })).filter((row) => row.n > 0)
  return new Set(ranked.sort((a, b) => b.n - a.n || a.index - b.index).slice(0, limit).map((row) => row.id))
}

/** 이름표 글자 크기(화면 px): 늘 12px 이상이고 관계가 가장 많은 쪽 노드(최대의 절반 이상)는 14px, 4분의 1 이상은 13px다. */
export const labelFont = (degree: number, maxDegree: number) => { const ratio = maxDegree > 0 ? degree / maxDegree : 0; return ratio >= 0.5 ? 14 : ratio >= 0.25 ? 13 : 12 }

/**
 * 이름표 투명도(옵시디언의 텍스트 표시 임계값): 확대 배율이 임계값 이상이면 1, 임계값의 60% 이하면 0, 그 사이는 서서히 나타난다. 임계값 0이면 늘 보인다.
 */
export const textAlpha = (zoom: number, threshold: number) => (threshold <= 0 ? 1 : Math.min(1, Math.max(0, (zoom - threshold * 0.6) / (threshold * 0.4))))

/** 선 하나가 나타내는 관계 한 줄: `id`는 관계 id(없을 수 있다), `source`→`target`은 그 관계 자신의 방향(선의 방향과 다를 수 있다), `label`은 짧은 이름, `full`은 전체 이름이다. */
export type Relation = { id?: string; source: string; target: string; label: string; full: string; symmetric: boolean }
/** 그래프의 노드. react-force-graph가 좌표(`x`·`y`·`vx`·`vy`)를 붙이고 끌 때 `fx`·`fy`를 쓰는 가변 객체라 같은 카드는 같은 객체로 둔다. 크기는 `degree`(와 접힌 위성 수)에서 그릴 때 정한다. */
export type GNode = {
  id: string; name: string; type?: CardType; unnamed: boolean; degree: number; color: string
  x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number
}
/** 그래프의 선: 같은 두 카드 사이의 관계는 선 하나로 묶는다(옵시디언처럼 쌍마다 선 하나). `directed`는 방향이 있는 관계가 하나라도 있다는 뜻이고 그때 `source`→`target`이 그 방향이다. */
export type GLink = { id: string; source: string | GNode; target: string | GNode; relations: Relation[]; directed: boolean }

const FALLBACK_COLOR = CARD_COLORS['기타']

/**
 * 관계도(`vm.graph`)를 그래프 데이터로 바꾼다. 없는 카드나 자기 자신으로 가는 관계는 그리지 않고, 같은 쌍의 관계는 선 하나로 묶으며, 카드 크기는 이어진 관계 수(묶기 전 관계 한 줄마다 센다)로 정한다.
 * `previous`에 있는 카드는 같은 객체를 고쳐 돌려준다(좌표를 잇는다: 설정을 고쳐 다시 만들어도 배치가 처음부터 다시 펼쳐지지 않는다). `spawn`에 있는 새 카드는 그 좌표에서 시작한다.
 */
export function buildGraph(nodes: readonly MapNode[], links: readonly MapLink[], previous: ReadonlyMap<string, GNode> = new Map(), spawn: ReadonlyMap<string, { x: number; y: number }> = new Map()): { nodes: GNode[]; links: GLink[] } {
  const ids = new Set(nodes.map((n) => n.id))
  const rows = links.flatMap((l) => {
    const source = mapEndpoint(l.source), target = mapEndpoint(l.target)
    return ids.has(source) && ids.has(target) && source !== target ? [{ source, target, relation: { id: l.id, source, target, label: l.label, full: l.fullLabel ?? l.label, symmetric: !!l.symmetric } satisfies Relation }] : []
  })
  const degree = degrees([...ids], rows)
  const graphNodes = nodes.map((n): GNode => {
    const d = degree.get(n.id) ?? 0
    const fields = { id: n.id, name: n.name, type: n.type, unnamed: !!n.unnamed, degree: d, color: n.type ? CARD_COLORS[CARD_KIND[n.type]] : FALLBACK_COLOR }
    const old = previous.get(n.id)
    if (old) return Object.assign(old, fields)
    const at = spawn.get(n.id)
    return at ? { ...fields, x: at.x, y: at.y } : fields
  })
  const pairs = new Map<string, GLink>()
  for (const { source, target, relation } of rows) {
    const key = source < target ? source + '|' + target : target + '|' + source, found = pairs.get(key)
    if (!found) pairs.set(key, { id: key, source, target, relations: [relation], directed: !relation.symmetric })
    else {
      found.relations.push(relation)
      if (!relation.symmetric && !found.directed) { found.directed = true; found.source = source; found.target = target }
    }
  }
  return { nodes: graphNodes, links: [...pairs.values()] }
}

/** 선에 올렸을 때 보이는 관계 이름: 관계가 하나면 그 이름, 여럿이면 첫 관계 '외 N개'다(합친 선의 굵기는 늘리지 않고 개수는 이 말로만 알린다). */
export function relationNames(link: Pick<GLink, 'relations'>) {
  const [first, ...rest] = link.relations
  return first ? first.label + (rest.length ? ' 외 ' + rest.length + '개' : '') : ''
}

/** 선의 끝점 id(react-force-graph가 끝점을 노드 객체로 바꾸기 전에는 id 문자열이다). */
export const endId = (end: string | GNode) => (typeof end === 'string' ? end : end.id)

/** 관계 한 줄의 이름(키보드 목록·삭제 하위 메뉴): '가람 → 나래 · 신뢰', 대칭이면 '가람 ↔ 나래 · 친구'. 방향이 이름에 드러나 같은 쌍의 관계끼리 구분된다. */
export const relationTitle = (r: Pick<Relation, 'source' | 'target' | 'full' | 'symmetric'>, name: (id: string) => string) => name(r.source) + (r.symmetric ? ' ↔ ' : ' → ') + name(r.target) + ' · ' + r.full
