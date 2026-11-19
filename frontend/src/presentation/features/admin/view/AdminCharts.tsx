import type { ReactElement } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { count, millis, percent, usd, type EvaluationMetric } from '../../../../domain/entities/llmOps'
import { costSummary, evaluationSummary, latencySummary, requestsSummary, type UsagePoint } from '../../../../domain/entities/llmOpsCharts'

// 색은 전역 테마 토큰이라 라이트·다크가 같이 바뀝니다. 옅은 --acc는 면 위에서 3:1이 안 되므로 같은 계열의 진한 --acc-ink 테두리를 두고(막대), 선은 --acc-ink를 씁니다.
const PRIMARY = { fill: 'var(--pri)' }
const AMBER = { fill: 'var(--acc)', stroke: 'var(--acc-ink)' }
const LINE = { type: 'monotone', strokeWidth: 2, dot: { r: 3, fill: 'var(--surface)', strokeWidth: 2 } } as const
const TICK = { fill: 'var(--sub)', fontSize: 12 }
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 }
const usdTick = (value: number) => `$${value}`

/** 마우스를 올렸을 때 보이는 값. 계열(dataKey)마다 표와 같은 단위로 보입니다. */
const TIP: Record<string, (value: number) => string> = {
  requests: (value) => `${count(value)}건`, failureRate: percent, p95LatencyMs: millis, costUser: usd, costPlatform: usd,
  score: (value) => value.toFixed(3), baseline: (value) => value.toFixed(3),
}
const tooltip = (
  <Tooltip
    formatter={(value, _name, item) => TIP[String(item.dataKey)]?.(Number(value)) ?? String(value)}
    cursor={{ fill: 'var(--muted-bg)' }}
    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 10, color: 'var(--ink)', fontSize: 13 }}
  />
)
const legend = <Legend iconSize={10} formatter={(name: string) => <span style={{ color: 'var(--ink2)' }}>{name}</span>} />

/**
 * 차트 한 장: 제목과, 값을 말로 옮긴 요약(role="img"의 aria-label)입니다. 같은 값이 차트 아래 표·카드에 있어 차트는 보조이므로
 * 그림 안은 키보드 초점(accessibilityLayer)을 받지 않습니다. 크기를 못 재는 환경(jsdom 등)에서는 그림 없이 이 틀만 남습니다.
 */
function ChartFrame({ title, summary, height = 260, children }: { title: string; summary: string; height?: number; children: ReactElement }) {
  return (
    <figure className="admin-chart">
      <figcaption>{title}</figcaption>
      <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
      </div>
    </figure>
  )
}

/** 날짜별 요청 수(막대, 왼쪽 축)와 실패율(선, 오른쪽 축). latency이면 p95 지연(선, 오른쪽 첫 축)도 그립니다. 비어 온 날은 선이 끊깁니다. */
export function RequestsChart({ period, points, latency = false }: { period: string; points: UsagePoint[]; latency?: boolean }) {
  return (
    <ChartFrame title={latency ? '날짜별 요청 수·p95 지연·실패율' : '날짜별 요청 수·실패율'} summary={(latency ? latencySummary : requestsSummary)(period, points)}>
      <ComposedChart data={points} margin={MARGIN} accessibilityLayer={false}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: 'var(--line2)' }} />
        <YAxis yAxisId="requests" allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} width={40} />
        {latency && <YAxis yAxisId="latency" orientation="right" tick={TICK} tickFormatter={millis} tickLine={false} axisLine={false} width={68} />}
        <YAxis yAxisId="rate" orientation="right" tick={TICK} tickFormatter={percent} tickLine={false} axisLine={false} width={44} />
        {tooltip}
        {legend}
        <Bar yAxisId="requests" dataKey="requests" name="요청 수" {...PRIMARY} maxBarSize={36} radius={[4, 4, 0, 0]} />
        {latency && <Line yAxisId="latency" dataKey="p95LatencyMs" name="p95 지연" stroke="var(--acc-ink)" {...LINE} />}
        <Line yAxisId="rate" dataKey="failureRate" name="실패율" stroke="var(--danger)" {...LINE} />
      </ComposedChart>
    </ChartFrame>
  )
}

/** 사용자 부담·플랫폼 부담 비용(USD)을 쌓은 막대. 날짜별은 세로로, 기능·모델별(horizontal)은 항목 수만큼 높이를 늘린 가로 막대입니다. */
export function CostChart({ title, period, points, horizontal = false }: { title: string; period: string; points: UsagePoint[]; horizontal?: boolean }) {
  return (
    <ChartFrame title={title} summary={costSummary(period, points)} height={horizontal ? Math.max(180, points.length * 40 + 60) : 260}>
      <BarChart data={points} layout={horizontal ? 'vertical' : 'horizontal'} margin={MARGIN} accessibilityLayer={false}>
        <CartesianGrid stroke="var(--line)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal
          ? [<XAxis key="x" type="number" tick={TICK} tickFormatter={usdTick} tickLine={false} axisLine={false} />, <YAxis key="y" type="category" dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: 'var(--line2)' }} width={110} />]
          : [<XAxis key="x" dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: 'var(--line2)' }} />, <YAxis key="y" tick={TICK} tickFormatter={usdTick} tickLine={false} axisLine={false} width={56} />]}
        {tooltip}
        {legend}
        <Bar dataKey="costUser" name="사용자 부담" stackId="cost" {...PRIMARY} maxBarSize={36} />
        <Bar dataKey="costPlatform" name="플랫폼 부담" stackId="cost" {...AMBER} maxBarSize={36} />
      </BarChart>
    </ChartFrame>
  )
}

/** 지표별 점수(0~1)와 기준(baseline) 묶음 막대. 기준이 하나도 없으면(첫 평가) 점수만 그립니다. */
export function EvaluationChart({ metrics }: { metrics: EvaluationMetric[] }) {
  return (
    <ChartFrame title="지표별 점수와 기준" summary={evaluationSummary(metrics)}>
      <BarChart data={metrics} margin={MARGIN} accessibilityLayer={false}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={{ stroke: 'var(--line2)' }} />
        <YAxis domain={[0, 1]} tick={TICK} tickLine={false} axisLine={false} width={40} />
        {tooltip}
        {legend}
        <Bar dataKey="score" name="점수" {...PRIMARY} maxBarSize={36} radius={[4, 4, 0, 0]} />
        {metrics.some((metric) => metric.baseline != null) && <Bar dataKey="baseline" name="기준(baseline)" {...AMBER} maxBarSize={36} radius={[4, 4, 0, 0]} />}
      </BarChart>
    </ChartFrame>
  )
}
