import type { Alert, AlertStatus } from '../entities/operationsAlert'
import type { Dashboard } from '../entities/operationsDashboard'

/** 운영 대시보드·경고 API 계약(DEC-55). 대시보드는 운영자 누구나, 경고 조회·처리는 llm 또는 jobs 권한으로 호출합니다. */
export interface OperationsDashboardRepository {
  dashboard(): Promise<Dashboard>
  /** 상태를 고르지 않으면(null) 서버가 최신 100개를 줍니다. */
  alerts(status: AlertStatus | null): Promise<Alert[]>
  updateAlert(id: string, status: 'acknowledged' | 'resolved', note: string): Promise<void>
}
