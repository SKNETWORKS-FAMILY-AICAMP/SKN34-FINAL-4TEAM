import { dashboardCards } from '../../../../domain/entities/operationsDashboard'
import { Go } from '../../../shared/Go'
import { useDashboardViewModel } from '../viewmodel/useDashboardViewModel'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { LiveState } from './OperationsPanels'

type VM = ReturnType<typeof useAdminViewModel>

/** 85 운영 대시보드: 운영 서버·Langfuse·Content·Core를 합친 현황 카드. 출처를 읽지 못한 칸은 0이 아니라 '불러오지 못함'입니다. */
export function OperationsDashboard({ vm }: { vm: VM }) {
  const dashboard = useDashboardViewModel()
  const data = dashboard.data
  return (
    <>
      <div className="rowend admin-refresh">
        <button type="button" className="btn sm" disabled={dashboard.isRefreshing} onClick={dashboard.retry}>새로고침</button>
      </div>
      <LiveState vm={vm} label="운영 현황" state={dashboard} />
      {data && (
        <>
          {data.unavailable.length > 0 && (
            <p className="admin-data-state" role="status">
              일부 출처를 불러오지 못했어요: {data.unavailable.join(', ')}. 해당 칸은 ‘불러오지 못함’으로 보여요(0으로 채우지 않아요).
            </p>
          )}
          <div className="kpi">
            {dashboardCards(data).map((card) => (
              <div key={card.key}>
                <small>{card.label}</small>
                <b className={card.value === null ? 'unavailable' : undefined}>{card.value ?? '불러오지 못함'}</b>
                {card.details.map((line) => <span key={line} className="small muted">{line}</span>)}
                {card.to && <Go to={card.to}>바로 가기</Go>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
