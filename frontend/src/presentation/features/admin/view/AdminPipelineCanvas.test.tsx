// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { layoutPipeline, linkCurve, pipelineSummary, type PipelineNode } from '../../../../domain/entities/llmOpsPipeline'
import AdminPipelineCanvas from './AdminPipelineCanvas'

// 실제 react-force-graph(d3·canvas)는 그리지 않고 캔버스가 넘기는 값만 붙잡는다.
type GraphNode = { id: string; x: number; y: number; fx: number; fy: number }
type GraphLink = { source: string; target: string; back: boolean }
type GraphProps = {
  graphData: { nodes: GraphNode[]; links: GraphLink[] }; width: number; height: number
  enableNodeDrag: boolean; enablePanInteraction: boolean; enableZoomInteraction: boolean; cooldownTicks: number; onNodeClick: (node: GraphNode) => void
  onRenderFramePre: (ctx: CanvasRenderingContext2D, scale: number) => void
  linkCanvasObject: (link: GraphLink, ctx: CanvasRenderingContext2D, scale: number) => void
  nodeCanvasObject: (node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => void
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

// 캔버스 그리기 호출을 이름·인자로 기록하는 대역(속성 대입은 그대로 저장한다).
const recorder = () => {
  const calls: [string, ...unknown[]][] = [], state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get: (target, name: string) => (name in target ? target[name] : (...args: unknown[]) => { calls.push([name, ...args]) }),
    set: (target, name: string, value) => { target[name] = value; return true },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

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
  expect(props.height).toBeGreaterThanOrEqual(160)
  expect(props.height).toBeLessThanOrEqual(760)
})

it('작은 흐름은 확대 비율에 상한(1.25)을 두어 화면 폭만큼 커지지 않고, 높이는 그 비율로 정한다(최소 160). 좁으면 폭에 맞춰 줄어든다(#857 3차)', () => {
  const branch = [node('a', ['b', 'c', 'd']), node('b'), node('c'), node('d')]   // 두 칸·세 줄
  const layout = layoutPipeline(branch)
  const heightAt = (width: number, list = branch) => { measure(width); const view = render(draw(list)); const height = forceGraph.props!.height; view.unmount(); return height }
  const capped = Math.round(layout.height * 1.25 + 48)   // 높이 = 레이아웃 높이 × 확대 비율 + 위아래 여백(24씩)
  expect(layout.width * 1.25).toBeLessThan(1400 - 48)    // 전제: 이 폭이면 상한이 걸린다
  expect(capped).toBeGreaterThan(160)
  expect(heightAt(1400)).toBe(capped)
  expect(heightAt(2400)).toBe(capped)                    // 폭이 더 넓어도 그대로다(상한이 없으면 폭에 비례해 커진다)
  const narrow = heightAt(300)
  expect(narrow).toBe(Math.max(Math.round((layout.height * (300 - 48)) / layout.width + 48), 160))   // 좁으면 폭에 맞춰 줄어든다
  expect(narrow).toBeLessThan(capped)
  expect(heightAt(1400, [node('a', ['b']), node('b', ['c']), node('c')])).toBe(160)                 // 한 줄짜리는 최소 높이
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

it('되돌아가는 선(업무 Agent→메인)은 back으로 넘기고, 그릴 때 점선으로 그려 앞으로 가는 선과 구분한다', () => {
  measure(900)
  render(draw([node('request', ['guard']), node('guard', ['main']), node('main', ['qa']), node('qa', ['main'])]))
  const { links } = forceGraph.props!.graphData
  expect(links.map((link) => link.back)).toEqual([false, false, false, true])
  const dashes = (link: GraphLink) => {
    const { ctx, calls } = recorder()
    forceGraph.props!.linkCanvasObject(link, ctx, 1)
    return calls.filter(([name]) => name === 'setLineDash').map(([, dash]) => dash)
  }
  expect(dashes(links[2])).toEqual([[], []])
  expect(dashes(links[3])).toEqual([[4, 3], []])
})

it('업무 Agent 묶음 라벨(읽기·검토, 작성)은 프레임을 그리기 전에 글자로 그린다', () => {
  measure(900)
  render(draw([node('main', ['qa', 'writing']), node('qa', ['main']), node('writing', ['main'])]))
  const { ctx, calls } = recorder()
  forceGraph.props!.onRenderFramePre(ctx, 1)
  expect(calls.filter(([name]) => name === 'fillText').map(([, text]) => text)).toEqual(['읽기·검토', '작성'])
})

it('캔버스는 노드 위에 눌러 쓰는 부품을 얹지 않는다: 그림이 지저분해지고 노드 이름을 가려서다(#857 3차, 프롬프트 보기는 노드 버튼 목록과 기록 패널에만 있다)', () => {
  measure(900)
  const { container } = render(draw([node('request', ['guard']), node('guard', ['main'], { promptNames: ['decision_guard.judge'] }), node('main', [], { promptNames: ['orchestration.main'] })]))
  expect(container.querySelector('button, a, [role="menu"], .pipe-node-links, .pipe-canvas-wrap')).toBeNull()
  expect(forceGraph.props).not.toBeNull()
})

it('서버 노드가 없는 단계(구조용 노드)는 점선 테두리에 건수 대신 LLM 호출 여부를 그리고, 서버 노드는 실선에 건수·오류를 그린다(#857 3차)', () => {
  measure(900)
  render(draw([node('server', ['plan'], { count: 5, errors: 1 }), node('plan', ['code'], { step: { llm: true } }), node('code', [], { step: { llm: false } })]))
  const paint = (id: string) => {
    const { ctx, calls } = recorder()
    forceGraph.props!.nodeCanvasObject(forceGraph.props!.graphData.nodes.find((n) => n.id === id)!, ctx, 1)
    return { dashes: calls.filter(([name]) => name === 'setLineDash').map(([, dash]) => dash), texts: calls.filter(([name]) => name === 'fillText').map(([, text]) => text) }
  }
  expect(paint('server')).toEqual({ dashes: [[], []], texts: ['server', '5건 · 오류 1건'] })
  expect(paint('plan')).toEqual({ dashes: [[4, 3], []], texts: ['plan', 'LLM 호출'] })
  expect(paint('code')).toEqual({ dashes: [[4, 3], []], texts: ['code', 'LLM 아님'] })
})

it('두 칸 넘게 거슬러 가는 선(다음 턴)은 노드 아래로 도는 호이고 화살촉이 위를 향하며, 그 밖의 선은 옆으로 닿는 화살촉이다(#857 3차)', () => {
  measure(900)
  const chain = [node('a', ['b']), node('b', ['c']), node('c', ['d']), node('d', ['a'])]
  render(draw(chain))
  const layout = layoutPipeline(chain), at = new Map(layout.nodes.map((n) => [n.id, n]))
  const heads = (index: number) => {
    const { ctx, calls } = recorder()
    forceGraph.props!.linkCanvasObject(forceGraph.props!.graphData.links[index], ctx, 1)
    return calls.filter(([name]) => name === 'lineTo').map(([, x, y]) => [x, y])
  }
  const long = linkCurve(at.get('d')!, at.get('a')!, true).points[3], side = linkCurve(at.get('a')!, at.get('b')!, false).points[3]
  expect(forceGraph.props!.graphData.links.map((l) => l.back)).toEqual([false, false, false, true])
  expect(heads(3)).toEqual([[long.x - 4, long.y + 7], [long.x + 4, long.y + 7]])
  expect(heads(0)).toEqual([[side.x - 7, side.y - 4], [side.x - 7, side.y + 4]])
})

it('title을 주면 캔버스 요약 이름이 그 흐름 이름이다(워크플로우 선택, #857 3차)', () => {
  measure(900)
  const list = [node('a', ['b'], { step: { llm: true } }), node('b', [], { count: 4 })]
  render(<AdminPipelineCanvas nodes={list} selected={null} onSelect={vi.fn()} title="인물 시뮬레이션 내부 흐름" />)
  screen.getByRole('img', { name: '인물 시뮬레이션 내부 흐름: 단계 2개, 건수·오류가 있는 단계 1개(나머지는 서버 노드가 없어 이름만)' })
})
