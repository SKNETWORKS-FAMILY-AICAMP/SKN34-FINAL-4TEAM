import { createGrid, type Box } from './canvasLayout'

/** 이름표를 붙일 노드(그래프 좌표): 중심, 점 지름(`d`), 이름, 글자 크기(`size`, 화면 px), 우선순위(`degree`: 이어진 관계 수이고, 큰 값이 먼저 자리를 잡는다. 강조한 이웃에는 더 큰 값을 넘긴다). */
export type LabelNode = { id: string; cx: number; cy: number; d: number; name: string; degree: number; size: number }
/** 지금 화면: 캔버스 원점의 화면 위치(`x`·`y`), 확대 배율(`k`), 캔버스 상자 크기(`w`·`h`, 화면 px). */
export type View = { x: number; y: number; k: number; w: number; h: number }
/** 놓은 이름표(화면 좌표): `x`는 가운데, `y`는 윗변, `size`는 글자 크기(px). */
export type Label = { id: string; x: number; y: number; size: number }
/** 노드와 이름표 사이 간격(화면 px). */
const LABEL_GAP = 4

/** 이름표 글자 폭 어림(화면 px): 한글·한자 같은 넓은 글자는 한 칸(글자 크기), 영문·숫자·기호는 약 0.56칸이다. */
export function labelWidth(name: string, size: number) {
  let width = 0
  for (const char of name) width += (char.codePointAt(0) ?? 0) > 0x2e7f ? size : size * 0.56
  return width
}

/**
 * 이름표를 놓는다(화면 좌표, 결정적). 이름표는 확대 배율을 따라 커지지 않고 노드 바로 아래 화면 4px에 붙으므로 겹침도 화면에서 가린다:
 * 우선순위는 `always`(강조한 노드·이웃·고른 카드: 겹쳐도 보이고 먼저 자리를 잡는다) > 관계가 많은 노드(큰 노드) > 앞선 노드이고,
 * 나머지는 이미 놓은 이름표와 겹치면 숨긴다(작은 노드부터). 다른 노드의 점은 가려도 된다: 이웃 점이 빽빽이 둘러싼 가장 큰 노드의 이름이 그 점들 때문에 사라지지 않게. `candidates`가 아닌 노드는 `always`가 아니면 이름표가 없고, 화면 밖 노드는 둘 다 만들지 않는다.
 */
export function placeLabels(nodes: readonly LabelNode[], view: View, candidates: ReadonlySet<string>, always: ReadonlySet<string>): Label[] {
  const margin = 200
  const seen = nodes.map((node, index) => ({ node, index, sx: node.cx * view.k + view.x, sy: node.cy * view.k + view.y })).filter(({ sx, sy }) => sx > -margin && sx < view.w + margin && sy > -margin && sy < view.h + margin)
  const grid = createGrid<Box & { id: string }>(3) // 놓은 이름표만 담는다
  const order = seen.filter(({ node }) => always.has(node.id) || candidates.has(node.id)).sort((a, b) => Number(always.has(b.node.id)) - Number(always.has(a.node.id)) || b.node.degree - a.node.degree || a.index - b.index)
  const placed: Label[] = []
  for (const { node, sx, sy } of order) {
    const size = node.size, w = labelWidth(node.name, size) + 8, h = size * 1.3, top = sy + (node.d * view.k) / 2 + LABEL_GAP
    const box = { cx: sx, cy: top + h / 2, w, h, id: node.id }
    if (!always.has(node.id) && grid.hits(box)) continue
    grid.add({ ...box, id: node.id })
    placed.push({ id: node.id, x: sx, y: top, size })
  }
  return placed
}
