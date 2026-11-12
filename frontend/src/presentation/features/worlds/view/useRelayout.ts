import { useRef } from 'react'

import type { useMapCanvas } from '../../worldstudio/view/useMapCanvas'

type Pos = { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }

/**
 * 세계관 지도와 상세 그래프 캔버스가 함께 쓰는 '다시 펼치기'와 '처음 한 번만 화면에 맞추기'.
 * `replay`는 드래그로 고정한 노드를 풀고 중심 근처 나선으로 되돌려 힘 계산을 처음부터 다시 돌린다.
 * `onEngineStop`은 배치가 멈출 때마다 상태를 알리되 맞춤(`zoomToFit`)은 처음 한 번만 한다(드래그가 끝나도 불리기 때문).
 */
export function useRelayout<N extends Pos, L>(canvas: ReturnType<typeof useMapCanvas<N, L>>, nodes: N[], padding: number) {
  const fitted = useRef(false)
  const { graph, reduced, setPaused, setSettled } = canvas
  return {
    replay: () => {
      fitted.current = false
      for (const [i, n] of nodes.entries()) {
        n.fx = undefined
        n.fy = undefined
        n.x = Math.cos(i * 2.4) * 15
        n.y = Math.sin(i * 2.4) * 15
        n.vx = 0
        n.vy = 0
      }
      setPaused(false)
      setSettled(false)
      graph.current?.resumeAnimation()
      graph.current?.centerAt(0, 0, 0)
      graph.current?.zoom(1, 0)
      graph.current?.d3ReheatSimulation()
    },
    onEngineStop: () => {
      setSettled(true)
      if (fitted.current) return
      fitted.current = true
      graph.current?.zoomToFit(reduced ? 0 : 500, padding)
    },
  }
}
