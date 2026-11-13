// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { useRelayout } from './useRelayout'

/** 지도·상세 그래프 캔버스가 쓰는 캔버스 훅 값 중 이 훅이 읽는 것만 흉내 낸다. */
const setup = (reduced = false) => {
  const graph = { resumeAnimation: vi.fn(), centerAt: vi.fn(), zoom: vi.fn(), d3ReheatSimulation: vi.fn(), zoomToFit: vi.fn() }
  const canvas = { graph: { current: graph }, reduced, setPaused: vi.fn(), setSettled: vi.fn() }
  const nodes = [{ fx: 5, fy: 6, x: 100, y: 200, vx: 3, vy: 4 }, { x: 1 }]
  const { result } = renderHook(() => useRelayout(canvas as never, nodes, 40))
  return { graph, canvas, nodes, ...result.current }
}

it('배치가 멈출 때마다 상태를 알리지만 화면 맞춤은 처음 한 번만 하고 다시 펼친 뒤 첫 멈춤에서 한 번 더 한다', () => {
  const { graph, canvas, replay, onEngineStop } = setup()
  onEngineStop()
  onEngineStop() // 드래그가 끝나도 불린다
  expect(canvas.setSettled.mock.calls).toEqual([[true], [true]])
  expect(graph.zoomToFit.mock.calls).toEqual([[500, 40]])
  replay()
  onEngineStop()
  expect(graph.zoomToFit).toHaveBeenCalledTimes(2)
})

it('다시 펼치기는 고정을 풀고 노드를 중심 근처 나선으로 되돌려 힘 계산을 처음부터 다시 돌린다', () => {
  const { graph, canvas, nodes, replay } = setup()
  replay()
  expect(nodes[0]).toEqual({ fx: undefined, fy: undefined, x: 15, y: 0, vx: 0, vy: 0 })
  expect(nodes[1].x).toBeCloseTo(Math.cos(2.4) * 15)
  expect([canvas.setPaused.mock.calls, canvas.setSettled.mock.calls]).toEqual([[[false]], [[false]]])
  expect([graph.resumeAnimation, graph.d3ReheatSimulation].map((fn) => fn.mock.calls.length)).toEqual([1, 1])
  expect([graph.centerAt.mock.calls, graph.zoom.mock.calls]).toEqual([[[0, 0, 0]], [[1, 0]]])
})

it('움직임 줄이기 설정이면 애니메이션 없이 맞춘다', () => {
  const { graph, onEngineStop } = setup(true)
  onEngineStop()
  expect(graph.zoomToFit.mock.calls).toEqual([[0, 40]])
})
