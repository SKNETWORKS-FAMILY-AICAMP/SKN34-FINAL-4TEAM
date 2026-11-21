import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force'
import { CARD_H, CARD_W, GAP, bodyBox, legalize, type Point } from './canvasLayout'
import { degrees, dotDiameter } from './zoomLevel'

type Body = SimulationNodeDatum & { id: string }
type Edge = { source: string; target: string }
/** 이어진 두 카드의 중심 사이 목표 거리: 카드 외접원 지름(250)보다 조금 넓게 둔다. */
const LINK_DISTANCE = 300

/**
 * 힘 기반 배치(d3-force): 이어진 카드는 끌어당기고(link) 모든 카드는 밀어내며(manyBody) 카드 크기만큼 겹치지 않게 하고(collide) 원점 둘레에 모은다(center).
 * 애니메이션 없이 정해진 횟수만 한 번에 돌린다(`stop()` 뒤 `tick(n)`): 처음 열 때와 '배치 정돈'을 누를 때만 쓴다.
 * 충돌 반지름은 노드 상자(`bodyBox`: 카드 200×150과 관계 수에 비례하는 점 중 큰 쪽)의 외접원 + 간격이다. 그래도 충돌 힘은 부드러운 제약이라 조금 겹칠 수 있어, 끝난 뒤 `legalize`가 남은 겹침을 가까운 빈 자리로 밀어 겹침 0(간격 16px 포함)을 보장한다.
 * 난수를 쓰지 않는다: 첫 자리는 d3가 인덱스로 정하고(나선) 겹침을 풀 때의 흔들림도 고정 시드(LCG)라 같은 입력에는 늘 같은 자리다.
 * 돌려주는 좌표는 카드의 왼쪽 위 모서리다. 없는 카드나 자기 자신으로 가는 관계는 무시한다.
 */
export function forceLayout(nodes: readonly { id: string }[], links: readonly Edge[]): Map<string, Point> {
  const ids = nodes.map((node) => node.id), known = new Set(ids)
  const edges: Edge[] = links.filter((link) => link.source !== link.target && known.has(link.source) && known.has(link.target)).map(({ source, target }) => ({ source, target }))
  const degree = degrees(ids, edges), maxDegree = Math.max(0, ...degree.values())
  const size = new Map(ids.map((id) => [id, bodyBox(dotDiameter(degree.get(id) ?? 0, maxDegree))]))
  const bodies: Body[] = ids.map((id) => ({ id }))
  const simulation = forceSimulation(bodies)
    .force('link', forceLink<Body, Edge>(edges).id((body) => body.id).distance(LINK_DISTANCE).strength(0.6))
    .force('charge', forceManyBody().strength(-400))
    .force('collide', forceCollide<Body>((body) => { const box = size.get(body.id)!; return Math.hypot(box.w, box.h) / 2 + GAP / 2 }).iterations(3))
    .force('center', forceCenter(0, 0))
    .stop()
  simulation.tick(Math.round(Math.max(120, Math.min(300, 30000 / Math.max(nodes.length, 1))))) // 카드가 많을수록 반복을 줄여(최소 120번) 한 번에 계산하는 시간을 묶는다
  const placed = legalize(bodies.map((body) => ({ cx: body.x ?? 0, cy: body.y ?? 0, ...size.get(body.id)! })))
  return new Map(bodies.map((body, i) => [body.id, { x: placed[i].cx - CARD_W / 2, y: placed[i].cy - CARD_H / 2 }]))
}
