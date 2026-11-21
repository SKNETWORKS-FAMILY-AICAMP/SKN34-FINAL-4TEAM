/** 선 하나: 선 id(그리는 선의 id와 같다)와 두 끝 노드 id. */
export type Link = { id: string; source: string; target: string }

/** 강조할 대상: 그 노드·직접 이어진 이웃 노드·그 노드에 닿는 선(이웃끼리 이어진 선은 아니다). 그래프에 없는 노드는 선 없이 자기 자신만 돌려준다. */
export function neighborhood(id: string, links: readonly Link[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]), edges = new Set<string>()
  for (const link of links) {
    if (link.source !== id && link.target !== id) continue
    edges.add(link.id)
    nodes.add(link.source)
    nodes.add(link.target)
  }
  return { nodes, edges }
}

const quote = (id: string) => '"' + id.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\a ') + '"'
/**
 * 강조 상태의 CSS(옵시디언식): 대상이 아닌 노드·선은 흐리게(눌리기는 그대로), 대상 선은 굵게 강조색으로 그린다. 노드·선을 다시 만들지 않고 이 한 덩어리 CSS만 바꿔 강조를 켜고 끈다(노드 수십 개의 렌더를 건드리지 않는다).
 * 노드·선은 둘 다 React Flow 래퍼의 `data-id`(노드는 `.react-flow__node`, 선은 `.react-flow__edge`)로 고른다.
 * opacity는 상속되지 않아 한 층만 흐리면 자식 요소의 computed opacity는 1로 읽히므로, 대상이 아닌 선은 층마다 흐리다: 래퍼와 선 그룹(`.relationship-edge`)이 .4씩(겹쳐 약 16%)이고
 * 그리지 않는 누르는 경로(`.relationship-edge-hit`)는 .15다. 마우스를 올리거나 초점이 간 선은 흐려도 편집·삭제 버튼이 보이도록 흐리지 않는다. 대상 노드가 없으면 빈 글자다.
 */
export function focusStyle(nodes: ReadonlySet<string>, edges: ReadonlySet<string>): string {
  if (!nodes.size) return ''
  const only = (ids: ReadonlySet<string>) => [...ids].map((id) => '[data-id=' + quote(id) + ']').join(',')
  const dimmed = '.relationship-flow .react-flow__edge:not(' + (edges.size ? only(edges) + ',' : '') + ':hover,:focus-within)'
  const crisp = edges.size ? '.relationship-flow .react-flow__edge:is(' + only(edges) + ') .relationship-edge > path:first-child{stroke:var(--edge-active);stroke-width:3px}' : ''
  return '.relationship-flow .react-flow__node:not(' + only(nodes) + '){opacity:.18}' + dimmed + '{opacity:.4}' + dimmed + ' .relationship-edge{opacity:.4}' + dimmed + ' .relationship-edge-hit{opacity:.15}' + crisp
}
