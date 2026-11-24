// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { NODE_HEIGHT, NODE_WIDTH, layoutPipeline, pipelineSummary, type PipelineNode } from '../../../../domain/entities/llmOpsPipeline'
import AdminPipelineCanvas from './AdminPipelineCanvas'

// 실제 react-force-graph(d3·canvas)는 그리지 않고 캔버스가 넘기는 값만 붙잡는다.
type GraphNode = { id: string; x: number; y: number; fx: number; fy: number }
type GraphLink = { source: string; target: string; back: boolean }
type GraphProps = {
  graphData: { nodes: GraphNode[]; links: GraphLink[] }; width: number; height: number
  enableNodeDrag: boolean; enablePanInteraction: boolean; enableZoomInteraction: boolean; cooldownTicks: number; onNodeClick: (node: GraphNode) => void
  onRenderFramePre: (ctx: CanvasRenderingContext2D, scale: number) => void
  linkCanvasObject: (link: GraphLink, ctx: CanvasRenderingContext2D, scale: number) => void
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

it('nodeLink가 있으면 부품이 있는 노드 위(상자 위 오른쪽 가장자리, 오른쪽·아래 끝 기준)에만 HTML로 얹고, 캔버스(role=img) 바깥 형제 자리에 두어 보조 기술에 읽히게 한다(#857)', () => {
  measure(900)
  const list = [node('request', ['guard']), node('guard', ['main'], { promptNames: ['decision_guard.judge'] }), node('main', [], { promptNames: ['orchestration.main'] })]
  const link = vi.fn((n: PipelineNode) => (n.promptNames.length ? <button type="button">프롬프트 보기 · {n.id}</button> : null))
  const { container } = render(<AdminPipelineCanvas nodes={list} selected={null} onSelect={vi.fn()} nodeLink={link} />)
  const canvas = screen.getByRole('img', { name: pipelineSummary(list) })
  // 버튼은 role=img 안이 아니라 그 곁에 있다(role=img의 자식은 보조 기술에 안 읽힌다).
  expect(canvas.querySelector('button')).toBeNull()
  const wraps = [...container.querySelectorAll<HTMLElement>('.pipe-node-link')]
  expect(wraps.map((wrap) => wrap.textContent)).toEqual(['프롬프트 보기 · guard', '프롬프트 보기 · main'])   // 부품이 없는 노드(request)는 자리도 없다
  // 위치는 배치 좌표와 확대 비율로 정한다: 원점이 캔버스 가운데이고 노드 상자의 위 오른쪽 모서리에 둔다.
  const layout = layoutPipeline(list)
  const width = 900, height = Math.round(Math.min(Math.max((width * layout.height) / layout.width, 240), 760))
  const scale = Math.min((width - 48) / layout.width, (height - 48) / layout.height)
  const guard = layout.nodes.find((n) => n.id === 'guard')!
  // 오른쪽·아래 끝 기준으로 앉힌다(transform을 쓰면 안쪽 메뉴의 fixed 기준 칸이 바뀌어 어긋난다).
  expect([wraps[0].style.right, wraps[0].style.bottom]).toEqual([`${width / 2 - (guard.x + NODE_WIDTH / 2) * scale + 6}px`, `${height / 2 - (guard.y - NODE_HEIGHT / 2) * scale - 5}px`])
  expect([wraps[0].style.left, wraps[0].style.top, wraps[0].style.transform]).toEqual(['', '', ''])
  const overlay = container.querySelector<HTMLElement>('.pipe-node-links')!
  expect([overlay.style.width, overlay.style.height]).toEqual(['900px', `${height}px`])
  expect(link).toHaveBeenCalledTimes(3)
})

it('nodeLink가 없으면(또는 크기를 못 재 틀만 그릴 때) 부품 자리를 만들지 않는다', () => {
  measure(900)
  const { container, unmount } = render(draw())
  expect(container.querySelector('.pipe-node-links')).toBeNull()
  unmount()
  vi.unstubAllGlobals()
  const { container: bare } = render(<AdminPipelineCanvas nodes={nodes} selected={null} onSelect={vi.fn()} nodeLink={() => <button type="button">보기</button>} />)
  expect(bare.querySelector('.pipe-node-links')).toBeNull()
})

it('캔버스가 너무 작게 줄어든(좁은 화면) 비율에서는 노드 위 부품이 서로 겹치므로 얹지 않는다(노드 버튼 목록에 같은 부품이 있다)', () => {
  const list = [node('request', ['guard']), node('guard', ['main'], { promptNames: ['decision_guard.judge'] }), node('main', [], { promptNames: ['orchestration.main'] })]
  const link = () => <button type="button">프롬프트 보기</button>
  measure(300)
  const narrow = render(<AdminPipelineCanvas nodes={list} selected={null} onSelect={vi.fn()} nodeLink={link} />)
  expect(forceGraph.props).not.toBeNull()   // 그림은 그리되
  expect(narrow.container.querySelector('.pipe-node-links')).toBeNull()   // 부품은 얹지 않는다
  narrow.unmount()
  measure(900)
  const wide = render(<AdminPipelineCanvas nodes={list} selected={null} onSelect={vi.fn()} nodeLink={link} />)
  expect(wide.container.querySelectorAll('.pipe-node-link')).toHaveLength(3)
})
