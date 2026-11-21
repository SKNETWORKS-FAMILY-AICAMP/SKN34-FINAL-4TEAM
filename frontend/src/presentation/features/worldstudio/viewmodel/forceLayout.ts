import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force'
import { CARD_H, CARD_W, type Point } from './canvasLayout'

type Body = SimulationNodeDatum & { id: string }
type Edge = { source: string; target: string }
/** 카드 한 장(200×150)이 차지하는 반지름: 반대각선의 절반 + 여백. 두 중심이 이 둘레의 두 배보다 멀면 카드 상자는 겹치지 않는다. */
const RADIUS = Math.hypot(CARD_W, CARD_H) / 2 + 10

/**
 * 힘 기반 배치(d3-force): 이어진 카드는 끌어당기고(link) 모든 카드는 밀어내며(manyBody) 카드 크기만큼 겹치지 않게 하고(collide) 원점 둘레에 모은다(center).
 * 애니메이션 없이 정해진 횟수만 한 번에 돌린다(`stop()` 뒤 `tick(n)`): 처음 열 때와 '배치 정돈'을 누를 때만 쓴다.
 * 난수를 쓰지 않는다: 첫 자리는 d3가 인덱스로 정하고(나선) 겹침을 풀 때의 흔들림도 고정 시드(LCG)라 같은 입력에는 늘 같은 자리다.
 * 돌려주는 좌표는 카드의 왼쪽 위 모서리다. 없는 카드나 자기 자신으로 가는 관계는 무시한다.
 */
export function forceLayout(nodes: readonly { id: string }[], links: readonly Edge[]): Map<string, Point> {
  const bodies: Body[] = nodes.map((node) => ({ id: node.id }))
  const known = new Set(bodies.map((body) => body.id))
  const edges: Edge[] = links.filter((link) => link.source !== link.target && known.has(link.source) && known.has(link.target)).map(({ source, target }) => ({ source, target }))
  const simulation = forceSimulation(bodies)
    .force('link', forceLink<Body, Edge>(edges).id((body) => body.id).distance(RADIUS * 2.2).strength(0.6))
    .force('charge', forceManyBody().strength(-400))
    .force('collide', forceCollide(RADIUS).iterations(3))
    .force('center', forceCenter(0, 0))
    .stop()
  simulation.tick(Math.round(Math.max(120, Math.min(300, 30000 / Math.max(nodes.length, 1))))) // 카드가 많을수록 반복을 줄여(최소 120번) 한 번에 계산하는 시간을 묶는다
  return new Map(bodies.map((body) => [body.id, { x: (body.x ?? 0) - CARD_W / 2, y: (body.y ?? 0) - CARD_H / 2 }]))
}
