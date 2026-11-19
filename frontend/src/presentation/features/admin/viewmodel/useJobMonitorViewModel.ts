import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { JobRunQuery } from '../../../../domain/entities/jobMonitor'
import type { JobMonitorUseCase } from '../../../../domain/usecases/JobMonitorUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

/**
 * 작업 감시(DEC-55): 실행 기록(상태·종류 조건, 0부터 쪽)과 정기 작업 일정을 읽고, 실패 재실행과 일정 등록·변경·취소를 요청합니다.
 * 변경 조치는 관리자 화면 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회를 한곳에서 합니다.
 */
export function useJobMonitorViewModel(mutate: AdminMutate, useCase: JobMonitorUseCase = appContainer.resolve('jobMonitorUseCase')) {
  const [query, setQuery] = useState<JobRunQuery>({ status: '', kind: '', page: 0 })
  const runs = useAsyncData(() => useCase.runs(query), [useCase, query])
  const schedules = useAsyncData(() => useCase.schedules(), [useCase])
  return {
    runs, schedules, query,
    applyFilters: (status: string, kind: string) => setQuery({ status, kind, page: 0 }),
    setPage: (page: number) => setQuery((current) => ({ ...current, page })),
    retry: (id: string) => mutate(`run:${id}`, '실패한 작업의 재실행을 요청했어요. 진행은 실행 기록에서 확인해 주세요.', () => useCase.retry(id)),
    createSchedule: (kind: string, cron: string, enabled: boolean, params: string) =>
      mutate('schedule:new', '정기 작업 일정을 등록했어요.', () => useCase.createSchedule(kind, cron, enabled, params)),
    updateSchedule: (id: string, kind: string, cron: string, enabled: boolean, params: string) =>
      mutate(`schedule:${id}`, '정기 작업 일정을 바꿨어요.', () => useCase.updateSchedule(id, kind, cron, enabled, params)),
    cancelSchedule: (id: string) => mutate(`schedule:${id}`, '정기 작업 일정을 취소했어요. 다시 쓰려면 일정을 수정해 켜 주세요.', () => useCase.cancelSchedule(id)),
  }
}
