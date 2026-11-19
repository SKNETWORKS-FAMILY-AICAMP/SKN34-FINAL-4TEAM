import { OperationsForbidden } from '../entities/operations'
import type { Alert, AlertStatus } from '../entities/operationsAlert'
import type { OperationsDashboardRepository } from '../repositories/OperationsDashboardRepository'

/** 운영 대시보드·경고(DEC-55). 칸별 실패(unavailable)는 서버가 정하고, 이 계층은 값을 바꾸지 않습니다. */
export class OperationsDashboardUseCase {
  private readonly repository: OperationsDashboardRepository
  constructor(repository: OperationsDashboardRepository) { this.repository = repository }

  dashboard() { return this.repository.dashboard() }

  /** 경고 조회 권한(llm·jobs)이 없으면(403) 실패가 아니라 null이라, 화면이 다시 불러오기 대신 권한 안내를 보입니다. */
  async alerts(status: AlertStatus | null): Promise<Alert[] | null> {
    try {
      return await this.repository.alerts(status)
    } catch (error) {
      if (error instanceof OperationsForbidden) return null
      throw error
    }
  }

  updateAlert(id: string, status: 'acknowledged' | 'resolved', note: string) { return this.repository.updateAlert(id, status, note.trim()) }
}
