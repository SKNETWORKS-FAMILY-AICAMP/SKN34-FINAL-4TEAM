import { labelWidth } from './labelLayout'

/*
 * 관계도 그래프의 설정(옵시디언 그래프 뷰의 오른쪽 위 톱니)과 그 값이 되는 힘. 설정은 화면 상태일 뿐 저장하지 않는다.
 * 물리는 react-force-graph가 안에서 돌리는 d3-force-3d다: 중심·반발·연결 힘은 그 기본 힘의 세기를 바꾸고, 중력(가로세로비를 따르는 약한 중심력)과 이름표 포함 겹침 방지는 우리가 함수로 넣는다.
 */

export type GraphSettings = {
  /** 방향 있는 관계의 화살표(옵시디언처럼 기본 꺼짐). */
  arrows: boolean
  /** 텍스트 표시 임계값: 확대 배율이 이보다 작으면 이름표가 서서히 사라진다(관계 상위 노드의 이름은 남는다). */
  textThreshold: number
  /** 노드 크기 배수. */
  nodeSize: number
  /** 선 두께 배수. */
  linkWidth: number
  /** 중심력(0~1): 노드를 가운데로 당기는 중력의 세기. */
  center: number
  /** 반발력(0~20): 노드끼리 밀어내는 힘. */
  repel: number
  /** 연결 힘(0~1): 이어진 노드를 당기는 힘. */
  linkForce: number
  /** 연결 거리: 이어진 노드가 놓이려는 간격. */
  linkDistance: number
  /** 외톨이 표시: 관계가 하나도 없는 노드를 그린다. null이면 자동이다: 노드가 60개를 넘는 큰 세계관에서만 숨긴다(바깥에 점 고리를 만든다). */
  orphans: boolean | null
  /** 위성 노드 접기: 이웃이 하나뿐인 노드를 그 이웃(허브) 안으로 접는다(기본 켬, 보이는 노드가 60개를 넘을 때만 적용한다). */
  fold: boolean
}

/** 기본값: 시연 세계관(홍길동전 57노드·146관계)을 1100×700 캔버스에 맞추면 배율 0.9쯤이고 이름이 겹치지 않게 골랐다. 선 두께 1은 가장 가는 선(화면 1px)이다. */
export const DEFAULT_SETTINGS: GraphSettings = { arrows: false, textThreshold: 0.7, nodeSize: 1, linkWidth: 1, center: 0.5, repel: 6, linkForce: 0.7, linkDistance: 60, orphans: null, fold: true }
/** 외톨이를 자동으로 숨기고(`orphans`가 null) 위성을 접는 세계관 크기의 기준: 노드가 이 수를 넘을 때만이다. */
export const AUTO_MAX = 60
/** 슬라이더 범위: [최소, 최대, 간격]. */
export const RANGES = {
  textThreshold: [0, 3, 0.05], nodeSize: [0.4, 2.5, 0.05], linkWidth: [1, 4, 0.5], // 선 두께는 가장 가는 선(1)이 최소다
  center: [0, 1, 0.01], repel: [0, 20, 0.5], linkForce: [0, 1, 0.01], linkDistance: [20, 300, 5],
} as const satisfies Record<string, readonly [number, number, number]>

/** 설정 값을 d3 힘의 세기로 바꾼다: 중심력은 중력(`aspectGravity`의 세기, 0.2가 최대), 반발력은 음수 전하이고 외톨이는 약하게(1/6) 밀어내 무리 가장자리에 촘촘히 놓인다. */
export const forceParams = (s: GraphSettings) => ({ gravity: s.center * 0.2, charge: -s.repel * 30, orphanCharge: -s.repel * 5, linkStrength: s.linkForce, linkDistance: s.linkDistance })

/** 노드 하나가 차지하는 상자(중심 기준): 반쪽 폭, 위쪽 길이(점 반지름), 아래쪽 길이(점 반지름 + 이름표 간격 4 + 글자 12px의 줄 높이). */
export type LabelBox = { halfW: number; up: number; down: number }
/**
 * 이름표 포함 상자: 이름표는 화면 12px로 그려지므로 배율 1에서의 크기로 어림한다(글자 폭 + 여백 8). 긴 이름이 배치를 터뜨리지 않게 이름 쪽 반쪽 폭은 70까지만 센다.
 * 확대 배율이 1보다 작으면 이름표가 이보다 커 보이는데, 그때는 겹치는 이름표를 숨기는 규칙(`placeLabels`)이 맡는다.
 */
export const labelBox = (name: string, radius: number): LabelBox => ({ halfW: Math.max(radius, Math.min(70, (labelWidth(name, 12) + 8) / 2)), up: radius, down: radius + 4 + 12 * 1.3 })
/** 점만 차지하는 상자: 외톨이는 이름표 자리를 비우지 않아 수백 개여도 촘촘하다(이름표는 겹치면 숨는다). */
export const dotBox = (radius: number): LabelBox => ({ halfW: radius, up: radius, down: radius })

/**
 * 이름표를 포함한 겹침 방지 힘(사각형 충돌). 두 상자가 겹치면 덜 겹친 쪽 축으로 서로 밀어낸다(속도에 더한다). 그 축의 차이가 0이면(같은 자리 포함) 앞선 노드가 음의 쪽으로 갈라진다(난수 없음).
 * d3의 `forceCollide`는 원이라 이름표가 점 아래에 놓인 모양을 못 담고, 이 힘은 `alpha`와 상관없이 같은 비율로 밀어 식은 뒤에도 겹침이 풀린다.
 */
export function labelCollide<N extends { x?: number; y?: number; vx?: number; vy?: number }>(box: (node: N) => LabelBox, strength = 0.7, padding = 4) {
  let nodes: N[] = []
  const force = (_alpha: number) => {
    const boxes = nodes.map(box), n = nodes.length
    for (let i = 0; i < n; i++) {
      const a = nodes[i], ab = boxes[i], ax = (a.x ?? 0) + (a.vx ?? 0), ay = (a.y ?? 0) + (a.vy ?? 0)
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j], bb = boxes[j], dx = (b.x ?? 0) + (b.vx ?? 0) - ax, dy = (b.y ?? 0) + (b.vy ?? 0) - ay
        const overlapX = ab.halfW + bb.halfW + padding - Math.abs(dx)
        if (overlapX <= 0) continue
        const overlapY = Math.min(ab.down, dy + bb.down) - Math.max(-ab.up, dy - bb.up) + padding
        if (overlapY <= 0) continue
        if (overlapX < overlapY) {
          const push = (overlapX * strength) / 2 * (Math.sign(dx) || 1) // 차이가 0이면(같은 높이·같은 세로줄) 앞선 노드가 음의 쪽으로 갈라진다
          a.vx = (a.vx ?? 0) - push; b.vx = (b.vx ?? 0) + push
        } else {
          const push = (overlapY * strength) / 2 * (Math.sign(dy) || 1)
          a.vy = (a.vy ?? 0) - push; b.vy = (b.vy ?? 0) + push
        }
      }
    }
  }
  force.initialize = (all: N[]) => { nodes = all }
  return force
}
