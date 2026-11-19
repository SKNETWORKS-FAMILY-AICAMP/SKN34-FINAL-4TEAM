import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { AlertStatus } from '../../../../domain/entities/operationsAlert'
import type { OperationsDashboardUseCase } from '../../../../domain/usecases/OperationsDashboardUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

/**
 * 운영 경고(DEC-55): 고른 상태별 목록(처음엔 미확인)을 읽고, 확인·조치 완료를 메모와 함께 기록합니다. LLM Ops의 '경고' 보기가 씁니다.
 * 처리는 관리자 화면 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회를 한곳에서 합니다.
 */
export function useAlertsViewModel(mutate: AdminMutate, useCase: OperationsDashboardUseCase = appContainer.resolve('operationsDashboardUseCase')) {
  const [status, setStatus] = useState<AlertStatus | null>('open')
  // 조회 권한(llm·jobs)이 없으면 null이라 화면이 실패 대신 필요한 권한을 안내합니다.
  const alerts = useAsyncData(() => useCase.alerts(status), [useCase, status])
  const updateAlert = (id: string, next: 'acknowledged' | 'resolved', note: string) =>
    mutate(`alert:${id}`, next === 'resolved' ? '경고를 조치 완료로 기록했어요.' : '경고를 확인으로 기록했어요.', () => useCase.updateAlert(id, next, note))
  return { alerts, status, setStatus, updateAlert }
}
