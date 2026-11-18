/** 주소가 없는 진입만 첫 회차를 연다. 없는 번호를 다른 회차로 바꾸지 않는다. */
export function pickEpisode<T extends { number: number }>(rows: T[], wanted?: number) {
  return wanted === undefined ? rows[0] : rows.find((e) => e.number === wanted)
}
