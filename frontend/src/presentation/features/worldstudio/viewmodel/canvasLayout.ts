/** 상자: 중심(`cx`·`cy`)과 크기. */
export type Box = { cx: number; cy: number; w: number; h: number }

/** 두 상자가 `gap`까지 가까우면 겹친 것이다: 두 축 모두 가까울 때만이다. */
export const overlaps = (a: Box, b: Box, gap = 0) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + gap && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + gap

/**
 * 상자를 칸(256)에 나눠 담아 가까운 것끼리만 겹침을 비교한다(수백 장에서도 O(n)): 상자는 간격까지 넓힌 범위의 모든 칸에 들어가고, 겹칠 수 있는 두 상자는 반드시 같은 칸을 지난다.
 * `id`가 있는 상자는 같은 `id`의 상자(자기 자신)를 비교에서 뺀다.
 */
export function createGrid<T extends Box & { id?: string }>(gap = 0) {
  const CELL = 256, cells = new Map<string, T[]>()
  const span = (b: Box) => ({ i0: Math.floor((b.cx - b.w / 2 - gap) / CELL), i1: Math.floor((b.cx + b.w / 2 + gap) / CELL), j0: Math.floor((b.cy - b.h / 2 - gap) / CELL), j1: Math.floor((b.cy + b.h / 2 + gap) / CELL) })
  return {
    add(b: T) { const s = span(b); for (let i = s.i0; i <= s.i1; i++) for (let j = s.j0; j <= s.j1; j++) { const key = i + ',' + j, list = cells.get(key); if (list) list.push(b); else cells.set(key, [b]) } },
    hits(b: Box & { id?: string }) { const s = span(b); for (let i = s.i0; i <= s.i1; i++) for (let j = s.j0; j <= s.j1; j++) for (const other of cells.get(i + ',' + j) ?? []) if (!(b.id !== undefined && other.id === b.id) && overlaps(b, other, gap)) return true; return false },
  }
}

/** 메뉴를 눌린 자리(`point`, 화면 좌표)에 두되 화면 오른쪽·아래로 넘치지 않게 안쪽으로 당기고 가장자리 여백을 지킨다(화면보다 큰 메뉴는 왼쪽 위에 붙인다). */
export const clampMenu = (point: { x: number; y: number }, size: { w: number; h: number }, view: { w: number; h: number }, margin = 8) => ({
  x: Math.max(margin, Math.min(point.x, view.w - size.w - margin)),
  y: Math.max(margin, Math.min(point.y, view.h - size.h - margin)),
})
