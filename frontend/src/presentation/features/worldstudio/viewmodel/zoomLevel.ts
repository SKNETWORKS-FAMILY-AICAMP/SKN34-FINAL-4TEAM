/** 관계도 시맨틱 줌(옵시디언식): 멀리 보면 점, 가까이 가면 카드. 단계는 확대 배율 하나로 정한다. */
export type ZoomLevel = 'far' | 'mid' | 'near'
/** 0.5 미만은 far(점·가는 선), 0.9 이상은 near(카드·점), 그 사이는 mid(점 + 이름·관계 라벨). */
const FAR_BELOW = 0.5, NEAR_FROM = 0.9
export const zoomLevel = (zoom: number): ZoomLevel => (zoom < FAR_BELOW ? 'far' : zoom < NEAR_FROM ? 'mid' : 'near')
/** 점을 눌러 그 카드로 옮겨 갈 때의 배율: near 바로 아래라 이름·관계 라벨까지만 보이고 카드로 바뀌지는 않는다. */
export const ZOOM_TO_NODE = 0.85

/** 점 지름의 범위(캔버스 단위). 멀리 볼 때의 배율(약 0.3)에서 화면 14~64px쯤이다. */
export const DOT_MIN = 44, DOT_MAX = 200
/** 카드마다 이어진 관계 수: 관계 하나가 양쪽 끝 카드에 한 번씩 더해진다. 그래프에 없는 끝점은 세지 않는다. */
export function degrees(ids: readonly string[], links: readonly { source: string; target: string }[]): Map<string, number> {
  const count = new Map(ids.map((id) => [id, 0]))
  for (const { source, target } of links) {
    if (count.has(source)) count.set(source, count.get(source)! + 1)
    if (count.has(target)) count.set(target, count.get(target)! + 1)
  }
  return count
}
/** 점 지름: 관계가 많을수록 크다. 면적이 관계 수에 비례하도록 √로 늘린다(관계 수에 비례해 지름을 늘리면 허브가 화면을 덮는다). */
export const dotDiameter = (degree: number, maxDegree: number) => Math.round(DOT_MIN + (DOT_MAX - DOT_MIN) * (maxDegree > 0 ? Math.sqrt(Math.min(degree, maxDegree) / maxDegree) : 0))

/** 멀리 볼 때 이름을 붙이는 카드 수: 약 10%, 최소 3개·최대 12개. */
export const labelLimit = (count: number) => Math.min(12, Math.max(3, Math.ceil(count * 0.1)))
/** 멀리 볼 때 이름을 붙이는 카드: 관계가 있는 카드 중 관계가 많은 쪽부터 `limit`개(같으면 `order`에서 앞선 카드). */
export function topDegreeIds(order: readonly string[], degree: ReadonlyMap<string, number>, limit: number): Set<string> {
  const ranked = order.map((id, index) => ({ id, index, n: degree.get(id) ?? 0 })).filter((row) => row.n > 0)
  return new Set(ranked.sort((a, b) => b.n - a.n || a.index - b.index).slice(0, limit).map((row) => row.id))
}
