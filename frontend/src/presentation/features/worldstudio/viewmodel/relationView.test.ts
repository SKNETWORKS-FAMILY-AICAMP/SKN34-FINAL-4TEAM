import { expect, it } from 'vitest'
import { KNOWLEDGE_KINDS, defaultRelationView, hideRelationKinds, kindRows, localGraph, relationKind, relationKinds } from './relationView'
import type { MapLink, MapNode } from './useWorldMapViewModel'

const node = (id: string, over: Partial<MapNode> = {}): MapNode => ({ id, name: id, kind: '인물', type: 'character', text: '', tags: [], ...over })
let n = 0
const link = (source: string, target: string, label = '친구', over: Partial<MapLink> = {}): MapLink => ({ id: source + '>' + target + '#' + ++n, source, target, label, fullLabel: label, ...over })
const graph = (nodes: MapNode[], links: MapLink[]) => ({ nodes, links, missingLinks: 0 })

it('relationKind는 줄임 없는 이름(fullLabel)을 쓰고 없으면 label이다', () => {
  expect(relationKind({ label: '부자 관…', fullLabel: '부자 관계 보호' })).toBe('부자 관계 보호')
  expect(relationKind({ label: '친구' })).toBe('친구')
})

it('relationKinds는 같은 이름의 관계를 묶어 개수와 함께 많은 쪽부터(같으면 이름순) 돌려준다', () => {
  const links = [link('a', 'b', '참여'), link('a', 'c', '참여'), link('b', 'c', '알고 있음'), link('a', 'b', '알고 있음'), link('c', 'a', '목격'), link('a', 'c', '참여')]
  expect(relationKinds(links)).toEqual([{ name: '참여', count: 3 }, { name: '알고 있음', count: 2 }, { name: '목격', count: 1 }])
  expect(relationKinds([])).toEqual([])
})

it('hideRelationKinds는 끈 종류의 선만 빼고(노드는 그대로) 끈 종류가 없으면 같은 그래프를 돌려준다', () => {
  const g = graph([node('a'), node('b'), node('c')], [link('a', 'b', '친구'), link('b', 'c', '알고 있음'), link('a', 'c', '목격')])
  expect(hideRelationKinds(g, new Set())).toBe(g)
  expect(hideRelationKinds(g, new Set(['없는 종류']))).toBe(g)
  const shown = hideRelationKinds(g, new Set(['알고 있음', '목격']))
  expect(shown.links.map((l) => l.label)).toEqual(['친구'])
  expect(shown.nodes).toBe(g.nodes)
  expect(g.links).toHaveLength(3) // 원본은 그대로
})

it('localGraph는 중심에서 선 깊이 1·2 안의 노드와 그 사이 선만 남긴다(방향 무관)', () => {
  // a — b — c — d — e, b — f
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id))
  const g = graph(nodes, [link('a', 'b'), link('c', 'b'), link('c', 'd'), link('d', 'e'), link('b', 'f')])
  const ids = (depth: 1 | 2, center = 'b') => localGraph(g, center, depth).nodes.map((x) => x.id).sort()
  expect(ids(1)).toEqual(['a', 'b', 'c', 'f'])
  expect(ids(2)).toEqual(['a', 'b', 'c', 'd', 'f'])
  expect(localGraph(g, 'b', 1).links).toHaveLength(3) // a-b, c-b, b-f (c-d는 d가 밖)
  expect(localGraph(g, 'b', 2).links).toHaveLength(4) // c-d도 남는다
  expect(ids(1, 'e')).toEqual(['d', 'e'])
})

it('localGraph는 같은 두 노드 사이의 평행 관계를 모두 남기고, 중심이 그래프에 없으면 그래프를 그대로 돌려준다', () => {
  const g = graph([node('a'), node('b'), node('c')], [link('a', 'b', '친구'), link('a', 'b', '동료'), link('b', 'c')])
  expect(localGraph(g, 'a', 1).links.map((l) => l.label)).toEqual(['친구', '동료'])
  expect(localGraph(g, '없음', 1)).toBe(g)
})

it('defaultRelationView: 인물이 둘 이상이면 인물만 켜고 정보 관계(알고 있음·전해 들음·목격)는 끈다. 인물이 없거나 한 장이면 모든 유형을 켠다', () => {
  expect(KNOWLEDGE_KINDS).toEqual(['알고 있음', '전해 들음', '목격'])
  const many = graph([node('a'), node('b'), node('p', { type: 'location', kind: '장소' }), node('e', { type: 'event', kind: '사건' })], [])
  expect(defaultRelationView(many)).toEqual({ hiddenTypes: ['location', 'event'], hiddenKinds: ['알고 있음', '전해 들음', '목격'] })
  const one = graph([node('a'), node('p', { type: 'location', kind: '장소' })], [])
  expect(defaultRelationView(one).hiddenTypes).toEqual([])
  expect(defaultRelationView(graph([node('p', { type: 'location', kind: '장소' })], [])).hiddenTypes).toEqual([])
  expect(defaultRelationView(graph([], [])).hiddenKinds).toEqual(['알고 있음', '전해 들음', '목격']) // 종류는 늘 같은 기본값
})

it('kindRows: 검색이 없으면 상위 12종과 나머지를 묶은 기타를(정보 관계 세 종류는 순위와 무관하게 항상 목록에), 검색이 있으면 이름에 글이 든 종류만(최대 50개) 돌려준다', () => {
  const kinds = Array.from({ length: 20 }, (_, i) => ({ name: '종류' + i, count: 40 - i }))
  const top = kindRows(kinds, '')
  expect(top.rows.map((r) => r.name)).toEqual(kinds.slice(0, 12).map((k) => k.name))
  expect(top.other).toEqual({ names: kinds.slice(12).map((k) => k.name), count: 196 })
  expect(kindRows(kinds.slice(0, 5), '').other).toBeNull() // 12종 이하면 기타가 없다
  const found = kindRows(kinds, ' 종류1 ') // 앞뒤 공백은 무시
  expect(found.rows.map((r) => r.name)).toEqual(['종류1', '종류10', '종류11', '종류12', '종류13', '종류14', '종류15', '종류16', '종류17', '종류18', '종류19'])
  expect(found.other).toBeNull()
  expect(kindRows(kinds, 'zzz').rows).toEqual([])
  expect(kindRows(Array.from({ length: 120 }, (_, i) => ({ name: 'k' + i, count: 1 })), 'k').rows).toHaveLength(50)
  const withKnowledge = [...kinds, { name: '목격', count: 1 }] // 순위가 아주 낮아도
  expect(kindRows(withKnowledge, '').rows.map((r) => r.name)).toContain('목격')
  expect(kindRows(withKnowledge, '').rows).toHaveLength(13) // 상위 12 + 정보 관계
  expect(kindRows(withKnowledge, '').other!.names).not.toContain('목격')
})
