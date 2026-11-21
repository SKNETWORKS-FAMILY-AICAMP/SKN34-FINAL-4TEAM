import { mapEndpoint, type MapLink, type MapNode } from './useWorldMapViewModel'

/*
 * 관계도의 화면 보기 규칙(순수): 관계 종류 필터·노드 중심(로컬) 보기·기본 보기. 모두 보기용이라 원본 그래프는 그대로 두고 주소·초안·저장과 무관하다.
 */
type MapGraph = { nodes: MapNode[]; links: MapLink[] }

/** 정보 관계: '누가 무엇을 안다'는 줄이다. 기본 보기에서는 끈다(켜면 사건·소문이 인물 관계를 가린다). */
export const KNOWLEDGE_KINDS = ['알고 있음', '전해 들음', '목격']

/** 관계 종류 = 줄임 없는 관계 이름(같은 이름끼리 한 종류다). */
export const relationKind = (link: Pick<MapLink, 'label' | 'fullLabel'>) => link.fullLabel ?? link.label

/** 관계 종류와 개수: 많은 쪽부터, 같으면 이름순. */
export function relationKinds(links: readonly MapLink[]) {
  const count = new Map<string, number>()
  for (const link of links) count.set(relationKind(link), (count.get(relationKind(link)) ?? 0) + 1)
  return [...count].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'))
}

/** 관계 종류 목록의 길이: 검색이 없으면 이만큼(정보 관계 제외)만 보인다. */
export const KIND_LIMIT = 12
/** 검색 결과의 최대 개수. */
const KIND_SEARCH_MAX = 50

/**
 * 필터 칸에 보일 관계 종류: 검색이 없으면 상위 `limit`종(정보 관계 세 종류는 순위와 무관하게 늘 목록에)과 나머지를 묶은 기타(`other`), 검색이 있으면 이름에 글이 든 종류만(최대 50개)이다.
 * 관계 이름이 천 가지가 넘는 세계관에서도 목록이 길어지지 않는다.
 */
export function kindRows(kinds: readonly { name: string; count: number }[], query: string, limit = KIND_LIMIT) {
  const q = query.trim().toLocaleLowerCase()
  if (q) return { rows: kinds.filter((k) => k.name.toLocaleLowerCase().includes(q)).slice(0, KIND_SEARCH_MAX), other: null }
  let taken = 0
  const rows = kinds.filter((k) => KNOWLEDGE_KINDS.includes(k.name) || taken++ < limit)
  const shown = new Set(rows)
  const rest = kinds.filter((k) => !shown.has(k))
  return { rows, other: rest.length ? { names: rest.map((k) => k.name), count: rest.reduce((sum, k) => sum + k.count, 0) } : null }
}

/** 끈 종류의 선만 뺀다(노드는 그대로). 뺄 선이 없으면 같은 그래프를 돌려준다. */
export function hideRelationKinds<G extends MapGraph>(graph: G, hidden: ReadonlySet<string>): G {
  const links = graph.links.filter((l) => !hidden.has(relationKind(l)))
  return links.length === graph.links.length ? graph : { ...graph, links }
}

/** 노드 중심 보기: `center`에서 선으로 `depth`단계(방향 무관) 안의 노드와 그 사이의 선만 남긴다. 중심이 그래프에 없으면 그래프를 그대로 돌려준다. */
export function localGraph<G extends MapGraph>(graph: G, center: string, depth: 1 | 2): G {
  if (!graph.nodes.some((n) => n.id === center)) return graph
  const near = new Set([center])
  let edge = new Set([center])
  for (let step = 0; step < depth; step++) {
    const next = new Set<string>()
    for (const l of graph.links) {
      const a = mapEndpoint(l.source), b = mapEndpoint(l.target)
      if (edge.has(a) && !near.has(b)) next.add(b)
      if (edge.has(b) && !near.has(a)) next.add(a)
    }
    next.forEach((id) => near.add(id))
    edge = next
  }
  return { ...graph, nodes: graph.nodes.filter((n) => near.has(n.id)), links: graph.links.filter((l) => near.has(mapEndpoint(l.source)) && near.has(mapEndpoint(l.target))) }
}

/** 처음 여는 세계관의 보기: 인물이 둘 이상이면 인물만 켜고, 정보 관계는 늘 끈다. 인물이 없거나 한 장이면 모든 유형을 켠다. */
export function defaultRelationView(graph: { nodes: readonly MapNode[] }) {
  const types = [...new Set(graph.nodes.flatMap((n) => (n.type ? [n.type] : [])))]
  const people = graph.nodes.filter((n) => n.type === 'character').length
  return { hiddenTypes: people > 1 ? types.filter((t) => t !== 'character') : [], hiddenKinds: [...KNOWLEDGE_KINDS] }
}
