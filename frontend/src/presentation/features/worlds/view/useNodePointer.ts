import { useState } from 'react'

/**
 * 세계관 지도와 상세 그래프 캔버스가 함께 쓰는 포인터 규칙. `shown`은 이름을 보이고 강조할 노드 id이고 `graphProps`는 ForceGraph에 그대로 넘긴다.
 * - 마우스: 올린 노드가 `shown`이고 누르면 바로 연다. 끌어서 지도를 옮기고 노드를 끌어 고정한다.
 * - 터치 기기(거친 포인터): 지도 이동·노드 끌기를 끈다. force-graph가 캔버스에 붙이는 d3-zoom·d3-drag는 한 손가락 끌기를 가로채
 *   캔버스 위에서 페이지가 스크롤되지 않기 때문이다(d3-drag가 넣는 `touch-action: none`은 worlds.css가 되돌린다). 이동·확대·전체 보기는 캔버스 아래 버튼으로 한다.
 *   올리기가 없으므로 이름이 숨은 노드는 첫 탭에 이름만 보이고(`shown`) 같은 노드를 다시 누르면 연다. 이름이 이미 보이는 노드(`labelShown`)는 바로 연다.
 * ponytail: 거친 포인터인지는 처음 한 번만 읽는다. 터치 화면이 달린 노트북(주 포인터가 마우스)은 마우스 규칙을 따른다.
 */
export function useNodePointer<N extends { id: string }>(labelShown: (node: N, shown?: string) => boolean, onOpen: (node: N) => void) {
  const [coarse] = useState(() => window.matchMedia?.('(pointer: coarse)').matches ?? false)
  const [shown, setShown] = useState<string>()
  return {
    coarse, shown,
    graphProps: {
      enablePanInteraction: !coarse,
      enableNodeDrag: !coarse,
      onNodeHover: coarse ? undefined : (node: N | null) => setShown(node?.id),
      onNodeClick: (node: N) => (!coarse || labelShown(node, shown) ? onOpen(node) : setShown(node.id)),
    },
  }
}
