/** 관계도 카드의 크기(캔버스 좌표). 가까이(near) 볼 때의 카드 상자이고, 멀리서는 같은 중심의 점이다. */
export const CARD_W = 200, CARD_H = 150
export type Point = { x: number; y: number }

const overlaps = (a: Point, b: Point) => Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H

/**
 * 새 카드를 `at`에 놓되 다른 카드(`occupied`, 왼쪽 위 모서리 좌표)와 겹치면 바깥쪽으로 돌며 가까운 빈 자리를 찾는다(60px 간격, 최대 12바퀴). 못 찾으면 `at` 그대로다.
 * 같은 입력에는 늘 같은 답이라 예측할 수 있다.
 */
export function freeSpot(at: Point, occupied: readonly Point[], step = 60): Point {
  if (!occupied.some((p) => overlaps(p, at))) return at
  for (let ring = 1; ring <= 12; ring++) {
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const spot = { x: at.x + dx * ring * step, y: at.y + dy * ring * step }
      if (!occupied.some((p) => overlaps(p, spot))) return spot
    }
  }
  return at
}

/** 끌어 잇기가 허용되는 연결인지: 자기 자신·그래프에 없는 카드·이름 없는 카드는 막는다(이름 없는 카드는 관계 작성 시트의 선택지에도 없다). */
export function validConnection(connection: { source: string; target: string }, nodes: ReadonlyMap<string, { unnamed?: boolean }>) {
  const from = nodes.get(connection.source), to = nodes.get(connection.target)
  return connection.source !== connection.target && !!from && !!to && !from.unnamed && !to.unnamed
}

/** 메뉴를 눌린 자리(`point`, 화면 좌표)에 두되 화면 오른쪽·아래로 넘치지 않게 안쪽으로 당기고 가장자리 여백을 지킨다(화면보다 큰 메뉴는 왼쪽 위에 붙인다). */
export const clampMenu = (point: { x: number; y: number }, size: { w: number; h: number }, view: { w: number; h: number }, margin = 8) => ({
  x: Math.max(margin, Math.min(point.x, view.w - size.w - margin)),
  y: Math.max(margin, Math.min(point.y, view.h - size.h - margin)),
})
