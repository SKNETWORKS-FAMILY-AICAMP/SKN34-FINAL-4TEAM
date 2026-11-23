import { createPortal } from 'react-dom'

import { LLM_FORBIDDEN } from '../../../../domain/entities/llmOps'
import { usagePoints } from '../../../../domain/entities/llmOpsCharts'
import { dashboardCards } from '../../../../domain/entities/operationsDashboard'
import { Go } from '../../../shared/Go'
import { useDashboardViewModel, useWeeklyUsageViewModel } from '../viewmodel/useDashboardViewModel'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { CostChart, RequestsChart } from './AdminCharts'
import { LiveState } from './OperationsPanels'
import { ServiceMetrics } from './ServiceMetrics'

type VM = ReturnType<typeof useAdminViewModel>

/** 85 운영 대시보드: 운영 서버·Langfuse·Content·Core를 합친 현황. 위에서부터 요약 카드 → 서비스 지표 → 최근 7일 AI 사용 순서이고, 출처를 읽지 못한 칸은 0이 아니라 '불러오지 못함'입니다. */
export function OperationsDashboard({ vm, headSide }: { vm: VM; headSide: HTMLElement | null }) {
  const dashboard = useDashboardViewModel()
  const usage = useWeeklyUsageViewModel()
  const data = dashboard.data
  return (
    <>
      {/* 새로고침은 다른 탭처럼 제목 줄 오른쪽(AdminPage가 비워 둔 머리 자리)에 둡니다. 조회 상태는 이 화면의 훅이 가져서 포털로 옮깁니다. */}
      {headSide && createPortal(
        <button type="button" className="btn sm" disabled={dashboard.isRefreshing || usage.isRefreshing} onClick={() => { dashboard.retry(); usage.retry() }}>새로고침</button>,
        headSide,
      )}
      <LiveState vm={vm} label="운영 현황" state={dashboard} />
      {data && (
        <>
          <div className="admin-summary">
            {dashboardCards(data).map((card) => (
              <div key={card.key}>
                <small>{card.label}</small>
                <b className={card.value === null ? 'unavailable' : undefined}>{card.value ?? '불러오지 못함'}</b>
                {card.details.map((line) => <span key={line} className="small muted">{line}</span>)}
                {card.to && <Go to={card.to} aria-label={`${card.label} 바로 가기`}>바로 가기</Go>}
              </div>
            ))}
          </div>
          {data.unavailable.length > 0 && (
            <p className="admin-data-state" role="status">일부 출처를 불러오지 못했어요: {data.unavailable.join(', ')}</p>
          )}
          <ServiceMetrics funnel={data.funnel} />
        </>
      )}
      <WeeklyUsage vm={vm} usage={usage} />
    </>
  )
}

const WEEK = '최근 7일'

/** 최근 7일 날짜별 AI 사용 차트. 지표 API는 llm 권한이 필요해, 없으면(403) 차트 자리에 안내만 보이고 실패는 0으로 채우지 않고 다시 불러오기를 보입니다. */
function WeeklyUsage({ vm, usage }: { vm: VM; usage: ReturnType<typeof useWeeklyUsageViewModel> }) {
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
