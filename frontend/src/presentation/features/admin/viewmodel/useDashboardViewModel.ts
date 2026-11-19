import { appContainer } from '../../../../app/appContainer'
import type { OperationsDashboardUseCase } from '../../../../domain/usecases/OperationsDashboardUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 운영 대시보드(DEC-55) 카드를 한 번에 읽습니다. 출처 하나가 실패하면 서버가 그 칸만 비워 주므로 화면이 0으로 채우지 않습니다. */
export function useDashboardViewModel(useCase: OperationsDashboardUseCase = appContainer.resolve('operationsDashboardUseCase')) {
  return useAsyncData(() => useCase.dashboard(), [useCase])
}
