/** 집필실이 처음 여는 회차: 주소의 ?ep=n 회차가 목록에 있으면 그 회차, 없거나 범위 밖이면 기존처럼 첫 회차다. */
export function pickEpisode<T extends { number: number }>(rows: T[], wanted?: number) {
  return rows.find((e) => e.number === wanted) ?? rows[0]
}
