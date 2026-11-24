import { createPortal } from 'react-dom'

import { serviceCards } from '../../../../domain/entities/operationsDashboard'
import { useDashboardViewModel } from '../viewmodel/useDashboardViewModel'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { LiveState, SummaryBand } from './OperationsPanels'
import { ServiceMetrics } from './ServiceMetrics'

type VM = ReturnType<typeof useAdminViewModel>

/**
 * 85 대시보드(서비스 지표만, #857): 운영 서버·Content·Core를 합친 현황. 위에서부터 서비스 지표 카드(회원·작업·미처리 업무) → 서비스 지표(전체 기간) 순서이고,
 * 출처를 읽지 못한 칸은 0이 아니라 '불러오지 못함'입니다. AI 요청·미확인 경고 카드와 최근 7일 AI 사용 차트는 LLM Ops 에이전트 지표 위에 있습니다.
 */
export function OperationsDashboard({ vm, headSide }: { vm: VM; headSide: HTMLElement | null }) {
  const dashboard = useDashboardViewModel()
  const data = dashboard.data
  return (
    <>
      {/* 새로고침은 다른 탭처럼 제목 줄 오른쪽(AdminPage가 비워 둔 머리 자리)에 둡니다. 조회 상태는 이 화면의 훅이 가져서 포털로 옮깁니다. */}
      {headSide && createPortal(
        <button type="button" className="btn sm" disabled={dashboard.isRefreshing} onClick={dashboard.retry}>새로고침</button>,
        headSide,
      )}
      <LiveState vm={vm} label="운영 현황" state={dashboard} />
      {data && (
        <>
          <SummaryBand cards={serviceCards(data)} />
          {data.unavailable.length > 0 && (
            <p className="admin-data-state" role="status">일부 출처를 불러오지 못했어요: {data.unavailable.join(', ')}</p>
          )}
          <ServiceMetrics funnel={data.funnel} />
        </>
      )}
    </>
  )
}
