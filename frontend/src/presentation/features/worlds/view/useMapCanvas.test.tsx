// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useMapCanvas } from './useMapCanvas'

/** 폭 맞춤(`[width]` effect)만 본다: 좌표가 붙기 전의 getGraphBbox는 NaN 상자라 그때 zoomToFit을 부르면 d3-zoom 변환이 NaN이 된다(이유는 훅의 주석). */
let resize: (width: number) => void = () => {}
beforeEach(() => vi.stubGlobal('ResizeObserver', class {
  constructor(callback: ResizeObserverCallback) { resize = (width) => callback([{ contentRect: { width } } as ResizeObserverEntry], this as never) }
  observe() {}
  disconnect() {}
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const NOT_PLACED = { x: [undefined, undefined], y: [undefined, undefined] }
const PLACED = { x: [-120, 140], y: [-60, 70] }

/** 그래프 메서드 대역을 훅의 graph ref에 렌더 중에 꽂는다(첫 effect가 돌 때 이미 있게). */
function setup() {
  const graph = { getGraphBbox: vi.fn(() => NOT_PLACED as unknown), zoomToFit: vi.fn() }
  function Probe() {
    const canvas = useMapCanvas()
    canvas.graph.current = graph as never
    return <div ref={canvas.host} />
  }
  render(<Probe />)
  return graph
}

it('좌표가 붙기 전에는 화면 맞춤을 하지 않고, 좌표가 생긴 뒤 폭이 바뀌면 맞춘다', () => {
  const graph = setup()
  expect(graph.zoomToFit).not.toHaveBeenCalled() // 마운트 직후(배치 전): 맞추면 변환이 NaN이 된다
  act(() => resize(744)) // 폭이 바뀌었지만 아직 배치 전이다
  expect(graph.zoomToFit).not.toHaveBeenCalled()
  graph.getGraphBbox.mockReturnValue(PLACED)
  act(() => resize(600))
  expect(graph.zoomToFit.mock.calls).toEqual([[0, 40]])
})
