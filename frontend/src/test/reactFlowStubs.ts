/**
 * React Flow(`@xyflow/react`)를 렌더하는 jsdom 테스트가 먼저 가져오는 최소 대역(import만 하면 설치된다).
 * - ResizeObserver: jsdom에 없고 React Flow 래퍼가 가드 없이 쓴다. 관찰을 시작하면 바로 한 번 알려 주고(`notifyResize`로 다시 알릴 수 있다), 크기는 늘 800×600이다.
 * - DOMMatrixReadOnly: 노드 측정 갱신이 뷰포트의 transform에서 배율(m22)을 읽는다. scale(n)만 읽고 없으면 1이다.
 * - offsetWidth·offsetHeight: React Flow가 상자·노드 크기를 읽는다(0이면 경고 #004와 500×500 대체값). 인라인 style의 px 폭·높이(노드 래퍼 200×150)가 있으면 그 값, 없으면 800×600이다.
 * - clientWidth·clientHeight: jsdom은 0이다. 캔버스는 상자가 보여 크기가 있을 때만 React Flow를 그리므로(0×0이면 경고·NaN 좌표) 800×600을 돌려준다. 숨긴 상자는 테스트가 이 getter를 0으로 덮어 흉내 낸다.
 * - getBoundingClientRect: jsdom은 늘 0이라 끌기의 자동 이동(autoPan)이 포인터를 '캔버스 밖'으로 보고 손을 뗀 뒤에도 뷰포트를 계속 민다. React Flow 상자(.react-flow)만 800×600 자리에 있다고 알리고 다른 요소는 그대로 둔다.
 * vi.stubGlobal이 아니라 직접 대입한다: 테스트의 afterEach(vi.unstubAllGlobals)가 대역을 걷어 가지 않게.
 */
const observers = new Set<ResizeObserverStub>()
class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback
  private readonly targets = new Set<Element>()
  constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.add(this) }
  observe(target: Element) { this.targets.add(target); observers.add(this); this.notify() }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear(); observers.delete(this) }
  notify() { if (this.targets.size) this.callback([...this.targets].map((target) => ({ target, contentRect: { width: 800, height: 600 } }) as ResizeObserverEntry), this as unknown as ResizeObserver) }
}
/** 크기 관찰자를 모두 다시 깨운다(상자가 보이게 되거나 숨겨진 뒤에 부른다). */
export const notifyResize = () => observers.forEach((observer) => observer.notify())
class DOMMatrixReadOnlyStub {
  readonly m22: number
  constructor(transform?: string) { this.m22 = Number(/scale\(([\d.]+)\)/.exec(transform ?? '')?.[1] ?? 1) }
}
const px = (value: string, fallback: number) => Number(/^([\d.]+)px$/.exec(value)?.[1] ?? fallback)
Object.defineProperties(Element.prototype, {
  clientWidth: { configurable: true, get: () => 800 },
  clientHeight: { configurable: true, get: () => 600 },
})
/** 핸들(.react-flow__handle)의 크기: 12px(끌어 잇기가 가까운 핸들을 찾는 데 쓴다). 그 밖의 요소는 인라인 style의 px 크기, 없으면 800×600이다. */
const handleSize = (el: HTMLElement) => (el.classList.contains('react-flow__handle') ? 12 : undefined)
Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { configurable: true, get(this: HTMLElement) { return handleSize(this) ?? px(this.style.width, 800) } },
  offsetHeight: { configurable: true, get(this: HTMLElement) { return handleSize(this) ?? px(this.style.height, 600) } },
})
const rectOf = Element.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function (this: Element) {
  return this.classList?.contains('react-flow') ? ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() { return this } } as DOMRect) : rectOf.call(this)
}
Object.assign(globalThis, { ResizeObserver: ResizeObserverStub, DOMMatrixReadOnly: DOMMatrixReadOnlyStub })
if (typeof window !== 'undefined') Object.assign(window, { ResizeObserver: ResizeObserverStub, DOMMatrixReadOnly: DOMMatrixReadOnlyStub })
