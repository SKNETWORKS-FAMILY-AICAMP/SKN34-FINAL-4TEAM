/*
 * 위성 노드 접기(순수): 서로 다른 이웃이 정확히 하나인 노드(위성)를 그 이웃(허브) 안으로 접는다. 큰 세계관에서 허브 주변의 점 무리가 선 다발이 되지 않게 한다.
 * 지금 보이는 그래프(유형·관계 종류 필터를 거치고 같은 쌍의 관계를 선 하나로 묶은 뒤)만 본다. 한 번만 접는다: 허브는 이웃이 둘 이상이라 다시 위성이 되지 않는다.
 * 서로만 이어진 두 노드는 관계가 많은 쪽(같으면 제목 순으로 앞선 쪽)이 허브다. 이웃이 없는 외톨이는 접지 않는다(외톨이 표시 설정이 맡는다).
 */
type End = string | { id: string }
const endId = (end: End) => (typeof end === 'string' ? end : end.id)

export type Folding<N, L> = {
  /** 보이는 노드·선: 접힌 위성과 그 선은 없다. */
  nodes: N[]; links: L[]
  /** 허브 id → 접힌 위성 id들(펼친 허브는 없다). */
  folded: Map<string, string[]>
  /** 허브 id → 위성 id들(펼친 허브도 있다: 다시 접을 수 있는지 알려 준다). */
  hubs: Map<string, string[]>
}

/** `expanded`는 펼친 허브 id들이다. */
export function foldSatellites<N extends { id: string; name: string; degree: number }, L extends { source: End; target: End }>(nodes: readonly N[], links: readonly L[], expanded: ReadonlySet<string> = new Set()): Folding<N, L> {
  const near = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set()]))
  for (const l of links) {
    const a = endId(l.source), b = endId(l.target)
    near.get(a)?.add(b)
    near.get(b)?.add(a)
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const hubs = new Map<string, string[]>()
  for (const n of nodes) {
    const mine = near.get(n.id)!
    if (mine.size !== 1) continue
    const [other] = mine, hub = byId.get(other)
    if (!hub) continue
    // 서로만 이어진 쌍이면 앞선 쪽(관계가 많은 쪽, 같으면 제목 순)만 허브로 남고 다른 쪽이 접힌다.
    const pair = near.get(other)!.size === 1
    if (pair && !(hub.degree > n.degree || (hub.degree === n.degree && (hub.name.localeCompare(n.name, 'ko') || (hub.id < n.id ? -1 : 1)) < 0))) continue
    hubs.set(other, [...(hubs.get(other) ?? []), n.id])
  }
  const folded = new Map([...hubs].filter(([id]) => !expanded.has(id)))
  const gone = new Set([...folded.values()].flat())
  return { nodes: nodes.filter((n) => !gone.has(n.id)), links: links.filter((l) => !gone.has(endId(l.source)) && !gone.has(endId(l.target))), folded, hubs }
}
