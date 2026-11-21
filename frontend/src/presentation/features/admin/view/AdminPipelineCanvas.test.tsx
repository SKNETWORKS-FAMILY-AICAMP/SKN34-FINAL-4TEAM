// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { pipelineSummary, type PipelineNode } from '../../../../domain/entities/llmOpsPipeline'
import AdminPipelineCanvas from './AdminPipelineCanvas'

// 실제 react-force-graph(d3·canvas)는 그리지 않고 캔버스가 넘기는 값만 붙잡는다.
type GraphNode = { id: string; x: number; y: number; fx: number; fy: number }
type GraphProps = {
  graphData: { nodes: GraphNode[]; links: unknown[] }; width: number; height: number
  enableNodeDrag: boolean; enablePanInteraction: boolean; enableZoomInteraction: boolean; cooldownTicks: number; onNodeClick: (node: GraphNode) => void
}
const forceGraph = vi.hoisted(() => ({ props: null as null | GraphProps }))
vi.mock('react-force-graph-2d', () => ({ default: (props: GraphProps) => { forceGraph.props = props; return null } }))

// jsdom에는 ResizeObserver가 없다. 관찰을 시작하면 바로 그 폭을 알려 주는 대역을 둔다.
const measure = (width: number) => vi.stubGlobal('ResizeObserver', class {
  private readonly notify: () => void
  constructor(callback: ResizeObserverCallback) { this.notify = () => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
  observe() { this.notify() }
  disconnect() {}
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forceGraph.props = null })

const node = (id: string, next: string[] = [], extra: Partial<PipelineNode> = {}): PipelineNode => ({ id, label: id, next, standalone: false, count: 3, errors: 0, promptNames: [], ...extra })
const nodes = [node('request', ['guard']), node('guard', ['main'], { errors: 2 }), node('main'), node('rating_direct', [], { standalone: true })]
const draw = (list = nodes, selected: string | null = null, onSelect = vi.fn()) => <AdminPipelineCanvas nodes={list} selected={selected} onSelect={onSelect} />

it('ResizeObserver가 없으면(jsdom) 크기를 재지 못해 그림 없이 요약 이름의 틀만 그린다', () => {
  render(draw())
  screen.getByRole('img', { name: pipelineSummary(nodes) })
  expect(forceGraph.props).toBeNull()
})

it('잰 폭으로 그리고, 노드는 고정 좌표(fx·fy)이며 끌기·이동·확대를 꺼 페이지 스크롤을 가로채지 않는다', () => {
  measure(900)
  render(draw())
  const props = forceGraph.props!
  expect([props.width, props.enableNodeDrag, props.enablePanInteraction, props.enableZoomInteraction, props.cooldownTicks]).toEqual([900, false, false, false, 0])
  expect(props.graphData.nodes.map((n) => n.id)).toEqual(['request', 'guard', 'main', 'rating_direct'])
  expect(props.graphData.nodes.every((n) => n.fx === n.x && n.fy === n.y)).toBe(true)
  expect(props.graphData.links).toHaveLength(2)
  expect(props.height).toBeGreaterThanOrEqual(240)
  expect(props.height).toBeLessThanOrEqual(760)
})

it('노드를 누르면 그 id로 onSelect를 부른다', () => {
  measure(900)
  const onSelect = vi.fn()
  render(draw(nodes, null, onSelect))
  act(() => forceGraph.props!.onNodeClick(forceGraph.props!.graphData.nodes[1]))
  expect(onSelect).toHaveBeenCalledWith('guard')
})

it('선택만 바뀌어 다시 그릴 때는 같은 그래프 데이터를 넘기고, 노드 목록이 새로 오면 새 데이터를 넘긴다(force-graph는 데이터가 바뀔 때만 다시 가열한다)', () => {
  measure(900)
  const { rerender } = render(draw())
  const first = forceGraph.props!.graphData
  rerender(draw(nodes, 'guard'))
  expect(forceGraph.props!.graphData).toBe(first)
  rerender(draw([...nodes, node('apply')], 'guard'))
  expect(forceGraph.props!.graphData).not.toBe(first)
})
