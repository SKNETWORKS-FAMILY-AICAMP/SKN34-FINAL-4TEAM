import { appContainer } from '../../../../app/appContainer'
import type { LlmOpsUseCase } from '../../../../domain/usecases/LlmOpsUseCase'
import type { OperationsDashboardUseCase } from '../../../../domain/usecases/OperationsDashboardUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 운영 대시보드(DEC-55) 카드를 한 번에 읽습니다. 출처 하나가 실패하면 서버가 그 칸만 비워 주므로 화면이 0으로 채우지 않습니다. */
export function useDashboardViewModel(useCase: OperationsDashboardUseCase = appContainer.resolve('operationsDashboardUseCase')) {
  return useAsyncData(() => useCase.dashboard(), [useCase])
}

/** 대시보드 차트용 최근 7일 날짜별 AI 사용. 카드와 따로 읽어 한쪽 실패가 다른 쪽을 가리지 않습니다. 조회 권한(llm)이 없으면 data가 null입니다. */
export function useWeeklyUsageViewModel(useCase: LlmOpsUseCase = appContainer.resolve('llmOpsUseCase')) {
  return useAsyncData(() => useCase.weeklyMetrics(), [useCase])
}
