import { act } from '@testing-library/react'
import { vi } from 'vitest'
import type { GLink, GNode } from '../presentation/features/worldstudio/viewmodel/graphModel'

/**
 * react-force-graph-2d(관계도 그래프 캔버스) 대역(jsdom 시험 공용): jsdom에는 canvas·d3 시뮬레이션이 없어 그리지 않고, 캔버스가 넘기는 값(`props`)과 부르는 메서드(`methods`)를 붙잡는다.
 * 시험 파일은 맨 위에서 `vi.mock('react-force-graph-2d', () => import('<경로>/forceGraphFake'))`를 부르고(vi.mock은 파일 맨 위로 올려진다) 같은 모듈의 `fakeGraph`로 값을 읽고 조작한다. `beforeEach`에서 `fakeGraph.reset()`을 부른다.
 * 가져오기만 해도 jsdom에 없는 ResizeObserver(관찰을 시작하면 바로 한 번 알린다, `notifyResize`로 다시 알린다)와 요소 크기(`canvasSize`: clientWidth·clientHeight 800×600, 캔버스는 상자가 보여 크기가 있을 때만 그린다)를 설치한다.
 * `vi.stubGlobal`이 아니라 직접 대입한다: 테스트의 afterEach(vi.unstubAllGlobals)가 대역을 걷어 가지 않게. 숨긴 상자는 `canvasSize.w = 0` 뒤 `notifyResize()`로 흉내 낸다.
 */
type Props = Record<string, any>
const observers = new Set<ResizeObserverStub>()
class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback
  private readonly targets = new Set<Element>()
  constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.add(this) }
  observe(target: Element) { this.targets.add(target); observers.add(this); this.notify() }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear(); observers.delete(this) }
  notify() { if (this.targets.size) this.callback([...this.targets].map((target) => ({ target, contentRect: { width: canvasSize.w, height: canvasSize.h } }) as ResizeObserverEntry), this as unknown as ResizeObserver) }
}
export const notifyResize = () => observers.forEach((observer) => observer.notify())
export const canvasSize = { w: 800, h: 600 }
Object.defineProperties(Element.prototype, {
  clientWidth: { configurable: true, get: () => canvasSize.w },
  clientHeight: { configurable: true, get: () => canvasSize.h },
})
Object.assign(globalThis, { ResizeObserver: ResizeObserverStub })
if (typeof window !== 'undefined') Object.assign(window, { ResizeObserver: ResizeObserverStub })

const chain = () => { const f: Record<string, any> = {}; f.strength = vi.fn(() => f); f.distance = vi.fn(() => f); return f }
export const mouse = (x = 10, y = 10) => ({ clientX: x, clientY: y, preventDefault() {} }) as unknown as MouseEvent
const endId = (end: string | GNode) => (typeof end === 'string' ? end : end.id)

export const fakeGraph = {
  /** 캔버스가 마지막으로 넘긴 props(없으면 아직 그리지 않았다). */
  props: null as null | Props,
  /** 지금 확대 배율(`zoom()`이 돌려준다). */
  zoom: 1,
  /** 캔버스가 `d3Force(이름, 힘)`으로 넣은 힘과 기본 힘(charge·link·center)의 대역. */
  forces: {} as Record<string, any>,
  /** 캔버스가 부르는 메서드(vi.fn). 화면 좌표는 그래프 좌표 + (400,300)이다. */
  methods: {} as Record<string, any>,
  reset() {
    this.props = null; this.zoom = 1; canvasSize.w = 800; canvasSize.h = 600
    this.forces = { charge: chain(), link: chain(), center: chain() }
    Object.assign(this.methods, {
      d3Force: vi.fn((name: string, fn?: unknown) => (fn === undefined ? this.forces[name] : (this.forces[name] = fn, this.methods))),
      d3ReheatSimulation: vi.fn(), zoomToFit: vi.fn(), centerAt: vi.fn(), zoom: vi.fn((k?: number) => (k === undefined ? this.zoom : (this.zoom = k, this.methods))),
      screen2GraphCoords: vi.fn((x: number, y: number) => ({ x: (x - 400) / this.zoom, y: (y - 300) / this.zoom })), graph2ScreenCoords: vi.fn((x: number, y: number) => ({ x: x * this.zoom + 400, y: y * this.zoom + 300 })),
    })
  },
  data() { return this.props!.graphData as { nodes: GNode[]; links: GLink[] } },
  node(name: string) { const found = this.data().nodes.find((n) => n.name === name); if (!found) throw new Error('그래프에 노드가 없어요: ' + name); return found },
  /** 두 설정 사이의 선(방향 무관). 없으면 undefined다. */
  link(a: string, b: string) { const ids = [this.node(a).id, this.node(b).id].sort().join(); return this.data().links.find((l) => [endId(l.source), endId(l.target)].sort().join() === ids) },
  /** 노드를 5열 격자로 흩어 놓고 선의 끝점을 노드 객체로 바꾼다(react-force-graph가 하는 일): 화면 좌표 = 그래프 좌표 + (400,300)이라 57노드가 모두 800×600 안이고 가장 긴 이름표(약 170px)도 겹치지 않는다. */
  place() {
    const { nodes, links } = this.data(), byId = new Map(nodes.map((n) => [n.id, n]))
    nodes.forEach((n, i) => { n.x = (i % 5) * 190 - 380; n.y = Math.floor(i / 5) * 55 - 300 })
    for (const l of links) { l.source = byId.get(endId(l.source))!; l.target = byId.get(endId(l.target))! }
  },
}
export default function FakeForceGraph(props: Props) { fakeGraph.props = props; props.ref.current = fakeGraph.methods; return null }

const call = (name: string, ...args: unknown[]) => act(() => { fakeGraph.props![name](...args) })
export const clickNode = (name: string) => call('onNodeClick', fakeGraph.node(name), mouse())
export const rightClickNode = (name: string) => call('onNodeRightClick', fakeGraph.node(name), mouse())
export const clickLink = (a: string, b: string) => call('onLinkClick', fakeGraph.link(a, b), mouse())
export const hoverLink = (a?: string, b?: string) => call('onLinkHover', a && b ? fakeGraph.link(a, b) : null, null)

/** 지금 캔버스가 그리는 글(이름표·선 위 관계 이름)을 `onRenderFramePost` 한 번으로 모은다: 노드에 좌표가 있어야 하므로 `fakeGraph.place()` 뒤에 쓴다. */
export function drawnTexts() {
  const texts: string[] = []
  const ctx = new Proxy({}, { get: (_, prop) => (prop === 'fillText' ? (text: string) => { texts.push(text) } : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
  fakeGraph.props!.onRenderFramePost(ctx, fakeGraph.zoom)
  return texts
}
/** 노드를 그릴 때 정하는 투명도(1이면 또렷, 낮으면 흐리다). */
export function nodeAlpha(name: string) {
  let alpha = -1
  const ctx = new Proxy({}, { get: () => () => {}, set: (_, prop, value) => { if (prop === 'globalAlpha' && alpha < 0) alpha = value; return true } }) as unknown as CanvasRenderingContext2D
  fakeGraph.props!.nodeCanvasObject(fakeGraph.node(name), ctx, 1)
  return alpha
}
