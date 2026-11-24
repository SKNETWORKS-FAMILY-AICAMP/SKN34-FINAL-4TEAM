import { LLM_FORBIDDEN, METRICS_GROUPS, PERIODS, count, millis, percent, usd, type MetricRow } from '../../../../domain/entities/llmOps'
import { agentCards, latencyBarSummary, outcomeSummary, type AgentCard } from '../../../../domain/entities/llmOpsAgents'
import { usagePoints } from '../../../../domain/entities/llmOpsCharts'
import { aiCards } from '../../../../domain/entities/operationsDashboard'
import { useDashboardViewModel, useWeeklyUsageViewModel } from '../viewmodel/useDashboardViewModel'
import { CostChart, RequestsChart } from './AdminCharts'
import type { LlmVM, VM } from './LlmOps'
import { formText } from './formValue'
import { LiveState, SummaryBand, Table } from './OperationsPanels'

/**
 * LLM Ops 에이전트 지표(#857, 기본 쪽의 지표 보기): 위에서부터 AI 요청·경고 요약 카드 → 최근 7일 AI 사용 차트 → 에이전트(기능)별 카드와 지표 표입니다.
 * 요약 카드·7일 차트는 대시보드에서 옮겨 왔고 같은 API·규칙(권한 403 안내·실패 시 다시 불러오기·0으로 채우지 않음)을 그대로 씁니다.
 */
export function AgentMetrics({ vm, l }: { vm: VM; l: LlmVM }) {
  return (
    <>
      <AiOverview vm={vm} />
      <WeeklyUsage vm={vm} />
      <Metrics vm={vm} l={l} />
    </>
  )
}

/** AI 요청(오늘·최근 7일)과 미확인 경고 카드. 운영 대시보드 응답을 읽고 출처를 읽지 못한 칸은 '불러오지 못함'입니다. */
function AiOverview({ vm }: { vm: VM }) {
  const dashboard = useDashboardViewModel()
  const data = dashboard.data
  return (
    <section aria-label="AI 요청·경고 요약">
      <LiveState vm={vm} label="AI 요청 현황" state={dashboard} />
      {data && (
        <>
          <SummaryBand cards={aiCards(data)} />
          {data.unavailable.length > 0 && <p className="admin-data-state" role="status">일부 출처를 불러오지 못했어요: {data.unavailable.join(', ')}</p>}
        </>
      )}
    </section>
  )
}

const WEEK = '최근 7일'

/** 최근 7일 날짜별 AI 사용 차트. 지표 API는 llm 권한이 필요해, 없으면(403) 차트 자리에 안내만 보이고 실패는 0으로 채우지 않고 다시 불러오기를 보입니다. */
function WeeklyUsage({ vm }: { vm: VM }) {
  const usage = useWeeklyUsageViewModel()
  const metrics = usage.data
  const points = metrics ? usagePoints(metrics.rows, 'day') : []
  return (
    <section className="panel admin-operations admin-usage" aria-label="최근 7일 AI 사용">
      <h2>최근 7일 AI 사용</h2>
      <LiveState vm={vm} label="AI 사용 현황" state={usage} />
      {metrics === null && <p className="admin-data-state" role="status">{LLM_FORBIDDEN}</p>}
      {metrics && (points.length
        ? (
          <>
            <div className="admin-charts">
              <RequestsChart period={WEEK} points={points} />
              <CostChart title="날짜별 비용(USD)" period={WEEK} points={points} />
            </div>
            <p className="admin-note">한국시간 기준이에요. 요청이 없던 날은 보이지 않고, 처음·마지막 날은 7일 구간에 걸친 만큼만 더해요.</p>
          </>
        )
        : <p className="admin-empty">아직 데이터가 없어요.</p>)}
    </section>
  )
}

/** 기능별(기본)은 에이전트 카드, 날짜별·모델별은 차트로 보이고 어느 묶음이든 같은 값을 표로도 보입니다. 제안 채택률 같은 비율은 표 아래에 있습니다. */
function Metrics({ vm, l }: { vm: VM; l: LlmVM }) {
  const m = l.metrics.data, q = l.metricsQuery
  const groupLabel = METRICS_GROUPS.find(([value]) => value === q.groupBy)?.[1] ?? ''
  const periodLabel = PERIODS.find(([hours]) => hours === q.hours)?.[1] ?? ''
  const points = m ? usagePoints(m.rows, q.groupBy) : []
  return (
    <section className="panel admin-operations" aria-label="LLM 지표">
      <h2>{q.groupBy === 'feature' ? '에이전트별 지표' : `${groupLabel}별 지표`}</h2>
      <form
        className="admin-filter"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          l.setMetricsQuery({ hours: Number(formText(form, 'hours')), groupBy: METRICS_GROUPS.find(([value]) => value === formText(form, 'groupBy'))?.[0] ?? 'feature' })
        }}
      >
        <label className="field">기간<select className="inp" name="hours" defaultValue={q.hours}>{PERIODS.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}</select></label>
        <label className="field">
          묶음
          <select className="inp" name="groupBy" defaultValue={q.groupBy}>{METRICS_GROUPS.map(([value, label]) => <option key={value} value={value}>{label}별</option>)}</select>
        </label>
        <button type="submit" className="btn sm">조회</button>
      </form>
      <LiveState vm={vm} label="지표 현황" state={l.metrics} forbidden={LLM_FORBIDDEN} />
      {m && (
        <>
          {m.rows.length > 0 && (q.groupBy === 'feature'
            ? <AgentCards rows={m.rows} />
            : points.length > 0 && (q.groupBy === 'day'
              ? <RequestsChart latency period={periodLabel} points={points} />
              : <CostChart title={`${groupLabel}별 비용(USD)`} period={`${periodLabel} ${groupLabel}별`} points={points} horizontal />))}
          {m.rows.length
            ? (
              <Table label="LLM 지표 표">
                <thead>
                  <tr>
                    <th scope="col">{groupLabel}</th>
                    <th scope="col">요청</th>
                    <th scope="col">실패율</th>
                    <th scope="col">시간 초과율</th>
                    <th scope="col">p50 지연</th>
                    <th scope="col">p95 지연</th>
                    <th scope="col">토큰(입력/출력)</th>
                    <th scope="col">비용(사용자)</th>
                    <th scope="col">비용(플랫폼)</th>
                  </tr>
                </thead>
                <tbody>
                  {m.rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td>{count(row.requests)}</td>
                      <td>{percent(row.failureRate)}</td>
                      <td>{percent(row.timeoutRate)}</td>
                      <td>{millis(row.p50LatencyMs)}</td>
                      <td>{millis(row.p95LatencyMs)}</td>
                      <td>{count(row.inputTokens)} / {count(row.outputTokens)}</td>
                      <td>{usd(row.costUser)}</td>
                      <td>{usd(row.costPlatform)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
            : <p className="admin-empty">이 기간의 요청이 없어요.</p>}
          <div className="kpi">
            {([['제안 채택률', m.adoptionRate], ['수정안 승인률', m.approvalRate], ['필터 복원률', m.filterRestoreRate]] as const).map(([label, rate]) => (
              <div key={label}>
                <small>{label}</small>
                <b className={rate == null ? 'unavailable' : undefined}>{percent(rate)}</b>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="admin-note">카드 하나가 에이전트(기능) 하나예요. 작은 막대는 고른 기간 전체의 집계로 그리고, 같은 값은 카드 숫자와 아래 표에도 있어요. 사용자 부담 비용은 AI 요청이 크레딧을 차감하기 시작하면 0이 아니게 돼요. 필터 복원률은 콘텐츠 필터 기능이 생기기 전까지 데이터가 없어요.</p>
    </section>
  )
}

/** 에이전트(기능)별 카드 목록: 요청이 많은 기능부터. 지표 API에 기능별 날짜 추이가 없어 카드의 작은 막대는 그 기능의 집계로 그립니다. */
function AgentCards({ rows }: { rows: MetricRow[] }) {
  return (
    <ul className="agent-cards" aria-label="에이전트별 지표 카드">
      {agentCards(rows).map((card) => <li key={card.key}><AgentCardView card={card} /></li>)}
    </ul>
  )
}

const pct = (ratio: number) => `${Math.round(ratio * 1000) / 10}%`

function AgentCardView({ card }: { card: AgentCard }) {
  const { outcome, latency } = card
  return (
    <article className="agent-card" aria-label={`${card.label} 지표`}>
      <header className="agent-card-head">
        <h3>{card.label}</h3>
        {card.label !== card.key && <code>{card.key}</code>}
      </header>
      <p className="agent-card-main"><b>{count(card.requests)}</b><span>요청 · 전체의 {percent(card.share)}</span></p>
      <dl className="agent-card-nums">
        <div><dt>실패율</dt><dd>{percent(card.failureRate)}</dd></div>
        <div><dt>시간 초과율</dt><dd>{percent(card.timeoutRate)}</dd></div>
        <div><dt>p95 지연</dt><dd>{millis(card.p95LatencyMs)}</dd></div>
        <div><dt>비용</dt><dd>{usd(card.costUser + card.costPlatform)}</dd></div>
      </dl>
      <div className="agent-meter">
        <p className="agent-meter-head">
          <span>처리 결과</span>
          {outcome ? <span className="agent-legend"><i className="ok">성공 {count(outcome.success)}</i><i className="bad">실패 {count(outcome.failed)}</i><i className="wait">시간 초과 {count(outcome.timeout)}</i></span> : <span>데이터 없음</span>}
        </p>
        <div className="agent-bar" role="img" aria-label={outcomeSummary(card)}>
          {outcome && ([['ok', outcome.success], ['bad', outcome.failed], ['wait', outcome.timeout]] as const).map(([part, n]) => n > 0 && <i key={part} className={part} style={{ flexGrow: n }} />)}
        </div>
      </div>
      <div className="agent-meter">
        <p className="agent-meter-head">
          <span>지연</span>
          <span>{latency ? `p50 ${millis(card.p50LatencyMs)} · p95 ${millis(card.p95LatencyMs)}` : '데이터 없음'}</span>
        </p>
        <div className="agent-bar agent-bar-latency" role="img" aria-label={latencyBarSummary(card)}>
          {latency && <><i className="p50" style={{ width: pct(latency.p50) }} /><i className="p95" style={{ left: pct(latency.p95) }} /></>}
        </div>
      </div>
    </article>
  )
}
