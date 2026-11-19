import { count, millis, percent, usd, type EvaluationMetric, type MetricRow, type MetricsGroup } from './llmOps'

/**
 * 운영 차트(DEC-55)에 그릴 값. 지표 행 하나가 점 하나이고, 비어 온 값(null·생략)은 0으로 바꾸지 않고 null로 둡니다.
 * 그래야 차트가 그 자리를 비우고 선을 끊습니다(진짜 0과 구분).
 */
export type UsagePoint = {
  key: string; label: string; requests: number
  failureRate: number | null; p95LatencyMs: number | null
  costUser: number; costPlatform: number
}

/**
 * 비율(0~1) 축의 고정 범위: 실패율·시간 초과율·평가 점수. 범위를 자동에 맡기면 값이 모두 0일 때 0~4(=0~400%)로 잡혀서 고정합니다.
 */
export const RATIO_DOMAIN: [number, number] = [0, 1]

/** 날짜 묶음의 키는 서버가 한국시간(Asia/Seoul)으로 자른 달력 날짜(YYYY-MM-DD)라 시간대를 다시 바꾸지 않고 글자에서 월/일만 뽑습니다. */
const dayLabel = (key: string) => {
  const date = /^\d{4}-(\d{2})-(\d{2})$/.exec(key)
  return date ? `${Number(date[1])}/${Number(date[2])}` : key
}
const totalCost = (point: UsagePoint) => point.costUser + point.costPlatform

/** 날짜는 오래된 날부터, 기능·모델은 비용이 큰 것부터 세웁니다(서버는 날짜만 정렬하고 나머지는 요청 수 순이라 비용 차트에 맞게 다시 세웁니다). */
export function usagePoints(rows: MetricRow[], groupBy: MetricsGroup): UsagePoint[] {
  const points = rows.map((row) => ({
    key: row.key, label: groupBy === 'day' ? dayLabel(row.key) : row.key, requests: row.requests,
    failureRate: row.failureRate ?? null, p95LatencyMs: row.p95LatencyMs ?? null, costUser: row.costUser, costPlatform: row.costPlatform,
  }))
  return points.sort(groupBy === 'day' ? (a, b) => a.key.localeCompare(b.key) : (a, b) => totalCost(b) - totalCost(a) || a.key.localeCompare(b.key))
}

/** 요청·비용은 더하고, 실패율은 요청 수로 가중하며(비어 온 날은 뺌), p95는 가장 느린 날의 값입니다. 값이 하나도 없으면 null입니다. */
export function usageTotals(points: UsagePoint[]) {
  let requests = 0, rated = 0, failed = 0, costUser = 0, costPlatform = 0, maxP95LatencyMs: number | null = null
  for (const point of points) {
    requests += point.requests
    costUser += point.costUser
    costPlatform += point.costPlatform
    if (point.failureRate !== null) { rated += point.requests; failed += point.requests * point.failureRate }
    if (point.p95LatencyMs !== null) maxP95LatencyMs = Math.max(maxP95LatencyMs ?? 0, point.p95LatencyMs)
  }
  return { requests, failureRate: rated > 0 ? failed / rated : null, maxP95LatencyMs, costUser, costPlatform }
}

// 차트 한 장을 말로 옮긴 요약(role="img"의 aria-label). 자세한 값은 차트 아래 표·카드에 있습니다.
export const requestsSummary = (period: string, points: UsagePoint[]) => {
  const { requests, failureRate } = usageTotals(points)
  return `${period} 요청 ${count(requests)}건, 실패율 ${percent(failureRate)}`
}
export const latencySummary = (period: string, points: UsagePoint[]) => {
  const { maxP95LatencyMs } = usageTotals(points)
  return `${requestsSummary(period, points)}, p95 지연 ${maxP95LatencyMs === null ? '데이터 없음' : `최대 ${millis(maxP95LatencyMs)}`}`
}
export const costSummary = (period: string, points: UsagePoint[]) => {
  const { costUser, costPlatform } = usageTotals(points)
  return `${period} 비용 사용자 ${usd(costUser)}, 플랫폼 ${usd(costPlatform)}`
}
export const evaluationSummary = (metrics: EvaluationMetric[]) =>
  `평가 지표 ${metrics.length}개: ${metrics.map((m) => `${m.name} 점수 ${m.score.toFixed(3)} 기준 ${m.baseline == null ? '없음' : m.baseline.toFixed(3)}`).join(', ')}`
