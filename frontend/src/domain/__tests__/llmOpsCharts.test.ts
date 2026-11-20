import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { EvaluationMetric, MetricRow } from '../entities/llmOps'
import { RATIO_DOMAIN, costSummary, evaluationSummary, latencySummary, requestsSummary, usagePoints, usageTotals } from '../entities/llmOpsCharts'

const row = (key: string, patch: Partial<MetricRow> = {}): MetricRow => ({
  key, requests: 10, failureRate: 0.1, timeoutRate: 0, p50LatencyMs: 800, p95LatencyMs: 2000, inputTokens: 1000, outputTokens: 300, costUser: 0.01, costPlatform: 0.02, ...patch,
})

describe('지표 행 → 차트 점', () => {
  it('날짜는 오래된 날부터 세우고, 서버가 준 한국시간 날짜를 시간대 변환 없이 월/일 라벨로 보인다', () => {
    const points = usagePoints([row('2026-11-19'), row('2026-11-05'), row('2026-12-01'), row('2027-01-01')], 'day')
    expect(points.map((p) => p.key)).toEqual(['2026-11-05', '2026-11-19', '2026-12-01', '2027-01-01'])
    expect(points.map((p) => p.label)).toEqual(['11/5', '11/19', '12/1', '1/1'])
    // 날짜 모양이 아닌 키는 그대로 보인다.
    expect(usagePoints([row('unknown')], 'day')[0].label).toBe('unknown')
  })

  it('비어 온 값은 0이 아니라 null로 두고(차트가 빈 칸·선 끊김), 진짜 0은 0으로 둔다', () => {
    const [empty, zero] = usagePoints([row('2026-11-18', { failureRate: null, p95LatencyMs: undefined }), row('2026-11-19', { failureRate: 0, p95LatencyMs: 0 })], 'day')
    expect(empty).toMatchObject({ failureRate: null, p95LatencyMs: null })
    expect(zero).toMatchObject({ failureRate: 0, p95LatencyMs: 0 })
  })

  it('기능·모델은 비용(사용자+플랫폼)이 큰 순서로 세우고 같으면 이름순이며, 라벨은 키 그대로다', () => {
    const points = usagePoints([
      row('writing', { costUser: 0, costPlatform: 0.1 }), row('qa', { costUser: 0.2, costPlatform: 0.1 }), row('manuscript_review', { costUser: 0.1, costPlatform: 0 }), row('embed', { costUser: 0, costPlatform: 0.1 }),
    ], 'feature')
    expect(points.map((p) => p.label)).toEqual(['qa', 'embed', 'manuscript_review', 'writing'])
    expect(usagePoints([row('gpt-demo'), row('2026-11-19')], 'model').map((p) => p.label).sort()).toEqual(['2026-11-19', 'gpt-demo'])
  })
})

describe('차트 합계와 요약 문장', () => {
  const week = usagePoints([
    row('2026-11-18', { requests: 10, failureRate: 0.1, p95LatencyMs: 1500, costUser: 0.5, costPlatform: 0.25 }),
    row('2026-11-19', { requests: 30, failureRate: 0.2, p95LatencyMs: 4200, costUser: 0.25, costPlatform: 0.5 }),
  ], 'day')

  it('요청·비용은 더하고 실패율은 요청 수로 가중하며 p95는 가장 느린 날의 값이다', () => {
    expect(usageTotals(week)).toEqual({ requests: 40, failureRate: 0.175, maxP95LatencyMs: 4200, costUser: 0.75, costPlatform: 0.75 })
  })

  it('실패율이 비어 온 날은 평균에서 빼고, 모두 비면 0이 아니라 null이다', () => {
    const withGap = usagePoints([row('2026-11-18', { requests: 10, failureRate: 0.5 }), row('2026-11-19', { requests: 90, failureRate: null, p95LatencyMs: null })], 'day')
    expect(usageTotals(withGap)).toMatchObject({ requests: 100, failureRate: 0.5, maxP95LatencyMs: 2000 })
    const empty = usagePoints([row('2026-11-19', { failureRate: undefined, p95LatencyMs: undefined })], 'day')
    expect(usageTotals(empty)).toMatchObject({ failureRate: null, maxP95LatencyMs: null })
    expect(usageTotals([])).toEqual({ requests: 0, failureRate: null, maxP95LatencyMs: null, costUser: 0, costPlatform: 0 })
  })

  it('요청·실패율 요약은 합계 요청 수와 가중 실패율이고, 값이 없으면 데이터 없음이다', () => {
    expect(requestsSummary('최근 7일', usagePoints([row('2026-11-19', { requests: 23, failureRate: 0.04 })], 'day'))).toBe('최근 7일 요청 23건, 실패율 4%')
    expect(requestsSummary('최근 7일', week)).toBe('최근 7일 요청 40건, 실패율 17.5%')
    expect(requestsSummary('최근 7일', usagePoints([row('2026-11-19', { failureRate: null })], 'day'))).toBe('최근 7일 요청 10건, 실패율 데이터 없음')
  })

  it('지연 요약은 요청·실패율 요약에 가장 느린 날의 p95를 더하고, 없으면 데이터 없음이다', () => {
    expect(latencySummary('최근 7일', week)).toBe('최근 7일 요청 40건, 실패율 17.5%, p95 지연 최대 4,200ms')
    expect(latencySummary('최근 24시간', usagePoints([row('2026-11-19', { p95LatencyMs: null })], 'day'))).toBe('최근 24시간 요청 10건, 실패율 10%, p95 지연 데이터 없음')
  })

  it('비용 요약은 사용자·플랫폼 부담 합계(USD)다', () => {
    expect(costSummary('최근 7일', week)).toBe('최근 7일 비용 사용자 $0.7500, 플랫폼 $0.7500')
    expect(costSummary('최근 30일 기능별', [])).toBe('최근 30일 기능별 비용 사용자 $0.0000, 플랫폼 $0.0000')
  })

  it('평가 요약은 지표마다 점수와 있으면 기준을 말한다', () => {
    const metrics: EvaluationMetric[] = [{ name: 'faithfulness', score: 0.78, baseline: 0.9, delta: -0.12 }, { name: 'answer_relevancy', score: 0.91, baseline: null }]
    expect(evaluationSummary(metrics)).toBe('평가 지표 2개: faithfulness 점수 0.780 기준 0.900, answer_relevancy 점수 0.910 기준 없음')
  })
})

describe('비율 축 범위', () => {
  it('실패율·시간 초과율·평가 점수 축은 0~1(0~100%)로 고정한다', () => {
    expect(RATIO_DOMAIN).toEqual([0, 1])
  })

  // 범위를 자동에 맡기면 값이 모두 0일 때 0~4(=0~400%)로 잡힌다(실데이터 E2E에서 확인). jsdom은 크기를 못 재 그림을 볼 수 없으니 연결을 소스에서 지킨다.
  it('차트의 실패율 축과 점수 축은 모두 이 상수를 쓴다', () => {
    const source = readFileSync(new URL('../../presentation/features/admin/view/AdminCharts.tsx', import.meta.url), 'utf8')
    const axes = source.match(/<YAxis[^>]*(?:yAxisId="rate"|domain=)[^>]*>/g) ?? []
    expect(axes.length).toBeGreaterThan(0)
    for (const axis of axes) expect(axis).toContain('domain={RATIO_DOMAIN}')
  })
})
