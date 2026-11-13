/** 지도 이동 버튼의 방향. 화면(보는 창)을 그쪽으로 옮긴다: 위는 위쪽 내용이 보이게 한다. */
export type PanDirection = 'up' | 'down' | 'left' | 'right'

/** 방향 버튼 한 번에 옮기는 양: 보이는 영역의 이 비율(네 번 누르면 한 화면). */
export const PAN_STEP = 0.25

/**
 * 방향 버튼을 누른 뒤의 화면 중심(그래프 좌표). 보이는 영역은 캔버스 크기를 확대 배율로 나눈 것이라,
 * 확대할수록 한 번에 옮기는 그래프 거리는 줄고 화면에서 움직이는 정도는 같다. y는 화면처럼 아래로 갈수록 크다.
 */
export function pannedCenter(center: { x: number; y: number }, direction: PanDirection, view: { width: number; height: number; zoom: number }) {
  const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0
  const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0
  return { x: center.x + dx * PAN_STEP * view.width / view.zoom, y: center.y + dy * PAN_STEP * view.height / view.zoom }
}
