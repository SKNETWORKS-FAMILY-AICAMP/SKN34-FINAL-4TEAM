import { expect, it } from 'vitest'
import { foldSatellites } from './graphFold'

const node = (id: string, degree: number, name = id) => ({ id, name, degree })
const link = (source: string, target: string) => ({ source, target })
const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

it('이웃이 정확히 하나인 노드(위성)는 그 이웃(허브) 안으로 접히고, 접힌 노드와 그 선은 남지 않는다', () => {
  const nodes = [node('h', 3), node('s1', 1), node('s2', 1), node('n', 2), node('m', 1)]
  const links = [link('h', 's1'), link('h', 's2'), link('h', 'n'), link('n', 'm')]
  const f = foldSatellites(nodes, links)
  expect(ids(f.nodes)).toEqual(['h', 'n'])
  expect(f.links).toEqual([link('h', 'n')])
  expect(f.folded).toEqual(new Map([['h', ['s1', 's2']], ['n', ['m']]]))
})

it('한 번만 접는다: 위성의 이웃(허브)이 다시 위성이 되어 연쇄로 접히지 않는다', () => {
  // a — b — c — d: a는 b의, d는 c의 위성이고 b·c는 이웃이 둘이라 남는다
  const f = foldSatellites([node('a', 1), node('b', 2), node('c', 2), node('d', 1)], [link('a', 'b'), link('b', 'c'), link('c', 'd')])
  expect(ids(f.nodes)).toEqual(['b', 'c'])
  expect(f.links).toEqual([link('b', 'c')])
  expect(f.folded).toEqual(new Map([['b', ['a']], ['c', ['d']]]))
})

it('서로만 이어진 두 노드는 관계가 많은 쪽이 허브이고, 같으면 제목 순으로 앞선 쪽이 허브다', () => {
  const more = foldSatellites([node('x', 2, '가람'), node('y', 3, '나래')], [link('x', 'y')])
  expect(ids(more.nodes)).toEqual(['y'])
  expect(more.folded).toEqual(new Map([['y', ['x']]]))
  const tie = foldSatellites([node('b', 1, '나래'), node('a', 1, '가람')], [link('b', 'a')])
  expect(ids(tie.nodes)).toEqual(['a'])
  expect(tie.folded).toEqual(new Map([['a', ['b']]]))
})

it('이웃이 없는 외톨이는 접지 않는다', () => {
  const f = foldSatellites([node('x', 0), node('p', 1), node('q', 1)], [link('p', 'q')])
  expect(ids(f.nodes)).toEqual(['x', 'p']) // q는 p(제목이 앞)에 접힌다
  expect(f.folded.has('x')).toBe(false)
})

it('선이 줄면 다시 센다: 필터로 선이 빠지면 위성이 새로 생기거나 외톨이가 된다', () => {
  const nodes = [node('h', 3), node('s1', 1), node('n', 2), node('m', 1)]
  const before = foldSatellites(nodes, [link('h', 's1'), link('h', 'n'), link('n', 'm')])
  expect(ids(before.nodes)).toEqual(['h', 'n'])
  // n—m 선이 빠지면 m은 외톨이(접지 않음)고 n은 h의 위성이 된다
  const after = foldSatellites(nodes, [link('h', 's1'), link('h', 'n')])
  expect(ids(after.nodes)).toEqual(['h', 'm'])
  expect(after.folded).toEqual(new Map([['h', ['s1', 'n']]]))
})

it('펼친 허브는 위성을 그대로 보이되 허브 목록(hubs)에는 남아 다시 접을 수 있다', () => {
  const nodes = [node('h', 3), node('s1', 1), node('s2', 1), node('n', 2), node('m', 1)]
  const links = [link('h', 's1'), link('h', 's2'), link('h', 'n'), link('n', 'm')]
  const f = foldSatellites(nodes, links, new Set(['h']))
  expect(ids(f.nodes)).toEqual(['h', 's1', 's2', 'n'])
  expect(f.links).toHaveLength(3)
  expect(f.folded).toEqual(new Map([['n', ['m']]]))
  expect(f.hubs).toEqual(new Map([['h', ['s1', 's2']], ['n', ['m']]]))
})

it('선의 끝이 노드 객체여도 같다(react-force-graph가 끝점을 객체로 바꾼다)', () => {
  const f = foldSatellites([node('h', 2), node('s', 1), node('t', 1)], [{ source: { id: 'h' }, target: { id: 's' } }, { source: { id: 't' }, target: { id: 'h' } }])
  expect(ids(f.nodes)).toEqual(['h'])
  expect(f.links).toEqual([])
})
