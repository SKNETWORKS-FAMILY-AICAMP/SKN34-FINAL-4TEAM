/** 관계도 카드의 크기(캔버스 좌표). 가까이(near) 볼 때의 카드 상자이고, 멀리서는 같은 중심의 점이다. */
export const CARD_W = 200, CARD_H = 150
/** 두 노드 사이에 늘 비워 두는 간격(캔버스 좌표). */
export const GAP = 16
export type Point = { x: number; y: number }
/** 노드 하나가 차지하는 상자: 중심(`cx`·`cy`)과 크기. */
export type Box = { cx: number; cy: number; w: number; h: number }

/** 어느 확대 단계에서나 겹치지 않게 보는 상자: 가까이의 카드(200×150)와 멀리·중간의 점(지름 `diameter`) 중 큰 쪽이다(허브의 점은 카드 높이를 넘는다). */
export const bodyBox = (diameter: number) => ({ w: Math.max(CARD_W, diameter), h: Math.max(CARD_H, diameter) })
/** 두 상자가 `gap`(기본 GAP)까지 가까우면 겹친 것이다: 두 축 모두 가까울 때만이다. */
export const overlaps = (a: Box, b: Box, gap = GAP) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + gap && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + gap

/**
 * 상자를 칸(256)에 나눠 담아 가까운 것끼리만 겹침을 비교한다(수백 장에서도 O(n)): 상자는 간격까지 넓힌 범위의 모든 칸에 들어가고, 겹칠 수 있는 두 상자는 반드시 같은 칸을 지난다.
 * `id`가 있는 상자는 같은 `id`의 상자(자기 자신)를 비교에서 뺀다.
 */
export function createGrid<T extends Box & { id?: string }>(gap = GAP) {
  const CELL = 256, cells = new Map<string, T[]>()
  const span = (b: Box) => ({ i0: Math.floor((b.cx - b.w / 2 - gap) / CELL), i1: Math.floor((b.cx + b.w / 2 + gap) / CELL), j0: Math.floor((b.cy - b.h / 2 - gap) / CELL), j1: Math.floor((b.cy + b.h / 2 + gap) / CELL) })
  return {
    add(b: T) { const s = span(b); for (let i = s.i0; i <= s.i1; i++) for (let j = s.j0; j <= s.j1; j++) { const key = i + ',' + j, list = cells.get(key); if (list) list.push(b); else cells.set(key, [b]) } },
    hits(b: Box & { id?: string }) { const s = span(b); for (let i = s.i0; i <= s.i1; i++) for (let j = s.j0; j <= s.j1; j++) for (const other of cells.get(i + ',' + j) ?? []) if (!(b.id !== undefined && other.id === b.id) && overlaps(b, other, gap)) return true; return false },
  }
}

/** `want`에서 가장 가까운 빈 자리를 찾는다(`step` 간격의 정사각 고리를 안쪽부터 훑고 한 고리 안에서는 가까운 순서, 같은 거리면 훑는 순서). 비어 있으면 `want` 그대로다. */
function nearestIn(grid: ReturnType<typeof createGrid<Box & { id?: string }>>, want: Box & { id?: string }, step: number): Box & { id?: string } {
  if (!grid.hits(want)) return want
  for (let ring = 1; ring < 5000; ring++) {
    const spots: Array<[number, number]> = []
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) spots.push([dx, dy])
    spots.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]))
    for (const [dx, dy] of spots) { const spot = { ...want, cx: want.cx + dx * step, cy: want.cy + dy * step }; if (!grid.hits(spot)) return spot }
  }
  return want
}
/** 새 상자를 `want`에 놓되 다른 상자(`others`)와 겹치면 가장 가까운 빈 자리로 옮긴다(같은 입력에는 늘 같은 답). */
export function nearestFree(want: Box, others: readonly Box[], step = 24): Box {
  const grid = createGrid()
  for (const other of others) grid.add(other)
  return nearestIn(grid, want, step)
}
/**
 * 겹친 상자를 없앤다(결정적): 큰 상자부터(같으면 앞선 것) 두고, 이미 둔 상자와 겹치면 가장 가까운 빈 자리로 옮긴다. 떨어져 있던 상자는 움직이지 않고 돌려주는 순서·크기는 입력과 같다.
 * 힘 시뮬레이션의 충돌 힘은 부드러운 제약이라 반복이 끝난 뒤에도 조금 겹칠 수 있는데, 이 마무리 패스가 겹침을 0으로 만든다.
 */
export function legalize(boxes: readonly Box[], step = 24): Box[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b].w * boxes[b].h - boxes[a].w * boxes[a].h || a - b)
  const grid = createGrid(), out = boxes.slice()
  for (const i of order) { out[i] = nearestIn(grid, boxes[i], step); grid.add(out[i]) }
  return out
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
