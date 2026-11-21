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
