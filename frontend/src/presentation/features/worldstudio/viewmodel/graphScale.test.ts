import { expect, it } from 'vitest'
import { cardTypeCounts, hideCardTypes } from './characterMap'
import { foldSatellites } from './graphFold'
import { labelBox, labelCollide } from './graphForces'
import { buildGraph } from './graphModel'
import { defaultRelationView, hideRelationKinds, kindRows, relationKinds } from './relationView'
import type { MapLink, MapNode } from './useWorldMapViewModel'

/**
 * 큰 세계관 한 건(해리 포터 원문 기반 평가 세계관의 규모: 카드 3770·관계 4732·관계 이름 1213종, 참여 1790·알고 있음 1430): 기본 보기·필터·접기·충돌 한 틱이 한도 안에 끝나는지 본다.
 * 한도는 CI 부하를 넉넉히 감안한 값이라 일부러 느려진 코드(전체 쌍 반복·프레임마다 재계산)만 잡는다.
 */
function bigWorld() {
  const types = [['character', 570, '인물'], ['event', 1634, '사건'], ['object', 537, '사물'], ['rule', 331, '규칙'], ['location', 280, '장소'], ['ability', 278, '능력'], ['organization', 140, '조직']] as const
  const nodes: MapNode[] = types.flatMap(([type, count, kind]) => Array.from({ length: count }, (_, i): MapNode => ({ id: type + i, name: kind + i, kind: kind as MapNode['kind'], type, text: '', tags: [] })))
  const person = (i: number) => 'character' + (i % 570), event = (i: number) => 'event' + (i % 1634)
  const links: MapLink[] = []
  const add = (source: string, target: string, label: string) => links.push({ id: 'r' + links.length, source, target, label, fullLabel: label })
  for (let i = 0; i < 1790; i++) add(person(i * 7), event(i * 13), '참여')
  for (let i = 0; i < 1430; i++) add(person(i * 11 + 3), event(i * 17 + 5), '알고 있음')
  for (let i = 0; i < 1512; i++) add(person(i * 5), person(i * 5 + 1 + (i % 40)), '종류' + (i % 1211)) // 인물끼리의 관계 1512개(이름 1211종)
  return { nodes, links, missingLinks: 0 }
}

it('큰 세계관(카드 3770·관계 4732·관계 이름 1213종): 기본 보기는 인물만·정보 관계 끔이고, 관계 종류 목록은 상위+기타로 짧으며, 접기·충돌 한 틱까지 한도 안에 끝난다', () => {
  const t0 = performance.now()
  const map = bigWorld()
  expect(map.nodes).toHaveLength(3770)
  expect(map.links).toHaveLength(4732)
  const view = defaultRelationView(map)
  expect(view.hiddenTypes).toHaveLength(6) // 인물 말고 여섯 유형
  const byTypes = hideCardTypes(map, new Set(view.hiddenTypes))
  expect(byTypes.nodes).toHaveLength(570)
  const kinds = relationKinds(byTypes.links)
  expect(kinds.length).toBe(1211) // 인물끼리의 관계 이름(참여·알고 있음은 사건에 닿아 빠졌다)
  const rows = kindRows(relationKinds(map.links), '')
  expect(relationKinds(map.links)).toHaveLength(1213)
  expect(rows.rows.length).toBeLessThanOrEqual(15) // 상위 12 + 정보 관계(알고 있음)
  expect(rows.other!.names.length).toBeGreaterThan(1190)
  const shown = hideRelationKinds(byTypes, new Set(view.hiddenKinds))
  expect(shown.links).toHaveLength(1512)
  const graph = buildGraph(shown.nodes, shown.links)
  const folding = foldSatellites(graph.nodes, graph.links)
  expect(folding.folded.size).toBeGreaterThan(0)
  expect(folding.nodes.length).toBeLessThan(graph.nodes.length)
  // 전체 3770노드에 한 틱: 이름표 상자 충돌(쌍마다 검사)이 한도 안이다
  const all = buildGraph(map.nodes, map.links).nodes.map((n, i) => Object.assign(n, { x: (i % 70) * 40, y: Math.floor(i / 70) * 40, vx: 0, vy: 0 }))
  const force = labelCollide<(typeof all)[number]>((n) => labelBox(n.name, 6))
  force.initialize(all)
  force(1)
  expect(cardTypeCounts(map.nodes)).toHaveLength(7)
  expect(performance.now() - t0).toBeLessThan(5000)
})
