/** 원작에서 이어받은 회차 번호를 '1~2화, 4화'처럼 이어진 묶음으로 줄여 쓴다. 이어받은 회차가 없으면 빈 문자열이다. */
export function inheritedRangeLabel(episodes: readonly { number: number; inherited: boolean }[]): string {
  const runs: [from: number, to: number][] = []
  for (const n of episodes.filter((e) => e.inherited).map((e) => e.number).sort((a, b) => a - b)) {
    const last = runs.at(-1)
    if (last && n === last[1] + 1) last[1] = n
    else runs.push([n, n])
  }
  return runs.map(([from, to]) => (from === to ? `${from}화` : `${from}~${to}화`)).join(', ')
}
